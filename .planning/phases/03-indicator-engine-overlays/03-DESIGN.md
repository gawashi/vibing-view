# Phase 3: Indicator Engine & Overlays — Design

**Date:** 2026-07-19
**Status:** Approved — ready for planning
**Covers:** IND-01, IND-02, IND-03, IND-07, IND-08
**Builds on:** `03-CONTEXT.md` (decisions D-22–D-31), P1/P2 code (`Chart.tsx`, `store.ts`, `App.tsx`)

## Goal

Overlay unlimited, multi-instance MA (SMA/EMA) and Bollinger Bands on the price
pane. Each instance is live-editable (period, source, color, σ), toggleable, and
deletable, recomputed from cached bars with **no refetch**. New indicators register
as self-contained modules (compute + param schema + render meta) without touching
chart-drawing code (IND-01).

## Architecture

Client-only, renderer-side. No new IPC, no new TanStack Query keys — indicators
are pure functions over `barsRef.current`, which is already populated by P1/P2's
read-through cache.

```
src/renderer/indicators/
  types.ts        FieldDesc, IndicatorModule, IndicatorInstance
  math.ts         sma(), ema(), bollinger()  (hand-written)
  math.test.ts    Vitest — asserts against hand-checked values
  ma.ts           MA module (SMA/EMA)
  bb.ts           BB module
  registry.ts     { ma, bb } — iterated by the "+指標" menu and edit form
  bandPrimitive.ts  ISeriesPrimitive for the BB translucent fill (D-29)

src/renderer/store.ts        + indicators[] and CRUD actions (D-31)
src/renderer/components/
  Chart.tsx                  + effect: diff instances → manage series, recompute
  IndicatorLegend.tsx        top-left overlay list (D-23/24)
  AddIndicatorMenu.tsx       toolbar "+指標" 2-item menu (D-22)
  IndicatorEditForm.tsx      schema-driven form in existing dialog (D-25)
```

## Component design

### 1. Indicator module contract (IND-01)

The param schema is a **hand-rolled field-descriptor array** (approved Option A —
not zod reflection). ~30 lines, no reflection, fully typed; P4 adds RSI/MACD/Volume
by exporting one more module.

```ts
type FieldDesc =
  | { key: string; kind: 'number'; label: string; default: number; min?: number; step?: number }
  | { key: string; kind: 'select'; label: string; options: string[]; default: string }
  | { key: string; kind: 'source'; label: string; default: Source }   // close/open/high/low/hl2/hlc3
  | { key: string; kind: 'color'; label: string }                     // maps to an output color

type LineData = { time: number; value: number }

type OutputMeta =
  | { key: string; kind: 'line'; defaultWidth?: number }
  | { key: string; kind: 'band'; between: [string, string] }          // BB fill between two outputs

type IndicatorModule = {
  type: string                                       // 'ma' | 'bb'
  label: (p: Params) => string                       // "MA 20", "BB 20,2"
  defaults: Params
  params: FieldDesc[]                                // drives the auto-form (D-25)
  outputs: OutputMeta[]                              // MA→[{line}]; BB→[upper,middle,lower lines + band]
  compute: (bars: Bar[], p: Params) => Record<string, LineData[]>
}
```

- **MA module** — defaults `{ kind:'SMA', period:20, source:'close' }` (D-28). `params`:
  period (number, min 1), kind (select SMA/EMA), source (source), color. `compute`
  returns `{ line }`.
- **BB module** — defaults `{ period:20, mult:2 }` (D-29). `params`: period, mult
  (number, step 0.5), source, colors. `outputs`: upper/middle/lower lines + one band
  between upper and lower. `compute` returns `{ upper, middle, lower }`.

`Source` selection (D-27): `close` default; `close/open/high/low/hl2/hlc3`. `hl2 =
(h+l)/2`, `hlc3 = (h+l+c)/3`.

### 2. Indicator math (`math.ts`)

Hand-written per CLAUDE.md `<indicator-computation-decision>`:
- `sma(values, period)` — trailing mean; `undefined`/skip until `period` bars exist.
- `ema(values, period)` — seed with SMA of first `period` values, then
  `k = 2/(period+1)` recurrence.
- `bollinger(values, period, mult)` — middle = SMA; upper/lower = middle ± mult ×
  population stddev over the window.

Each returns aligned arrays (leading gap where the window isn't full).
**Check (ponytail):** one `math.test.ts` asserting SMA/EMA/BB against hand-computed
values on a small fixed series. Skipped: `trading-signals` dependency — the unit
test is the lazier cross-check; add the dep only if a formula genuinely disputes.

### 3. State (`store.ts`, D-31)

Extend the existing Zustand store (app-level, survives symbol/timeframe switch):

```ts
type IndicatorInstance = {
  id: string                 // stable, from a module-level counter (no Date/random)
  type: string
  params: Params
  colors: Record<string, string>   // per-output color, palette-assigned on add (D-30)
  visible: boolean
}
// actions: addIndicator(type), removeIndicator(id), toggleVisible(id),
//          updateParams(id, patch), setColor(id, outputKey, color)
```

In-memory only this phase; shape is JSON-serializable so P5 can persist it.
`addIndicator` seeds from the module's `defaults` and assigns palette colors
round-robin by current instance count.

### 4. Chart integration (`Chart.tsx`)

One new effect, subscribing to `indicators` and re-running on `q.data` / `timeframe`
change. Reconciles a `Map<instanceId, ISeriesApi[]>` against the current instances:

- **added** → create line series (and band primitive for BB) on the price pane,
  compute from `barsRef.current`, `setData`.
- **params/bars changed** → recompute, `setData` (immediate, D-26 — client compute is
  cheap; add a short debounce only if live typing feels heavy).
- **visibility** → `applyOptions({ visible })`.
- **removed** → `removeSeries` and drop from the map.

Cleanup removes all indicator series alongside the existing chart teardown. The
existing data-push effect is untouched; indicators read the same `barsRef`, so a
gap-fetch merge (which updates `q.data`) naturally retriggers recompute.

### 5. BB band fill (D-29) — the one technical risk

lightweight-charts v5 has no native band series. Plan: a custom `ISeriesPrimitive`
(`bandPrimitive.ts`) drawing a translucent polygon between the upper and lower
line values, rendered under the three lines.

`// ponytail:` ceiling — if the custom primitive proves heavy, fall back to the
three lines only. Fill was chosen for looks (D-29, 見映え優先), so we attempt it, but
the phase does not sink into rendering polish.

### 6. UI — reuse installed parts, native where lazier

- **AddIndicatorMenu (D-22)** — plain button toggling a 2-item inline menu (MA / BB),
  placed near `TimeframeRow` in `App`. No dropdown-menu dependency (only 2 items).
- **IndicatorLegend (D-23/24)** — absolute top-left overlay inside Chart. One row per
  instance: `label · eye · gear · ×`, using existing `button`/`tooltip`/`toggle`.
  No count limit (IND-07). Sits over the canvas, costs no chart area.
- **IndicatorEditForm (D-25)** — auto-generated from the module's `params`, rendered in
  the existing `dialog`. Field mapping: `number`→`input`, `select`/`source`→
  `toggle-group` or native `<select>`, `color`→native `<input type="color">`
  (rung 4 — no color-picker dependency). Edits call `updateParams`/`setColor` →
  immediate recompute.
- **Palette (D-30)** — small fixed dark-theme color array, round-robin by add order so
  three stacked MAs never collide. Labels: `MA 20`, `BB 20,2`.

## Data flow

```
AddIndicatorMenu / Legend / EditForm
        │  (CRUD)
        ▼
   store.indicators[]  ──subscribe──▶  Chart effect
        ▲                                  │ compute(barsRef, params)
        │                                  ▼
   IndicatorLegend (renders list)     ISeriesApi.setData / band primitive
```

## Testing

- `math.test.ts` (Vitest) — SMA/EMA/BB correctness on a fixed series (the one required
  non-trivial-logic check).
- Manual/E2E out of scope for the math gate; TV-exact validation is P4.

## Out of scope (deferred)

- Sub-pane indicators (Volume/RSI/MACD), crosshair sync, TV-exact correctness gate → **P4**
  (reuses this registry + schema-driven form unchanged).
- Disk persistence / named layouts / serialized instances → **P5**.
- Per-cell independent indicator sets in a multi-chart grid → **P5**.
- Volume-MA overlay, indicator presets/templates → **v2**.
- User-authored indicator scripts (Pine-equivalent) → **out of scope** (developers add
  modules in code — IND-01 covers the need).
```
