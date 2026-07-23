# Chart Context Menu Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the chart right-click menu (watchlist toggle, copy/cut/paste chart config, remove) and make it identical on grid cells and the enlarge window.

**Architecture:** A new `ChartContextMenu` wrapper component wraps each cell's contents (populated `ChartPanel` *or* empty placeholder) so both the grid and the enlarge window inherit the same menu. Copy/cut/paste operate on a new `chartClipboard` slice of the zustand store; the clipboard is held authoritatively in the main process and synced to every window via a rev-guarded IPC channel (mirroring the existing `useWorkspaceSync` pattern), so a window opened *after* a copy still sees the clipboard.

**Tech Stack:** TypeScript, React, zustand (`subscribeWithSelector`), Radix `@radix-ui/react-context-menu`, Electron IPC, TanStack Query, Vitest.

## Global Constraints

- Tech stack: TypeScript + React; platform Electron on Windows.
- SQLite = OHLCV cache / JSON = user preferences. This feature touches **neither** — the clipboard is in-memory only (never persisted).
- Store mutations stay **pure** (no IPC inside store actions); persistence/cross-window sync lives in subscription hooks (`useWorkspaceSync` precedent).
- Indicator/cell ids must be collection-wide unique — always re-mint on paste (`remintLayout` precedent, `dedupeCollectionIds`).
- Exactly one `fixed` Volume indicator per cell is an invariant (D-34).
- Do not add new dependencies — `@radix-ui/react-context-menu` is already installed.

---

### Task 1: Store — clipboard state + copy/cut/paste actions

**Files:**
- Modify: `src/shared/types.ts` (add `ClipboardCell` type)
- Modify: `src/renderer/store.ts` (add `chartClipboard` state + `copyCell`/`cutCell`/`pasteCell`/`setClipboard`)
- Test: `tests/renderer/store.test.ts` (add a `chart clipboard (copy/cut/paste)` describe block)

**Interfaces:**
- Consumes: existing store closure helpers (`nextId`, `clearCell`), `Cell` / `IndicatorInstance` / `Timeframe` from `@shared/types`.
- Produces:
  - `ClipboardCell = { symbol: string; timeframe: Timeframe; indicators: IndicatorInstance[] }` (in `@shared/types`)
  - `chartClipboard: ClipboardCell | null`
  - `copyCell(cellId: string): void` — deep-clones the target cell's `{symbol, timeframe, indicators}` into `chartClipboard`; no-op if the cell is missing or has no symbol.
  - `cutCell(cellId: string): void` — `copyCell` then `clearCell`; no-op if cell missing / no symbol.
  - `pasteCell(cellId: string): void` — applies `chartClipboard` to the target cell (re-mints indicator ids, normalizes to exactly one `fixed` Volume, drops that cell's crosshair); no-op if clipboard null or cell missing.
  - `setClipboard(clip: ClipboardCell | null): void` — replaces `chartClipboard` verbatim (used by the sync hook in Task 3).

- [ ] **Step 1: Add the `ClipboardCell` type**

In `src/shared/types.ts`, after the `Cell` type (around line 64), add:

```ts
// Copy/paste payload for a chart cell's config (no cell id — paste re-mints ids). Held in the
// main process and synced across windows; never persisted (SQLite = OHLCV / JSON = prefs only).
export type ClipboardCell = {
  symbol: string
  timeframe: Timeframe
  indicators: IndicatorInstance[]
}
```

- [ ] **Step 2: Write the failing tests**

In `tests/renderer/store.test.ts`, add this describe block just before the final closing `})` of the top-level `describe('useAppStore grid shape logic', ...)` (i.e. after the `duplicateWorkspace(newName, sourceName)` block, before line 627's `})`):

```ts
  describe('chart clipboard (copy/cut/paste)', () => {
    const seedCell = (id: string, symbol: string | null, extra: import('../../src/shared/types').IndicatorInstance[] = []) => ({
      id,
      symbol,
      timeframe: '1d' as const,
      indicators: [
        { id: `${id}-vol`, type: 'volume', params: {}, colors: {}, visible: true, fixed: true },
        ...extra
      ]
    })

    beforeEach(() => {
      useAppStore.setState({
        cells: [seedCell('src', 'AAPL', [{ id: 'src-ma', type: 'ma', params: { period: 20 }, colors: { line: '#fff' }, visible: true }]), seedCell('dst', null)],
        shape: { rows: 1, cols: 2 },
        activeCellId: 'src',
        chartClipboard: null
      })
    })

    it('copyCell deep-clones symbol/timeframe/indicators; no aliasing with the source cell', () => {
      useAppStore.getState().copyCell('src')
      const clip = useAppStore.getState().chartClipboard!
      expect(clip.symbol).toBe('AAPL')
      expect(clip.timeframe).toBe('1d')
      expect(clip.indicators.map((i) => i.type)).toEqual(['volume', 'ma'])
      // mutate the clipboard's params — source cell must not change (deep clone)
      clip.indicators[1].params.period = 999
      const srcCell = useAppStore.getState().cells.find((c) => c.id === 'src')!
      expect(srcCell.indicators[1].params.period).toBe(20)
    })

    it('copyCell is a no-op for a missing cell or a null-symbol cell', () => {
      useAppStore.getState().copyCell('dst') // null symbol
      expect(useAppStore.getState().chartClipboard).toBeNull()
      useAppStore.getState().copyCell('nope') // missing
      expect(useAppStore.getState().chartClipboard).toBeNull()
    })

    it('cutCell fills the clipboard and empties the source cell (keeps fixed Volume)', () => {
      useAppStore.getState().cutCell('src')
      expect(useAppStore.getState().chartClipboard!.symbol).toBe('AAPL')
      const srcCell = useAppStore.getState().cells.find((c) => c.id === 'src')!
      expect(srcCell.symbol).toBeNull()
      expect(srcCell.indicators.map((i) => i.type)).toEqual(['volume'])
    })

    it('pasteCell applies symbol/timeframe/indicators with fresh (re-minted) ids', () => {
      useAppStore.getState().copyCell('src')
      const clip = useAppStore.getState().chartClipboard!
      useAppStore.getState().pasteCell('dst')
      const dst = useAppStore.getState().cells.find((c) => c.id === 'dst')!
      expect(dst.symbol).toBe('AAPL')
      expect(dst.indicators.map((i) => i.type)).toEqual(['volume', 'ma'])
      // ids differ from the clipboard's (collection-wide uniqueness)
      const clipIds = clip.indicators.map((i) => i.id)
      for (const i of dst.indicators) expect(clipIds).not.toContain(i.id)
    })

    it('pasteCell normalizes to exactly one fixed Volume for 0 / 1 / many clipboard Volumes', () => {
      const paste = (indicators: import('../../src/shared/types').IndicatorInstance[]) => {
        useAppStore.setState({ chartClipboard: { symbol: 'AAPL', timeframe: '1d', indicators } })
        useAppStore.getState().pasteCell('dst')
        return useAppStore.getState().cells.find((c) => c.id === 'dst')!.indicators.filter((i) => i.type === 'volume')
      }
      // zero volumes → one seeded
      expect(paste([{ id: 'a', type: 'ma', params: {}, colors: {}, visible: true }])).toHaveLength(1)
      // one volume → kept, forced fixed
      const one = paste([{ id: 'v', type: 'volume', params: {}, colors: {}, visible: true, fixed: false }])
      expect(one).toHaveLength(1)
      expect(one[0].fixed).toBe(true)
      // many volumes → collapsed to one
      expect(paste([
        { id: 'v1', type: 'volume', params: {}, colors: {}, visible: true, fixed: true },
        { id: 'v2', type: 'volume', params: {}, colors: {}, visible: true, fixed: true }
      ])).toHaveLength(1)
    })

    it('pasteCell works onto an empty cell and clears that cell\'s crosshair', () => {
      useAppStore.getState().setCrosshair('dst', { price: { open: 1, high: 1, low: 1, close: 1 } })
      useAppStore.getState().copyCell('src')
      useAppStore.getState().pasteCell('dst')
      expect(useAppStore.getState().cells.find((c) => c.id === 'dst')!.symbol).toBe('AAPL')
      expect(useAppStore.getState().crosshairByCell['dst']).toBeUndefined()
    })

    it('pasteCell is a no-op when the clipboard is empty', () => {
      const before = useAppStore.getState().cells
      useAppStore.getState().pasteCell('dst')
      expect(useAppStore.getState().cells).toBe(before)
    })
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/renderer/store.test.ts -t "chart clipboard"`
Expected: FAIL — `copyCell is not a function` (actions not defined yet).

- [ ] **Step 4: Add the clipboard state + actions to the store**

In `src/renderer/store.ts`:

4a. Extend the type import (line 5) to include `ClipboardCell`:

```ts
import type { Cell, GridShape, IndicatorInstance, Params, Timeframe, Layout, WatchlistItem, Workspace, WorkspaceCollection, ClipboardCell } from '@shared/types'
```

4b. In the `AppState` type, add the clipboard members. Put them right after `setCrosshair` (after line 66):

```ts
  // Chart config clipboard (copy/cut/paste). In-memory only, synced across windows by
  // useClipboardSync — never persisted. Pure actions (no IPC) so they stay unit-testable.
  chartClipboard: ClipboardCell | null
  copyCell: (cellId: string) => void
  cutCell: (cellId: string) => void
  pasteCell: (cellId: string) => void
  setClipboard: (clip: ClipboardCell | null) => void
```

4c. In the returned store object, add the initial state next to `crosshairByCell: {}` (after line 155):

```ts
  chartClipboard: null,
```

4d. Add the four actions. Place them right after the `clearCell` action (after line 227, before `addIndicator`):

```ts
  copyCell: (cellId) => {
    const cell = get().cells.find((c) => c.id === cellId)
    if (!cell || !cell.symbol) return // nothing to copy from an empty cell
    set({
      chartClipboard: {
        symbol: cell.symbol,
        timeframe: cell.timeframe,
        // deep clone so later edits to the source cell (or the clipboard) don't alias each other
        indicators: cell.indicators.map((i) => ({ ...i, params: { ...i.params }, colors: { ...i.colors } }))
      }
    })
  },
  cutCell: (cellId) => {
    const cell = get().cells.find((c) => c.id === cellId)
    if (!cell || !cell.symbol) return
    get().copyCell(cellId)
    get().clearCell(cellId)
  },
  pasteCell: (cellId) => {
    const src = get().chartClipboard
    if (!src) return
    if (!get().cells.some((c) => c.id === cellId)) return
    // Re-mint every indicator id (collection-wide uniqueness) and normalize to exactly one fixed
    // Volume: keep the first clipboard Volume forced fixed, drop the rest; seed one if none exist.
    const clones = src.indicators.map((i) => ({ ...i, id: String(nextId++), params: { ...i.params }, colors: { ...i.colors } }))
    const firstVolumeIndex = clones.findIndex((i) => i.type === 'volume')
    let indicators: IndicatorInstance[]
    if (firstVolumeIndex === -1) {
      indicators = [
        { id: String(nextId++), type: 'volume', params: {}, colors: {}, visible: true, fixed: true },
        ...clones
      ]
    } else {
      indicators = clones
        .filter((i, idx) => i.type !== 'volume' || idx === firstVolumeIndex)
        .map((i) => (i.type === 'volume' ? { ...i, fixed: true } : i))
    }
    set((state) => {
      const { [cellId]: _removed, ...crosshairByCell } = state.crosshairByCell
      return {
        cells: state.cells.map((c) =>
          c.id === cellId ? { ...c, symbol: src.symbol, timeframe: src.timeframe, indicators } : c
        ),
        crosshairByCell
      }
    })
  },
  setClipboard: (clip) => set({ chartClipboard: clip }),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/renderer/store.test.ts -t "chart clipboard"`
Expected: PASS (7 tests).

- [ ] **Step 6: Run the full store test file (guard against regressions)**

Run: `npx vitest run tests/renderer/store.test.ts`
Expected: PASS (all existing + 7 new).

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/renderer/store.ts tests/renderer/store.test.ts
git commit -m "feat(store): chart clipboard copy/cut/paste actions"
```

---

### Task 2: IPC — main-held clipboard with rev-guarded sync channel

**Files:**
- Modify: `src/shared/ipc.ts` (CH keys, `ClipboardPayload`, `Api.clipboard`)
- Modify: `src/preload/index.ts` (expose `api.clipboard`)
- Modify: `src/main/ipc.ts` (in-memory clipboard + handlers + broadcast)

**Interfaces:**
- Consumes: `ClipboardCell` from Task 1, existing `BrowserWindow` broadcast pattern (workspaces).
- Produces:
  - `CH.clipboardGet` / `CH.clipboardSet` / `CH.clipboardChanged`
  - `ClipboardPayload = { clipboard: ClipboardCell | null; rev: number }`
  - `api.clipboard.get(): Promise<ClipboardPayload>`
  - `api.clipboard.set(c: ClipboardCell | null): Promise<void>`
  - `api.clipboard.onChanged(cb: (p: ClipboardPayload) => void): () => void`

- [ ] **Step 1: Add the channel keys and types in `src/shared/ipc.ts`**

1a. Extend the type import (line 1) to include `ClipboardCell`:

```ts
import type { Bar, SymbolResult, Timeframe, DateRange, WorkspaceCollection, Quote, MarketStatus, CompanyInfo, ClipboardCell } from './types'
```

1b. Add three keys to the `CH` object (after `workspacesChanged`, line 27 — add a comma to the previous line):

```ts
  workspacesChanged: 'workspaces:changed',
  clipboardGet: 'clipboard:get',
  clipboardSet: 'clipboard:set',
  clipboardChanged: 'clipboard:changed'
```

1c. Add the payload type next to `WorkspacesPayload` (after line 34):

```ts
export type ClipboardPayload = { clipboard: ClipboardCell | null; rev: number }
```

1d. Add the `clipboard` namespace to the `Api` interface (after the `workspaces` block, after line 72):

```ts
  // Chart clipboard: main holds the value + a monotonic rev; renderers ignore stale (<= lastRev)
  // payloads. Same ordering contract as workspaces so a window opened after a copy still sees it.
  clipboard: {
    get(): Promise<ClipboardPayload>
    set(c: ClipboardCell | null): Promise<void>
    onChanged(cb: (p: ClipboardPayload) => void): () => void
  }
```

- [ ] **Step 2: Expose `api.clipboard` in `src/preload/index.ts`**

2a. Extend the imports (line 2-3):

```ts
import type { Timeframe, DateRange, WorkspaceCollection, ClipboardCell } from '@shared/types'
import { CH, type Api, type WorkspacesPayload, type ClipboardPayload } from '@shared/ipc'
```

2b. Add the `clipboard` namespace to the `api` object, right after the `workspaces` block (after line 42):

```ts
  clipboard: {
    get: () => ipcRenderer.invoke(CH.clipboardGet),
    set: (c: ClipboardCell | null) => ipcRenderer.invoke(CH.clipboardSet, c),
    onChanged: (cb) => {
      const listener = (_e: unknown, payload: ClipboardPayload): void => cb(payload)
      ipcRenderer.on(CH.clipboardChanged, listener)
      return () => ipcRenderer.removeListener(CH.clipboardChanged, listener)
    }
  },
```

- [ ] **Step 3: Add the main-process handlers in `src/main/ipc.ts`**

3a. Extend the type import (line 2) to include `ClipboardCell`:

```ts
import type { Bar, Timeframe, DateRange, WorkspaceCollection, ClipboardCell } from '@shared/types'
```

3b. Add the in-memory clipboard + handlers. Place this right after the `workspacesSet` handler block (after line 169, before the `capabilitiesGet` handler):

```ts
  // Chart clipboard: authoritative value lives here (in-memory, never persisted) so a window
  // opened after a copy can fetch it via clipboard:get. Mirrors the workspaces rev/broadcast
  // contract — renderers drop stale (<= lastRev) payloads (see useClipboardSync).
  let clipboard: ClipboardCell | null = null
  let clipboardRev = 0

  ipcMain.handle(CH.clipboardGet, () => ({ clipboard, rev: clipboardRev }))
  ipcMain.handle(CH.clipboardSet, (e, c: ClipboardCell | null) => {
    clipboard = c
    clipboardRev += 1
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.webContents.id !== e.sender.id) {
        w.webContents.send(CH.clipboardChanged, { clipboard: c, rev: clipboardRev })
      }
    }
  })
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no type errors across main/preload/renderer).

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/ipc.ts
git commit -m "feat(ipc): main-held chart clipboard with rev-guarded sync channel"
```

---

### Task 3: `useClipboardSync` hook + wire into App and ChartWindow

**Files:**
- Create: `src/renderer/hooks/useClipboardSync.ts`
- Modify: `src/renderer/App.tsx` (call the hook)
- Modify: `src/renderer/components/ChartWindow.tsx` (call the hook)

**Interfaces:**
- Consumes: `api.clipboard.*` (Task 2), `store.setClipboard` / `store.chartClipboard` (Task 1).
- Produces: `useClipboardSync(): void` — on mount fetches the current clipboard (rev-guarded), applies `clipboard:changed` broadcasts (rev-guarded), and pushes local `chartClipboard` changes to main. Called by both `App` and `ChartWindow`.

- [ ] **Step 1: Create `src/renderer/hooks/useClipboardSync.ts`**

```ts
import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { api } from '@/api'
import type { ClipboardCell } from '@shared/types'

// Module-scope guard: true only while applying a remote/get clipboard, so the store subscriber
// below doesn't echo that value straight back to main. One window per renderer → one hook instance.
let applyingRemote = false

// Cross-window chart-clipboard sync, shared by App and ChartWindow. Main is the source of truth;
// this mirrors useWorkspaceSync's rev-guard (drops stale/out-of-order + startup race) but needs no
// debounce — copy/cut are discrete user actions, not a stream.
export function useClipboardSync(): void {
  useEffect(() => {
    let mounted = true
    let lastRev = -1

    const apply = (clipboard: ClipboardCell | null, rev: number): void => {
      if (rev <= lastRev) return // stale / out-of-order (also drops a get that lost the startup race)
      lastRev = rev
      applyingRemote = true
      try {
        useAppStore.getState().setClipboard(clipboard)
      } finally {
        applyingRemote = false
      }
    }

    void api.clipboard.get().then((p) => {
      if (mounted) apply(p.clipboard, p.rev)
    })

    const off = api.clipboard.onChanged((p) => apply(p.clipboard, p.rev))

    const unsubscribe = useAppStore.subscribe(
      (s) => s.chartClipboard,
      (clipboard) => {
        if (applyingRemote) return
        void api.clipboard.set(clipboard)
      }
    )

    return () => {
      mounted = false
      off()
      unsubscribe()
    }
  }, [])
}
```

- [ ] **Step 2: Call the hook in `src/renderer/App.tsx`**

2a. Add the import next to the `useWorkspaceSync` import (App.tsx line 20):

```ts
import { useClipboardSync } from './hooks/useClipboardSync'
```

2b. Call it right after the existing `useWorkspaceSync()` call (App.tsx line 31):

```ts
  useWorkspaceSync()
  useClipboardSync()
```

- [ ] **Step 3: Call the hook in `src/renderer/components/ChartWindow.tsx`**

3a. Add the import next to the `useWorkspaceSync` import (ChartWindow.tsx line 5):

```ts
import { useClipboardSync } from '@/hooks/useClipboardSync'
```

3b. Call it right after the existing `useWorkspaceSync()` call (ChartWindow.tsx line 15):

```ts
  useWorkspaceSync()
  useClipboardSync()
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useClipboardSync.ts src/renderer/App.tsx src/renderer/components/ChartWindow.tsx
git commit -m "feat(renderer): useClipboardSync cross-window chart clipboard"
```

---

### Task 4: `ContextMenuSeparator` export + `ChartContextMenu` component

**Files:**
- Modify: `src/renderer/components/ui/context-menu.tsx` (add `ContextMenuSeparator`)
- Create: `src/renderer/components/ChartContextMenu.tsx`

**Interfaces:**
- Consumes: `ContextMenu`/`ContextMenuTrigger`/`ContextMenuContent`/`ContextMenuItem`/`ContextMenuSeparator` from `./ui/context-menu`; store actions from Task 1; `api.company.openWindow`, `qk.profile`; `selectActiveItems`.
- Produces: `ChartContextMenu({ cellId, children }: { cellId: string; children: React.ReactNode }): React.JSX.Element` — wraps `children` as the context-menu trigger and renders the full menu (company info / watchlist toggle / copy / cut / paste / remove) with per-item enable/disable based on the cell's symbol and clipboard state.

- [ ] **Step 1: Add `ContextMenuSeparator` to `src/renderer/components/ui/context-menu.tsx`**

1a. Add the component definition right before the `export {` line (after line 40):

```tsx
const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-border", className)}
    {...props}
  />
))
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName
```

1b. Add it to the export (line 42):

```tsx
export { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator }
```

- [ ] **Step 2: Create `src/renderer/components/ChartContextMenu.tsx`**

```tsx
import React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, qk } from '@/api'
import { useAppStore, selectActiveItems } from '@/store'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator
} from './ui/context-menu'
import type { SymbolResult } from '@shared/types'

// The shared right-click menu for a chart cell. Wraps `children` (the cell's populated ChartPanel
// OR its empty placeholder) so both the grid (GridCell) and the enlarge window (ChartWindow) get an
// identical menu — including on empty cells, so a Paste (or paste-back after a Cut) has a target.
export function ChartContextMenu({ cellId, children }: { cellId: string; children: React.ReactNode }): React.JSX.Element {
  const queryClient = useQueryClient()
  const symbol = useAppStore((s) => s.cells.find((c) => c.id === cellId)?.symbol ?? null)
  const watched = useAppStore((s) => (symbol ? selectActiveItems(s).some((w) => w.symbol === symbol) : false))
  const hasClipboard = useAppStore((s) => s.chartClipboard !== null)
  const addToWatchlist = useAppStore((s) => s.addToWatchlist)
  const removeFromWatchlist = useAppStore((s) => s.removeFromWatchlist)
  const copyCell = useAppStore((s) => s.copyCell)
  const cutCell = useAppStore((s) => s.cutCell)
  const pasteCell = useAppStore((s) => s.pasteCell)
  const clearCell = useAppStore((s) => s.clearCell)

  const toggleWatchlist = (): void => {
    if (!symbol) return
    if (watched) {
      removeFromWatchlist(symbol)
    } else {
      // Reuse the same profile→name/exchange fallback as FavoriteStar. The profile is virtually
      // always already cached (SymbolLabel renders it), so read it from the query cache — no fetch.
      const p = queryClient.getQueryData<SymbolResult>(qk.profile(symbol))
      addToWatchlist({ symbol, name: p?.name ?? symbol, exchange: p?.exchange ?? '' })
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {symbol && (
          <>
            <ContextMenuItem onSelect={() => void api.company.openWindow(symbol)}>
              Show company info
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={toggleWatchlist}>
              {watched ? 'Remove from watchlist' : 'Add to watchlist'}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem disabled={!symbol} onSelect={() => copyCell(cellId)}>Copy chart</ContextMenuItem>
        <ContextMenuItem disabled={!symbol} onSelect={() => cutCell(cellId)}>Cut chart</ContextMenuItem>
        <ContextMenuItem disabled={!hasClipboard} onSelect={() => pasteCell(cellId)}>Paste chart</ContextMenuItem>
        {symbol && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => clearCell(cellId)}>Remove from chart</ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ui/context-menu.tsx src/renderer/components/ChartContextMenu.tsx
git commit -m "feat(ui): ChartContextMenu component + ContextMenuSeparator"
```

---

### Task 5: Wire `ChartContextMenu` into `GridCell` and `ChartWindow`

**Files:**
- Modify: `src/renderer/components/GridHost.tsx` (`GridCell` — replace the old single-item menu; wrap both populated + empty content)
- Modify: `src/renderer/components/ChartWindow.tsx` (wrap content when the cell exists)

**Interfaces:**
- Consumes: `ChartContextMenu` from Task 4.
- Produces: no new exports — final integration. Grid cells (populated + empty) and the enlarge window (populated + empty-symbol) all render the shared menu.

- [ ] **Step 1: Update `GridCell` in `src/renderer/components/GridHost.tsx`**

1a. Replace the context-menu import (line 13) with the `ChartContextMenu` import. Remove the now-unused `ContextMenu*` import and add:

```tsx
import { ChartContextMenu } from './ChartContextMenu'
```

(Delete the old line `import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from './ui/context-menu'` — `GridHost` no longer uses those primitives directly.)

1b. Replace the entire ternary body inside `GridCell`'s outer `<div>` (lines 291-324, from `{cell.symbol` through the closing `: <div ...>Search a symbol to begin.</div>}`) with:

```tsx
      <ChartContextMenu cellId={cell.id}>
        {cell.symbol
          ? (
            /* pl-6 reserves a left gutter for the drag handle so it sits to the LEFT of the ticker
               instead of top-right next to the × button (mis-click hazard). */
            <div className="flex h-full min-h-0 min-w-0 flex-col gap-4 pl-6">
              {/* Drag handle: the ONLY drag source for the cell — keeps chart body, timeframe/★/×
                  buttons, and the shared ChartPanel (used by ChartWindow) non-draggable. */}
              <span
                draggable
                onDragStart={(e) => {
                  e.stopPropagation()
                  e.dataTransfer.setData('application/x-vv-cell', cell.id)
                }}
                onDragEnd={() => onDropTarget(null)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Move ${cell.symbol} chart`}
                className="invisible absolute left-1 top-1.5 z-10 cursor-grab text-muted-foreground hover:text-foreground group-hover/cell:visible"
              >
                <GripVertical className="size-4" />
              </span>
              <ChartPanel cell={cell} />
            </div>
            )
          : <div className="flex h-full min-h-0 min-w-0 items-start p-6 text-muted-foreground">Search a symbol to begin.</div>}
      </ChartContextMenu>
```

- [ ] **Step 2: Update `ChartWindow` in `src/renderer/components/ChartWindow.tsx`**

2a. Add the import next to the `ChartPanel` import (line 6):

```tsx
import { ChartContextMenu } from './ChartContextMenu'
```

2b. Replace the `content` computation (lines 23-38) with a version that wraps the in-workspace branches (populated + empty-symbol) in `ChartContextMenu`, leaving the not-in-workspace branch menu-less:

```tsx
  // One TooltipProvider/Toaster around every branch: ChartPanel renders Radix Tooltips (SymbolLabel,
  // TimeframeRow) which throw without a provider ancestor, and gating toasts need somewhere to render.
  const content = !cell
    ? (
      <div className="flex h-screen items-center justify-center bg-background p-8 text-center text-muted-foreground">
        This chart is not in the current workspace. Switch back to its workspace to see it again.
      </div>
      )
    : (
      // Wrap in the shared menu even when empty (no symbol) so a Paste — or paste-back after a Cut
      // in this window — has a target.
      <ChartContextMenu cellId={cellId}>
        {cell.symbol
          ? (
            <div className="flex h-screen min-h-0 min-w-0 flex-col gap-4 bg-background p-4 text-foreground">
              <ChartPanel cell={cell} />
            </div>
            )
          : (
            <div className="flex h-screen items-center justify-center bg-background p-8 text-center text-muted-foreground">
              This chart has no symbol set.
            </div>
            )}
      </ChartContextMenu>
      )
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Run the full test suite (guard against regressions)**

Run: `npm test`
Expected: PASS (all tests, including Task 1's new clipboard tests).

- [ ] **Step 5: Manual verification (Radix menu render — can't be unit-tested)**

Run: `npm run dev`

Verify:
1. Right-click a populated grid chart → menu shows: Show company info, Add/Remove watchlist (label matches watchlist state), Copy chart, Cut chart, Paste chart (disabled if nothing copied), Remove from chart.
2. Copy a chart, right-click another cell → Paste chart enabled → paste replaces symbol/timeframe/indicators; volume shows once.
3. Cut a chart → source empties; right-click the now-empty cell → Paste chart enabled → paste-back works.
4. Right-click an empty cell → only Copy/Cut (disabled) + Paste (enabled iff clipboard has content).
5. Double-click a chart to open the enlarge window → right-click there → same menu; copy in the grid then open a NEW enlarge window → Paste is enabled (clipboard synced to the fresh window).
6. Add/Remove watchlist toggles the sidebar star state.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/GridHost.tsx src/renderer/components/ChartWindow.tsx
git commit -m "feat(chart): shared right-click menu on grid cells and enlarge window"
```

---

## Self-Review

**Spec coverage:**
- Watchlist add/remove toggle → Task 4 (menu item) + Task 1 reuse of `addToWatchlist`/`removeFromWatchlist`. ✓
- Remove from chart (empty the cell) → Task 4 menu item → `clearCell`. ✓
- Copy / Cut / Paste (whole config) → Task 1 actions + Task 4 menu items. ✓
- Cross-window shared clipboard (main-held + rev) → Tasks 2 + 3. ✓
- Same menu on enlarge window → Task 5 (`ChartWindow` wrap) via shared `ChartContextMenu`. ✓
- Empty-cell paste target (menu survives cut) → Task 4 wrapper design + Task 5 wiring both branches. ✓
- Paste re-mints ids + one fixed Volume + clears crosshair → Task 1 `pasteCell` + tests. ✓
- `ContextMenuSeparator` export → Task 4. ✓
- Tests in the existing Vitest suite → Task 1 Step 2. ✓
- Watchlist payload = full `SymbolResult` with profile fallback → Task 4 `toggleWatchlist`. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to" — every code step has complete code. ✓

**Type consistency:** `ClipboardCell = { symbol, timeframe, indicators }` defined in `@shared/types` (Task 1) and imported identically in store, ipc, preload, main, and `useClipboardSync`. `ClipboardPayload = { clipboard, rev }` used in ipc/preload/hook. Action names `copyCell`/`cutCell`/`pasteCell`/`setClipboard` match across store, tests, and `ChartContextMenu`. `ChartContextMenu({ cellId, children })` signature matches its call sites in `GridCell` and `ChartWindow`. `api.clipboard.{get,set,onChanged}` match across preload and hook. ✓
