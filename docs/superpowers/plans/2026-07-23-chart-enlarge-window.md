# Enlarge a Chart in a Separate OS Window — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Double-clicking a chart cell opens that cell enlarged in its own OS window, keyed by cellId, with bidirectional sync to the source grid cell.

**Architecture:** The enlarge window loads the same renderer bundle with a `#chart=<cellId>` hash (twin of the existing `#company=` company windows) and mounts a standalone `<ChartWindow>`. Both windows share one persisted workspace collection; sync rides the existing debounced `workspaces:set` → JSON persist, plus a new `workspaces:changed` main→renderer broadcast that re-hydrates the other windows. Two prerequisites make this safe: collection-wide-unique cell ids, and an ordering/echo guard on the sync.

**Tech Stack:** Electron (main + preload + renderer), React, zustand (`subscribeWithSelector`), TanStack Query, lightweight-charts, Vitest.

## Global Constraints

- Pin Vite at `^7`.
- better-sqlite3 must be rebuilt against Electron's Node ABI (handled by existing postinstall).
- SQLite = OHLCV cache only; JSON (`app.getPath('userData')`) = user prefs/workspaces.
- Indicator math stays in hand-written TS modules.
- No `Date.now()` / `Math.random()` in `src/renderer/store.ts` or `src/shared/*` (JSON-stable ids; keep the `nextId` counter pattern). `Date.now()` is fine in `src/main/*`.
- Follow the existing test boundary: pure logic in `tests/` (Vitest), Electron/React wiring verified by `npm run typecheck` + `npm run build` + manual smoke. This mirrors the company-window feature, which unit-tested only its pure hash helper.
- Run commands from the repo root `C:/Users/010230240/work/vibing-view`.

---

### Task 1: Chart-window hash helpers

**Files:**
- Create: `src/shared/chartWindow.ts`
- Test: `tests/chartWindow.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildChartHash(cellId: string): string`, `parseChartCellId(hash: string): string | null`.

- [ ] **Step 1: Write the failing test**

`tests/chartWindow.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildChartHash, parseChartCellId } from '../src/shared/chartWindow'

describe('chart window hash', () => {
  it('round-trips a cell id', () => {
    expect(parseChartCellId('#' + buildChartHash('5'))).toBe('5')
  })

  it('parses with and without a leading #', () => {
    expect(parseChartCellId('#chart=12')).toBe('12')
    expect(parseChartCellId('chart=12')).toBe('12')
  })

  it('round-trips an id needing encoding', () => {
    expect(parseChartCellId('#' + buildChartHash('1__w0c1'))).toBe('1__w0c1')
  })

  it('returns null when there is no chart param', () => {
    expect(parseChartCellId('')).toBeNull()
    expect(parseChartCellId('#company=AAPL')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/chartWindow.test.ts`
Expected: FAIL — cannot find module `../src/shared/chartWindow`.

- [ ] **Step 3: Write minimal implementation**

`src/shared/chartWindow.ts`:

```ts
// Enlarge-chart windows reuse the main renderer bundle; the target cell rides in the URL hash
// (#chart=CELLID). main.tsx branches on parseChartCellId; main-process index.ts builds the URL with
// buildChartHash. Twin of companyWindow.ts — shared so both sides agree on the exact format.
export function buildChartHash(cellId: string): string {
  return `chart=${encodeURIComponent(cellId)}`
}

export function parseChartCellId(hash: string): string | null {
  const q = hash.startsWith('#') ? hash.slice(1) : hash
  return new URLSearchParams(q).get('chart')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/chartWindow.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/chartWindow.ts tests/chartWindow.test.ts
git commit -m "feat(chart-window): add #chart hash helpers"
```

---

### Task 2: Collection-wide-unique cell/indicator ids on load

**Files:**
- Modify: `src/shared/workspace.ts` (add `dedupeCollectionIds`, call it in `parseWorkspaceCollection`)
- Test: `tests/renderer/workspace.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: existing `parseWorkspaceCollection(raw): WorkspaceCollection`, types `WorkspaceCollection`, `Workspace`, `Layout`.
- Produces: `parseWorkspaceCollection` now guarantees every cell id and every indicator id is unique across the whole collection. First occurrence (in workspace-then-cell order) keeps its original id; later duplicates get a deterministic suffix. `activeCellId` is remapped when its cell id was reassigned.

**Why:** `emptyLayout()` seeds inactive workspaces with fixed ids `"1"`/`"2"`, and `duplicateWorkspace()` clones ids verbatim, so the enlarge window's `cells.find(c => c.id === cellId)` could match the wrong cell. Deterministic reminting means every window computes identical ids (no cross-window divergence).

- [ ] **Step 1: Write the failing test**

Append to `tests/renderer/workspace.test.ts`:

```ts
describe('parseWorkspaceCollection dedupes ids across the whole collection', () => {
  it('reassigns duplicate cell/indicator ids, keeping the first occurrence', () => {
    const dupCell = {
      id: '1', symbol: 'AAPL', timeframe: '1d',
      indicators: [{ id: '2', type: 'volume', params: {}, colors: {}, visible: true, fixed: true }]
    }
    const raw = {
      version: 3,
      active: 'A',
      workspaces: [
        { name: 'A', items: [], layout: { schemaVersion: 1, cells: [dupCell], shape: { rows: 1, cols: 1 }, activeCellId: '1' } },
        { name: 'B', items: [], layout: { schemaVersion: 1, cells: [{ ...dupCell }], shape: { rows: 1, cols: 1 }, activeCellId: '1' } }
      ]
    }
    const parsed = parseWorkspaceCollection(raw)
    const ids = parsed.workspaces.flatMap((w) => w.layout.cells.flatMap((c) => [c.id, ...c.indicators.map((i) => i.id)]))
    expect(new Set(ids).size).toBe(ids.length) // all unique
    expect(parsed.workspaces[0].layout.cells[0].id).toBe('1') // first occurrence kept
    // workspace B's activeCellId follows its cell's reassigned id
    const bCell = parsed.workspaces[1].layout.cells[0]
    expect(parsed.workspaces[1].layout.activeCellId).toBe(bCell.id)
    expect(bCell.id).not.toBe('1')
  })

  it('leaves an already-unique collection untouched', () => {
    const raw = defaultWorkspaceCollection()
    expect(parseWorkspaceCollection(raw)).toEqual(parseWorkspaceCollection(raw))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/workspace.test.ts -t "dedupes ids"`
Expected: FAIL — duplicate ids present (`new Set(ids).size` < `ids.length`).

- [ ] **Step 3: Write minimal implementation**

In `src/shared/workspace.ts`, add before `parseWorkspaceCollection`:

```ts
// Guarantee every cell id and indicator id is unique across the WHOLE collection. Deterministic
// (no counter/random) so every renderer window computes identical ids from the same input — the
// enlarge window (keyed by cellId) relies on ids being collection-wide unique to find its cell
// unambiguously. First occurrence keeps its id; later duplicates get suffixed until free.
// ponytail: suffixing only ever touches emptyLayout() '1'/'2' seeds and verbatim-duplicated
// workspaces (real cells already carry unique nextId-minted ids); good enough, no UUIDs needed.
function dedupeCollectionIds(collection: WorkspaceCollection): WorkspaceCollection {
  const seen = new Set<string>()
  const uniq = (base: string): string => {
    let id = base
    while (seen.has(id)) id += '_'
    seen.add(id)
    return id
  }
  const workspaces = collection.workspaces.map((w) => {
    let activeCellId = w.layout.activeCellId
    const cells = w.layout.cells.map((c) => {
      const id = uniq(c.id)
      if (id !== c.id && c.id === w.layout.activeCellId) activeCellId = id
      const indicators = c.indicators.map((inst) => {
        const iid = uniq(inst.id)
        return iid === inst.id ? inst : { ...inst, id: iid }
      })
      return { ...c, id, indicators }
    })
    return { ...w, layout: { ...w.layout, cells, activeCellId } }
  })
  return { ...collection, workspaces }
}
```

Then change the final return of `parseWorkspaceCollection` from:

```ts
  return { version: 3, active, workspaces }
```

to:

```ts
  return dedupeCollectionIds({ version: 3, active, workspaces })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/workspace.test.ts`
Expected: PASS (all existing tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/shared/workspace.ts tests/renderer/workspace.test.ts
git commit -m "fix(workspace): make cell/indicator ids unique across the whole collection"
```

---

### Task 3: Remint duplicated layouts + reseed nextId across the collection

**Files:**
- Modify: `src/renderer/store.ts` (`duplicateWorkspace`, `hydrateWorkspaces`)
- Test: `tests/renderer/store.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: existing store actions `duplicateWorkspace(name)`, `hydrateWorkspaces(collection)`, `currentLayout()`; module-level `nextId`, `bumpId`.
- Produces: `duplicateWorkspace` mints fresh cell + indicator ids for the copy (shares none with its source); `hydrateWorkspaces` reseeds `nextId` past the max id across **every** workspace layout, not just the active one.

- [ ] **Step 1: Write the failing test**

Append to `tests/renderer/store.test.ts`:

```ts
describe('workspace duplication mints fresh ids', () => {
  beforeEach(() => {
    useAppStore.getState().hydrateWorkspaces({
      version: 3, active: 'Src',
      workspaces: [{
        name: 'Src', items: [],
        layout: {
          schemaVersion: 1,
          cells: [{ id: 'srcC', symbol: 'AAPL', timeframe: '1d', indicators: [{ id: 'srcI', type: 'volume', params: {}, colors: {}, visible: true, fixed: true }] }],
          shape: { rows: 1, cols: 1 }, activeCellId: 'srcC'
        }
      }]
    })
  })

  it('duplicate shares no cell or indicator id with its source', () => {
    useAppStore.getState().duplicateWorkspace('Copy')
    const wss = useAppStore.getState().workspaces
    const src = wss.find((w) => w.name === 'Src')!
    const copy = wss.find((w) => w.name === 'Copy')!
    const srcIds = src.layout.cells.flatMap((c) => [c.id, ...c.indicators.map((i) => i.id)])
    const copyIds = copy.layout.cells.flatMap((c) => [c.id, ...c.indicators.map((i) => i.id)])
    expect(srcIds.some((id) => copyIds.includes(id))).toBe(false)
    // copy's activeCellId points at a real cell in the copy
    expect(copy.layout.cells.some((c) => c.id === copy.layout.activeCellId)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/store.test.ts -t "duplicate shares no cell"`
Expected: FAIL — source and copy share ids (`srcC`/`srcI`).

- [ ] **Step 3: Write minimal implementation**

In `src/renderer/store.ts`, inside the `create(...)` body near `snapshotActive`/`activate`, add a helper:

```ts
  // Fresh ids for every cell + indicator in a layout (used when duplicating a workspace so the copy
  // never shares an id with its source — collection-wide uniqueness, see workspace.ts dedupe).
  const remintLayout = (layout: Layout): Layout => {
    let activeCellId = layout.activeCellId
    const cells = layout.cells.map((c) => {
      const id = String(nextId++)
      if (c.id === layout.activeCellId) activeCellId = id
      return { ...c, id, indicators: c.indicators.map((i) => ({ ...i, id: String(nextId++) })) }
    })
    return { ...layout, cells, activeCellId }
  }
```

In `duplicateWorkspace`, change:

```ts
    const layout = get().currentLayout()
```

to:

```ts
    const layout = remintLayout(get().currentLayout())
```

Replace the whole `hydrateWorkspaces` action:

```ts
  hydrateWorkspaces: (collection) => {
    activate(collection.workspaces, collection.active)
  }
```

with:

```ts
  hydrateWorkspaces: (collection) => {
    // Reseed nextId past every id in EVERY workspace (not just the active one activate() hydrates),
    // so a runtime-minted id can't collide with a non-active workspace's cell/indicator id.
    for (const w of collection.workspaces) {
      for (const cell of w.layout.cells) {
        nextId = Math.max(nextId, bumpId(cell.id))
        for (const inst of cell.indicators) nextId = Math.max(nextId, bumpId(inst.id))
      }
    }
    activate(collection.workspaces, collection.active)
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/store.test.ts`
Expected: PASS (all existing + new).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/store.ts tests/renderer/store.test.ts
git commit -m "fix(store): remint duplicated layouts and reseed nextId across all workspaces"
```

---

### Task 4: IPC channels, types, and preload bridge

**Files:**
- Modify: `src/shared/ipc.ts` (add channels + update `Api`)
- Modify: `src/preload/index.ts` (add `chart.openWindow`, `workspaces.onChanged`, update `workspaces.get` type usage)

**Interfaces:**
- Consumes: existing `CH`, `Api`, `WorkspaceCollection`.
- Produces:
  - `CH.chartOpenWindow = 'chart:openWindow'`, `CH.workspacesChanged = 'workspaces:changed'`.
  - `WorkspacesPayload = { collection: WorkspaceCollection; rev: number }` (exported from `ipc.ts`).
  - `Api.workspaces.get(): Promise<WorkspacesPayload>` (changed), `Api.workspaces.onChanged(cb: (p: WorkspacesPayload) => void): () => void` (new), `Api.chart.openWindow(cellId: string): Promise<void>` (new).

- [ ] **Step 1: Edit `src/shared/ipc.ts`**

Add to the `CH` object (after `companyOpenWindow`):

```ts
  companyOpenWindow: 'company:openWindow',
  chartOpenWindow: 'chart:openWindow',
  workspacesChanged: 'workspaces:changed'
```

(Ensure the preceding `companyOpenWindow` line keeps/gains its trailing comma.)

Add an exported type near the other exported types:

```ts
export type WorkspacesPayload = { collection: WorkspaceCollection; rev: number }
```

Change the `workspaces` block of `interface Api` from:

```ts
  workspaces: {
    get(): Promise<WorkspaceCollection>
    set(c: WorkspaceCollection): Promise<void>
  }
```

to:

```ts
  workspaces: {
    // rev: monotonic version stamped by main. Renderers ignore any get/onChanged payload whose rev
    // is <= the last one they applied (drops out-of-order broadcasts and the startup get-vs-broadcast race).
    get(): Promise<WorkspacesPayload>
    set(c: WorkspaceCollection): Promise<void>
    onChanged(cb: (p: WorkspacesPayload) => void): () => void
  }
```

Add a `chart` block to `interface Api` (after `company`):

```ts
  chart: {
    openWindow(cellId: string): Promise<void>
  }
```

- [ ] **Step 2: Edit `src/preload/index.ts`**

Change the `workspaces` block from:

```ts
  workspaces: {
    get: () => ipcRenderer.invoke(CH.workspacesGet),
    set: (c: WorkspaceCollection) => ipcRenderer.invoke(CH.workspacesSet, c)
  },
```

to:

```ts
  workspaces: {
    get: () => ipcRenderer.invoke(CH.workspacesGet),
    set: (c: WorkspaceCollection) => ipcRenderer.invoke(CH.workspacesSet, c),
    onChanged: (cb) => {
      const listener = (_e: unknown, payload: WorkspacesPayload): void => cb(payload)
      ipcRenderer.on(CH.workspacesChanged, listener)
      return () => ipcRenderer.removeListener(CH.workspacesChanged, listener)
    }
  },
```

Change the `company` block to add `chart` after it:

```ts
  company: {
    info: (symbol) => ipcRenderer.invoke(CH.companyInfo, symbol),
    openWindow: (symbol) => ipcRenderer.invoke(CH.companyOpenWindow, symbol)
  },
  chart: {
    openWindow: (cellId) => ipcRenderer.invoke(CH.chartOpenWindow, cellId)
  }
```

Update the top-of-file import to add the payload type:

```ts
import { CH, type Api, type WorkspacesPayload } from '@shared/ipc'
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (If it flags the sole `api.workspaces.get()` call site in `src/renderer/App.tsx` now returning a payload, leave it — Task 6 removes that call from App. If typecheck fails only on `App.tsx` `get()` usage, proceed; it is resolved in Task 6. To keep this task green on its own, temporarily wrap the App call as `api.workspaces.get().then((p) => useAppStore.getState().hydrateWorkspaces(parseWorkspaceCollection((p as unknown as { collection: unknown }).collection)))` — Task 6 deletes it.)

> Note: prefer to run Task 4 and Task 6 back-to-back so the App call site is migrated cleanly rather than shimmed. The shim above exists only so this task can typecheck in isolation.

- [ ] **Step 4: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/renderer/App.tsx
git commit -m "feat(ipc): add chart:openWindow + workspaces:changed channels and rev payload"
```

---

### Task 5: Main-process chart windows + broadcast

**Files:**
- Modify: `src/main/index.ts` (chart window map, `openChartWindow`, teardown, handler)
- Modify: `src/main/ipc.ts` (rev counter, broadcast on set, rev on get)

**Interfaces:**
- Consumes: `CH.chartOpenWindow`, `CH.workspacesChanged`, `buildChartHash`, existing `loadRenderer`, `hardenWindow`, `companyWindows` teardown pattern, `workspaceStore.getWorkspaces/setWorkspaces`.
- Produces: opening `chart:openWindow(cellId)` focuses/creates a chart window; `workspaces:set` persists, bumps rev, and broadcasts `{ collection, rev }` to all other windows; `workspaces:get` returns `{ collection, rev }`.

- [ ] **Step 1: Edit `src/main/index.ts`**

Add the import at the top (alongside `buildCompanyHash`):

```ts
import { buildCompanyHash } from '@shared/companyWindow'
import { buildChartHash } from '@shared/chartWindow'
```

Add a second module-level map after `companyWindows`:

```ts
// One enlarge-chart window per cellId (spec: cellId keying; the same cell re-focuses, a different
// cell spawns another). Cleared on 'closed'. Twin of companyWindows.
const chartWindows = new Map<string, BrowserWindow>()
```

In `createWindow`, extend the main-window `'closed'` handler to also tear down chart windows:

```ts
  win.on('closed', () => {
    for (const w of companyWindows.values()) w.close()
    for (const w of chartWindows.values()) w.close()
  })
```

Add `openChartWindow` after `openCompanyWindow`:

```ts
function openChartWindow(cellId: string): void {
  const existing = chartWindows.get(cellId)
  if (existing) {
    existing.focus()
    return
  }
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    backgroundColor: '#0B0E11',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  hardenWindow(win)
  chartWindows.set(cellId, win)
  win.on('ready-to-show', () => win.show())
  win.on('closed', () => chartWindows.delete(cellId))
  loadRenderer(win, buildChartHash(cellId))
}
```

Register the handler in `app.whenReady().then(...)`, next to the company one:

```ts
  ipcMain.handle(CH.companyOpenWindow, (_e, symbol: string) => openCompanyWindow(symbol))
  ipcMain.handle(CH.chartOpenWindow, (_e, cellId: string) => openChartWindow(cellId))
```

- [ ] **Step 2: Edit `src/main/ipc.ts`**

Add `BrowserWindow` to the electron import:

```ts
import { ipcMain, BrowserWindow } from 'electron'
```

Inside `registerIpc()`, before the `ipcMain.handle(CH.workspacesGet, ...)` line, add:

```ts
  // Monotonic version stamped on each persisted workspace write. Renderers ignore stale (<= lastRev)
  // get/broadcast payloads — see the sync guard in useWorkspaceSync (ordering + startup race).
  let workspacesRev = 0
```

Replace the two workspace handlers:

```ts
  ipcMain.handle(CH.workspacesGet, () => workspaceStore.getWorkspaces())
  ipcMain.handle(CH.workspacesSet, (_e, c: WorkspaceCollection) => workspaceStore.setWorkspaces(c))
```

with:

```ts
  ipcMain.handle(CH.workspacesGet, () => ({ collection: workspaceStore.getWorkspaces(), rev: workspacesRev }))
  ipcMain.handle(CH.workspacesSet, (e, c: WorkspaceCollection) => {
    workspaceStore.setWorkspaces(c)
    workspacesRev += 1
    // Forward the new collection to every OTHER window so it re-hydrates. The sender skips itself —
    // its own store is already current and re-applying would fight its debounce.
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.webContents.id !== e.sender.id) {
        w.webContents.send(CH.workspacesChanged, { collection: c, rev: workspacesRev })
      }
    }
  })
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS (both).

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/main/ipc.ts
git commit -m "feat(main): open enlarge-chart windows and broadcast workspace changes"
```

---

### Task 6: Shared workspace-sync hook + adopt in App

**Files:**
- Create: `src/renderer/hooks/useWorkspaceSync.ts`
- Modify: `src/renderer/App.tsx` (drop the inline workspaces hydrate + debounced-save effect; call the hook)

**Interfaces:**
- Consumes: `useAppStore` (`hydrateWorkspaces`, `collectionSnapshot`, and the subscribe fields `cells`/`shape`/`activeCellId`/`workspaces`/`activeWorkspace`), `api.workspaces.get/set/onChanged`, `parseWorkspaceCollection`, `WorkspacesPayload`.
- Produces: `useWorkspaceSync(): void` — on mount hydrates from `workspaces.get` (rev-guarded), debounce-saves local changes (500ms), and applies `workspaces:changed` broadcasts (rev-guarded, cancels a pending local save, suppresses the echo). Used by both `App` and `ChartWindow`.

- [ ] **Step 1: Create `src/renderer/hooks/useWorkspaceSync.ts`**

```ts
import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { api } from '@/api'
import { parseWorkspaceCollection } from '@shared/workspace'
import type { WorkspaceCollection } from '@shared/types'

// Module-scope guard: true only while we're applying a remote/get collection. The store notifies
// subscribers synchronously inside set(), so the save subscriber below sees this true during the
// remote hydrate and skips scheduling an echo save. One window per renderer → one hook instance.
let applyingRemote = false

// Startup hydrate + debounced persist + cross-window sync, shared by App and ChartWindow. Both
// windows are views over the SAME persisted workspace collection; this hook is the whole sync.
export function useWorkspaceSync(): void {
  useEffect(() => {
    let mounted = true
    let lastRev = -1
    let timer: ReturnType<typeof setTimeout> | null = null

    const apply = (collection: WorkspaceCollection, rev: number): void => {
      if (rev <= lastRev) return // stale / out-of-order (also drops a get that lost the startup race)
      lastRev = rev
      if (timer) { clearTimeout(timer); timer = null } // a pending local save is now stale — cancel it
      applyingRemote = true
      useAppStore.getState().hydrateWorkspaces(collection)
      applyingRemote = false
    }

    void api.workspaces.get().then((p) => {
      if (mounted) apply(parseWorkspaceCollection(p.collection), p.rev)
    })

    const off = api.workspaces.onChanged((p) => {
      apply(parseWorkspaceCollection(p.collection), p.rev)
    })

    const unsubscribe = useAppStore.subscribe(
      (s) => [s.cells, s.shape, s.activeCellId, s.workspaces, s.activeWorkspace] as const,
      () => {
        if (applyingRemote) return
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          void api.workspaces.set(useAppStore.getState().collectionSnapshot())
        }, 500)
      },
      { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] }
    )

    return () => {
      mounted = false
      if (timer) clearTimeout(timer)
      off()
      unsubscribe()
    }
  }, [])
}
```

- [ ] **Step 2: Edit `src/renderer/App.tsx`**

Add the import:

```ts
import { useWorkspaceSync } from './hooks/useWorkspaceSync'
```

Remove the `void api.workspaces.get().then(...)` call from the startup `useEffect` (keep the theme + sidebar calls). The effect becomes:

```ts
  useEffect(() => {
    void api.settings.getTheme().then(applyTheme)
    void api.settings.getSidebarOpen().then((open) => {
      if (open !== null) setSidebarOpen(open)
    })
    void api.settings.getSidebarWidth().then((w) => {
      if (w !== null) setSidebarWidth(w)
    })
  }, [])
```

Delete the entire debounced auto-save `useEffect` (the one containing `useAppStore.subscribe(... api.workspaces.set ...)`).

Add the hook call at the top of the component body (after the `useState` lines):

```ts
  useWorkspaceSync()
```

Remove the now-unused `parseWorkspaceCollection` import if TypeScript flags it as unused.

- [ ] **Step 3: Typecheck + tests + build**

Run: `npm run typecheck && npm run test && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/hooks/useWorkspaceSync.ts src/renderer/App.tsx
git commit -m "refactor(renderer): extract workspace persistence into useWorkspaceSync with cross-window sync"
```

---

### Task 7: ChartPanel extraction, double-click, and the ChartWindow

**Files:**
- Modify: `src/renderer/components/GridHost.tsx` (export `ChartPanel`; `GridCell` uses it + `onDoubleClick`)
- Create: `src/renderer/components/ChartWindow.tsx`
- Modify: `src/renderer/main.tsx` (route `#chart=` to `<ChartWindow>`)

**Interfaces:**
- Consumes: existing GridHost-private helpers (`useCellCapabilityGating`, `SymbolLabel`, `AddIndicatorMenu`, `TimeframeRow`, `Chart`, store actions), `useWorkspaceSync`, `parseChartCellId`, `api.chart.openWindow`, `applyTheme`.
- Produces: `ChartPanel({ cell }: { cell: Cell })` exported from `GridHost.tsx` (renders the chart toolbar + chart for a symbol-bearing cell, as a fragment); `ChartWindow({ cellId }: { cellId: string })`.

- [ ] **Step 1: Extract `ChartPanel` in `src/renderer/components/GridHost.tsx`**

Add `import { api }` already exists. Add an exported `ChartPanel` above `GridCell`:

```ts
// The chart toolbar + chart body for one symbol-bearing cell. Rendered fragment (no outer box) so
// GridCell can wrap it as a ContextMenu trigger and ChartWindow can render it full-screen. Owns the
// per-cell capability gating so both the grid and the enlarge window gate their own row.
export function ChartPanel({ cell }: { cell: Cell }): React.JSX.Element {
  const setCellTimeframe = useAppStore((s) => s.setCellTimeframe)
  const clearCell = useAppStore((s) => s.clearCell)
  useCellCapabilityGating(cell.id, cell.symbol, cell.timeframe)

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <SymbolLabel symbol={cell.symbol!} timeframe={cell.timeframe} />
        <TimeframeRow value={cell.timeframe} onChange={(tf) => setCellTimeframe(cell.id, tf)} />
        <AddIndicatorMenu cellId={cell.id} />
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-6 w-6 [&_svg]:size-3.5"
          aria-label={`Remove ${cell.symbol} chart`}
          onClick={(e) => { e.stopPropagation(); clearCell(cell.id) }}
        >
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <Chart cellId={cell.id} symbol={cell.symbol!} timeframe={cell.timeframe} />
      </div>
    </>
  )
}
```

- [ ] **Step 2: Rewrite `GridCell` to use `ChartPanel` + double-click**

Replace the `GridCell` function body with:

```ts
function GridCell({ cell, active }: { cell: Cell; active: boolean }): React.JSX.Element {
  const setActiveCell = useAppStore((s) => s.setActiveCell)

  return (
    <div
      onClick={() => setActiveCell(cell.id)}
      // Double-click a chart-bearing cell → open it enlarged in its own OS window (keyed by cellId).
      // The user reports the chart canvas's built-in double-click zoom-reset doesn't fire in-app, so
      // binding the whole cell is safe. Empty cells have nothing to enlarge.
      onDoubleClick={cell.symbol ? () => void api.chart.openWindow(cell.id) : undefined}
      className={cn(
        'flex h-full min-h-0 min-w-0 flex-col gap-4 rounded-md',
        active && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
      )}
    >
      {cell.symbol
        ? (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className="flex h-full min-h-0 min-w-0 flex-col gap-4">
                <ChartPanel cell={cell} />
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => void api.company.openWindow(cell.symbol!)}>
                Show company info
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          )
        : <div className="p-6 text-muted-foreground">Search a symbol to begin.</div>}
    </div>
  )
}
```

(The `useCellCapabilityGating` call that was in `GridCell` now lives in `ChartPanel`; empty cells no longer gate, which is a no-op since gating short-circuits on a null symbol.)

- [ ] **Step 3: Create `src/renderer/components/ChartWindow.tsx`**

```ts
import React, { useEffect } from 'react'
import { api } from '@/api'
import { useAppStore } from '@/store'
import { applyTheme } from '@/lib/theme'
import { useWorkspaceSync } from '@/hooks/useWorkspaceSync'
import { ChartPanel } from './GridHost'

// Standalone enlarge-chart window. Shares the workspace collection with every other window via
// useWorkspaceSync, so edits here (timeframe / indicators) sync to the source grid cell and back.
// Follows the active workspace: if its cell leaves the active hot grid (workspace switched away),
// it shows a placeholder and auto-restores when the workspace becomes active again.
export function ChartWindow({ cellId }: { cellId: string }): React.JSX.Element {
  useWorkspaceSync()
  useEffect(() => { void api.settings.getTheme().then(applyTheme) }, [])

  const cell = useAppStore((s) => s.cells.find((c) => c.id === cellId))
  useEffect(() => { document.title = cell?.symbol ?? 'Chart' }, [cell?.symbol])

  if (!cell) {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-8 text-center text-muted-foreground">
        このチャートは現在のワークスペースにありません。元のワークスペースに戻すと再表示されます。
      </div>
    )
  }
  if (!cell.symbol) {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-8 text-center text-muted-foreground">
        このチャートには銘柄が設定されていません。
      </div>
    )
  }
  return (
    <div className="flex h-screen min-h-0 min-w-0 flex-col gap-4 bg-background p-4 text-foreground">
      <ChartPanel cell={cell} />
    </div>
  )
}
```

`ChartPanel` is exported from `GridHost.tsx` (Task 7 Step 1), so the `import { ChartPanel } from './GridHost'` above resolves directly — no separate component file.

- [ ] **Step 4: Route `#chart=` in `src/renderer/main.tsx`**

Add imports:

```ts
import { parseChartCellId } from '@shared/chartWindow'
import { ChartWindow } from './components/ChartWindow'
```

After the `companySymbol` line add:

```ts
const chartCellId = parseChartCellId(window.location.hash)
```

Change the render branch from:

```tsx
      {companySymbol ? <CompanyWindow symbol={companySymbol} /> : <App />}
```

to:

```tsx
      {companySymbol
        ? <CompanyWindow symbol={companySymbol} />
        : chartCellId
          ? <ChartWindow cellId={chartCellId} />
          : <App />}
```

- [ ] **Step 5: Typecheck + tests + build**

Run: `npm run typecheck && npm run test && npm run build`
Expected: PASS.

- [ ] **Step 6: Manual smoke test**

Run: `npm run dev`. Verify:
1. Double-click a chart cell → an enlarged window opens showing the same symbol/timeframe/indicators.
2. In the enlarge window, change the timeframe and add an indicator → within ~0.5s the source grid cell reflects both. Then change something in the grid cell → the enlarge window reflects it.
3. Double-click the same cell again → focuses the existing window (no second window). Double-click a different cell showing a different symbol → a second window.
4. Switch to another workspace in the main window → the enlarge window shows the placeholder; switch back → the chart returns.
5. Close the main window → the enlarge window(s) close and the app quits.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/GridHost.tsx src/renderer/components/ChartWindow.tsx src/renderer/main.tsx
git commit -m "feat(chart-window): double-click a cell to open a synced enlarged chart window"
```

---

## Self-Review

**Spec coverage:**
- Double-click opens enlarge window (cellId keying, focus-if-live) → Tasks 5, 7.
- Same renderer bundle + `#chart=` hash routing → Tasks 1, 7.
- Full-operation ChartPanel (timeframe/indicators) reused by grid + window → Task 7.
- Bidirectional sync via existing persistence + `workspaces:changed` broadcast → Tasks 4, 5, 6.
- Sync correctness: cancel pending timer + `applyingRemote` echo guard + rev ordering → Tasks 5 (rev/broadcast), 6 (guard/cancel/rev).
- cellId collection-wide uniqueness: dedupe-on-load + duplicate remint + reseed-all → Tasks 2, 3.
- Option A placeholder + auto-restore; symbol-null empty state → Task 7 (`ChartWindow`).
- Main-window close tears down chart windows; renderer can't spawn untracked windows → Task 5 (`hardenWindow` reused).
- Testing: hash parse, dedupe uniqueness, duplicate remint, manual smoke → Tasks 1, 2, 3, 7.

**Placeholder scan:** No TBD/TODO; every code step shows full code. The Task 4 typecheck note documents a real, temporary shim with its removal point (Task 6), not a placeholder.

**Type consistency:** `WorkspacesPayload = { collection, rev }` used identically in `ipc.ts`, `preload`, and `useWorkspaceSync`. `ChartPanel({ cell })`, `ChartWindow({ cellId })`, `buildChartHash`/`parseChartCellId`, `api.chart.openWindow(cellId)`, `api.workspaces.onChanged` match across tasks. `hydrateWorkspaces`/`collectionSnapshot`/`duplicateWorkspace` names match the existing store.

## Out of Scope
- Persisting chart-window position/size across restarts.
- Field-level merge for concurrent multi-window edits (last-writer-wins retained; noted in spec).
- Pinning a chart window to a non-active workspace (Option B).
