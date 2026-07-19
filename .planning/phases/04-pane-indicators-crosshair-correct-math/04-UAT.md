---
status: complete
phase: 04-pane-indicators-crosshair-correct-math
source: [04-01-PLAN.md, 04-02-PLAN.md, 04-03-PLAN.md, 04-04-PLAN.md]
mvp_mode: true
note: No *-SUMMARY.md files exist; tests derived from plan must_haves.truths + git history. STATE.md stale (says phase 1).
started: 2026-07-19T22:32:41Z
updated: 2026-07-20T07:50:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Launch app fresh, load a symbol. Price candlestick chart renders and a Volume sub-pane appears below it automatically. No crash, no blank screen.
result: pass
note: First attempt failed (blank app) → root-caused as G-04-1, fix committed b84dd74. Re-test passed.

### 2. Volume Fixed Sub-Pane
expected: Volume is always present below the price pane once bars load — never zero-state, cannot be removed, and does NOT appear in the "+指標" menu. Bars are green (close≥open) / red (close<open) matching the candles. Its legend shows only label + thousands-separated value (e.g. 12,450,200), with no eye/gear/× icons.
result: pass

### 3. Add RSI Sub-Pane
expected: Add RSI from the "+指標" menu. It renders in its own sub-pane on a fixed 0-100 scale with translucent 70/30 zone fill and 70/30 guide lines. Editing overbought/oversold in the edit form moves the guide lines and zone fill live, with no data re-fetch.
result: pass
note: First attempt — axis showed 0-120 (default price-scale margins ballooned the fixed 0-100 range). Fixed G-04-3 (8ecd5f2). Re-test passed.

### 4. Add MACD Sub-Pane
expected: Add MACD from the "+指標" menu (defaults 12/26/9). Its pane shows a MACD line, a signal line in a distinguishable second hue, and a histogram with a zero guide line. Histogram uses 4 colors (dark/light green when positive, dark/light red when negative, by rising/falling vs previous bar). Crosshair readout reads "MACD {v} Signal {v} Hist {v}" at 2 decimals.
result: pass

### 5. Synchronized Crosshair
expected: A single vertical crosshair line spans the price pane and every sub-pane at the same x. Each pane's legend updates to that same timestamp's values (never independently lagged). When the cursor is off the chart, every legend shows the latest (rightmost) bar's values, not blanks. The price-pane readout shows OHLC four values only — no percent-change.
result: pass

### 6. Zero / One / Many Panes + Resize + Removal
expected: With zero RSI/MACD instances there is no pane for them. Add multiple — each stacks downward with no upper limit, panes shrink to fit rather than clip, and each pane is drag-resizable. Remove an indicator's last instance and that pane disappears immediately with panes below shifting up — no empty placeholder track.
result: pass

### 7. Per-Pane Legend Affordances
expected: Each addable sub-pane (RSI, MACD) carries the same top-left legend controls as the price pane — show/hide, edit, and remove icons — and the crosshair value is injected into that pane's own legend. (Volume is the exception: label + value only.)
result: pass

### 8. IND-09 TradingView Parity Gate
expected: The golden-fixture correctness test (tests/indicators/math.golden.test.ts) exists and covers all five indicators (SMA/EMA/BB/RSI/MACD) with Math.abs(actual − expected) < 0.01. NOTE: it currently ships in empty-pass state (expected values are placeholder nulls, 8 checkpoints todo). Full TradingView-parity enforcement requires you to fill real TradingView AAPL-daily values into fixtures/golden.ts.
result: pass
note: Harness accepted as the deliverable (D-48/D-49 empty-pass by design). OUTSTANDING (deferred, user-input): fill real TradingView AAPL-daily values into tests/indicators/fixtures/golden.ts to enable the 8 todo parity checkpoints — TradingView parity is NOT yet mechanically enforced until then.

## Summary

total: 8
passed: 8
issues: 0
pending: 0
skipped: 0
gaps_resolved: 2

## Deferred Follow-Ups

- test: 8
  idea: "Fill real TradingView AAPL-daily OHLC + expected values into tests/indicators/fixtures/golden.ts to enable the 8 todo IND-09 parity checkpoints. Until then, TradingView-parity is structurally scaffolded but not mechanically enforced."
  deferred_at: 2026-07-20

## Gaps

- gap_id: G-04-3
  truth: "RSI renders on a fixed 0-100 scale."
  status: resolved
  reason: "User reported RSI axis showed 0-120 instead of 0-100."
  severity: minor
  test: 3
  root_cause: "autoscaleInfoProvider locks priceRange 0-100 but default scaleMargins (0.2/0.1) expand the axis to ~-10..120."
  fix: "Apply scaleMargins {top:0.05, bottom:0.05} to fixed-scale line series in Chart.tsx reconcile."
  resolved_by: 8ecd5f2
  resolved_at: 2026-07-20
  artifacts: [src/renderer/components/Chart.tsx]
  missing: []

- gap_id: G-04-1
  truth: "App boots and renders price candlestick chart + Volume sub-pane for a symbol with bars."
  status: failed
  reason: "User reported: ウィンドウが開いたが、チャートなど何も表示されない (window opens, nothing renders)."
  severity: blocker
  test: 1
  diagnosis_ruled_out:
    - "npm run build succeeds (renderer bundle compiles, 1945 modules)."
    - "typecheck passes clean."
    - "main process starts without better-sqlite3/native ABI error (only benign GPU disk-cache noise from a 2nd-instance collision)."
    - "preload api shape (symbols/ohlcv/apikey/settings/capabilities) matches every renderer call site."
    - "store Volume seed + IndicatorLegend use undefined-safe registry lookups (skip/return null, no throw)."
  root_cause: |
    Chart.tsx:407 s.getPane() throws "Value is null" on a stale series handle.
    The create-once chart effect cleanup (Chart.tsx:200-207) calls chart.remove() and nulls
    chartRef/seriesRef but does NOT clear indicatorSeriesRef/bandPrimitiveRef/guideLineRef. Under
    React StrictMode's dev mount→unmount→remount, the reconcile effect's `if (!map.has(id))` guard
    then sees the stale seeded-Volume entry and skips re-adding the series to the NEW chart. The
    legend effect calls getPane() on the detached handle → throw → <Chart> crashes → blank app
    (no error boundary). Dev-only (StrictMode); packaged build masks it.
  fix: |
    In the create-once effect cleanup, after chart.remove(), also clear the three indicator refs:
    indicatorSeriesRef.current.clear(); bandPrimitiveRef.current.clear(); guideLineRef.current.clear();
    so a remount reconciles all series against the fresh chart.
  artifacts: [src/renderer/components/Chart.tsx]
  missing: []
