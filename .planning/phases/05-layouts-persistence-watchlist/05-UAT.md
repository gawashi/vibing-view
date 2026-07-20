---
status: complete
phase: 05-layouts-persistence-watchlist
source: [05-01-PLAN.md, 05-02-PLAN.md, 05-03-PLAN.md, 05-04-PLAN.md]
started: 2026-07-20T02:46:03Z
updated: 2026-07-20T02:46:03Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: With no saved state (fresh install), app boots cleanly and defaults to a 1x1 grid showing AAPL. No error toast, no crash.
result: pass
note: "Initially blank (blocker G-05-1) — fixed inline (IndicatorLegend selector infinite loop); passed on re-test."

### 2. Switch Grid Shape
expected: A header icon row lets you switch between 1x1 / 2x1 / 2x2. Visible cell count matches (1 / 2 / 4), cells separated by a gap, never overlapping.
result: pass
note: "Two issues found & fixed inline: (G-05-2a major) 2x2 cell overlap/volume clip — missing min-h-0; (G-05-2b cosmetic) per-cell TradingView logo — attributionLogo disabled. Passed on re-test."

### 3. Active Cell Focus Ring
expected: Clicking anywhere in a cell makes it the active cell, shown by a glowing accent focus ring. Exactly one cell is highlighted at a time.
result: pass

### 4. Independent Cells
expected: Each cell holds its own symbol, timeframe, and indicators. Changing one cell's symbol/timeframe/indicators does not affect the others. Hovering the crosshair in one cell updates only that cell's legend.
result: pass

### 5. Shrink Retains / Expand Duplicates
expected: Configure a 2x2 grid, shrink to 1x1, then expand back — the previously-configured cells return with their config intact. Expanding into a never-configured new cell shows a copy of the active cell's symbol/timeframe/indicators.
result: pass

### 6. Save & Restore Named Layout
expected: From the layout menu, "Save As New…" prompts for a name and saves the current workspace. It then appears in the menu; selecting it restores that exact workspace.
result: pass
note: "Initially froze on save (blocker G-05-6, Radix modal DropdownMenu+Dialog pointer-events lock) — fixed inline (modal={false}); passed on re-test."

### 7. Duplicate Layout Name Blocked
expected: "Save As New…" with a name that already exists shows inline error 'A layout named "{name}" already exists.' and blocks submit — no silent overwrite.
result: pass

### 8. Delete Layout (Confirmation)
expected: "Delete…" shows a confirmation dialog titled "Delete layout?" with a destructive confirm. Confirming removes only that layout; other saved layouts remain intact.
result: pass

### 9. Switch Auto-Saves Current State
expected: With unsaved changes to the working state, switching to a named layout first auto-saves the working state (no dialog), so nothing is lost. The named layout stays a clean snapshot.
result: pass
note: "Core guarantee holds (auto-save on switch, no dialog, named layout stays clean). UX observation: no in-session way to return to the 'current/unsaved' slot — it only auto-restores on app restart, and a second switch overwrites it. User accepted as pass; possible future 'Current (unsaved)' menu entry."

### 10. Empty Layout Menu State
expected: With no layouts saved, the menu shows a disabled "No saved layouts yet" row rather than an empty section.
result: pass

### 11. Add to Watchlist via Search Star
expected: Each search result row has a star control. Clicking it adds the symbol to the watchlist; the star becomes filled and disabled ("Already in watchlist"). Adding an existing symbol is a no-op (no duplicate row).
result: pass
note: "Issues fixed inline (G-05-11): missing React key restored, search results now dismiss on Esc/click-outside, and star made a toggle (add/remove) per owner request. Passed on re-test."

### 12. Click Watchlist Row Loads Symbol
expected: Clicking a watchlist row (not the drag handle or remove X) loads that symbol into the currently active cell only.
result: pass

### 13. Reorder Watchlist
expected: Dragging a row by its drag handle reorders the watchlist. Dragging works only via the handle and never triggers the click-to-load.
result: pass
note: "Fixed inline (G-05-13): drop handlers moved to row so drag works; also added drop-position indicator per user request. Passed on re-test."

### 14. Remove & Empty Watchlist
expected: Hovering a row reveals a remove X; removing works. When empty, the watchlist shows "Your watchlist is empty. Add symbols from search results."
result: pass

### 15. Sidebar Toggle
expected: A header button toggles the watchlist sidebar between expanded (240px) and collapsed (hidden). Long company names truncate with ellipsis, not wrapping or pushing the price off-row.
result: pass

### 16. Full Restore Across Restart
expected: Build a workspace (grid shape, per-cell symbols/indicators, watchlist entries, sidebar open/closed state), fully quit, and relaunch. Everything auto-restores verbatim — grid, cells, watchlist, and sidebar state.
result: pass

## Summary

total: 16
passed: 16
issues: 0
pending: 0
skipped: 0

## Notes

All 16 tests pass. 6 issues were found during UAT and all fixed inline (small,
root-cause changes) then re-verified — see resolved gaps below:
- G-05-1 (blocker): blank app on startup — IndicatorLegend selector infinite loop
- G-05-2a (major): 2x2 cell overlap/volume clip — missing min-h-0
- G-05-2b (cosmetic): per-cell TradingView logo — attributionLogo:false
- G-05-6 (blocker): freeze on Save As New — Radix modal DropdownMenu+Dialog lock
- G-05-11 (minor): search key warning + no dismiss; also star made a toggle (owner request)
- G-05-13 (major): watchlist drag not-allowed — drop handlers on grip; + drop indicator (owner request)

## Gaps

- gap_id: G-05-1
  truth: "On startup the workspace renders — header and a 1x1 AAPL chart are visible."
  status: resolved
  resolved_by: "inline fix during UAT — IndicatorLegend.tsx stable selectors"
  reason: "User reported: アプリを実行しても何も表示されない。ウィンドウは開いた。チャートもヘッダーも見えない。"
  severity: blocker
  test: 1
  root_cause: "IndicatorLegend.tsx selectors returned fresh references every render — `useAppStore((s) => s.cells.flatMap(...))` (new array) and `s.crosshairByCell[cellId] ?? {}` (new object). Under zustand v5 / useSyncExternalStore this trips the getSnapshot cache and causes an infinite render loop (Maximum update depth exceeded), which with no error boundary unmounts the whole React tree → fully blank window. Regression from the 05-01 grid refactor (was previously a stable `s.indicators` array)."
  artifacts:
    - path: "src/renderer/components/IndicatorLegend.tsx"
      issue: "Zustand selectors returning fresh array/object references each render"
  missing:
    - "Select stable s.cells and flatMap in render body"
    - "Use a module-level EMPTY_CROSSHAIR constant for the crosshair fallback"
  status_note: "Fixed inline during UAT (2-line change); pending user re-verify."

- gap_id: G-05-2a
  truth: "In a 2x2 grid every cell renders at equal size with its own full chart (including volume pane) visible; cells never overlap or clip each other."
  status: resolved
  resolved_by: "inline fix during UAT — GridHost min-h-0 on cell + chart wrapper"
  reason: "User reported: 2x2 で上側ブロックの出来高が下ブロックに隠れる。上ブロックが1x2縦長になり下ブロックが上に重なって見える (cell sizing/overlap bug in 2x2)."
  severity: major
  test: 2
  root_cause: "GridCell root (a CSS grid item) and the chart wrapper (flex-1) lacked min-h-0. Grid/flex children default to min-height:auto and refuse to shrink below content; the chart's autoSize measured full height, ballooning the 2x2 top row past 1fr → top cell double-height, bottom cell clipped/overlapped, volume pane hidden."
  artifacts:
    - path: "src/renderer/components/GridHost.tsx"
      issue: "Missing min-h-0 on grid item + flex-1 chart wrapper"
  missing:
    - "Add min-h-0 (and min-w-0) to GridCell root and min-h-0 to the chart wrapper"
  status_note: "Fixed inline during UAT; pending user re-verify."

- gap_id: G-05-6
  truth: "Saving a new named layout (Save As New → enter name → Save) completes and leaves the app fully interactive."
  status: resolved
  resolved_by: "inline fix during UAT — LayoutMenu DropdownMenu modal={false}"
  reason: "User reported: save as new でレイアウト名を登録したらアプリがフリーズ (whole window unclickable). Console: no JS error, Radix aria-hidden/focus warning on dropdown popper."
  severity: blocker
  test: 6
  root_cause: "LayoutMenu opened its name Dialog from a DropdownMenuItem while the DropdownMenu was modal. A modal Radix DropdownMenu sets body pointer-events:none + a focus scope; the Dialog opening races the menu teardown so the body lock is never cleaned up, leaving the entire window unclickable."
  artifacts:
    - path: "src/renderer/components/LayoutMenu.tsx"
      issue: "Modal DropdownMenu + Dialog-from-item leaves body pointer-events locked"
  missing:
    - "Set modal={false} on the LayoutMenu DropdownMenu"
  status_note: "Fixed inline during UAT; pending user re-verify."

- gap_id: G-05-11
  truth: "Searching shows no React console errors, and the results list can be dismissed without having to clear the input and press Enter."
  status: resolved
  resolved_by: "inline fix during UAT — SearchResults key restored + SearchBar Escape/click-outside dismiss"
  reason: "User reported: React key warning at SearchResults.tsx:39; search results won't close unless input cleared + Enter."
  severity: minor
  test: 11
  root_cause: "1) The 05-04 star rewrite of SearchResults dropped the <li> key (was key=`${symbol}-${exchange}`). 2) SearchBar only closed results on select or clear+Enter (pre-existing, not a phase-5 regression) — no click-outside/Escape dismiss."
  artifacts:
    - path: "src/renderer/components/SearchResults.tsx"
      issue: "Missing key prop on list items (regression)"
    - path: "src/renderer/components/SearchBar.tsx"
      issue: "No click-outside/Escape dismiss for results dropdown (pre-existing UX gap)"
  missing:
    - "Restore key={`${r.symbol}-${r.exchange}`} on the <li>"
    - "Add Escape + click-outside dismiss in SearchBar"
    - "Per user request, made the search-result star a toggle (add/remove) instead of add-only+disabled — deviates from D-65 by owner's choice"
  status_note: "Fixed inline during UAT; pending user re-verify."

- gap_id: G-05-13
  truth: "Dragging a watchlist row by its grip handle reorders the list (no not-allowed cursor)."
  status: resolved
  resolved_by: "inline fix during UAT — move onDragOver/onDrop to the row <li>"
  reason: "User reported: drag できない、禁止マークが出る (not-allowed cursor, no reorder)."
  severity: major
  test: 13
  root_cause: "onDragOver/onDrop were only on the tiny grip <span> (invisible except on hover), so dragging over a row's body hit no preventDefault → browser showed not-allowed and never fired drop. Only the drag *initiation* belongs on the handle; the whole row must be the drop target."
  artifacts:
    - path: "src/renderer/components/Watchlist.tsx"
      issue: "Drop handlers on grip handle instead of the row"
  missing:
    - "Move onDragOver(preventDefault)+onDrop to the <li>; keep draggable+onDragStart on the grip"
    - "Per user request, added a drop-position indicator (accent top-border on the hovered row) during drag"
  status_note: "Fixed inline during UAT; pending user re-verify."

- gap_id: G-05-2b
  truth: "The lightweight-charts / TradingView attribution mark does not clutter every cell; it is placed once in a sensible location rather than repeated on each chart."
  status: resolved
  resolved_by: "inline fix during UAT — Chart.tsx attributionLogo:false"
  reason: "User reported: TradingView のリンクアイコンがチャート上にありブロックごとに出る。別の場所にした方がよい (per-cell attribution placement)."
  severity: cosmetic
  test: 2
  root_cause: "lightweight-charts v5 renders an on-canvas attributionLogo (default true) per chart instance → repeated in every grid cell."
  artifacts:
    - path: "src/renderer/components/Chart.tsx"
      issue: "attributionLogo not disabled"
  missing:
    - "Set layout.attributionLogo: false"
  status_note: "Fixed inline during UAT; pending user re-verify."
