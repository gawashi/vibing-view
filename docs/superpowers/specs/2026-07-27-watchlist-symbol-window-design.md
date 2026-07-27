# Enlarge a watchlist symbol in its own window — Design

**Date:** 2026-07-27
**Status:** Draft (pending spec review)

## Problem

Double-clicking a grid cell opens it enlarged in its own OS window
(2026-07-23 enlarge design). A watchlist row has no such gesture: the only way to
see a watchlist symbol big is to put it into a grid cell first, which overwrites
whatever chart was there.

## Decision

Double-clicking a watchlist row opens that **symbol** enlarged in a separate OS
window. The grid is left completely untouched — no cell is written, no layout
changes, nothing is persisted.

The window is a **throwaway preview**: it starts at the daily timeframe with the
always-on Volume pane, the user can change the timeframe and add indicators
inside it, and all of that is discarded when the window closes. Reopening the
same symbol starts from the defaults again.

### Why not reuse the cellId enlarge window

`ChartPanel` is store-coupled (`setCellTimeframe(cell.id)`,
`AddIndicatorMenu cellId`, `Chart cellId` for the crosshair), so an enlarged
chart needs a cell in `useAppStore`. The existing enlarge window satisfies that
by pointing at a cell in the shared, persisted workspace collection. A watchlist
symbol has no cell, and creating one — even a hidden one outside the visible
grid slice — would push the "which cells are visible" question into the store,
the persistence schema, and the MCP layout code. Rejected: the state is
throwaway, so it does not need to live in the persisted collection at all.

Instead the new window exploits the fact that **each BrowserWindow runs its own
renderer store**. A fresh store already holds exactly what an enlarged chart
needs: a 1x1 shape, one cell, a fixed Volume indicator, `activeCellId` set. The
window calls `setActiveSymbol(symbol)` once and renders `ChartPanel` over that
cell. Because the window never mounts `useWorkspaceSync`, its store is never
saved and never hydrated from the collection — isolation comes from not wiring
the sync, not from new state machinery.

Consequence: the workspace JSON, the grid, the store, and the MCP layout code
are unchanged by this feature.

## Watchlist row behaviour

Today a single click writes the symbol into the active cell, so a double-click
would mutate the grid via its leading `click` event. Rather than debouncing the
click, the row's gestures are redefined:

| Gesture | Before | After |
| --- | --- | --- |
| Single click | `setActiveSymbol` | nothing (row takes focus only) |
| Enter | `setActiveSymbol` | unchanged |
| Drag & drop onto a cell | places the symbol | unchanged |
| Double click | — | opens the symbol window |
| Context menu | Show company info | + Open enlarged chart |

The row keeps `role="button"` / `tabIndex={0}`; Enter and drag & drop remain the
two ways to put a watchlist symbol into the grid.

Double-click alone would leave the feature unreachable from the keyboard, since
Enter keeps its grid-placement meaning. The row already has a context menu, so
the enlarge action is added there: it is reachable with the menu key / Shift+F10,
and it makes the feature discoverable for mouse users too. Redefining Enter is
rejected — it is the only keyboard path into the grid now that single click no
longer places.

## Components

### Main process (`src/main/index.ts`)
- `Map<string, BrowserWindow>` keyed by **symbol** (twin of `companyWindows` /
  `chartWindows`).
- `ipcMain.handle(CH.symbolChartOpenWindow, ...)` → the existing
  `openHashWindow(map, symbol, 1100, 760, buildSymbolChartHash(symbol))`. Same
  size as the cellId enlarge window; focus-if-live and delete-on-`'closed'` come
  from `openHashWindow`.
- Main-window `'closed'` also closes every symbol window, alongside the company
  and chart windows.

### Plumbing
- `src/shared/symbolChartWindow.ts` (new): `buildSymbolChartHash(symbol)` /
  `parseSymbolChartSymbol(hash)` — twin of `companyWindow.ts`, hash key
  `symbolChart`.
- `src/shared/ipc.ts`: add `symbolChart:openWindow`; preload exposes
  `symbolChart.openWindow(symbol)`.

### Renderer
- `main.tsx`: add a `symbolChart=` hash branch → mount
  `<SymbolChartWindow symbol>`.
- `SymbolChartWindow.tsx` (new): applies the theme, mounts `useRefreshSync()`,
  seeds the store's single cell with the symbol, sets `document.title` to the
  symbol, and renders `<ChartPanel cell minimal />` full-screen inside a
  `TooltipProvider` + `Toaster` (ChartPanel renders Radix tooltips and the
  capability-gating toast). It does **not** mount `useWorkspaceSync` or
  `useClipboardSync`, and it is not wrapped in `ChartContextMenu`.
- `ChartPanel`: new optional `minimal` prop. When set, the header's ★
  (FavoriteStar) and × (clear chart) buttons are not rendered, and a refresh
  button takes the ×'s place. In an isolated window the ★ would report "not
  watched" for a symbol that is in the watchlist by construction and its click
  would be silently discarded; × would only blank the window. Both are hidden
  rather than fixed — this window has no write path back to the collection. The
  grid and the cellId enlarge window keep both buttons and get no refresh button
  (the main toolbar's global reload already covers them).
- The refresh button calls `api.ohlcv.refresh(symbol, timeframe)` — the same
  force-fetch IPC the global reload uses — and writes the result with
  `queryClient.setQueryData(qk.ohlcv(...))`. It refreshes only this window's own
  symbol + timeframe, and does not broadcast. See "Refresh coverage" below for
  why the window needs its own button.
- `Watchlist.tsx` `Row`: drop the `onClick` handler, keep the `Enter` handler,
  add `onDoubleClick={() => void api.symbolChart.openWindow(item.symbol)}`, and
  add an "Open enlarged chart" item to the existing `ContextMenuContent` calling
  the same function.

## Data flow

double-click row → `api.symbolChart.openWindow(symbol)` → main creates or
focuses the window → the new renderer boots in symbol-chart mode with a fresh
store → `setActiveSymbol(symbol)` → `ChartPanel` renders. Timeframe and
indicator edits mutate that window's store only.

### Refresh coverage

The window has two sources of fresh data, and one documented gap.

1. **On open / on timeframe change.** The chart's own query runs
   `api.ohlcv.get(symbol, tf)`, the read-through cache: it returns SQLite rows
   and fetches FMP when the range is not covered. So the data is current as of
   the moment the window opens or the timeframe changes.
2. **While open.** `useRefreshSync` applies the scheduler's `refresh:applied`
   payload to this window's query cache (it never fetches FMP itself). That
   payload covers only what `refreshTargets` computes: the **visible grid cells**
   and, when the sidebar is open, the **watchlist symbols at `1d`**.

> ponytail: a symbol window whose timeframe is not in the scheduler's target set
> — any non-`1d` timeframe, or `1d` while the sidebar is closed or after the
> symbol is removed from the watchlist — receives no automatic updates, and
> `staleTime: Infinity` means its query never refetches on its own. The window's
> refresh button is the manual escape hatch; leaving it open unattended can show
> data as old as the last time it was opened or refreshed. Upgrade path if this
> bites: have each satellite window register its (symbol, timeframe) with the
> main window's scheduler over IPC and unregister on close, then union those into
> `refreshTargets`. Rejected for now — it re-adds the cross-window coupling this
> design exists to avoid, for a window whose whole state is throwaway.

## Error handling / edge cases

- Symbol removed from the watchlist while its window is open → the window keeps
  showing the chart (it is symbol-keyed and independent). Nothing to clean up;
  it just stops receiving scheduler updates (see "Refresh coverage").
- Double-clicking the same symbol again → `openHashWindow` focuses the live
  window instead of spawning a duplicate.
- Two different watchlist rows → two windows, one per symbol.
- First paint before `setActiveSymbol` lands: the cell has `symbol: null` for
  one frame, so the component renders nothing until the symbol is set (guard on
  `cell.symbol`) rather than hitting `ChartPanel`'s `cell.symbol!`.
- Quote / market-status queries are `enabled:false` subscribers, so the header's
  change readout comes from the daily bars fetched by `Chart` until a refresh
  broadcast arrives — identical to the existing enlarge window.
- The renderer cannot spawn untracked windows: `hardenWindow` in
  `openHashWindow` already denies them and routes http(s) to the system browser.

## Testing

- Unit: `parseSymbolChartSymbol('#symbolChart=AAPL')` → `'AAPL'`; no hash →
  `null`; round-trips a symbol through `buildSymbolChartHash`.
- Unit: a watchlist row's single click does not call `setActiveSymbol`, while
  Enter still does.
- Unit: the row's context menu exposes an "Open enlarged chart" item that calls
  `api.symbolChart.openWindow` with the row's symbol (the keyboard path).
- Manual: double-click a watchlist row → an enlarged chart window opens and the
  grid is unchanged; change its timeframe and add an indicator → the grid and
  the persisted workspace stay unchanged; press the window's refresh button →
  the bars update; close and reopen → back to daily with Volume only;
  double-click the same row twice → one window, focused; close the main window →
  the symbol windows close and the app quits.

## Out of scope

- Persisting the symbol window's timeframe / indicators.
- Registering symbol windows with the scheduler's refresh targets (see the
  ponytail note under "Refresh coverage").
- Watchlist add/remove (★) from inside the symbol window.
- Copy / cut / paste and the chart context menu in the symbol window.
- Persisting symbol-window position and size across restarts.
