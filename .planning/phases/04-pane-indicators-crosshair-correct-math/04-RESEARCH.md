# Phase 4: Pane Indicators, Crosshair & Correct Math - Research

**Researched:** 2026-07-19
**Domain:** lightweight-charts v5.2.0 multi-pane API mechanics (this phase's UX/design is already locked — see CONTEXT.md/DESIGN.md/UI-SPEC.md)
**Confidence:** HIGH (all core API claims verified against the installed `node_modules/lightweight-charts@5.2.0` type declarations and compiled source; RSI/MACD formula conventions cross-checked against StockCharts/macroption)

> **Scope note:** This research does NOT revisit the module contract, UX, colors, scale rules, or correctness-gate approach — those are GIVEN (CONTEXT.md D-32→D-50, DESIGN.md DD-1/2/3 + §1-6, UI-SPEC.md). This document answers only "what is the exact v5.2 API shape needed to build what's already been decided," and flags landmines where the locked design's assumptions don't hold up against the actual library behavior.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D-32 → D-50 — research targets these, not alternatives)

**Sub-pane structure/layout:**
- D-32: Sub-pane heights are drag-resizable (lightweight-charts native pane resize handles). Height persistence is Phase 5 — this phase is memory-only.
- D-33: One indicator instance = one pane. Adding a second instance of the same type (e.g., RSI 14 and RSI 7) creates a new pane below.
- D-34: Volume is an always-on fixed sub-pane (not a user-managed "+Indicator" instance).

**Add/remove UX:**
- D-35: RSI/MACD are added via the existing "+Indicator" menu (AddIndicatorMenu) — overlay vs. sub-pane is decided by the module's output kind, not a separate menu.
- D-36: Removing a sub-pane indicator's last instance removes that pane entirely; panes below shift up. No empty placeholder track.
- D-37: Every sub-pane gets the same legend affordances as the price-pane legend (eye/gear/×, D-23/24 extended per-pane).

**Crosshair UX:**
- D-38: Cursor values are injected into each pane's own top-left legend (TradingView-style), not a separate data window.
- D-39: Price pane cursor readout = OHLC four values only (no % change this phase).
- D-40: Non-hover state shows the latest (rightmost) bar's values in every pane's legend.

**Visual defaults:**
- D-41: RSI 70/30 = guide lines + translucent zone fill between them (reuse `BandPrimitive`). RSI pane is fixed 0-100 scale (D-45), so guide-line position is always constant.
- D-42: MACD histogram uses 4 colors (dark/light green for positive rising/falling, dark/light red for negative falling/rising).
- D-43: Volume bars colored by candle direction (close≥open → `#22C55E`, else `#EF4444`).
- D-44: Defaults are fixed per requirements: RSI = 14/70/30, MACD = 12/26/9. Both live-editable post-add (IND-08, D-25 schema-driven form).
- D-45: RSI pane = fixed 0-100 vertical scale.
- D-46: MACD pane shows a zero line; MACD itself auto-scales.
- D-47: Sub-pane line colors use the same D-30 palette auto-assignment as overlays.

**Correctness gate:**
- D-48: TradingView-sourced golden values, hand-picked by the user from a real TV chart, hardcoded as test expectations.
- D-49: Fixed reference symbol/range chosen by user; AAPL daily is the working default until specified. Planner builds a fixture-with-placeholder test harness first; gate goes from "empty pass" to "enforcing" once the user fills in real TV values. Gate covers all 5 indicators (SMA/EMA/BB/RSI/MACD).
- D-50: RSI = Wilder smoothing (SMA-seeded), MACD signal = EMA of MACD line, BB = population stddev, correct EMA seeding. Hand-written TS per CLAUDE.md, cross-checked against `trading-signals`@7.4.3 (not `technicalindicators`).

### Claude's Discretion (this research + the planner may decide freely, within the above)
- Concrete shape of the module-contract extension (how `OutputMeta` gains pane/histogram output kinds; how pane assignment plugs into Chart's reconcile effect). **DESIGN.md §1-2 already pins this — see below, this is no longer open.**
- Concrete lightweight-charts v5.2 multi-pane API usage (`addSeries(..., paneIndex)` / `moveToPane()`, pane creation/teardown/resize-handle behavior, `HistogramSeries` usage). **This is what this research answers.**
- Crosshair implementation details (`subscribeCrosshairMove` value extraction, per-pane legend delivery, magnet mode, time/price label display). Only D-38/39/40's user-visible behavior is fixed.
- MACD 4-color histogram / volume up-down coloring implementation mechanism (per-bar `HistogramSeries` color vs. multiple series).
- RSI guide-line+band implementation (BandPrimitive reuse vs. horizontal-line primitive).
- Whether to add % change to the price-pane readout (D-39 footnote) or debounce live recompute (mirrors P3 D-26).
- Where volume's always-on pane state lives (special-cased "fixed" flag vs. separate store slice).
- Golden-test tolerance philosophy and fixture format (JSON vs. TS constants).

### Deferred Ideas (OUT OF SCOPE for this phase)
- Sub-pane height persistence to disk, indicator-set serialization, independent per-cell indicators in a multi-chart grid → **Phase 5** (LAYOUT-01/02/03/04).
- Cross-chart crosshair sync → **Out of scope v1 / v1.x**. This phase is single-chart, all-panes-within-it sync only.
- Volume MA overlay, indicator presets/templates → **v2** (IND2-01/02).
- User-authored indicator scripts (Pine Script equivalent) → Out of scope entirely.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| IND-04 | Volume in a dedicated pane | Q3 (HistogramSeries per-bar color, base line), Q1/Q2 (fixed paneIndex 1, pane geometry for its legend) |
| IND-05 | RSI in a dedicated pane, configurable overbought/oversold (default 14/70/30) | Q5 (fixed 0-100 scale via `autoscaleInfoProvider`, guide lines via `createPriceLine`, zone fill via `BandPrimitive` reuse), Q7 (Wilder RSI formula + leading-gap arithmetic) — **see Landmine #1: guides/band must be param-driven, not static, to satisfy the "configurable" half of this requirement** |
| IND-06 | MACD in a dedicated pane (line/signal/histogram, default 12/26/9) | Q3 (Histogram + Line series co-existing in one pane), Q5 (zero line via `createPriceLine`), Q7 (MACD = EMA signal, not SMA; gap-alignment mechanics for reusing `ema()`) |
| IND-09 | Indicator values match TradingView conventions (RSI Wilder, MACD EMA signal, BB population stddev, correct EMA seed) | Q7 (formula confirmation + citations), Validation Architecture section (correctness-gate sizing implications) |
| CHART-04 | Crosshair reads price + all indicator sub-panes in sync at one timestamp | Q4 (`subscribeCrosshairMove` param shape, per-series-type value extraction, magnet mode), Q2 (per-pane legend positioning so each pane's readout appears in the right place) |
</phase_requirements>

## Summary

Every mechanic DESIGN.md §1-6 assumes is available in lightweight-charts v5.2.0 **is confirmed present** by reading the installed package's type declarations (`node_modules/lightweight-charts/dist/typings.d.ts`) and, where the public docs were ambiguous, the compiled source (`lightweight-charts.development.mjs`). Three findings materially sharpen or correct DESIGN.md's own sketch:

1. **Pane auto-collapse (D-36) is 100% native and unconditional.** Reading the model's `_internal_removeSeries` implementation confirms it always calls a `_cleanupIfPaneIsEmpty` check after removing a series' data source — no `chart.removePane()` call is ever needed by app code. DESIGN §2's "lightweight-charts が自動除去" assumption is exactly right; the only app-side work is re-deriving the paneIndex bookkeeping after the auto-splice (indices shift down).

2. **Per-pane HTML legend positioning (the flagged high-risk item) has a cleaner, more robust recipe than DESIGN §4's own draft.** `IPaneApi.getHTMLElement()` is a real, documented, public method — but it returns the pane's `<tr>` row element (verified in source), which cannot safely be used as a DOM-append target (table-layout semantics) and isn't a stable contract to reach further into. The correct recipe is to read that element's `getBoundingClientRect()` (a standard browser API) to compute each pane's on-screen offset relative to the chart's own wrapper div, and attach a `ResizeObserver` (also standard, not lightweight-charts-specific) to that same element to react to drag-resize — because **no dedicated "pane resized" event exists** in the public API, and the one resize event that does exist (`chart.timeScale().subscribeSizeChange`) is scoped to the time axis's own width/height and does NOT fire on a pure inter-pane stretch-factor drag (confirmed by tracing the separator's drag handler in source — it never touches the Delegate backing that event).

3. **A real gap exists between D-44 (RSI thresholds are live-editable) and DESIGN.md §1's `guides`/`band` being declared as static per-module fields.** As drafted, editing RSI's overbought/oversold params would silently desync the drawn guide lines/zone fill from the new threshold values. See Landmine #1 — this needs a one-line type fix (function-of-params, mirroring the already-established `label: (p) => string` pattern), not a redesign.

4. **`autoscaleInfoProvider` returning a fixed `{minValue:0, maxValue:100}` is the officially-documented pattern for RSI's fixed scale** — the exact code sample appears verbatim in the shipped `.d.ts` doc comments as "Use price range from 0 to 100 regardless the current visible range." No need to combine it with `priceScale().applyOptions({autoScale:false})`.

5. **Recommendation: do not add `trading-signals` as a devDependency.** DD-1 already makes the golden-fixture harness self-contained and TV-sourced — matching a third-party library doesn't get you closer to TV-parity than matching TV's own numbers does, and Phase 3 already declined to add it for the same MA/BB cross-check use case (confirmed: absent from `package.json`/`node_modules`). See the dedicated section below.

## Architectural Responsibility Map

This is an Electron desktop app — the "tiers" below map to Electron's process model, not a web app's SSR/API/CDN split.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Sub-pane rendering (Volume/RSI/MACD canvases) | Renderer process (Browser-equivalent) | — | lightweight-charts mounts entirely in the renderer's DOM via `useEffect`, unchanged from Phase 1-3's pattern. No main-process/IPC involvement. |
| Per-pane HTML legend overlay | Renderer process (React component tree) | — | Plain DOM/CSS positioned over the chart's canvas, same as the existing single price-pane legend. |
| Crosshair sync across panes | Renderer process | — | Single `subscribeCrosshairMove` handler in the create-once chart effect; pure client-side event, no data fetch. |
| Indicator math (RSI/MACD formulas) | Renderer process | Test tooling (Vitest, Node) | Pure functions in `src/renderer/indicators/math.ts`, computed client-side from `barsRef.current` (D-26 precedent) — zero network/IPC. The identical module is imported directly into Vitest tests (Node), since `math.ts` has zero imports (confirmed by reading the file's own header comment). |
| Correctness gate (golden-fixture tests) | Test tooling (Vitest) | — | Not a runtime tier — build/verification step only. Runs in Node via `vitest run`, no Electron process involved. |
| Main process (file cache, FMP fetch, API key) | Not touched this phase | — | Confirmed by CONTEXT.md's own domain boundary: indicator math and rendering are 100% renderer-side; this phase adds zero new IPC surface. |

## Q1 — Multi-pane series API (D-33, DESIGN §2)

**Exact v5.2 signature** (verified: `typings.d.ts` L1640, `IChartApiBase.addSeries`):
```ts
addSeries<T extends SeriesType>(
  definition: SeriesDefinition<T>,
  options?: SeriesPartialOptionsMap[T],
  paneIndex?: number
): ISeriesApi<T, HorzScaleItem>
```
Called exactly like the app's existing overlay code (`Chart.tsx:202`, `chartRef.current.addSeries(LineSeries, {...})`) with one added third argument.

**Does an out-of-range `paneIndex` auto-create the pane?** Yes — verified two ways:
1. `ISeriesApi.moveToPane`'s own doc text (L2601-2602, `typings.d.ts`): *"Move the series to another pane. If the pane with the specified index does not exist, the pane will be created."*
2. Source: the chart model's `_private__getOrCreatePane(index)` (`lightweight-charts.development.mjs:7300`) does `index = Math.min(panes.length, index); return index < panes.length ? panes[index] : this._addPane(index)` — i.e. it clamps and creates. `addSeries(..., paneIndex)` routes through this same helper.

**Practical implication for the reconcile effect:** don't hand-roll a `nextPaneIndex` counter. At the moment you create a NEW sub-pane instance's series, read `chartRef.current.panes().length` and pass that as `paneIndex` — it always reflects the current live pane count (already corrected for any prior auto-collapse from D-36 removals), so it's guaranteed to append a fresh pane at the bottom with zero extra bookkeeping.

**`series.moveToPane(index)`** (L2606): moves an existing series to a (possibly new) pane; not needed for this phase's add/remove flow, but available if a future "reorder panes" feature is wanted (there's also `chart.swapPanes(first, second)`, L1792, and `pane.moveTo(paneIndex)`, L2031, for pane-level reordering).

**`chart.panes(): IPaneApi[]`** (L1779) — the live array of pane handles; `pane.paneIndex()` (L2037), `pane.getSeries()` (L2043).

**Removing a pane / D-36 auto-collapse — CONFIRMED NATIVE, no `removePane()` call needed:**
Verified in source (`lightweight-charts.development.mjs:7160-7172`):
```js
_internal_removeSeries(series) {
    const pane = this._internal_paneForSource(series);
    ...
    this._private__serieses.splice(seriesIndex, 1);
    paneImpl._internal_removeDataSource(series);
    ...
    this._private__cleanupIfPaneIsEmpty(paneImpl);   // <-- always called
}
_private__cleanupIfPaneIsEmpty(pane) {
    if (!pane._internal_preserveEmptyPane() &&
        (pane._internal_dataSources().length === 0 && this._private__panes.length > 1)) {
        this._private__panes.splice(this._internal_getPaneIndex(pane), 1);  // pane disappears, array reindexes
        this._internal_fullUpdate();
        return true;
    }
    return false;
}
```
So: `chart.removeSeries(series)` for the last series in a pane **automatically** removes that pane and every lower pane's index shifts down by one (array `splice`, not a sparse hole) — matching D-36's "パインが消えて下が詰まる" exactly, for free. `preserveEmptyPane` (settable via `chart.addPane(true)` or `pane.setPreserveEmptyPane(true)`) is the opt-out if a future feature ever wants to keep an empty pane visible — irrelevant to this phase, default (`false`) is correct.

`chart.removePane(index)` (L1785) and the equivalent model method (`_internal_removePane`, `mjs:6890`) exist for **explicit** pane removal (e.g., if you wanted to remove a pane while its series still exist) — not needed for this phase's flow since removing the series already triggers cleanup, but note it refuses to remove the last remaining pane (`if (panes.length === 1) return;`, `mjs:6891`).

**Code sketch** (extends the existing removal loop at `Chart.tsx:176-186`):
```ts
// After removing all series for a departed instance (existing loop, unchanged):
for (const s of series) chartRef.current.removeSeries(s)
// No further action needed — the pane auto-collapses on the last removeSeries call above.
// Only re-derive OWN bookkeeping (e.g., a `fixed volume = pane 1` invariant check) after this loop,
// since paneIndex numbering for surviving panes has shifted. Prefer querying
// `series.getPane().paneIndex()` live (ISeriesApi.getPane(), L2629) over maintaining
// a stale Map<instanceId, paneIndex> — the pane index is a derived, not stored, fact.
```

**Confidence:** HIGH — every claim verified directly against installed source, not the public docs alone.

## Q2 — Pane geometry for per-pane HTML legend overlay (THE FLAGGED HIGH-RISK ITEM)

**No dedicated "pane resized" event exists in the public API.** Confirmed by reading the full `IPaneApi` interface (`typings.d.ts` L2013-2131) — it has no `subscribe*`/`on*` method at all. The only resize-shaped event in the whole chart API is `chart.timeScale().subscribeSizeChange(handler: (width, height) => void)` (`ITimeScaleApi`, L3023-3033) — but this fires for the **time axis's own size**, which does not change when a user drags a pane separator (verified in source: the separator's drag handler, `PaneSeparator` class around `mjs:8567-8710`, mutates `stretchFactor` on the two adjacent panes and triggers a pane-height recalculation — it never touches the `_private__sizeChanged` Delegate that backs `subscribeSizeChange`, which is wired only to the time-axis widget's own `_setSizes` call, `mjs:10348-10357`). **A `ResizeObserver` on the chart's outer container would also miss this** — the container's own box doesn't change size when panes redistribute height internally.

**`chart.paneSize(paneIndex?): PaneSize`** (`typings.d.ts` L1830, `{height, width}` only, L3510-3514) gives a pane's own dimensions but **not its top offset** — DESIGN §4's own sketch ("cumulative height sum") is workable but requires manually accounting for the 1px inter-pane separator (`SeparatorConstants.SeparatorHeight = 1`, confirmed in source) for every pane boundary, and still needs *some* resize signal to know when to recompute (see above — there isn't a clean one).

**The recommended recipe — `IPaneApi.getHTMLElement()` + `getBoundingClientRect()` + `ResizeObserver`:**

`IPaneApi.getHTMLElement()` (`typings.d.ts` L2044-2049) is real, public, and documented: *"Retrieves the HTML element of the pane... or null if pane wasn't created yet."* Verified in source (`mjs:12516-12522` and `mjs:9614`) it returns `this._private__rowElement` — a `<tr>` (table row) containing `[leftAxisCell, paneCell, rightAxisCell]` `<td>`s, where the middle `paneCell` (the actual canvas area) has `position: relative` and explicit `style.width`/`style.height` in px that lightweight-charts keeps in sync on every resize (`mjs:9533-9540`, `9799-9800`).

**Landmine within this landmine:** do NOT `appendChild` your legend div directly into the node `getHTMLElement()` returns. It's a `<tr>` — table layout rules mean a raw non-`<td>` child appended via `appendChild` (not HTML-parsed) risks anonymous-box side effects and is not how the library expects to be extended; and reaching further into its children (`.children[1]` to grab the real `paneCell`) relies on undocumented, `_private_`-prefixed internal structure that could change across minor versions.

**The safe, standards-based approach:** treat `getHTMLElement()` purely as a **measurement reference**, not a mount point:
```ts
// One ResizeObserver per pane, created/torn down alongside the pane's series in the reconcile effect.
const paneEl = pane.getHTMLElement()          // public API — <tr>, may be null if pane not yet created
if (!paneEl) return
const wrapperEl = containerRef.current!.parentElement! // the existing `<div className="relative h-full w-full">`
const reposition = () => {
  const paneRect = paneEl.getBoundingClientRect()   // standard DOM API — works on any element, table or not
  const wrapperRect = wrapperEl.getBoundingClientRect()
  legendDiv.style.top = `${paneRect.top - wrapperRect.top + 8}px`   // +8px = existing `top-2` legend convention
  legendDiv.style.left = '8px'
}
const ro = new ResizeObserver(reposition)   // standard Web API — fires on ANY box-size change, drag or otherwise
ro.observe(paneEl)
reposition()   // initial position
// on cleanup: ro.disconnect()
```
This sidesteps the "is it a `<tr>` or `<td>`" question entirely, because `getBoundingClientRect()` gives accurate on-screen geometry for any element regardless of its table role, and mounting the legend as a **sibling** overlay inside the chart's own pre-existing relatively-positioned wrapper (the same wrapper `IndicatorLegend` already uses today, `Chart.tsx:252`) is exactly the technique already proven to work for the current single price-pane legend — this just runs it once per pane instead of once per chart.

Since this app currently has **no left price scale enabled** (Chart.tsx only sets `rightPriceScale`, leaving `leftPriceScale.visible` at its default `false`), the row's left edge and the canvas area's left edge coincide closely enough for `left: 8px` positioning to match the existing convention without extra correction.

**Recomputation triggers needed:** (1) `ResizeObserver` per pane (drag-resize, chart container resize, pane add/remove all change a pane's rendered box), (2) re-run `reposition()`/re-attach observers whenever the reconcile effect adds or removes a pane (since indices shift on D-36 auto-collapse, tear down old observers and re-observe current `chart.panes()` each time pane composition changes).

**Confidence:** HIGH for the "no dedicated event exists" and "`getHTMLElement()` returns a `<tr>`" findings (both verified directly in compiled source). HIGH for the `ResizeObserver`+`getBoundingClientRect()` recipe (both are standard, well-established browser APIs; the only lightweight-charts-specific fact relied on is the public, documented `getHTMLElement()` call itself).

## Q3 — HistogramSeries (Volume D-43, MACD hist D-42)

**Per-bar color confirmed in v5.2** — `HistogramData<T> extends SingleValueData<T>` (`typings.d.ts` L1322-1327):
```ts
export interface HistogramData<HorzScaleItem = Time> extends SingleValueData<HorzScaleItem> {
  color?: string  // Optional color value for certain data item. If missed, color from options is used
}
```
This matches DESIGN §1's `HistPoint = { time, value, color? }` exactly — no gap between the design and the actual API.

**Base/zero-line option** — `HistogramStyleOptions` (`typings.d.ts` L1331-1344):
```ts
export interface HistogramStyleOptions {
  color: string   // default '#26a69a' — fallback for points without an explicit color
  base: number    // default 0 — "Initial level of histogram columns"
}
```
`base` defaults to `0`, which is already correct for both Volume (bars grow up from 0) and MACD histogram (positive above 0, negative below 0) — **no override needed**, just don't set anything unusual here.

**One HistogramSeries per sub-pane:** confirmed straightforward — `chart.addSeries(HistogramSeries, { base: 0 }, paneIndex)`. `HistogramSeries` is exported the same way `LineSeries`/`CandlestickSeries` already are (verified: `mjs:5032-5038`, `export { histogramSeries as HistogramSeries, lineSeries as LineSeries, candlestickSeries as CandlestickSeries, ... }`) — importable identically to the two already used in `Chart.tsx:3-11`.

**Mixing histogram + line series in one pane (MACD line + signal + histogram):** no structural gotcha — both series types share the pane's one price scale by default, which is exactly the intended visual (bars and lines on one common vertical axis). One real ordering gotcha: **rendering/z-order follows add order** (later-added series draws on top — confirmed indirectly via `ISeriesApi.setSeriesOrder()`'s doc, L2613-2623: *"Sets the zero-based index of this series within the pane's series collection, thereby adjusting its rendering order"* — MEDIUM confidence on the specific stacking direction since the doc doesn't spell out "higher index = on top" explicitly, but this matches standard canvas/charting-library painter's-algorithm convention). **Recommendation:** add the histogram series to the pane FIRST, then the MACD line and signal line — so the lines are never visually hidden under the bars. If precise control is ever needed, `series.setSeriesOrder(n)` / `series.seriesOrder()` (L2612-2623) are available.

**Confidence:** HIGH for data/style option shapes (verified in `.d.ts`). MEDIUM for the specific add-order-determines-z-order claim (inferred from doc wording + general charting-library convention, not an explicit "series added later renders on top" statement).

## Q4 — Crosshair sync (CHART-04, DESIGN §4)

**`subscribeCrosshairMove` shape** (`typings.d.ts` L1707-1733, `MouseEventParams` L3392-3440):
```ts
subscribeCrosshairMove(handler: (param: MouseEventParams<Time>) => void): void

interface MouseEventParams<HorzScaleItem = Time> {
  time?: HorzScaleItem            // undefined when cursor is off-chart (confirms D-40's trigger condition)
  logical?: Logical
  point?: Point                   // undefined on mouse-leave
  paneIndex?: number               // which pane the hover resolved in
  seriesData: Map<ISeriesApi<SeriesType, HorzScaleItem>,
                  BarData | LineData | HistogramData | CustomData>
  hoveredInfo?: HoveredInfo<HorzScaleItem>
  sourceEvent?: TouchMouseEventData
}
```

**`param.time` is confirmed undefined when the cursor leaves the chart** — directly stated in the doc comment (L3396: *"The value will be `undefined` if the location of the event in the chart is outside the range of available data"*) and the built-in example checks exactly this (`if (!param.point) return`, `point` and `time` become undefined together on mouse-leave). This is the correct, direct trigger for D-40's "非ホバー → 最新バー値" fallback: `if (param.time === undefined) { /* use latest bar's already-computed values */ }`.

**`param.seriesData.get(series)` shape per series type** — verified via `SeriesDataItemTypeMap` (`typings.d.ts` L3891-3913+):
| Series kind | Type returned | Shape |
|---|---|---|
| `Candlestick` | `CandlestickData \| WhitespaceData` | `{time, open, high, low, close, color?, borderColor?, wickColor?}` (extends `OhlcData`, L837/L3444) |
| `Line` | `LineData \| WhitespaceData` | `{time, value, color?}` (extends `SingleValueData`, L3245/L4309) |
| `Histogram` | `HistogramData \| WhitespaceData` | `{time, value, color?}` (same `SingleValueData` base) |

`WhitespaceData` can appear in the union (a gap/placeholder point) — guard with a type check (e.g., `'close' in data` for candlesticks, `'value' in data` for line/histogram) before reading fields, since a bar can be whitespace at a given timestamp for some series.

**Code sketch** (extends `Chart.tsx`'s create-once effect, alongside the existing `subscribeVisibleLogicalRangeChange` at line 134):
```ts
const onCrosshairMove = (param: MouseEventParams<Time>): void => {
  // rAF-throttled per DESIGN §4 — mousemove fires far more often than useful here
  if (rafRef.current) return
  rafRef.current = requestAnimationFrame(() => {
    rafRef.current = null
    if (param.time === undefined) {
      // D-40: fall back to the already-computed latest-bar values (computed once per data change)
      useAppStore.getState().setCrosshair(latestBarValuesRef.current)
      return
    }
    const values: Record<string, unknown> = {}
    for (const [series, data] of param.seriesData) {
      // map `series` back to instanceId via indicatorSeriesRef reverse lookup, extract .value/.close etc.
    }
    useAppStore.getState().setCrosshair(values)
  })
}
chart.subscribeCrosshairMove(onCrosshairMove)
```

**Magnet mode** — `CrosshairMode` enum (`typings.d.ts` L35-52): `Normal=0`, `Magnet=1`, `Hidden=2`, `MagnetOHLC=3` ("sticks crosshair's horizontal line to open/high/low/close of OHLC-based series", new in this API surface vs. older `Magnet`'s "close only" behavior). **`Magnet` is already the chart-wide default** (`crosshair.mode` doc, `@defaultValue {@link CrosshairMode.Magnet}` — confirmed at `typings.d.ts` ~L1084-1086) — so no explicit option is needed unless the plan wants `MagnetOHLC` (snaps to any of O/H/L/C, arguably a better fit for a candlestick price pane) or `Normal` (free movement). Given D-39 reads all four OHLC values simultaneously regardless of where the horizontal line snaps, the default `Magnet` is functionally sufficient — this is a cosmetic choice, not a correctness one.

**Confidence:** HIGH — all shapes verified directly against installed `.d.ts`.

## Q5 — Fixed scale + guide lines + zone band (RSI D-41/45, MACD D-46)

**Fixed 0-100 RSI scale — `autoscaleInfoProvider` is the officially-documented approach**, not `priceScale().applyOptions({autoScale:false})`. The exact pattern is a verbatim example in the shipped type declarations (`typings.d.ts` L4120-4136, doc comment on `SeriesOptionsCommon.autoscaleInfoProvider`):
```js
// Use price range from 0 to 100 regardless the current visible range
const firstSeries = chart.addSeries(LineSeries, {
    autoscaleInfoProvider: () => ({
        priceRange: { minValue: 0, maxValue: 100 },
    }),
});
```
`AutoscaleInfoProvider` type (L4649): `(baseImplementation: () => AutoscaleInfo | null) => AutoscaleInfo | null`; `AutoscaleInfo` (L545-554): `{ priceRange: PriceRange | null; margins?: AutoScaleMargins }`; `PriceRange` (L3684-3693): `{ minValue: number; maxValue: number }`. Since the RSI pane will contain only the RSI line series, there's no other series in that pane to conflict with the fixed range — **no need to also touch `priceScale().applyOptions({autoScale:false})`**, the provider alone overrides the scale computation for that series/pane per the doc's own framing ("Override the default AutoscaleInfo provider").
```ts
chartRef.current.addSeries(LineSeries, {
  color: inst.colors.line,
  autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } })
}, paneIndex)
```

**Guide lines (RSI 70/30, MACD 0-line) — `series.createPriceLine(options)`** (`typings.d.ts` L2541, options type `CreatePriceLineOptions = Partial<PriceLineOptions> & Pick<PriceLineOptions,'price'>`). Full `PriceLineOptions` (L3620-3680): `{ id?, price, color, lineWidth, lineStyle, lineVisible, axisLabelVisible, title, axisLabelColor, axisLabelTextColor }`. It IS scoped to the pane the calling series lives in (price lines render as horizontal lines across that series' own pane, not the whole chart) — confirmed by the doc's own framing (line rendered relative to the series' price scale) and consistent with how the existing app would use it.
```ts
rsiSeries.createPriceLine({ price: 70, color: '#8B92A0', lineWidth: 1 })
rsiSeries.createPriceLine({ price: 30, color: '#8B92A0', lineWidth: 1 })
macdLineSeries.createPriceLine({ price: 0, color: '#8B92A0', lineWidth: 1 })
```

**Landmine (idempotency):** `createPriceLine` is NOT idempotent — each call creates a new line object (`series.removePriceLine(priceLine)` is the only way to remove one, per the doc example at L2546-2550, and there's no dedup-by-price/id behavior documented). The existing reconcile effect's "recompute every live instance unconditionally" pattern (`Chart.tsx:219-220`, safe for `setData()` because that's a pure overwrite) is **not safe** for `createPriceLine` — guide lines must be created exactly once, inside the `if (!map.has(inst.id))` new-instance branch, never in the per-reconcile-pass recompute section, or duplicate stacked lines will accumulate on every symbol switch / gap-fetch merge / any state change that re-runs the effect.

**`series.priceScale()` / `chart.priceScale(id, paneIndex)`** (L1741) remain available if a plan ever needs pane-scoped price-scale option tweaks beyond what `autoscaleInfoProvider` covers — not needed for this phase's fixed-0-100 requirement.

**BandPrimitive reuse in a sub-pane — CONFIRMED, no modification needed.** Read `bandPrimitive.ts` directly: its renderer only calls `chart.timeScale().timeToCoordinate()` and `series.priceToCoordinate()` (lines 29-34) — both are inherently scoped to whichever pane the anchor `series` (passed via `attached(param: SeriesAttachedParameter)`) belongs to. Nothing in `BandPrimitive`/`BandPaneRenderer`/`BandPaneView` references a specific pane index or the price price. Attaching one to a `LineSeries` living in `paneIndex >= 1` works identically to how it works today for BB in `paneIndex 0`. Drive it with two constant-value series spanning every bar's timestamp for the RSI zone (per DESIGN §2's own note):
```ts
const zoneColor = hexToRgba('#8B92A0', 0.12)   // reuses existing hexToRgba from bandPrimitive.ts
const upper = barsRef.current.map((b) => ({ time: b.time, value: 70 }))
const lower = barsRef.current.map((b) => ({ time: b.time, value: 30 }))
primitive.update(upper, lower, zoneColor, inst.visible)
```

**Confidence:** HIGH — `autoscaleInfoProvider` recipe is a verbatim shipped doc example (as authoritative as it gets short of the hosted docs site). HIGH for `createPriceLine` shape and non-idempotency (verified against `.d.ts` + doc example pairing `createPriceLine`/`removePriceLine`). HIGH for `BandPrimitive` reuse (verified by direct code read, not inference).

## Q6 — Native pane resize handles (D-32)

**Enabled by default — confirmed via `LayoutPanesOptions`** (`typings.d.ts` L3222-3241):
```ts
interface LayoutPanesOptions {
  enableResize: boolean          // @defaultValue true
  separatorColor: string         // @defaultValue '#2B2B43'
  separatorHoverColor: string    // @defaultValue 'rgba(178, 181, 189, 0.2)'
}
```
Set via `createChart(container, { layout: { panes: { ... } } })`. Default `{enableResize: true, separatorColor: '#2B2B43', separatorHoverColor: 'rgba(178, 181, 189, 0.2)'}` (documented default value string at L3161) already gives D-32's drag-resize behavior with zero extra code. The only styling hook worth using: recolor the separator to match the app's existing dark-theme grid token (`#151920`, already used for `grid.vertLines`/`grid.horzLines` and axis borders in `Chart.tsx:55-58`) instead of the library's default `#2B2B43`, for visual consistency:
```ts
createChart(containerRef.current, {
  layout: {
    background: { color: '#0B0E11' }, textColor: '#8B92A0',
    panes: { separatorColor: '#151920', separatorHoverColor: 'rgba(139, 146, 160, 0.2)' }
  },
  ...
})
```
No JS drag-handling code needed at all — this is entirely native.

**Confidence:** HIGH — verified directly in `.d.ts` including documented defaults.

## Q7 — Indicator math (IND-09) — confirmation only, not redesign

DESIGN §5 already pins the formulas; this section confirms them against citable sources and flags the concrete arithmetic pitfalls that would silently break TV parity if implemented naively.

**RSI = Wilder smoothing, SMA-seeded** [CITED: chartschool.stockcharts.com, rsimonitor.com/articles/wilder-smoothing]:
- Seed: average gain and average loss over the first `period` price-change diffs = plain arithmetic mean (simple average, NOT smoothed).
- Every subsequent bar: `avgGain = (prevAvgGain * (period-1) + currentGain) / period` (same recurrence shape for avgLoss) — this is Wilder's smoothing, mathematically an EMA with `α = 1/period` (vs. a standard EMA's `α = 2/(period+1)` — for period=14 that's ~7% weight on the newest value vs. ~13% for a "regular" EMA of the same period; conflating the two is the single most common RSI-parity bug).
- `RS = avgGain / avgLoss; RSI = 100 - 100/(1 + RS)` (guard `avgLoss === 0 → RSI = 100`).

**Leading-gap arithmetic differs from `sma`/`ema`'s convention — this is a real off-by-one risk.** `math.ts`'s existing `sma(values, period)`/`ema(values, period)` produce their first defined value at index `period - 1` (need `period` raw values). RSI operates on **differences between consecutive closes**, so its first defined value needs `period + 1` raw closes (one extra, to form `period` diffs) — the first defined RSI value lands at index `period`, one later than `sma`/`ema`'s `period - 1`. A naive port that reuses the exact same loop bounds as `sma`/`ema` will either read one index out of bounds or silently misalign the leading gap by one bar — which would desync every subsequent value from TradingView's own alignment.

**MACD signal = EMA of the MACD line, not SMA** [CITED: fidelity.com/learning-center, fairmontequities.com]: `macdLine = ema(values, fast) - ema(values, slow)`; `signal = ema(macdLine, signalPeriod)`; `histogram = macdLine - signal`.

**Gap-compaction is required to reuse the existing `ema()` for the signal line — DESIGN §5 says "reuse `ema()`" but doesn't spell out the mechanics.** The existing `ema(values: number[], period)` (`math.ts:19-35`) assumes a **dense** input array with no internal gaps — it only tolerates a *leading* gap. But `macdLine` (as an array aligned to `bars`) has `undefined` for every index before `slow - 1` (the longer of the two EMA gaps dominates). Passing that array directly into `ema()` would treat the leading `undefined`s as if they were real numeric values (type error at best, `NaN` propagation at worst). The correct approach: (1) extract the **contiguous defined suffix** of `macdLine` into a plain dense `number[]`, (2) run `ema(compacted, signalPeriod)`, (3) re-expand the result back onto the original bar-index alignment, offsetting by the number of leading gap entries removed in step 1.

**Concrete minimum-fixture-length implication for the golden-fixture harness (D-49):** for default params (fast=12, slow=26, signal=9), `macdLine` first becomes defined at bar index `slow - 1 = 25`; the compacted signal series needs `signalPeriod - 1 = 8` more entries before it's defined, landing MACD's histogram/signal first-valid-value at absolute bar index `25 + 8 = 33` (0-based) — i.e. **the fixture's OHLC input must contain at least ~34 bars before any checkpoint date used for MACD**, and meaningfully more (recommend 50-60+) for safety margin and to give RSI/BB/MA checkpoints room too. DESIGN §6/DD-1's placeholder fixture doesn't currently state a minimum length — this is a concrete sizing constraint the planner should bake into the fixture's construction step.

**BB = population standard deviation** — already correctly implemented in the existing `bollinger()` (`math.ts:39-57`, divides `sumSq` by `period` not `period-1`) — Bessel's correction (`period-1`, "sample" stddev) is the well-known alternate convention that would NOT match TradingView; the current code already avoids it. No change needed, just confirming D-50/IND-09's BB requirement is already satisfied by existing code.

**EMA seeding — the existing `ema()` is already correct, confirming why it's safe to reuse for MACD.** Read `math.ts:19-35` directly: it seeds `prev` with the SMA of the first `period` values (`ema.ts` lines 25-28), then applies the standard `k = 2/(period+1)` recurrence. The well-known alternate (and TV-incompatible) implementation seeds EMA with just the very first raw value (`out[0] = values[0]`) — this produces a "warm-up bias" that can take many periods to converge to the SMA-seeded result, especially for longer periods, and would fail a strict `<0.01` DD-2 tolerance check for any golden checkpoint chosen too early in the series. The existing codebase already avoids this bug; worth explicitly re-confirming in a plan verification step rather than assuming, since MACD's two EMAs (12 and 26) reuse this exact function.

**Confidence:** HIGH for all formula/convention claims (multiple independent, well-established sources cross-checked). HIGH for the leading-gap/off-by-one and gap-compaction findings (derived directly from reading the existing `math.ts` source's own documented alignment contract, not assumed).

## `trading-signals`@7.4.3 — resolve: skip it, don't add as a devDependency

**Recommendation: do not add.** DD-1 already makes the golden-fixture harness self-contained and TV-sourced (input OHLC and expected values both hand-picked from the same real TradingView chart) — the correctness gate's authority is TradingView's own displayed numbers, not any third-party library's output. Matching `trading-signals`'s RSI/MACD would not get the implementation closer to TV-parity than matching the TV-sourced golden values already does; a mismatch against `trading-signals` wouldn't even necessarily indicate a bug (it's yet another independent implementation that could itself diverge from TV in some edge case), and a match against it provides no additional gating value beyond what DD-2's `<0.01`-against-TV assertion already provides.

**Concrete costs of adding it anyway:** one more devDependency to track/version-bump; its README-documented API is streaming-class-based (`new RSI(14)`, `.update()`/`.getResult()`) [CITED via WebSearch: npmjs.com/package/trading-signals, github.com/bennycode/trading-signals] — a real shape mismatch against this project's existing pure-function array-in/array-out style (`sma(values, period) -> Array<number|undefined>`), requiring adapter/bridge code in tests purely to feed bars through it, for a comparison that isn't the actual gate.

**Established project precedent supports skipping it.** CLAUDE.md's `<indicator-computation-decision>` and Phase 3's own CONTEXT.md ("`trading-signals` でクロスチェック") already framed this as a *suggested dev-time cross-check practice*, not a shipped dependency requirement — and Phase 3 (which covered the equivalent MA/BB cross-check scenario) did **not** end up adding it (confirmed: absent from `package.json` and `node_modules` in the current repo state). Phase 4 following the same precedent is consistent, not a new decision.

**Verified the package itself is legitimate** (in case a future phase reconsiders): `npm view trading-signals version time.modified` → `7.4.3`, published `2026-01-21` [VERIFIED: npm registry] — actively maintained, matches CLAUDE.md's claim. If a developer gets stuck mid-implementation on an unexplained TV mismatch and wants a second reference implementation to triangulate the bug, installing it temporarily (or just running its logic in a scratch script, not committing it as a dependency) remains a reasonable escape hatch — but that's a conditional, as-needed action, not a default recommendation for this phase's plan.

## Package Legitimacy Audit

**No new packages are being installed this phase.** `lightweight-charts@5.2.0` and `vitest@3.0.x` are already installed dependencies (confirmed via `package.json`/`node_modules` reads) and this research's own recommendation is to explicitly NOT add `trading-signals` (see above) — so the Package Legitimacy Gate protocol (which triggers "whenever this phase installs external packages") does not apply. `trading-signals`'s registry legitimacy was spot-checked anyway (see above) purely to support the skip recommendation with evidence, not because it's being added.

## Existing Code — grounding notes (from direct reads, not assumptions)

- **`Chart.tsx`** — create-once chart effect: lines 51-143. Data-push effect: lines 146-163. Indicator reconcile effect: lines 168-242 (matches DESIGN.md's own "`Chart.tsx:168`" citation exactly). `indicatorSeriesRef: Map<string, ISeriesApi<'Line'>[]>` (line 23) and `bandPrimitiveRef: Map<string, BandPrimitive>` (line 26) are the two maps this phase's paneIndex bookkeeping extends alongside.
- **`AddIndicatorMenu.tsx`** iterates `Object.values(registry)` with **no filtering** (lines 21-32) — once `volume` is registered (per DESIGN §3), it will appear in the "+Indicator" menu unless explicitly excluded. D-34 requires it hidden from the user-add flow. `IndicatorModule` (`types.ts`) currently has no "hide from add-menu" field — needs either a small additive flag or an explicit `type !== 'volume'` filter in this component. Concrete, small, and squarely in-scope for the planner (not a redesign — D-34's user-visible behavior is already decided, this is just "where the filter check goes").
- **`IndicatorLegend.tsx`** unconditionally renders the eye/gear/× icon row for every instance (lines 37-80) — DESIGN §3 already states Volume's legend should show label + cursor value only, no action icons. This component needs a conditional guard (e.g., `!inst.fixed`) around those three `<Tooltip>` blocks once a `fixed` flag exists on `IndicatorInstance`.
- **`IndicatorEditForm.tsx`** — confirmed **zero changes needed** for RSI/MACD's own parameter fields: its `renderField` switch already covers `'number'` (used for period/fast/slow/signal/overbought/oversold), `'select'`, `'source'`, `'color'` — all of RSI/MACD's params fit the existing `'number'` FieldDesc kind. Low-risk, no new UI primitive required.
- **`registry.ts`** is a one-line object literal (`{ ma, bb }`, line 7) — adding `rsi`, `macd`, `volume` is a pure addition, exactly as IND-01 intends.
- **`math.ts`** has a documented "ZERO imports" contract (file header comment, line 1) specifically so `tests/indicators/math.test.ts` can import it in isolation — `rsi`/`macd` must preserve this (no importing from `types.ts` or elsewhere) to keep the correctness-gate test file dependency-free, matching the existing `tests/indicators/math.test.ts` pattern (which imports only `sma, ema, bollinger` from `../../src/renderer/indicators/math`, no other project modules).
- **`vitest.config.ts`** registers only a `@shared` path alias (no `@` alias) — irrelevant for `math.ts`/`rsi.ts`/`macd.ts` since they have zero imports, but worth noting if a future test ever needs to import from `@/indicators/types` or similar, that alias isn't configured for the test runner (only for the Vite web build).

## Validation Architecture

**DESIGN.md §6's golden-fixture harness is sufficient for IND-09 specifically — no separate VALIDATION.md is needed for the correctness-gate piece.** It already specifies: self-contained TV-sourced fixtures (DD-1), a single `math.golden.test.ts` covering all 5 indicators, `<0.01` tolerance (DD-2), and a placeholder/`test.todo` pattern that upgrades to enforcing once the user supplies real TV values. This research's only addition to that piece is the concrete minimum-fixture-length constraint from Q7 (≥~34 bars before any MACD checkpoint, recommend 50-60+ overall) — an input to DESIGN §6's harness, not a structural change to it.

However, IND-09 is only one of this phase's five requirements. The other four (IND-04/05/06, CHART-04) are rendering/interaction behaviors, not pure-math correctness, and this repo has **no e2e/UI test infrastructure** (confirmed: no Playwright in `package.json`, no `tests/e2e` or similar directory exists) — so the phase's full requirement coverage needs both automated and manual verification:

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.0.x (installed, `vitest.config.ts` present) |
| Config file | `vitest.config.ts` — `test.include: ['tests/**/*.test.ts']`, `environment: 'node'` |
| Quick run command | `npx vitest run tests/indicators/` |
| Full suite command | `npm test` (= `vitest run`, all suites) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| IND-09 | RSI/MACD/BB/SMA/EMA match TV golden values within 0.01 | unit (Vitest) | `npx vitest run tests/indicators/math.golden.test.ts` | ❌ Wave 0 — new file per DESIGN §6 |
| IND-05 | RSI module registers, computes correct shape, overbought/oversold params editable | unit (Vitest) | `npx vitest run tests/indicators/rsi.test.ts` (module-shape/param-plumbing test, distinct from the golden-value test) | ❌ Wave 0 — recommend alongside `rsi.ts` |
| IND-06 | MACD module registers, computes 3 outputs (line/signal/hist), params editable | unit (Vitest) | `npx vitest run tests/indicators/macd.test.ts` | ❌ Wave 0 — recommend alongside `macd.ts` |
| IND-04 | Volume pane always present, colored by candle direction | unit (Vitest, compute-only) + manual UAT (visual render) | `npx vitest run tests/indicators/volume.test.ts` for the color-by-direction compute logic; **rendering itself is manual-only** (no e2e infra) | ❌ Wave 0 for the unit slice; manual for the rest |
| CHART-04 | Crosshair reads all panes at one synchronized timestamp | manual-only (justification: requires a live rendered chart + mouse simulation; no Playwright/e2e harness in this repo) — **but** the pure value-extraction logic (given a `param.seriesData` Map, correctly read `.value`/`.close` per series kind) CAN be unit-tested if factored as a standalone function | `npx vitest run tests/indicators/crosshairValues.test.ts` (recommended factoring, optional) | ❌ optional Wave 0 addition |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/indicators/` (fast, isolated to this phase's math/module changes)
- **Per wave merge:** `npm test` (full suite, catches any regression in `tests/main/*` unrelated code)
- **Phase gate:** full suite green + manual UAT pass (sub-pane render, crosshair sync, pane resize/collapse) before `/gsd:verify-work`, since D-32/D-36/CHART-04's actual visual behavior has no automated coverage in this repo

### Wave 0 Gaps
- [ ] `tests/indicators/fixtures/golden.ts` — self-contained TV-sourced OHLC + expected values (DD-1), placeholder until user supplies real numbers (D-49)
- [ ] `tests/indicators/math.golden.test.ts` — the single cross-indicator correctness-gate file (DESIGN §6)
- [ ] `tests/indicators/rsi.test.ts` / `macd.test.ts` / `volume.test.ts` — module-shape unit tests (distinct from the golden-value gate), mirroring the existing `tests/indicators/math.test.ts` style
- [ ] No new framework/config install needed — Vitest already fully set up and proven against this exact directory (`tests/indicators/math.test.ts` already exists and passes)

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `lightweight-charts` | All sub-pane/crosshair rendering (Q1-Q6) | Yes | 5.2.0 (confirmed via `node_modules/lightweight-charts/package.json`) | — |
| `vitest` | Correctness gate (Q7, IND-09) | Yes | 3.0.x (confirmed via `package.json`) | — |
| `trading-signals` | Optional dev-time cross-check (CLAUDE.md) | No (not installed) | — | Recommended fallback: skip entirely, rely on DD-1's self-contained TV golden fixtures (see dedicated section above) |
| `ResizeObserver` (browser API, not npm) | Q2's per-pane legend repositioning recipe | Yes (Electron renderer = Chromium, native support) | — | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** `trading-signals` — fallback is "don't use it" (recommended, not a workaround).

## Security Domain

`security_enforcement: true`, `security_asvs_level: 1` (`.planning/config.json`). This phase introduces no new trust boundary: no new network calls (D-26 precedent — all sub-pane math runs client-side over already-cached bars), no new file I/O, no new IPC surface, no new auth/session/access-control surface.

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Not touched this phase |
| V3 Session Management | No | Not touched this phase |
| V4 Access Control | No | Not touched this phase |
| V5 Input Validation | Yes (narrow) | RSI/MACD numeric params (period/fast/slow/signal/overbought/oversold) flow through the existing `IndicatorEditForm` number-input clamping (`Math.max(field.min, parsed)`, already-established Phase 3 pattern) — no new validation library needed, extend the existing `FieldDesc` min/step constraints to the new params |
| V6 Cryptography | No | Not touched this phase |

### Known Threat Patterns for this stack
None specific to this phase — no user-controlled strings reach a DB query, shell command, or HTML-injection sink (indicator params are numbers/enums rendered as chart data, not markup).

## Landmines / plan-affecting findings

1. **DESIGN.md §1's `guides`/`band` fields are declared as static per-module data, but D-44/IND-05 require RSI's overbought/oversold thresholds to be live-editable.** As drafted (`guides?: { value: number; color?: string }[]`), editing RSI's threshold params via the schema-driven edit form would NOT move the drawn 70/30 guide lines or the zone-fill band — they'd stay hardcoded at whatever the module declares, silently desyncing the visual from the live param value. The natural fix (purely additive, no user-visible redesign): make `guides`/`band` functions of `Params`, mirroring the pattern the codebase already uses for `label: (p: Params) => string` in `ma.ts`/`bb.ts` — e.g. `guides?: (p: Params) => { value: number; color?: string }[]`. `scale` (RSI's fixed 0-100) does NOT need this treatment — D-45 fixes it regardless of threshold edits. MACD's `guides` (the 0-line) also doesn't need it — 0 is never user-editable. **Only RSI's `guides`/`band` are affected.** The planner should resolve this before implementation, not silently ship a threshold-edit feature that visually lies about the current thresholds.

2. **No lightweight-charts event fires on a pure pane-separator drag.** Neither `chart.timeScale().subscribeSizeChange()` nor an outer-container `ResizeObserver` catches D-32's drag-resize. Confirmed by tracing the separator's drag handler in source — it mutates pane stretch factors directly and never touches the Delegate backing `subscribeSizeChange`. The only reliable recipe is a `ResizeObserver` attached to each pane's own `getHTMLElement()` (see Q2) — this must be explicitly planned as its own piece of work, not assumed to "just work" via an existing chart-resize hook.

3. **`IPaneApi.getHTMLElement()` returns a `<tr>`, not a `<td>` — do not `appendChild` into it.** DESIGN §4's phrasing ("HTML オーバーレイ... 各ペイン左上に絶対配置") doesn't specify the exact DOM mechanism; the natural first instinct (mount legends as children of the pane's own returned element) breaks on table-layout semantics. Use it only for `getBoundingClientRect()` measurement, and mount legends as siblings inside the chart's own existing wrapper div (see Q2's code sketch).

4. **`series.createPriceLine()` is not idempotent** — calling it inside the reconcile effect's unconditional per-pass recompute section (the same section that safely calls `setData()` every pass) will stack duplicate guide lines on every symbol switch, gap-fetch merge, or any state change that re-runs the effect. Guide-line creation must be gated to the one-time "new instance" branch, same as series creation itself.

5. **MACD's signal-line computation needs a compact/re-expand step around the existing `ema()`** — DESIGN §5 says "reuse `ema()`" but `ema()`'s contract only tolerates a *leading* gap, and `macdLine` (as bar-aligned) has one. Passing it in directly would corrupt the computation. See Q7 for the exact mechanics and the resulting minimum-fixture-length constraint (≥34 bars before any MACD golden checkpoint) that DD-1's placeholder fixture needs to respect.

6. **RSI's leading gap is `period` bars, not `period - 1` like `sma`/`ema`** (it needs one extra raw value to form the first `period` diffs) — a naive port of the existing loop-bound convention will misalign RSI's output by one bar relative to TradingView, which would fail the correctness gate in a way that looks like a formula bug but is actually an indexing bug.

7. **Don't hand-roll a `nextPaneIndex` counter** — `chartRef.current.panes().length` at the moment of creating a new sub-pane instance's series is always the correct next index (already reflects any prior D-36 auto-collapse), simpler and less bug-prone than tracking it manually.

8. **`AddIndicatorMenu.tsx` needs a filter added once `volume` is registered** (D-34 requires it hidden from the add-menu; the component currently has no such filter — see grounding notes above). Small, concrete, easy to miss since it's a one-line omission in an otherwise-correct existing component.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Later-added series render on top within the same pane (z-order = add order) | Q3 | Low — if wrong, MACD histogram could visually cover the MACD/signal lines; easily fixed post-hoc with `series.setSeriesOrder()`, which is documented and confirmed to exist regardless |
| A2 | `autoscaleInfoProvider` alone (without also setting `priceScale().applyOptions({autoScale:false})`) is sufficient to hard-lock RSI's 0-100 scale in all situations (e.g., a future pane containing more than just the RSI line) | Q5 | Low for this phase (RSI pane will only ever contain the RSI line per D-33/34) — would only matter if a future phase adds a second series to the same pane |

**All other claims in this research are VERIFIED (direct source/type-declaration reads) or CITED (official doc comments shipped with the installed package, or reputable third-party technical-analysis references cross-checked across multiple independent sources).** No claim in this document is presented as authoritative without one of those two groundings.

## Open Questions

1. **Exact final choice of RSI/MACD golden checkpoint dates and the AAPL daily OHLC fixture window (D-49).**
   - What we know: user will supply real TradingView values; AAPL daily is the working default; the fixture must contain ≥~34 bars before any MACD checkpoint (Q7 finding), recommend 50-60+ for margin.
   - What's unclear: the exact date range/checkpoint dates themselves — this is explicitly a user-input placeholder per D-49, not something research can resolve.
   - Recommendation: planner builds the fixture file with the correct minimum length and `test.todo`/skip placeholders per DESIGN §6, sized per the Q7 constraint, ready for the user to drop in real TV numbers.

2. **Whether `MagnetOHLC` (new in this API surface, snaps to any of O/H/L/C) or the default `Magnet` (snaps to close only) is the better crosshair feel for the price pane, given D-39 reads all four OHLC values regardless.**
   - What we know: both are available, `Magnet` is already the chart-wide default (zero config needed).
   - What's unclear: no UX preference recorded in CONTEXT.md/UI-SPEC.md for this specific nuance — genuinely cosmetic given D-39's all-four-values readout doesn't depend on which value the horizontal line snaps to.
   - Recommendation: default `Magnet` (zero extra code) is a safe, working choice; leave `MagnetOHLC` as a one-line future tweak if the user requests it after seeing the default in practice.

## Sources

### Primary (HIGH confidence)
- `node_modules/lightweight-charts/dist/typings.d.ts` (installed v5.2.0, read directly) — `addSeries`/`moveToPane`/`panes()`/`removePane`/`IPaneApi`/`PaneSize`/`MouseEventParams`/`SeriesDataItemTypeMap`/`HistogramStyleOptions`/`PriceLineOptions`/`AutoscaleInfo`/`AutoscaleInfoProvider`/`LayoutPanesOptions`/`CrosshairMode` — all signatures and doc-comment examples cited above are read verbatim from this file.
- `node_modules/lightweight-charts/dist/lightweight-charts.development.mjs` (installed v5.2.0, compiled source, read directly) — `_internal_removeSeries`/`_cleanupIfPaneIsEmpty`/`_private__getOrCreatePane`/`PaneWidget._internal_getElement`/`PaneSeparator`/timeScale `_sizeChanged` Delegate wiring — used to verify behavior the public `.d.ts` alone doesn't fully specify (pane auto-collapse, DOM element shape, resize-event scope).
- `src/renderer/components/Chart.tsx`, `src/renderer/indicators/{types,math,ma,bb,bandPrimitive,registry}.ts`, `src/renderer/components/{IndicatorLegend,AddIndicatorMenu,IndicatorEditForm}.tsx`, `src/renderer/store.ts`, `src/shared/types.ts`, `tests/indicators/math.test.ts`, `vitest.config.ts` — all read directly this session; every "existing code" claim above is grounded in these reads, not assumed.
- `npm view trading-signals version time.modified` — confirmed `7.4.3`, published `2026-01-21`.

### Secondary (MEDIUM confidence)
- chartschool.stockcharts.com/.../relative-strength-index-rsi — RSI Wilder-smoothing formula confirmation
- rsimonitor.com/articles/wilder-smoothing — Wilder smoothing vs. standard EMA distinction, cross-platform RSI behavior
- fidelity.com/learning-center/.../macd, fairmontequities.com/how-to-calculate-the-macd — MACD signal-line = EMA (not SMA) confirmation
- npmjs.com/package/trading-signals, github.com/bennycode/trading-signals — API shape (streaming class-based) confirmation for the skip recommendation

### Tertiary (LOW confidence)
- None — every claim in this document is grounded in either a direct source/code read or a cross-checked technical-analysis reference; no claim rests on WebSearch alone without corroboration.

## Metadata

**Confidence breakdown:**
- Multi-pane API mechanics (Q1, Q2, Q3, Q5, Q6): HIGH — every signature and behavior verified against installed source, not just public docs
- Crosshair API (Q4): HIGH — all shapes verified against installed `.d.ts`
- Indicator math conventions (Q7): HIGH — cross-checked against multiple independent, reputable technical-analysis sources, plus direct confirmation against existing `math.ts` source
- `trading-signals` recommendation: HIGH — grounded in DD-1's own stated authority model, existing project precedent (Phase 3), and verified registry legitimacy

**Research date:** 2026-07-19
**Valid until:** lightweight-charts and vitest are pinned to exact installed versions used for all verification (5.2.0 / 3.0.x) — this research stays valid as long as those versions remain installed; re-verify the pane-resize/DOM-structure findings (Q1/Q2, which relied on reading compiled source rather than only public docs) if either package is upgraded.
