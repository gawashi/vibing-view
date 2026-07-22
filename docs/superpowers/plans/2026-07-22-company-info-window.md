# Company Info Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show company info in separate, non-modal OS windows (one per symbol) so the main chart screen stays fully interactive.

**Architecture:** Company windows reuse the existing renderer bundle — a new `BrowserWindow` loads the same `index.html` with a `#company=SYMBOL` hash; `main.tsx` branches on that hash to mount `<CompanyWindow>` instead of `<App>`. The main process keeps a `Map<symbol, BrowserWindow>` so a repeat symbol re-focuses and a new symbol spawns a second window. The old Radix modal, its store state, and its App mount are deleted.

**Tech Stack:** Electron (`BrowserWindow`, `ipcMain`), TypeScript, React, TanStack Query, Vitest.

## Global Constraints

- Pin Vite at `^7` (do not touch build config in this plan).
- Renderer imports the preload bridge only via `@/api` (`window.api`) — never touch `window.api` elsewhere.
- Tests live in `tests/**/*.test.ts`, `environment: 'node'`, run with `npm test`. Import source by relative path (e.g. `../src/shared/...`); `@shared` alias also resolves.
- SQLite = OHLCV cache / JSON = user preferences (unchanged here; the `company:info` service already owns its TTL/DB cache).

---

### Task 1: Shared hash helper

**Files:**
- Create: `src/shared/companyWindow.ts`
- Test: `tests/companyWindow.test.ts`

**Interfaces:**
- Produces:
  - `buildCompanyHash(symbol: string): string` — returns `"company=<encoded>"` (no leading `#`).
  - `parseCompanySymbol(hash: string): string | null` — accepts `location.hash` (with or without leading `#`); returns the decoded symbol or `null`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/companyWindow.test.ts
import { describe, it, expect } from 'vitest'
import { buildCompanyHash, parseCompanySymbol } from '../src/shared/companyWindow'

describe('company window hash', () => {
  it('round-trips a plain symbol', () => {
    expect(parseCompanySymbol('#' + buildCompanyHash('AAPL'))).toBe('AAPL')
  })

  it('parses a hash with a leading #', () => {
    expect(parseCompanySymbol('#company=MSFT')).toBe('MSFT')
  })

  it('parses a hash without a leading #', () => {
    expect(parseCompanySymbol('company=MSFT')).toBe('MSFT')
  })

  it('round-trips a symbol needing encoding', () => {
    expect(parseCompanySymbol('#' + buildCompanyHash('BRK.B'))).toBe('BRK.B')
  })

  it('returns null when there is no company param', () => {
    expect(parseCompanySymbol('')).toBeNull()
    expect(parseCompanySymbol('#foo=bar')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/companyWindow.test.ts`
Expected: FAIL — cannot resolve `../src/shared/companyWindow`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/companyWindow.ts
// Company-info windows reuse the main renderer bundle; the target symbol rides in the URL hash
// (#company=SYMBOL). main.tsx branches on parseCompanySymbol; main-process index.ts builds the URL
// with buildCompanyHash. Shared here so both sides agree on the exact format.
export function buildCompanyHash(symbol: string): string {
  return `company=${encodeURIComponent(symbol)}`
}

export function parseCompanySymbol(hash: string): string | null {
  const q = hash.startsWith('#') ? hash.slice(1) : hash
  return new URLSearchParams(q).get('company')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/companyWindow.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/companyWindow.ts tests/companyWindow.test.ts
git commit -m "feat(company): shared company-window hash helper"
```

---

### Task 2: IPC channel, preload, and Api type

**Files:**
- Modify: `src/shared/ipc.ts` (add channel constant + `Api.company.openWindow`)
- Modify: `src/preload/index.ts` (expose `company.openWindow`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `CH.companyOpenWindow === 'company:openWindow'`
  - `window.api.company.openWindow(symbol: string): Promise<void>` (used by Tasks 3 and 5).

- [ ] **Step 1: Add the channel constant**

In `src/shared/ipc.ts`, in the `CH` object, change the `companyInfo` line to add the new channel after it:

```ts
  companyInfo: 'company:info',
  companyOpenWindow: 'company:openWindow'
} as const
```

- [ ] **Step 2: Add the Api method type**

In `src/shared/ipc.ts`, extend the `company` block of `interface Api`:

```ts
  company: {
    info(symbol: string): Promise<CompanyInfo>
    openWindow(symbol: string): Promise<void>
  }
```

- [ ] **Step 3: Expose it in preload**

In `src/preload/index.ts`, extend the `company` block:

```ts
  company: {
    info: (symbol) => ipcRenderer.invoke(CH.companyInfo, symbol),
    openWindow: (symbol) => ipcRenderer.invoke(CH.companyOpenWindow, symbol)
  }
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors). The renderer callers don't exist yet, but the type additions compile on their own.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts
git commit -m "feat(company): add company:openWindow IPC channel"
```

---

### Task 3: Main process — open/focus company windows

**Files:**
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `buildCompanyHash` (Task 1), `CH.companyOpenWindow` (Task 2).
- Produces: an `ipcMain.handle(CH.companyOpenWindow, ...)` that creates or focuses a per-symbol window.

**Notes:** Company windows are top-level (no `parent`) so they can move to another monitor. Closing the main window closes all company windows, so `window-all-closed` fires and the app quits on Windows.

- [ ] **Step 1: Replace `src/main/index.ts` with the window-aware version**

```ts
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { registerIpc } from './ipc'
import { configureProxy } from './net/httpClient'
import { CH } from '@shared/ipc'
import { buildCompanyHash } from '@shared/companyWindow'

// One company-info window per symbol (spec: side-by-side compare). Reopening a live symbol focuses
// its window; a new symbol spawns another. Cleared on 'closed'.
const companyWindows = new Map<string, BrowserWindow>()

// Load the shared renderer bundle, optionally with a hash (e.g. company=AAPL) that main.tsx reads
// to mount CompanyWindow instead of App. Dev serves from ELECTRON_RENDERER_URL; prod loads the file.
function loadRenderer(win: BrowserWindow, hash?: string): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + (hash ? '#' + hash : ''))
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0B0E11',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.on('ready-to-show', () => win.show())
  // Closing the main window tears down company windows so window-all-closed fires → app quits.
  win.on('closed', () => {
    for (const w of companyWindows.values()) w.close()
  })
  loadRenderer(win)
}

function openCompanyWindow(symbol: string): void {
  const existing = companyWindows.get(symbol)
  if (existing) {
    existing.focus()
    return
  }
  const win = new BrowserWindow({
    width: 480,
    height: 680,
    backgroundColor: '#0B0E11',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  companyWindows.set(symbol, win)
  win.on('ready-to-show', () => win.show())
  win.on('closed', () => companyWindows.delete(symbol))
  loadRenderer(win, buildCompanyHash(symbol))
}

app.whenReady().then(async () => {
  // Route provider HTTP through the OS/system proxy (or HTTP(S)_PROXY) before any fetch runs —
  // corporate networks block direct egress, so an unconfigured client times out (see net/httpClient).
  await configureProxy()
  registerIpc()
  ipcMain.handle(CH.companyOpenWindow, (_e, symbol: string) => openCompanyWindow(symbol))
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(company): open/focus per-symbol company windows in main"
```

---

### Task 4: Renderer — CompanyWindow component + main.tsx branch

**Files:**
- Rename/replace: `src/renderer/components/CompanyInfoDialog.tsx` → `src/renderer/components/CompanyWindow.tsx`
- Modify: `src/renderer/main.tsx`

**Interfaces:**
- Consumes: `parseCompanySymbol` (Task 1).
- Produces: `CompanyWindow({ symbol }: { symbol: string })` default-mounted when the hash carries a company symbol.

**Notes:** Keep `CompanyInfoBody`, `Attr`, and `fmtCompact` verbatim — only the exported wrapper changes (drop the Radix `Dialog`; wrap in a full-window scroll container). Window title = symbol (dropping the "update to company name" nicety per YAGNI).

- [ ] **Step 1: Create `src/renderer/components/CompanyWindow.tsx`**

Copy the current `CompanyInfoDialog.tsx` and change only the imports (drop `Dialog*`, add `useEffect`) and the exported component at the bottom. The file becomes:

```tsx
import React, { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, qk } from '@/api'
import type { CompanyInfo } from '@shared/types'

const fmtCompact = (n: number): string =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n)

// 値が null/空なら行ごと出さない（未取得フィールドで空ラベルが並ぶのを防ぐ）。
function Attr({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element | null {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  )
}

function CompanyInfoBody({ symbol }: { symbol: string }): React.JSX.Element {
  const q = useQuery<CompanyInfo>({
    queryKey: qk.companyInfo(symbol),
    queryFn: () => api.company.info(symbol)
  })

  if (q.isLoading) {
    return <div className="p-2 text-muted-foreground">Loading company info…</div>
  }
  if (q.isError || !q.data) {
    // Chart と同じ文言方針: HTTP 40x（プラン外/未カバー）は専用文言、それ以外は汎用エラー。
    const notCovered = /FMP HTTP (200|40[0-9])/.test(String((q.error as Error)?.message))
    return (
      <div className="p-2 text-center text-muted-foreground">
        {notCovered
          ? 'Company info isn’t available on your current FMP plan.'
          : 'Couldn’t load company info. Check your connection or your FMP API key in Settings.'}
      </div>
    )
  }

  const c = q.data
  const asOf = new Date(c.fetchedAt * 1000).toISOString().slice(0, 10)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {c.image && <img src={c.image} alt="" className="h-10 w-10 shrink-0 rounded" />}
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-base font-semibold">{c.companyName}</span>
          <span className="text-sm text-muted-foreground">
            {c.symbol}{c.exchange ? ` · ${c.exchange}` : ''}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3">
        <Attr label="Sector" value={c.sector} />
        <Attr label="Industry" value={c.industry} />
        <Attr label="Country" value={c.country} />
        <Attr label="Market cap" value={c.marketCap === null ? null : fmtCompact(c.marketCap)} />
        <Attr label="CEO" value={c.ceo} />
        <Attr label="Employees" value={c.fullTimeEmployees === null ? null : fmtCompact(c.fullTimeEmployees)} />
        <Attr label="IPO date" value={c.ipoDate} />
        <Attr label="Beta" value={c.beta === null ? null : c.beta.toFixed(2)} />
        <Attr label="52-week range" value={c.range} />
        <Attr label="Volume" value={c.volume === null ? null : fmtCompact(c.volume)} />
        <Attr label="Avg volume" value={c.averageVolume === null ? null : fmtCompact(c.averageVolume)} />
        <Attr label="Last dividend" value={c.lastDividend === null ? null : c.lastDividend.toFixed(2)} />
      </div>

      {c.description && (
        <p className="line-clamp-4 text-sm text-muted-foreground">{c.description}</p>
      )}

      <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
        {c.website
          ? <a href={c.website} target="_blank" rel="noreferrer" className="truncate text-primary hover:underline">{c.website}</a>
          : <span />}
        <span className="shrink-0">As of {asOf}</span>
      </div>
    </div>
  )
}

export function CompanyWindow({ symbol }: { symbol: string }): React.JSX.Element {
  useEffect(() => { document.title = symbol }, [symbol])
  return (
    <div className="h-screen overflow-auto bg-background p-6 text-foreground">
      <h1 className="mb-4 text-sm font-semibold text-muted-foreground">Company info</h1>
      <CompanyInfoBody symbol={symbol} />
    </div>
  )
}
```

- [ ] **Step 2: Delete the old dialog file**

```bash
git rm src/renderer/components/CompanyInfoDialog.tsx
```

(The `App.tsx` import of it is removed in Task 5 — typecheck will pass only after Task 5. That's expected; commit this task together with Task 5's edits if running typecheck as a gate. To keep this task independently green, do Step 3 here then proceed directly to Task 5 before running `npm run typecheck`.)

- [ ] **Step 3: Branch in `src/renderer/main.tsx`**

Replace the file body with:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { parseCompanySymbol } from '@shared/companyWindow'
import App from './App'
import { CompanyWindow } from './components/CompanyWindow'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    // API 節約最優先: OHLCV data is cache-first + manual-refresh (遅延OK).
    //  - staleTime:Infinity → a *successful* query never auto-refetches (covered symbols reuse cache).
    //  - retryOnMount:false → an *errored* query (an out-of-plan symbol's 402) is NOT retried when
    //    the observer remounts, i.e. every time the user switches back to that timeframe. Without it,
    //    D↔W↔M round-trips on an out-of-plan symbol re-hit FMP on every switch. A failed (symbol,tf)
    //    now hits FMP at most once per session (key change / manual invalidate re-attempts).
    //  - retry:0 → don't re-attempt a failed fetch; an out-of-plan 402 is deterministic, so a retry
    //    just doubles the API hit and the error noise for no gain (manual refresh re-attempts).
    queries: { staleTime: Infinity, retry: 0, refetchOnWindowFocus: false, retryOnMount: false }
  }
})

// Company-info windows reuse this same bundle; the hash carries the target symbol. When present,
// mount the standalone CompanyWindow instead of the full App (see src/shared/companyWindow.ts).
const companySymbol = parseCompanySymbol(window.location.hash)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {companySymbol ? <CompanyWindow symbol={companySymbol} /> : <App />}
    </QueryClientProvider>
  </React.StrictMode>
)
```

- [ ] **Step 4: Commit** (after Task 5 typecheck passes — see Task 5 Step 5)

---

### Task 5: Wire context menus, remove store state and App mount

**Files:**
- Modify: `src/renderer/components/GridHost.tsx`
- Modify: `src/renderer/components/Watchlist.tsx`
- Modify: `src/renderer/store.ts`
- Modify: `src/renderer/App.tsx`

**Interfaces:**
- Consumes: `window.api.company.openWindow` (Task 2), via `api` already imported in both components.

- [ ] **Step 1: GridHost — call the IPC, drop the store hook**

In `src/renderer/components/GridHost.tsx`, remove this line (≈213):

```ts
  const openCompanyInfo = useAppStore((s) => s.openCompanyInfo)
```

And change the context-menu item (≈261) — no more next-tick defer (opening an OS window doesn't touch `<body>` pointer-events):

```tsx
              <ContextMenuItem onSelect={() => void api.company.openWindow(cell.symbol!)}>
                Show company info
              </ContextMenuItem>
```

- [ ] **Step 2: Watchlist — same change**

In `src/renderer/components/Watchlist.tsx`, remove this line (≈24):

```ts
  const openCompanyInfo = useAppStore((s) => s.openCompanyInfo)
```

Add `api` to the existing import from `@/api` if not already present (it is: `import { api, qk } from '@/api'`). Change the context-menu item (≈111):

```tsx
        <ContextMenuItem onSelect={() => void api.company.openWindow(item.symbol)}>
          Show company info
        </ContextMenuItem>
```

- [ ] **Step 3: store.ts — delete the dialog state**

In `src/renderer/store.ts`, remove the interface members (≈54-57):

```ts
  // 会社情報ダイアログの対象銘柄。null = 閉。App 常設の CompanyInfoDialog が subscribe する。
  companyInfoSymbol: string | null
  openCompanyInfo: (symbol: string) => void
  closeCompanyInfo: () => void
```

And remove the implementation (≈114-116):

```ts
  companyInfoSymbol: null,
  openCompanyInfo: (symbol) => set({ companyInfoSymbol: symbol }),
  closeCompanyInfo: () => set({ companyInfoSymbol: null }),
```

- [ ] **Step 4: App.tsx — remove the import and mount**

In `src/renderer/App.tsx`, remove the import (line 18):

```ts
import { CompanyInfoDialog } from './components/CompanyInfoDialog'
```

And remove the mount (≈185):

```tsx
      <CompanyInfoDialog />
```

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck`
Expected: PASS — no remaining references to `CompanyInfoDialog`, `openCompanyInfo`, or `companyInfoSymbol`.

Confirm nothing dangling:

Run: `git grep -n "CompanyInfoDialog\|openCompanyInfo\|companyInfoSymbol\|closeCompanyInfo"`
Expected: no matches.

- [ ] **Step 6: Commit (Tasks 4 + 5 together)**

```bash
git add -A
git commit -m "feat(company): show company info in separate OS windows

Replace the modal CompanyInfoDialog with per-symbol OS windows. Renderer
branches on a #company=SYMBOL hash to mount CompanyWindow; context menus
call api.company.openWindow; dialog store state removed."
```

- [ ] **Step 7: Manual verification**

Run: `npm run dev`
Then verify:
1. Right-click a chart cell → "Show company info" opens a separate window; the main window is still interactive (drag/click charts while it's open).
2. Right-click a watchlist row → same behavior.
3. Open a second, different symbol → a second window appears (both stay open).
4. Re-open an already-open symbol → its existing window is focused, no duplicate.
5. Close the main window → the app quits (all company windows close too).

---

## Self-Review

**Spec coverage:**
- Separate OS windows → Task 3. One-per-symbol + focus-existing → Task 3 `companyWindows` map. Native frame / not a child / resizable → Task 3 `BrowserWindow` opts (no `frame`/`parent`). Reuse renderer bundle via hash → Tasks 1 + 4. `company:openWindow` channel + preload → Task 2. CompanyWindow (drop Dialog) → Task 4. Context-menu rewire → Task 5. Delete store state + App mount → Task 5. Closing main quits → Task 3 `win.on('closed')`. Runnable check on hash parse → Task 1. ✓
- Deviation from spec: window title stays the symbol (spec's "company name once loaded" dropped as YAGNI). Noted in Task 4.

**Placeholder scan:** none — every code step shows full content.

**Type consistency:** `buildCompanyHash`/`parseCompanySymbol` (Task 1) used identically in Tasks 3/4. `CH.companyOpenWindow` and `company.openWindow` (Task 2) used in Tasks 3/5. `CompanyWindow({ symbol })` (Task 4) matches the mount in main.tsx. ✓
