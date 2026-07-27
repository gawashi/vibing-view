# Watchlist Symbol Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Double-clicking a watchlist row opens that symbol enlarged in its own OS window, without touching the grid.

**Architecture:** A third kind of satellite window (after company-info and cellId-enlarge). Main keys a `BrowserWindow` map by symbol and loads the shared renderer bundle with `#symbolChart=<SYMBOL>`; `main.tsx` branches on that hash and mounts `SymbolChartWindow`. Because every BrowserWindow gets its own renderer store, and this window deliberately never mounts `useWorkspaceSync`, its chart state is isolated and throwaway — no store, schema, grid, or MCP changes.

**Tech Stack:** TypeScript, React 18, Electron (electron-vite), zustand, TanStack Query, Radix UI (shadcn-style wrappers in `src/renderer/components/ui`), lucide-react icons, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-27-watchlist-symbol-window-design.md`

## Global Constraints

- Work in this worktree only: `C:\Users\010230240\work\vibing-view\.claude\worktrees\watchlist-symbol-window` (branch `feat/watchlist-symbol-window`).
- Do NOT modify: `src/renderer/store.ts`, `src/shared/workspace.ts`, `src/shared/types.ts`, `src/main/workspaceStore.ts`, anything under `src/main/mcp/`. This feature adds no persisted state. If you think you need to touch one of these, stop and report instead.
- The symbol window must never mount `useWorkspaceSync` or `useClipboardSync` — mounting either would write this window's throwaway cell into the persisted workspace collection.
- Tests run with `npm test` (Vitest, `environment: 'node'`, only `tests/**/*.test.ts`). There is no component-test harness; do NOT add `@testing-library/*`, `jsdom`, or `happy-dom`.
- Typecheck with `npm run typecheck` (runs `tsc` over both `tsconfig.node.json` and `tsconfig.web.json`). It must pass at the end of every task.
- Match surrounding code style: no semicolons at line ends are NOT used — this repo omits semicolons; 2-space indent; single quotes; comments explain *why*, and Japanese comments are normal here. Keep new comments in the language of the file's neighbours (English for `src/shared`, either for renderer components).
- Commit after every task with the message given in the task's final step.

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `src/shared/symbolChartWindow.ts` | create | `buildSymbolChartHash` / `parseSymbolChartSymbol` — the `#symbolChart=SYMBOL` contract shared by main and renderer. Twin of `chartWindow.ts`. |
| `tests/symbolChartWindow.test.ts` | create | Unit tests for the hash helper, including non-collision with the `#chart=` and `#company=` hashes. |
| `src/shared/ipc.ts` | modify | Add the `symbolChart:openWindow` channel and the `symbolChart.openWindow(symbol)` API signature. |
| `src/preload/index.ts` | modify | Expose `symbolChart.openWindow` over the context bridge. |
| `src/main/index.ts` | modify | `symbolChartWindows` map, the IPC handler, and teardown on main-window close. |
| `src/renderer/components/SymbolChartWindow.tsx` | create | The standalone window: theme, refresh sync, seeds the local cell with the symbol, renders `ChartPanel` full-screen. |
| `src/renderer/main.tsx` | modify | Mount `SymbolChartWindow` when the hash carries `symbolChart`. |
| `src/renderer/components/GridHost.tsx` | modify | `ChartPanel` gains the `minimal` prop (hide ★ and ×, show a per-window refresh button). |
| `src/renderer/components/Watchlist.tsx` | modify | Row gestures: drop `onClick`, add `onDoubleClick`, add the context-menu item. |

---

### Task 1: Hash contract and IPC plumbing

Adds the `#symbolChart=SYMBOL` helper plus the full main↔renderer channel, so `window.api.symbolChart.openWindow('AAPL')` opens a real window. The window still renders the normal `App` at this point (the renderer branch lands in Task 2) — that is the expected intermediate state.

**Files:**
- Create: `src/shared/symbolChartWindow.ts`
- Create: `tests/symbolChartWindow.test.ts`
- Modify: `src/shared/ipc.ts` (CH map ~line 28; `chart` API block ~line 122)
- Modify: `src/preload/index.ts` (`chart` block ~line 58)
- Modify: `src/main/index.ts` (imports ~line 8; window maps ~line 27; `createWindow`'s `'closed'` handler ~line 79; `app.whenReady` handlers ~line 173)

**Interfaces:**
- Consumes: `openHashWindow(map, key, width, height, hash)` — the existing private helper in `src/main/index.ts` that focuses a live window or creates a hardened one and clears the map entry on `'closed'`.
- Produces:
  - `buildSymbolChartHash(symbol: string): string`
  - `parseSymbolChartSymbol(hash: string): string | null`
  - `CH.symbolChartOpenWindow = 'symbolChart:openWindow'`
  - `api.symbolChart.openWindow(symbol: string): Promise<void>` (renderer-side, via preload)

- [ ] **Step 1: Write the failing test**

Create `tests/symbolChartWindow.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildSymbolChartHash, parseSymbolChartSymbol } from '../src/shared/symbolChartWindow'
import { parseChartCellId } from '../src/shared/chartWindow'
import { parseCompanySymbol } from '../src/shared/companyWindow'

describe('symbol-chart window hash', () => {
  it('round-trips a symbol', () => {
    expect(parseSymbolChartSymbol('#' + buildSymbolChartHash('AAPL'))).toBe('AAPL')
  })

  it('parses with or without the leading #', () => {
    expect(parseSymbolChartSymbol('#symbolChart=MSFT')).toBe('MSFT')
    expect(parseSymbolChartSymbol('symbolChart=MSFT')).toBe('MSFT')
  })

  it('survives symbols needing encoding (crypto pairs, dotted tickers)', () => {
    expect(parseSymbolChartSymbol('#' + buildSymbolChartHash('BTC/USD'))).toBe('BTC/USD')
    expect(parseSymbolChartSymbol('#' + buildSymbolChartHash('BRK.B'))).toBe('BRK.B')
  })

  it('returns null for an empty or foreign hash', () => {
    expect(parseSymbolChartSymbol('')).toBeNull()
    expect(parseSymbolChartSymbol('#company=AAPL')).toBeNull()
    expect(parseSymbolChartSymbol('#chart=5')).toBeNull()
  })

  it('does not collide with the sibling window hashes', () => {
    // 'symbolChart' must not be read as 'chart' (or vice versa) by the other parsers.
    const hash = '#' + buildSymbolChartHash('AAPL')
    expect(parseChartCellId(hash)).toBeNull()
    expect(parseCompanySymbol(hash)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/symbolChartWindow.test.ts`
Expected: FAIL — cannot resolve `../src/shared/symbolChartWindow`.

- [ ] **Step 3: Write the helper**

Create `src/shared/symbolChartWindow.ts`:

```ts
// Watchlist symbol windows reuse the main renderer bundle; the target symbol rides in the URL hash
// (#symbolChart=SYMBOL). main.tsx branches on parseSymbolChartSymbol; main-process index.ts builds
// the URL with buildSymbolChartHash. Twin of chartWindow.ts — the key is deliberately distinct from
// 'chart' so the two parsers never read each other's hash.
export function buildSymbolChartHash(symbol: string): string {
  return `symbolChart=${encodeURIComponent(symbol)}`
}

export function parseSymbolChartSymbol(hash: string): string | null {
  const q = hash.startsWith('#') ? hash.slice(1) : hash
  return new URLSearchParams(q).get('symbolChart')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/symbolChartWindow.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the IPC channel and API type**

In `src/shared/ipc.ts`, add to the `CH` object right after the `chartOpenWindow` entry:

```ts
  symbolChartOpenWindow: 'symbolChart:openWindow',
```

and right after the existing `chart` block in the API type:

```ts
  chart: {
    openWindow(cellId: string): Promise<void>
  }
  // ウォッチリスト銘柄の拡大窓（銘柄キー、使い捨て）。chart 窓と違いセルにもワークスペースにも
  // 紐づかないので、開くのに必要なのは symbol だけ。
  symbolChart: {
    openWindow(symbol: string): Promise<void>
  }
```

- [ ] **Step 6: Expose it in preload**

In `src/preload/index.ts`, right after the existing `chart` block:

```ts
  chart: {
    openWindow: (cellId) => ipcRenderer.invoke(CH.chartOpenWindow, cellId)
  },
  symbolChart: {
    openWindow: (symbol) => ipcRenderer.invoke(CH.symbolChartOpenWindow, symbol)
  },
```

- [ ] **Step 7: Wire the main process**

In `src/main/index.ts`:

1. Add the import next to the sibling hash builders:

```ts
import { buildSymbolChartHash } from '@shared/symbolChartWindow'
```

2. Add the map after `chartWindows`:

```ts
// One symbol window per watchlist symbol (spec: symbol keying; the same symbol re-focuses, a
// different symbol spawns another). Cleared on 'closed'. Twin of chartWindows.
const symbolChartWindows = new Map<string, BrowserWindow>()
```

3. In `createWindow`'s `win.on('closed', ...)` handler, add the third teardown loop:

```ts
    for (const w of symbolChartWindows.values()) w.close()
```

4. In `app.whenReady()`, after the `CH.chartOpenWindow` handler:

```ts
  ipcMain.handle(CH.symbolChartOpenWindow, (_e, symbol: string) => openHashWindow(symbolChartWindows, symbol, 1100, 760, buildSymbolChartHash(symbol)))
```

- [ ] **Step 8: Typecheck and run the whole suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all test files pass (52 files after this task's addition).

- [ ] **Step 9: Commit**

```bash
git add src/shared/symbolChartWindow.ts tests/symbolChartWindow.test.ts src/shared/ipc.ts src/preload/index.ts src/main/index.ts
git commit -m "feat(symbol-window): symbolChart hash contract and IPC plumbing"
```

---

### Task 2: The symbol window renderer

Mounts a standalone, isolated chart for one symbol. This is where the "no workspace sync" isolation is enforced and where `ChartPanel` learns the `minimal` chrome.

**Files:**
- Create: `src/renderer/components/SymbolChartWindow.tsx`
- Modify: `src/renderer/main.tsx` (hash branch, ~lines 26-38)
- Modify: `src/renderer/components/GridHost.tsx` (`ChartPanel`, lines 205-234)

**Interfaces:**
- Consumes: `parseSymbolChartSymbol` (Task 1); `ChartPanel({ cell, minimal })`; `useAppStore` actions `setActiveSymbol(symbol)` and `setCellTimeframe(cellId, tf)`; `useRefreshSync()`; `applyTheme` from `@/lib/theme`; `api.ohlcv.refresh(symbol, tf)` and `qk.ohlcv(symbol, tf)` from `@/api`.
- Produces: `SymbolChartWindow({ symbol }: { symbol: string })`; `ChartPanel`'s new optional `minimal?: boolean` prop.

- [ ] **Step 1: Add the `minimal` prop to ChartPanel**

In `src/renderer/components/GridHost.tsx`, replace the whole `ChartPanel` component (currently lines 205-234, the block starting with the comment `// The chart toolbar + chart body for one symbol-bearing cell.`) with:

```tsx
// The chart toolbar + chart body for one symbol-bearing cell. Rendered fragment (no outer box) so
// GridCell can wrap it as a ContextMenu trigger and ChartWindow can render it full-screen. Owns the
// per-cell capability gating so both the grid and the enlarge window gate their own row.
//
// minimal: the watchlist symbol window. That window has no write path back to the workspace, so ★
// (would report "not watched" and silently drop the click) and × (would just blank the window) are
// hidden. It also has no toolbar of its own, hence its own refresh button — see the refresh-coverage
// note in the 2026-07-27 spec: the scheduler only pushes visible cells + watchlist 1d, so a symbol
// window sitting on any other timeframe would otherwise never update.
export function ChartPanel({ cell, minimal }: { cell: Cell; minimal?: boolean }): React.JSX.Element {
  const setCellTimeframe = useAppStore((s) => s.setCellTimeframe)
  const clearCell = useAppStore((s) => s.clearCell)
  useCellCapabilityGating(cell.id, cell.symbol, cell.timeframe)

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <SymbolLabel symbol={cell.symbol!} timeframe={cell.timeframe} minimal={minimal} />
        <TimeframeRow value={cell.timeframe} onChange={(tf) => setCellTimeframe(cell.id, tf)} />
        <AddIndicatorMenu cellId={cell.id} />
        {minimal
          ? <RefreshButton symbol={cell.symbol!} timeframe={cell.timeframe} />
          : (
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-6 w-6 [&_svg]:size-3.5"
              aria-label={`Remove ${cell.symbol} chart`}
              onClick={(e) => { e.stopPropagation(); clearCell(cell.id) }}
            >
              <X />
            </Button>
            )}
      </div>
      <div className="min-h-0 flex-1">
        <Chart cellId={cell.id} symbol={cell.symbol!} timeframe={cell.timeframe} />
      </div>
    </>
  )
}
```

- [ ] **Step 2: Hide the star in minimal mode**

Still in `GridHost.tsx`, change `SymbolLabel`'s signature and its star line. Replace the signature (line 116):

```tsx
function SymbolLabel({ symbol, timeframe }: { symbol: string; timeframe: Timeframe }): React.JSX.Element {
```

with:

```tsx
function SymbolLabel({ symbol, timeframe, minimal }: { symbol: string; timeframe: Timeframe; minimal?: boolean }): React.JSX.Element {
```

and replace the star line inside its returned JSX (line 159):

```tsx
      <FavoriteStar symbol={symbol} />
```

with:

```tsx
      {!minimal && <FavoriteStar symbol={symbol} />}
```

- [ ] **Step 3: Add the refresh button**

Still in `GridHost.tsx`, add this component immediately above `ChartPanel`:

```tsx
// 銘柄ウィンドウ専用の更新ボタン。全体リロード(App のツールバー)はこの窓に無く、スケジューラの
// 配信対象(可視セル＋サイドバー表示中のウォッチリスト 1d)からも外れうるので、自分の
// symbol+timeframe だけを強制取得する手動経路を1つ持つ。api.ohlcv.refresh は差分取得(キャッシュ
// 最新→現在)なので、押しても丸ごと再取得にはならない。broadcast はしない(自分の窓だけ更新)。
function RefreshButton({ symbol, timeframe }: { symbol: string; timeframe: Timeframe }): React.JSX.Element {
  const queryClient = useQueryClient()
  const [busy, setBusy] = React.useState(false)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={busy}
          className="ml-auto h-6 w-6 [&_svg]:size-3.5"
          aria-label={`Refresh ${symbol}`}
          onClick={async () => {
            setBusy(true)
            try {
              const bars = await api.ohlcv.refresh(symbol, timeframe)
              queryClient.setQueryData(qk.ohlcv(symbol, timeframe), bars)
            } catch {
              toast(`Could not refresh ${symbol}. Showing cached data.`)
            } finally {
              setBusy(false)
            }
          }}
        >
          <RefreshCw className={cn(busy && 'animate-spin')} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Refresh this chart</TooltipContent>
    </Tooltip>
  )
}
```

Then extend the lucide import at the top of the file (line 4) from:

```tsx
import { X, Star, GripVertical } from 'lucide-react'
```

to:

```tsx
import { X, Star, GripVertical, RefreshCw } from 'lucide-react'
```

(`useQueryClient`, `toast`, `Button`, `Tooltip`/`TooltipTrigger`/`TooltipContent`, `cn`, `api`, `qk` are already imported in this file — do not re-import them.)

- [ ] **Step 4: Write the window component**

Create `src/renderer/components/SymbolChartWindow.tsx`:

```tsx
import React, { useEffect } from 'react'
import { api } from '@/api'
import { useAppStore } from '@/store'
import { applyTheme } from '@/lib/theme'
import { useRefreshSync } from '@/hooks/useRefreshSync'
import { ChartPanel } from './GridHost'
import { TooltipProvider } from './ui/tooltip'
import { Toaster } from './ui/sonner'

// Standalone chart window for one watchlist symbol. Deliberately does NOT mount useWorkspaceSync or
// useClipboardSync: every BrowserWindow gets its own renderer store, so skipping the sync hooks is
// what makes this window isolated — its timeframe/indicator edits are never saved to the workspace
// collection and never reach the grid. A fresh store already holds exactly one 1x1 cell with the
// always-on Volume indicator, so seeding the symbol is all it takes to have a full chart.
export function SymbolChartWindow({ symbol }: { symbol: string }): React.JSX.Element {
  useRefreshSync()
  useEffect(() => { void api.settings.getTheme().then(applyTheme) }, [])
  useEffect(() => { document.title = symbol }, [symbol])
  useEffect(() => { useAppStore.getState().setActiveSymbol(symbol) }, [symbol])

  const cell = useAppStore((s) => s.cells[0])

  return (
    <TooltipProvider>
      {/* The seed effect runs after the first commit, so the cell is symbol-less for one frame —
          render an empty backdrop rather than hitting ChartPanel's cell.symbol! assertion. */}
      {cell?.symbol
        ? (
          <div className="flex h-screen min-h-0 min-w-0 flex-col gap-4 bg-background p-4 text-foreground">
            <ChartPanel cell={cell} minimal />
          </div>
          )
        : <div className="h-screen bg-background" />}
      <Toaster />
    </TooltipProvider>
  )
}
```

- [ ] **Step 5: Branch on the hash in `main.tsx`**

In `src/renderer/main.tsx`, add the import beside its siblings:

```tsx
import { parseSymbolChartSymbol } from '@shared/symbolChartWindow'
import { SymbolChartWindow } from './components/SymbolChartWindow'
```

then add the parse beside the other two:

```tsx
const symbolChartSymbol = parseSymbolChartSymbol(window.location.hash)
```

and replace the render branch:

```tsx
      {companySymbol
        ? <CompanyWindow symbol={companySymbol} />
        : chartCellId
          ? <ChartWindow cellId={chartCellId} />
          : <App />}
```

with:

```tsx
      {companySymbol
        ? <CompanyWindow symbol={companySymbol} />
        : chartCellId
          ? <ChartWindow cellId={chartCellId} />
          : symbolChartSymbol
            ? <SymbolChartWindow symbol={symbolChartSymbol} />
            : <App />}
```

- [ ] **Step 6: Typecheck and run the suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass. (No new automated tests here — see Global Constraints; the behaviour is checked manually in Step 7.)

- [ ] **Step 7: Manual verification**

Run: `npm run dev`

In the main window's DevTools console (Ctrl+Shift+I), run:

```js
await window.api.symbolChart.openWindow('AAPL')
```

Confirm:
1. A ~1100×760 window opens showing the AAPL daily chart with volume, titled `AAPL`.
2. Its header has the timeframe row, the add-indicator menu, and a refresh button — **no ★ and no ×**.
3. Changing its timeframe and adding an indicator changes nothing in the main window's grid.
4. Pressing the refresh button spins briefly and leaves the chart intact.
5. Running the same console command again focuses the existing window instead of opening a second one; `openWindow('MSFT')` opens a separate window.
6. Closing the main window closes both symbol windows and quits the app.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/SymbolChartWindow.tsx src/renderer/main.tsx src/renderer/components/GridHost.tsx
git commit -m "feat(symbol-window): standalone symbol chart window with minimal chrome"
```

---

### Task 3: Watchlist row gestures

Redefines the row's gestures so double-click can open the window without the leading `click` writing into the grid, and adds the keyboard-reachable path.

**Files:**
- Modify: `src/renderer/components/Watchlist.tsx` (`Row`, lines 42-135)

**Interfaces:**
- Consumes: `api.symbolChart.openWindow(symbol)` (Task 1).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Change the row's gestures**

In `src/renderer/components/Watchlist.tsx`, replace these three lines inside `Row`'s `<li>` (lines 72-75):

```tsx
      role="button"
      tabIndex={0}
      onClick={() => setActiveSymbol(item.symbol)}
      onKeyDown={(e) => { if (e.key === 'Enter') setActiveSymbol(item.symbol) }}
```

with:

```tsx
      role="button"
      tabIndex={0}
      // クリックでグリッドに入れるのは廃止(ダブルクリックの先行 click がアクティブセルを書き換えて
      // しまうため)。グリッドへ置く経路は Enter とドラッグ&ドロップ、拡大窓はダブルクリックと
      // コンテキストメニュー(キーボードからは Shift+F10)。
      onKeyDown={(e) => { if (e.key === 'Enter') setActiveSymbol(item.symbol) }}
      onDoubleClick={() => void api.symbolChart.openWindow(item.symbol)}
```

- [ ] **Step 2: Add the context-menu item**

Still in `Watchlist.tsx`, replace the `ContextMenuContent` block (lines 129-133):

```tsx
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => void api.company.openWindow(item.symbol)}>
          Show company info
        </ContextMenuItem>
      </ContextMenuContent>
```

with:

```tsx
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => void api.symbolChart.openWindow(item.symbol)}>
          Open enlarged chart
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void api.company.openWindow(item.symbol)}>
          Show company info
        </ContextMenuItem>
      </ContextMenuContent>
```

- [ ] **Step 3: Typecheck and run the suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean (note `setActiveSymbol` is still used by the `Enter` handler, so its `useAppStore` selector stays); all tests pass.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`. With at least two symbols in the watchlist and a chart already in the active grid cell:

1. Single-click a watchlist row → the active cell's chart does **not** change.
2. Focus a row with Tab and press Enter → the symbol lands in the active cell (unchanged behaviour).
3. Drag a row's grip onto a grid cell → the symbol lands there (unchanged behaviour).
4. Double-click a row → the symbol window opens and the grid is untouched.
5. Right-click a row → "Open enlarged chart" appears above "Show company info" and opens the same window.
6. Focus a row and press Shift+F10 (or the menu key) → the same context menu opens and can be driven with the arrow keys + Enter.
7. Reorder rows by dragging the grip → still works (the double-click handler must not interfere).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/Watchlist.tsx
git commit -m "feat(watchlist): double-click / context menu open the symbol window"
```

---

## Done criteria

- `npm run typecheck` and `npm test` both pass.
- All manual checks in Tasks 2 and 3 pass.
- `git diff main --stat` touches only the files listed in the File Structure table, plus the spec/plan docs. (README documents no user-facing gestures — verified with `grep -i "double-click\|watchlist" README.md`, no hits — so there is nothing to update there.)
- No changes to `src/renderer/store.ts`, `src/shared/workspace.ts`, `src/shared/types.ts`, `src/main/workspaceStore.ts`, or `src/main/mcp/`.
