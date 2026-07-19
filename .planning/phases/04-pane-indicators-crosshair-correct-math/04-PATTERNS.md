# Phase 4: Pane Indicators, Crosshair & Correct Math - Pattern Map

**Mapped:** 2026-07-19
**Files analyzed:** 17 (3 new indicator modules, 5 new test files, 8 modified files, 1 reused-as-is)
**Analogs found:** 16 / 17 (only `tests/indicators/fixtures/golden.ts` has no codebase analog — shape is fully pinned by DESIGN §6/DD-1 instead)

All line numbers below were verified by direct read this session (not copied from RESEARCH.md's citations, though they match).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/renderer/indicators/rsi.ts` (NEW) | indicator module (pure compute) | transform (bars → outputs) | `src/renderer/indicators/ma.ts` | exact — identical module shape |
| `src/renderer/indicators/macd.ts` (NEW) | indicator module | transform, multi-output | `src/renderer/indicators/bb.ts` (multi-output pattern) + `ma.ts` (base shape) | exact |
| `src/renderer/indicators/volume.ts` (NEW) | indicator module | transform, no math needed | `src/renderer/indicators/ma.ts` (shape only — output kind differs) | role-match |
| `src/renderer/indicators/types.ts` (MODIFY) | type contract | n/a | itself (additive extension) | exact |
| `src/renderer/indicators/math.ts` (MODIFY) | utility (pure math) | transform | itself — `ema()` is the direct mirror for `rsi`/`macd` | exact |
| `src/renderer/indicators/registry.ts` (MODIFY) | config/registry | n/a | itself | exact |
| `src/renderer/indicators/bandPrimitive.ts` (reused, **no modification**) | rendering primitive | transform (data → canvas polygon) | itself — confirmed pane-agnostic by RESEARCH Q5 | exact, zero changes |
| `src/renderer/components/Chart.tsx` (MODIFY) | component (chart orchestration) | event-driven (crosshair) + CRUD-like reconcile (indicator series) | itself — reconcile effect (lines 168-242) + create-once effect's subscribe/cleanup pattern (lines 124-142) | exact |
| `src/renderer/components/IndicatorLegend.tsx` (MODIFY) | component | request-response (render from store) | itself | exact, but needs a structural split (single global legend → per-pane instances) |
| `src/renderer/components/AddIndicatorMenu.tsx` (MODIFY) | component | request-response | itself | exact — one-line filter add |
| `src/renderer/store.ts` (MODIFY) | store (Zustand) | CRUD (indicator instances) + event-driven (crosshair values) | itself — `addIndicator`/`removeIndicator` are the direct analogs for the new seed/guard logic | exact |
| `tests/indicators/math.golden.test.ts` (NEW) | test | batch (reference-value comparison) | `tests/indicators/math.test.ts` (import/assertion style only — tolerance form differs, see below) | role-match |
| `tests/indicators/rsi.test.ts` / `macd.test.ts` / `volume.test.ts` (NEW) | test | transform | `tests/indicators/math.test.ts` | exact (style), new subject (module object, not raw math fn) |
| `tests/indicators/fixtures/golden.ts` (NEW) | fixture/constants | batch | **none** — see No Analog Found | n/a |

## Pattern Assignments

### `src/renderer/indicators/rsi.ts` (NEW — indicator module, transform)

**Analog:** `src/renderer/indicators/ma.ts` (full file, 28 lines) — copy this file's skeleton wholesale and swap the body.

**Full analog for reference** (`ma.ts:1-28`):
```typescript
import { ema, sma } from './math'
import { sourceValues } from './types'
import type { IndicatorModule, LineData, Params, Source } from './types'

export const ma: IndicatorModule = {
  type: 'ma',
  label: (p) => `MA ${p.period}`, // D-30: period only — SMA/EMA is distinguished via the edit form, not the label
  defaults: { kind: 'SMA', period: 20, source: 'close' },
  params: [
    { key: 'period', kind: 'number', label: 'Period', default: 20, min: 1, step: 1 },
    { key: 'kind', kind: 'select', label: 'Type', options: ['SMA', 'EMA'], default: 'SMA' },
    { key: 'source', kind: 'source', label: 'Source', default: 'close' },
    { key: 'color', kind: 'color', label: 'Color' }
  ],
  outputs: [{ key: 'line', kind: 'line' }],
  compute(bars, p: Params): Record<string, LineData[]> {
    const values = sourceValues(bars, p.source as Source)
    const period = Number(p.period)
    const aligned = p.kind === 'EMA' ? ema(values, period) : sma(values, period)
    const line: LineData[] = []
    for (let i = 0; i < aligned.length; i++) {
      const value = aligned[i]
      if (value === undefined) continue
      line.push({ time: bars[i].time, value })
    }
    return { line }
  }
}
```

**What rsi.ts must add on top of this shape** (DESIGN §1, D-41/44/45):
- `pane: 'separate'` (module-level, new field)
- `scale: { min: 0, max: 100 }` (D-45 — fixed scale)
- `guides` / `band` for the 70/30 zone (D-41) — **MUST be `(p: Params) => ...` functions, not static arrays**, so live-editing overbought/oversold (D-44) moves the drawn lines/zone. See Landmine #1 under types.ts below — this is the one place DESIGN §1's draft literally needs correcting before use. Mirror the already-established `label: (p) => string` function-of-params pattern (`ma.ts:7`) for `guides`/`band` too.
- `params`: period (default 14), overbought (default 70), oversold (default 30), color — no `source` field needed (RSI conventionally operates on close only; `ma.ts`'s `source` param is not part of the IND-05 requirement).
- `compute` calls the new `rsi(values, period)` from `math.ts` (mirrors `ema`/`sma` import), returns `{ line: LineData[] }` — single line output, same shape as `ma.ts`'s return.

No error handling needed — indicator modules are pure functions over already-validated `Bar[]`; no try/catch exists anywhere in `indicators/*.ts` and none should be added here.

---

### `src/renderer/indicators/macd.ts` (NEW — indicator module, multi-output transform)

**Analog:** `src/renderer/indicators/bb.ts` (multi-output construction) + `ma.ts` (base shape).

**Multi-output helper pattern to copy** (`bb.ts:21-34`):
```typescript
compute(bars, p: Params): Record<string, LineData[]> {
  const values = sourceValues(bars, p.source as Source)
  const { upper, middle, lower } = bollinger(values, Number(p.period), Number(p.mult))
  const toLineData = (aligned: Array<number | undefined>): LineData[] => {
    const out: LineData[] = []
    for (let i = 0; i < aligned.length; i++) {
      const value = aligned[i]
      if (value === undefined) continue
      out.push({ time: bars[i].time, value })
    }
    return out
  }
  return { upper: toLineData(upper), middle: toLineData(middle), lower: toLineData(lower) }
}
```
MACD reuses this exact `toLineData`-style helper for its `macd`/`signal` line outputs. It needs a second helper (`toHistData` or similar) for the `histogram` output that also carries `color` per point (new `HistPoint` type, DESIGN §1) — no existing analog for per-bar coloring in `indicators/*.ts`; RESEARCH Q3 confirms `HistogramData.color?` (lightweight-charts `.d.ts` L1322-1327) matches `HistPoint = { time, value, color? }` exactly, so this is a new-but-simple mapping, not a new concept.

**Outputs shape** (per DESIGN §1/§5, D-42/46):
```typescript
outputs: [
  { key: 'macd', kind: 'line' },
  { key: 'signal', kind: 'line' },
  { key: 'histogram', kind: 'histogram' }
],
pane: 'separate',
guides: () => [{ value: 0, color: '#8B92A0' }] // zero-line D-46 — static is fine, unlike RSI's guides:
                                                 // 0 is never user-editable, so no Landmine #1 fix needed here
```

**Core math** — see `math.ts` section below for the exact `ema()` reuse mechanics (Landmine #5: signal-line EMA needs a compact/re-expand step, `ema()` cannot take `macdLine` directly).

**4-color histogram (D-42)** is decided per-bar inside `compute()` (DESIGN §2 line 47: "per-bar color は module.compute が返す"), comparing each bar's histogram value to both zero and the previous bar's value (rising/falling within same sign) — no codebase precedent for this comparison logic; it's new, self-contained arithmetic (not a pattern to copy from elsewhere).

---

### `src/renderer/indicators/volume.ts` (NEW — indicator module, no math.ts involvement)

**Analog:** `ma.ts` shape only (type/label/defaults/params/outputs/compute skeleton) — the body is much simpler.

**DESIGN §5 is explicit: "出来高は math 不要"** — `compute()` just maps `bars` directly to `{ time, value: volume, color }`, no `math.ts` function call at all:
```typescript
outputs: [{ key: 'volume', kind: 'histogram' }],
pane: 'separate',
compute(bars): Record<string, HistPoint[]> {
  const volume = bars.map((b) => ({
    time: b.time,
    value: b.volume,
    color: b.close >= b.open ? '#22C55E' : '#EF4444' // D-43 — matches candle colors exactly
  }))
  return { volume }
}
```
The `#22C55E` / `#EF4444` pair is not a new color choice — it's copy-pasted from the existing candlestick series options already in `Chart.tsx:63-64` (`upColor: '#22C55E', ... downColor: '#EF4444'`), so volume bars visually match candle direction with zero new palette decisions.

`params: []`, `defaults: {}` (or a placeholder) — the fixed instance is seeded directly in `store.ts`, not via the normal `addIndicator(type)` flow, so `defaults` mostly exists for shape-consistency with `IndicatorModule`, not for actual use.

---

### `src/renderer/indicators/types.ts` (MODIFY — additive contract extension)

**Current contract to extend** (`types.ts:15-34`):
```typescript
export type OutputMeta =
  | { key: string; kind: 'line'; defaultWidth?: number }
  | { key: string; kind: 'band'; between: [string, string] }

export type IndicatorModule = {
  type: string
  label: (p: Params) => string
  defaults: Params
  params: FieldDesc[]
  outputs: OutputMeta[]
  compute: (bars: Bar[], p: Params) => Record<string, LineData[]>
}

export type IndicatorInstance = {
  id: string
  type: string
  params: Params
  colors: Record<string, string>
  visible: boolean
}
```

**DESIGN §1's additive extension** (apply as-is, plus one correction below):
```typescript
export type HistPoint = { time: number; value: number; color?: string }

export type OutputMeta =
  | { key: string; kind: 'line'; defaultWidth?: number }
  | { key: string; kind: 'band'; between: [string, string] }
  | { key: string; kind: 'histogram' }                       // NEW

export type IndicatorModule = {
  // ...existing (type / label / defaults / params / outputs)...
  pane?: 'overlay' | 'separate'                    // NEW, default 'overlay'. RSI/MACD/Volume = 'separate'
  scale?: { min: number; max: number }             // NEW, fixed scale. RSI = {0,100} (D-45)
  guides?: { value: number; color?: string }[]     // DESIGN's literal draft — see Landmine #1 correction below
  band?: { from: number; to: number; color: string }
  compute: (bars: Bar[], p: Params) => Record<string, LineData[] | HistPoint[]>
}
```

**Landmine #1 (RESEARCH — resolve before implementing, not a redesign):** DESIGN §1 declares `guides`/`band` as *static* per-module data. But D-44 requires RSI's overbought/oversold thresholds to be live-editable, and a static array would desync the drawn 70/30 lines/zone from an edited threshold. Fix (purely additive, mirrors the existing `label: (p: Params) => string` pattern from `ma.ts:7`):
```typescript
guides?: (p: Params) => { value: number; color?: string }[]
band?: (p: Params) => { from: number; to: number; color: string }
```
Only RSI's `guides`/`band` actually need to close over `p` (its thresholds vary). MACD's zero-line `guides` and RSI's `scale` do not need this treatment — 0 and 0-100 are never user-editable — but making the *type* a function keeps the contract uniform (MACD's module just returns a constant from its function, same as `ma.ts`'s `label` sometimes ignores parts of `p`).

**`IndicatorInstance` also needs a `fixed?: boolean` field** (not in DESIGN §1's snippet but required by D-34/§3 — grep confirmed no `fixed` field exists anywhere on this type today) to let `store.ts`'s `removeIndicator` and `IndicatorLegend.tsx`'s icon-row guard both key off one flag.

---

### `src/renderer/indicators/math.ts` (MODIFY — add `rsi`/`macd` next to `sma`/`ema`/`bollinger`)

**Direct mirror for both new functions — `ema()`** (`math.ts:19-35`, read in full):
```typescript
// Exponential moving average. Seeded with the SMA of the first `period` values, then the
// standard k = 2/(period+1) recurrence. Aligned to `values` with the same leading gap as sma().
export function ema(values: number[], period: number): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(values.length).fill(undefined)
  const k = 2 / (period + 1)
  let prev: number | undefined
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue
    if (i === period - 1) {
      let sum = 0
      for (let j = i - period + 1; j <= i; j++) sum += values[j]
      prev = sum / period
    } else if (prev !== undefined) {
      prev = values[i] * k + prev * (1 - k)
    }
    out[i] = prev
  }
  return out
}
```
`rsi()` mirrors this file's `Array<number | undefined>` + leading-gap convention, but Wilder's recurrence uses `α = 1/period` (not `k = 2/(period+1)`) and operates on **gain/loss diffs**, not raw values.

**Landmine #6 (RESEARCH Q7) — RSI's leading gap is `period`, not `period - 1` like `sma`/`ema`.** RSI needs one extra raw value to form the first `period` diffs, so its first defined output lands at index `period`, one bar later than `sma`/`ema`'s `period - 1`. Naively copying `ema()`'s loop bounds (`i < period - 1`) will misalign RSI's output by one bar vs. TradingView — a bug that looks like a formula error but is actually an indexing error. Seed: plain arithmetic mean of the first `period` gains and first `period` losses (NOT smoothed — same "SMA-seed" idea as `ema()`'s seed, just on diffs). Then Wilder recurrence: `avgGain = (prevAvgGain * (period-1) + currentGain) / period` (same shape for avgLoss). Guard `avgLoss === 0 → RSI = 100`.

**Landmine #5 (RESEARCH Q7) — MACD's signal line needs compact/re-expand around `ema()`, cannot pass `macdLine` in directly.** `ema()`'s contract only tolerates a *leading* gap (its own header comment says "Aligned to `values` with the same leading gap as sma()"). `macdLine = ema(values, fast) - ema(values, slow)` (aligned to bars, `undefined` before index `slow - 1`) has exactly that shape, so it's *not* immediately safe to feed to `ema()` for the signal calculation — the fix: (1) slice out the contiguous defined suffix of `macdLine` into a plain dense `number[]`, (2) run `ema(compacted, signalPeriod)`, (3) re-expand back onto the original bar-index alignment, offsetting by the number of leading `undefined`s stripped in step 1. `histogram = macdLine - signal` (both already bar-aligned after step 3).

**Minimum fixture length implication (feeds `tests/indicators/fixtures/golden.ts`):** for default params (12/26/9), `macdLine` first defined at bar index 25 (`slow - 1`), signal needs 8 more (`signalPeriod - 1`) → MACD/signal/histogram first valid at absolute index 33. The fixture needs **≥34 bars before any MACD checkpoint date**, recommend 50-60+ overall for margin and to give RSI/BB/MA checkpoints room too.

**Zero-imports contract (`math.ts:1`, file header comment)** — must be preserved: `rsi`/`macd` must not import from `types.ts` or anywhere else, exactly like the existing `sma`/`ema`/`bollinger`. This is what lets `tests/indicators/math.test.ts` (and the new `math.golden.test.ts`) import `math.ts` in total isolation.

**BB is already correct, no change needed** — `bollinger()` (`math.ts:39-57`) already divides by `period` (population stddev, not `period-1` Bessel's correction), satisfying D-50/IND-09 as-is. **EMA seeding is already correct** too (`math.ts:25-28` seeds with SMA of first `period` values, not the TV-incompatible "seed with first raw value" bug) — worth an explicit re-confirmation step in the plan rather than assuming, since MACD's two EMAs (12/26) reuse this exact function.

---

### `src/renderer/components/Chart.tsx` (MODIFY — extend reconcile effect + add crosshair subscribe)

**Current indicator reconcile effect, to extend** (`Chart.tsx:168-242`, read in full):
```typescript
useEffect(() => {
  if (!chartRef.current) return
  const map = indicatorSeriesRef.current
  const liveIds = new Set(indicators.map((inst) => inst.id))

  // Remove series for instances no longer present. Detach the band primitive BEFORE
  // removeSeries disposes its anchor series — detaching from an already-removed series is
  // undefined behavior in lightweight-charts (may throw mid-loop or silently no-op).
  for (const [id, series] of map) {
    if (!liveIds.has(id)) {
      const primitive = bandPrimitiveRef.current.get(id)
      if (primitive?.series) {
        primitive.series.detachPrimitive(primitive)
        bandPrimitiveRef.current.delete(id)
      }
      for (const s of series) chartRef.current.removeSeries(s)
      map.delete(id)
    }
  }

  for (const inst of indicators) {
    const module = registry[inst.type]
    if (!module) continue

    const lineOutputs = module.outputs.filter((o) => o.kind === 'line')

    // Create series for newly-added instances, one per 'line' output, plus one BandPrimitive
    // per 'band' output (Plan 03 Task 2, D-29) — dispatched generically on OutputMeta.kind,
    // never on indicator type, so any future band indicator reuses this unchanged.
    if (!map.has(inst.id)) {
      const series: ISeriesApi<'Line'>[] = []
      for (const output of module.outputs) {
        if (output.kind === 'line') {
          series.push(
            chartRef.current.addSeries(LineSeries, { color: inst.colors[output.key], lineWidth: 2 })
          )
        }
      }
      map.set(inst.id, series)

      for (const output of module.outputs) {
        if (output.kind !== 'band') continue
        const lineKeys = lineOutputs.map((o) => o.key)
        const anchorSeries = series[lineKeys.indexOf(output.between[0])]
        if (!anchorSeries) continue
        const primitive = new BandPrimitive()
        anchorSeries.attachPrimitive(primitive)
        bandPrimitiveRef.current.set(inst.id, primitive)
      }
    }

    // Recompute every live instance from barsRef.current — cheap client compute (D-26), no
    // network read. Unconditional recompute is fine per DESIGN §4.
    const outputs = module.compute(barsRef.current, inst.params)
    const series = map.get(inst.id) ?? []
    lineOutputs.forEach((output, idx) => {
      const lineSeries = series[idx]
      if (!lineSeries) return
      const data = (outputs[output.key] ?? []).map((d) => ({ time: d.time as UTCTimestamp, value: d.value }))
      lineSeries.setData(data)
      lineSeries.applyOptions({ color: inst.colors[output.key], visible: inst.visible })
    })

    const bandOutput = module.outputs.find((o) => o.kind === 'band')
    if (bandOutput && bandOutput.kind === 'band') {
      const primitive = bandPrimitiveRef.current.get(inst.id)
      if (primitive) {
        const toBandData = (key: string): { time: UTCTimestamp; value: number }[] =>
          (outputs[key] ?? []).map((d) => ({ time: d.time as UTCTimestamp, value: d.value }))
        const color = hexToRgba(inst.colors[bandOutput.key] ?? '#000000', 0.15)
        primitive.update(toBandData(bandOutput.between[0]), toBandData(bandOutput.between[1]), color, inst.visible)
      }
    }
  }
}, [indicators, q.data, timeframe])
```
**Refs this effect already keys off** (`Chart.tsx:23, 26`):
```typescript
const indicatorSeriesRef = useRef<Map<string, ISeriesApi<'Line'>[]>>(new Map())
const bandPrimitiveRef = useRef<Map<string, BandPrimitive>>(new Map())
```

**Extension points for this phase** (DESIGN §2, RESEARCH Q1/Q3/Q5):
- New-instance branch (`if (!map.has(inst.id))`, line 197): for `module.pane === 'separate'` instances, pass `chartRef.current.panes().length` as the third `addSeries(..., paneIndex)` argument when creating that instance's FIRST series — **Landmine #7: do not hand-roll a `nextPaneIndex` counter**, `panes().length` at series-creation time is always correct (already reflects any prior D-36 auto-collapse). For `histogram` outputs, add a branch alongside the existing `if (output.kind === 'line')` check using `chart.addSeries(HistogramSeries, { base: 0 }, paneIndex)` — `HistogramSeries` imports identically to the already-imported `LineSeries`/`CandlestickSeries` (`Chart.tsx:3-11`).
- **Same new-instance branch** is also where `guides`/`band`/`scale` get wired one-time: `series.createPriceLine({ price, color })` per guide, `priceScale`/`autoscaleInfoProvider` for `scale`, and the existing `BandPrimitive` pattern (lines 213-216 above) reused for RSI's zone — driven by two constant-value series at 70/30 spanning every bar (RESEARCH Q5 code sketch). **Landmine #4: `createPriceLine()` is NOT idempotent** — it must go in this one-time branch, never in the unconditional per-pass recompute section below it (lines 219+), or duplicate stacked lines accumulate on every symbol switch / gap-fetch merge.
- Unconditional recompute section (lines 219-240): extend `lineOutputs.forEach` with an equivalent `histogramOutputs.forEach` that also applies per-point `color` from `HistPoint` (D-42/43) via `setData()` — same shape as the existing line branch, just reading `.color` off each point too.
- Removal loop (lines 176-186): unchanged in shape — `chart.removeSeries(s)` already auto-collapses the pane per RESEARCH Q1 (confirmed via source read of `_cleanupIfPaneIsEmpty`), matching D-36 for free. No `chart.removePane()` call needed.

**Crosshair subscribe/cleanup — closest analog is this same file's existing subscribe pattern** (`Chart.tsx:124-142`, the pan/gap-fetch listener, inside the create-once effect):
```typescript
const onVisibleLogicalRangeChange = (range: LogicalRange | null): void => { /* ... */ }
chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChange)

return () => {
  chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChange)
  if (debounceRef.current) clearTimeout(debounceRef.current)
  chart.remove()
  chartRef.current = null
  seriesRef.current = null
}
```
Mirror this exact subscribe-in-body / unsubscribe-in-cleanup shape for `chart.subscribeCrosshairMove(onCrosshairMove)` (no matching `unsubscribeCrosshairMove` call needed — RESEARCH confirms the API is `subscribeCrosshairMove(handler)` only, cleanup is `chart.remove()` tearing down everything, same as today). Throttle via `requestAnimationFrame` per DESIGN §4 (RESEARCH Q4 gives the full code sketch — not duplicated here, see `04-RESEARCH.md` Q4).

---

### `src/renderer/components/IndicatorLegend.tsx` (MODIFY — per-pane instantiation + `fixed` guard)

**Current full file structure** (94 lines, read in full) — single legend div, pulls ALL instances from the store unconditionally:
```typescript
export function IndicatorLegend(): React.JSX.Element | null {
  const indicators = useAppStore((s) => s.indicators)
  const toggleVisible = useAppStore((s) => s.toggleVisible)
  const removeIndicator = useAppStore((s) => s.removeIndicator)
  const [editingId, setEditingId] = useState<string | null>(null)

  if (indicators.length === 0) return null

  return (
    <>
      <div className="absolute left-2 top-2 z-10 max-h-[50%] overflow-y-auto rounded bg-card/80 p-2 text-xs">
        {indicators.map((inst) => { /* ... */ })}
      </div>
      {editingId !== null && <IndicatorEditForm ... />}
    </>
  )
}
```

**Icon-row block that needs the `fixed` guard** (`IndicatorLegend.tsx:37-80` — the three `<Tooltip>` blocks for eye/gear/×):
```typescript
<Tooltip>
  <TooltipTrigger asChild>
    <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={inst.visible ? 'Hide' : 'Show'}
      onClick={() => toggleVisible(inst.id)}>
      {inst.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
    </Button>
  </TooltipTrigger>
  <TooltipContent>{inst.visible ? 'Hide' : 'Show'}</TooltipContent>
</Tooltip>
{/* ...gear (Settings2) and × (X) Tooltips follow the identical structure... */}
```
D-34/§3: Volume's legend row shows label + cursor value only — wrap these three `<Tooltip>` blocks in `{!inst.fixed && (...)}`.

**Structural change required (not just a guard) — per-pane instantiation (D-37, DESIGN §4):** DESIGN §4 states explicitly: "`IndicatorLegend` は行描画コンポーネントのまま、ペインごとに当該ペインのインスタンス＋カーソル値で複数インスタンス化する" (IndicatorLegend stays a row-rendering component; instantiate it once per pane with that pane's instances + cursor values). Today this component self-selects `s.indicators` wholesale (line 14) and renders exactly one legend div for the whole chart. The new shape: `Chart.tsx` renders one `<IndicatorLegend>` per pane (price pane + each separate-pane instance group), each one filtered/positioned by its caller, rather than this component pulling and rendering everything itself. The row-rendering JSX body (the `.map` over instances, lines 24-83) is the reusable part; the top-level store-subscription + "render everything in one div" wrapper is what changes.

---

### `src/renderer/components/AddIndicatorMenu.tsx` (MODIFY — volume exclusion filter)

**Current full file** (37 lines) — the unfiltered map (Landmine #8):
```typescript
{open && (
  <div className="absolute left-0 top-full z-20 mt-1 flex flex-col gap-1 rounded-md border border-border bg-card p-2 shadow-md">
    {Object.values(registry).map((module) => (
      <button key={module.type} className="rounded px-2 py-1 text-left text-sm hover:bg-accent"
        onClick={() => { addIndicator(module.type); setOpen(false) }}>
        {module.type.toUpperCase()}
      </button>
    ))}
  </div>
)}
```
D-34 requires `volume` hidden from this menu. `IndicatorModule` has no "hide from add-menu" field today. Two equally-valid fixes (RESEARCH leaves this as planner's call): `Object.values(registry).filter((m) => m.type !== 'volume').map(...)` (simplest, one line) OR add a small additive `hideFromMenu?: boolean` field to `IndicatorModule` and filter on that instead (slightly more general if a second fixed/hidden indicator is ever added). Given YAGNI and that D-34 only ever applies to `volume`, the literal type-check filter is the smaller diff.

---

### `src/renderer/store.ts` (MODIFY — `crosshair` slice + fixed `volume` seed)

**Full current file** (54 lines, read in full) — `addIndicator`/`removeIndicator` are the direct analogs:
```typescript
export const PALETTE = ['#F5A623', '#A78BFA', '#2DD4BF', '#F472B6', '#FACC15', '#38BDF8']

let nextId = 1 // module-level counter (no Date/random) — JSON-stable ids for P5 persistence

export const useAppStore = create<AppState>((set, get) => ({
  activeSymbol: null,
  setActiveSymbol: (symbol) => set({ activeSymbol: symbol }),

  indicators: [],
  addIndicator: (type) => {
    const module = registry[type]
    if (!module) return
    const color = PALETTE[get().indicators.length % PALETTE.length]
    const colors: Record<string, string> = {}
    for (const output of module.outputs) colors[output.key] = color
    const instance: IndicatorInstance = {
      id: String(nextId++), type, params: { ...module.defaults }, colors, visible: true
    }
    set((state) => ({ indicators: [...state.indicators, instance] }))
  },
  removeIndicator: (id) => set((state) => ({ indicators: state.indicators.filter((i) => i.id !== id) })),
  toggleVisible: (id) => set((state) => ({ /* ... */ })),
  updateParams: (id, patch) => set((state) => ({ /* ... */ })),
  setColor: (id, outputKey, color) => set((state) => ({ /* ... */ }))
}))
```

**Three changes needed:**
1. **Seed a fixed volume instance** instead of starting `indicators: []` — construct one `IndicatorInstance` object the same shape `addIndicator` builds (`id`/`type`/`params`/`colors`/`visible`), plus `fixed: true`, and put it in the initial `indicators` array at store creation. Volume's `colors` field is largely unused (D-43's colors are per-bar and computed in `volume.ts`'s `compute()`, not palette-assigned), so it can be a placeholder/empty object.
2. **`removeIndicator` (line 42) must ignore fixed instances** (DESIGN §3: "`removeIndicator` は fixed インスタンスを無視") — guard: `state.indicators.filter((i) => i.id !== id || i.fixed)`.
3. **New `crosshair` slice** (DESIGN §4) — a small additional piece of state, `crosshair: Record<string, unknown>` (keyed by instance id, or by pane) + a `setCrosshair` action, following the exact same `set((state) => ({...}))` action-shape convention already used by every action above (no new state-management pattern, just one more key + one more setter, same as `setActiveSymbol`/`toggleVisible`).

---

### `src/renderer/indicators/registry.ts` (MODIFY — one-line addition)

**Current full file** (7 lines):
```typescript
import { ma } from './ma'
import { bb } from './bb'
import type { IndicatorModule } from './types'

// The single registration point for indicator modules — iterated by AddIndicatorMenu and
// IndicatorEditForm (Plan 02, same wave). Plan 03 adds `bb` here (IND-01).
export const registry: Record<string, IndicatorModule> = { ma, bb }
```
Add `import { rsi } from './rsi'`, `import { macd } from './macd'`, `import { volume } from './volume'`, and extend the literal to `{ ma, bb, rsi, macd, volume }`. Confirms IND-01: zero other files need touching for the registration itself (`AddIndicatorMenu`/`IndicatorEditForm` already iterate `registry` generically — `IndicatorEditForm` needs literally zero changes per RESEARCH's grounding notes, its `renderField` switch already covers every `FieldDesc.kind` RSI/MACD's params use).

---

### `src/renderer/indicators/bandPrimitive.ts` (reused as-is — **no modification**)

**Confirmed by RESEARCH Q5 via direct code read: pane-agnostic, zero changes needed.** Its renderer only calls `chart.timeScale().timeToCoordinate()` and `series.priceToCoordinate()` (lines 29-34), both inherently scoped to whichever pane the anchor series lives in — nothing references a specific pane index.

**`update()` signature to drive for RSI's zone** (`bandPrimitive.ts:100-106`):
```typescript
update(upper: LineData[], lower: LineData[], color: string, visible: boolean): void {
  this.upper = upper
  this.lower = lower
  this.color = color
  this.visible = visible
  this.requestUpdate?.()
}
```
**`hexToRgba` to reuse for the zone's translucent fill** (`bandPrimitiveRef.ts:15-20`):
```typescript
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex)
  if (!m) return hex
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16))
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
```
Drive it with two constant-value series spanning every bar's timestamp (RESEARCH Q5's exact recipe):
```typescript
const zoneColor = hexToRgba('#8B92A0', 0.12)
const upper = barsRef.current.map((b) => ({ time: b.time, value: 70 }))
const lower = barsRef.current.map((b) => ({ time: b.time, value: 30 }))
primitive.update(upper, lower, zoneColor, inst.visible)
```
Same attach mechanism already used for BB (`Chart.tsx:213-214`, `anchorSeries.attachPrimitive(primitive)`) — attach to the RSI line series living in its own `paneIndex >= 1`.

---

### `tests/indicators/math.golden.test.ts`, `rsi.test.ts`, `macd.test.ts`, `volume.test.ts` (NEW)

**Analog:** `tests/indicators/math.test.ts` (236 lines, read in full) — import style and assertion style to copy:
```typescript
import { describe, it, expect } from 'vitest'
import { sma, ema, bollinger } from '../../src/renderer/indicators/math'

describe('sma', () => {
  it('returns leading undefined until period values accumulated, then trailing means', () => {
    // sma([1,2,3,4], 2):
    // i=0: sum=1, i >= period-1 (1)? No → undefined
    // ...
    const result = sma([1, 2, 3, 4], 2)
    expect(result).toHaveLength(4)
    expect(result[0]).toBeUndefined()
    expect(result[1]).toBeCloseTo(1.5)
    // ...
  })
})
```
The **hand-computed comment walkthrough before each assertion block** is the established house style in this file (every `it()` shows the arithmetic inline before asserting) — carry this into `rsi.test.ts`/`macd.test.ts` for at least one worked example per function.

**`math.golden.test.ts` tolerance form is DIFFERENT from `math.test.ts`'s `toBeCloseTo`** — DD-2/DESIGN §6 prescribe an explicit form:
```typescript
expect(Math.abs(actual - expected)).toBeLessThan(0.01)
```
Do not reuse `toBeCloseTo` (default 2-decimal precision, ≈0.005) for the golden gate — DD-2 pins the exact `<0.01` comparison explicitly, and the placeholder/`test.todo` upgrade path (D-49) depends on this literal assertion shape being present even while `fixtures/golden.ts` values are still TODO.

`rsi.test.ts`/`macd.test.ts`/`volume.test.ts` are **module-shape tests** (registry compute output structure, param editability) — a different subject than `math.test.ts` (they import `./rsi`/`./macd`/`./volume` module objects and exercise `.compute(bars, params)`, not raw `math.ts` functions directly), but should keep the same `describe`/`it`/comment-walkthrough conventions.

---

## Shared Patterns

### Indicator module contract shape
**Source:** `src/renderer/indicators/ma.ts` (whole file, canonical minimal example)
**Apply to:** `rsi.ts`, `macd.ts`, `volume.ts`
Every module is `{ type, label: (p) => string, defaults, params: FieldDesc[], outputs: OutputMeta[], compute(bars, p) }`. No module does its own error handling or logging — pure function over an already-validated `Bar[]`.

### Palette auto-assignment for line colors (D-47)
**Source:** `src/renderer/store.ts:7` (`PALETTE` array) + `store.ts:27-32` (`addIndicator`'s round-robin color assignment)
**Apply to:** RSI's line color, MACD's line/signal colors (NOT volume — its bar colors are direction-based, D-43, not palette-assigned)
```typescript
const color = PALETTE[get().indicators.length % PALETTE.length]
const colors: Record<string, string> = {}
for (const output of module.outputs) colors[output.key] = color
```

### BandPrimitive reuse for zone/band fills
**Source:** `src/renderer/indicators/bandPrimitive.ts` (whole file) — already proven for BB, RESEARCH Q5 confirms zero modification needed for RSI's 70/30 zone.
**Apply to:** `rsi.ts`'s zone fill (driven by two constant-value series, not `bollinger()` output)

### Reconcile effect's create/update/remove triad
**Source:** `src/renderer/components/Chart.tsx:168-242`
**Apply to:** every new sub-pane output kind (`histogram`, `guides`, `band`, fixed `scale`) — extend the same three phases (remove-departed, create-new, recompute-live) rather than writing a parallel effect. **Landmine #4: one-time-creation-only operations (`createPriceLine`) must live in the create-new branch, never the recompute branch.**

### No error-handling pattern needed in indicator code
Confirmed by reading every file in `indicators/*.ts` — zero `try`/`catch` anywhere. Indicator modules and `math.ts` are pure functions over already-cached/validated data (D-26 precedent: client-side recompute, no network, no I/O). Do not introduce error handling here; it would be unrequested defensive code with no failure mode to guard against.

### Numeric param validation
**Source:** `src/renderer/components/IndicatorEditForm.tsx:40-47` (existing `'number'` field's onChange handler)
**Apply to:** RSI/MACD's period/overbought/oversold/fast/slow/signal params — already generically handled, zero changes needed to this file:
```typescript
const clamped = field.min !== undefined ? Math.max(field.min, parsed) : parsed
updateParams(instance.id, { [field.key]: clamped })
```

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `tests/indicators/fixtures/golden.ts` | fixture/constants | batch | No existing analog — this repo's other fixtures (`tests/fixtures/*.json`) are FMP-response JSON for provider tests, a different domain (API payload shapes, not OHLC+expected-indicator-value pairs). Shape is fully pinned by DESIGN §6/DD-1 instead: self-contained TV-sourced OHLC input + expected values, `// TODO: fill from TradingView` placeholders, ≥34 bars before any MACD checkpoint (RESEARCH Q7), recommend 50-60+ bars total. |
| Per-pane HTML legend positioning mechanism (part of `Chart.tsx`/`IndicatorLegend.tsx` work) | interaction/DOM measurement | event-driven | Grep-confirmed: no `ResizeObserver`, `getHTMLElement`, or `paneIndex`/`panes()` usage anywhere in `src/` today — this is this app's first multi-pane UI. No codebase precedent exists; RESEARCH Q2's `getHTMLElement()` + `getBoundingClientRect()` + `ResizeObserver` recipe is the full specification to follow verbatim (see `04-RESEARCH.md` Q2 for the complete code sketch — not duplicated here since it's already fully worked out there, not derived from existing code). |

## Metadata

**Analog search scope:** `src/renderer/indicators/*.ts`, `src/renderer/components/{Chart,IndicatorLegend,AddIndicatorMenu,IndicatorEditForm}.tsx`, `src/renderer/store.ts`, `src/shared/types.ts`, `tests/indicators/*.ts`, `vitest.config.ts` — every file DESIGN §1-6/CONTEXT canonical_refs named, all read in full this session (all ≤ 275 lines, no file required chunked reads).
**Files scanned:** 13 read directly (full contents) + 1 glob of `tests/**/*` + 2 targeted greps (confirmed no existing multi-pane/crosshair/ResizeObserver usage, confirmed no existing `fixed` field on any store type).
**Pattern extraction date:** 2026-07-19
