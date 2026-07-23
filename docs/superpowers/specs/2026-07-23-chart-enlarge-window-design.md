# Enlarge a chart in a separate OS window — Design

**Date:** 2026-07-23
**Status:** Draft (pending spec review)

## Problem

To see a single chart larger, the user currently has to switch the grid to 1x1
and put the symbol there — which destroys their multi-chart layout. We want a
chart cell to open **enlarged in its own OS window** on double-click, leaving the
grid untouched.

## Decision

Double-clicking a (non-empty) chart cell opens that cell **enlarged in a separate
OS window**, keyed by **cellId**. The window is a full-featured chart (change
timeframe, add / remove / edit indicators) and **syncs bidirectionally** with the
source cell.

This reuses the existing company-info-window pattern: the enlarge window loads the
**same renderer bundle** with a hash marker (`#chart=<cellId>`); `main.tsx` mounts a
standalone `<ChartWindow>` instead of `<App>`.

### Keying: cellId, not symbol

A chart's state (timeframe + overlaid indicators) is **per-cell**, not per-symbol —
the same symbol can live in two cells with different timeframes/indicators. So the
window is keyed by cellId:

- Double-clicking the **same** cell again → focuses its existing window (no dupes).
- Two different cells showing AAPL → two windows (correct: they are two charts).

### Behavior on workspace switch (Option A)

Both windows share **one** persisted workspace collection with a single `active`
workspace, so the enlarge window **follows the active workspace**. When the user
switches watchlist/workspace in the main window, the enlarged cellId is no longer
in the active hot grid, so the enlarge window shows a **placeholder** ("this chart
isn't in the current workspace") and **auto-restores** when the user switches back.
The window is never auto-closed (non-destructive).

Rejected alternatives (see 2026-07-23 investigation): **A′** auto-close — destructive
on a transient switch; **B** pin-to-original-workspace — breaks the single-active
invariant and needs per-cell IPC mirroring; **C** retarget-to-active-workspace-cell —
redefines the feature and conflicts with cellId keying.

## Sync architecture — reuse the persistence backbone

Persistence is already a shared source of truth: renderer store → 500ms debounced
`api.workspaces.set(collectionSnapshot())` → main writes JSON; boot →
`api.workspaces.get()` → `hydrateWorkspaces`. Both windows are just **views over the
same persisted collection**. The only new machinery is propagation between live
windows:

- **`workspaces:changed` broadcast.** When main handles `workspaces:set`, after
  persisting it forwards the collection (with a revision — see below) to **all other**
  windows via `webContents.send`. Recipients call `hydrateWorkspaces`.
- **Shared `useWorkspaceSync()` hook.** Extract App's startup-hydrate + debounced-save
  effect into one hook used by **both** `App` and `ChartWindow`, plus a
  `workspaces:changed` listener. Keeps the two windows on identical sync logic.

### Sync correctness (prerequisite 2)

1. **Cancel pending save on remote apply.** A `workspaces:changed` handler must clear
   any pending local debounce timer before hydrating, and wrap the hydrate in an
   `applyingRemote` flag so the store subscription doesn't reschedule a save. Without
   the timer-cancel, a stale pre-broadcast timer can fire and re-save the old snapshot
   over the just-applied remote state.
2. **Revision guard.** Main keeps a monotonic `rev` counter, increments it on each
   persisted `workspaces:set`, and includes it in both the `workspaces:get` result and
   the `workspaces:changed` broadcast. Each renderer tracks `lastRev` and **ignores**
   any broadcast/get with `rev <= lastRev`. This drops out-of-order and startup-race
   applies (an early broadcast landing before the initial `get` resolves).

> ponytail: whole-collection last-writer-wins is retained. Two windows editing
> different cells within the same 500ms window can still clobber each other (the
> loser's edit is lost on next save). Field-level merge is out of scope; the revision
> guard only fixes ordering, not concurrent-write merge. Upgrade path: per-cell writes
> or a CRDT if concurrent multi-window editing becomes common.

## cellId collection-wide uniqueness (prerequisite 1)

The enlarge window finds its cell by `cells.find(c => c.id === cellId)` in the active
hot grid. This is only unambiguous if cellIds are unique **across the whole
collection** — otherwise a same-id cell in the now-active workspace shows the wrong
chart instead of the placeholder. Today ids are **not** collection-wide unique:

1. `duplicateWorkspace()` copies the layout verbatim, cloning cell + indicator ids.
2. `emptyLayout()` seeds inactive/malformed workspaces with fixed ids `"1"` / `"2"`,
   so multiple empty workspaces collide.
3. `hydrate()` reseeds `nextId` from the **activated** workspace only, not the whole
   collection.

Fixes (all deterministic so every window computes identical ids — no cross-window
divergence):

- **`parseWorkspaceCollection` dedup pass.** After parsing, walk every workspace's
  cells + indicators; keep the first occurrence of each id, and **deterministically**
  remint later duplicates (suffix by position, e.g. `${id}__w${wi}c${ci}`). Runs
  identically in every window at startup, healing legacy `"1"/"2"` collisions. First
  occurrences (real cells) keep their original id → stable references.
- **`duplicateWorkspace` reminting.** Mint fresh cell + indicator ids (via `nextId`)
  for the duplicated layout in the store. This happens in one window, then the result
  is persisted + broadcast, so the other window receives the reminted collection
  directly (no divergence).
- **Reseed across the whole collection.** `hydrateWorkspaces` reseeds `nextId` past the
  max id in **every** workspace's layout, so runtime-minted ids never collide with a
  non-active workspace's ids.

## Components

### Main process (`src/main/index.ts`)
- `Map<string, BrowserWindow>` keyed by cellId (twin of `companyWindows`).
- IPC `chart:openWindow(cellId)`: focus if live, else create a ~1100×760 native-frame
  window (dark `backgroundColor`, `show:false` → `ready-to-show`, `hardenWindow`),
  load renderer with `#chart=<cellId>`, `delete` from map on `'closed'`.
- Main-window `'closed'` also closes all chart windows (same as company windows).
- `workspaces:set` handler: persist → bump `rev` → broadcast `workspaces:changed`
  `{ collection, rev }` to every other window. `workspaces:get` returns `{ collection, rev }`.

### Renderer
- `main.tsx`: add a `chart=` hash branch → mount `<ChartWindow cellId>`.
- `ChartWindow.tsx` (new): applies theme, calls `useWorkspaceSync()`, looks up the
  cell by id in `cells`. If found → renders `<ChartPanel>` fullscreen and sets
  `document.title` to the symbol. If not found → placeholder ("this chart isn't in the
  current workspace").
- `ChartPanel.tsx` (new): extracted from `GridCell`'s inner body — `SymbolLabel` +
  `TimeframeRow` + `AddIndicatorMenu` + remove-X + `<Chart>`. `GridCell` wraps it with
  grid chrome (active ring, click-to-activate, context menu) and an `onDoubleClick`
  (non-empty cells only) → `api.chart.openWindow(cell.id)`.
- `useWorkspaceSync.ts` (new): startup hydrate from `workspaces.get` (rev-guarded),
  debounced save, `workspaces:changed` listener (cancel pending timer + `applyingRemote`
  + rev guard). Used by both `App` and `ChartWindow`. App keeps its own theme/sidebar
  startup effects.

### Plumbing
- `src/shared/chartWindow.ts` (new): `buildChartHash(cellId)` / `parseChartCellId(hash)`
  (twin of `companyWindow.ts`).
- `src/shared/ipc.ts`: add `chart:openWindow` and `workspaces:changed`; `workspaces.get`
  / `set` signatures carry `rev`; `preload` exposes `chart.openWindow` and an
  `onWorkspacesChanged(cb)` subscription.

## Data flow

double-click cell → `api.chart.openWindow(cellId)` → main creates/focuses window →
new window boots renderer in chart mode → `useWorkspaceSync` hydrates the shared
collection → `ChartWindow` renders the cell fullscreen. Any edit (either window) →
debounced `workspaces:set` → main persists + broadcasts → other window hydrates
(guarded) → its view updates within ~500ms.

## Error handling / edge cases
- Cell not in active `cells` (workspace switched / deleted) → placeholder; restores on
  return. Shows iff `cellId ∈ cells` (surviving a grid shrink below the visible slice
  is fine — the window keeps showing it while the cell exists).
- Cell cleared (symbol null) → same empty-cell prompt the grid shows.
- Reopening a cellId whose window just closed → `'closed'` already removed it from the
  map, so a fresh window is created.
- Renderer never spawns untracked windows (`hardenWindow` denies + routes http(s) to
  the system browser), same as company windows.

## Testing
- Unit: `parseChartCellId` (`#chart=5` → `"5"`, no hash → `null`).
- Unit: `parseWorkspaceCollection` yields collection-wide-unique cell ids (two
  workspaces each with cell id `"1"` → distinct after parse; first occurrence kept).
- Unit: `duplicateWorkspace` shares **no** cell/indicator id with its source.
- Manual: double-click opens an enlarged window; changing timeframe / adding an
  indicator in either window reflects in the other within ~500ms; switching workspace
  in main shows the placeholder and switching back restores the chart; closing the main
  window closes the chart windows and quits.

## Out of scope
- Persisting chart-window position/size across restarts.
- Field-level merge for concurrent multi-window edits (last-writer-wins retained).
- Pinning a chart window to a non-active workspace (Option B).
