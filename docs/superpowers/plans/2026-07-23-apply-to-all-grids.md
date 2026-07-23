# Apply timeframe / indicator to all grids — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a header toolbar that applies one timeframe, or one pre-configured indicator, to every visible grid cell at once.

**Architecture:** Two new pure Zustand store actions (`setAllTimeframes`, `addIndicatorToAll`) mutate the visible slice of `cells`; existing reactive rendering, per-cell capability gating, and debounced workspace persistence carry the rest. UI is a small `ApplyToAllToolbar` reusing a generalized `TimeframeRow` and a newly-extracted `ParamFields` (shared with `IndicatorEditForm`).

**Tech Stack:** TypeScript, React, Zustand, Radix UI (shadcn), Vitest.

## Global Constraints

- Pin Vite at `^7` (do not touch build config in this feature).
- SQLite = OHLCV cache / JSON = user preferences — this feature touches neither; it only mutates in-memory `cells`, persisted via the existing `useWorkspaceSync` debounced save.
- Indicator math stays in hand-written TS modules under `src/renderer/indicators/` — unchanged here.
- Colors come from the fixed 6-hue `PALETTE` in `store.ts`, round-robin by add order — reuse, do not introduce a new color scheme.

---

## File Structure

- `src/renderer/store.ts` (modify) — add `makeInstance` helper, `setAllTimeframes`, `addIndicatorToAll`; refactor `addIndicator` onto `makeInstance`.
- `src/renderer/components/ParamFields.tsx` (create) — pure number/select/source field renderer extracted from `IndicatorEditForm`.
- `src/renderer/components/IndicatorEditForm.tsx` (modify) — use `ParamFields`; keep color handling local.
- `src/renderer/components/TimeframeRow.tsx` (modify) — make `value` optional, add `label` prop.
- `src/renderer/components/ApplyToAllToolbar.tsx` (create) — the toolbar (TF dropdown + indicator dialog).
- `src/renderer/App.tsx` (modify) — mount `ApplyToAllToolbar` in the header.
- `tests/renderer/store.test.ts` (modify) — tests for the two new actions.

---

## Task 1: Store actions (`setAllTimeframes`, `addIndicatorToAll`) + `makeInstance` refactor

**Files:**
- Modify: `src/renderer/store.ts`
- Test: `tests/renderer/store.test.ts`

**Interfaces:**
- Consumes: existing `cellCount(shape)` from `@shared/workspace` (already imported), `registry`, `PALETTE`, module-level `nextId`.
- Produces:
  - `setAllTimeframes(tf: Timeframe): void` — sets `timeframe` on cells `0..cellCount(shape)-1`.
  - `addIndicatorToAll(type: string, params: Params): void` — adds one instance to each visible cell unless a same-`type` + shallow-equal-`params` instance already exists there; no-op for unknown `type`.
  - Internal `makeInstance(type: string, params: Params, base: number): IndicatorInstance | null` (not on the store; module-scoped helper).

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to `tests/renderer/store.test.ts`, inside the top-level `describe('useAppStore grid shape logic', ...)` (after the `clearCell` block):

```ts
  describe('apply-to-all actions', () => {
    it('setAllTimeframes updates only visible cells, leaving hidden cells untouched', () => {
      useAppStore.getState().setShape({ rows: 2, cols: 2 }) // 4 cells created
      useAppStore.getState().setShape({ rows: 1, cols: 1 }) // shrink: cells 1..3 now hidden but retained
      const hiddenBefore = useAppStore.getState().cells[1].timeframe

      useAppStore.getState().setAllTimeframes('1h')

      const cells = useAppStore.getState().cells
      expect(cells[0].timeframe).toBe('1h')       // visible → updated
      expect(cells[1].timeframe).toBe(hiddenBefore) // hidden → unchanged
    })

    it('addIndicatorToAll adds to every visible cell but skips a same-type+same-params duplicate', () => {
      useAppStore.getState().setShape({ rows: 1, cols: 2 }) // 2 visible cells
      // cell 0 already has MA with the exact default params we are about to apply
      const c0 = useAppStore.getState().cells[0].id
      useAppStore.getState().addIndicator('ma', c0) // default params { kind:'SMA', period:20, source:'close' }

      useAppStore.getState().addIndicatorToAll('ma', { kind: 'SMA', period: 20, source: 'close' })

      const [cell0, cell1] = useAppStore.getState().cells
      expect(cell0.indicators.filter((i) => i.type === 'ma')).toHaveLength(1) // skipped (dup)
      expect(cell1.indicators.filter((i) => i.type === 'ma')).toHaveLength(1) // added
    })

    it('addIndicatorToAll adds when params differ from an existing same-type instance', () => {
      useAppStore.getState().setShape({ rows: 1, cols: 1 })
      const c0 = useAppStore.getState().cells[0].id
      useAppStore.getState().addIndicator('ma', c0) // period 20

      useAppStore.getState().addIndicatorToAll('ma', { kind: 'SMA', period: 50, source: 'close' })

      const cell0 = useAppStore.getState().cells[0]
      expect(cell0.indicators.filter((i) => i.type === 'ma')).toHaveLength(2) // different params → added
    })

    it('addIndicatorToAll does not touch hidden cells and mints unique ids', () => {
      useAppStore.getState().setShape({ rows: 2, cols: 2 })
      useAppStore.getState().setShape({ rows: 1, cols: 1 }) // 1 visible, 3 hidden

      useAppStore.getState().addIndicatorToAll('rsi', { period: 14, overbought: 70, oversold: 30 })

      const cells = useAppStore.getState().cells
      expect(cells[0].indicators.some((i) => i.type === 'rsi')).toBe(true)
      for (const c of cells.slice(1)) expect(c.indicators.some((i) => i.type === 'rsi')).toBe(false)
      const allIds = cells.flatMap((c) => c.indicators.map((i) => i.id))
      expect(new Set(allIds).size).toBe(allIds.length)
    })

    it('addIndicatorToAll is a no-op for an unknown indicator type', () => {
      useAppStore.getState().setShape({ rows: 1, cols: 1 })
      const before = useAppStore.getState().cells[0].indicators.length
      useAppStore.getState().addIndicatorToAll('nope', {})
      expect(useAppStore.getState().cells[0].indicators.length).toBe(before)
    })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/renderer/store.test.ts -t "apply-to-all"`
Expected: FAIL — `setAllTimeframes is not a function` / `addIndicatorToAll is not a function`.

- [ ] **Step 3: Add the `makeInstance` helper and refactor `addIndicator`**

In `src/renderer/store.ts`, inside the `create(...)` factory body (alongside `snapshotActive` / `remintLayout` / `activate`, before the `return {`), add:

```ts
  // Build one IndicatorInstance with palette-assigned colors. Extracted from addIndicator so the
  // bulk addIndicatorToAll shares the exact color/id logic. `base` = the target cell's current
  // indicator count (palette is round-robin by add order). Returns null for an unknown type.
  const makeInstance = (type: string, params: Params, base: number): IndicatorInstance | null => {
    const module = registry[type]
    if (!module) return null
    const colors: Record<string, string> = {}
    const lineCount = module.outputs.filter((o) => o.kind === 'line').length
    const hasBand = module.outputs.some((o) => o.kind === 'band')
    if (lineCount > 1 && !hasBand) {
      let n = 0
      for (const output of module.outputs) {
        colors[output.key] =
          output.kind === 'line' ? PALETTE[(base + n++) % PALETTE.length] : PALETTE[base % PALETTE.length]
      }
    } else {
      const color = PALETTE[base % PALETTE.length]
      for (const output of module.outputs) colors[output.key] = color
    }
    return { id: String(nextId++), type, params: { ...params }, colors, visible: true }
  }
  // Shallow params equality — same type ⇒ same key set, so key-count + per-key value compare suffices.
  const sameParams = (a: Params, b: Params): boolean => {
    const ak = Object.keys(a)
    return ak.length === Object.keys(b).length && ak.every((k) => a[k] === b[k])
  }
```

Then replace the existing `addIndicator` action (the whole `addIndicator: (type, cellId) => { ... }` block, currently `store.ts:158-194`) with:

```ts
  addIndicator: (type, cellId) => {
    const targetId = cellId ?? get().activeCellId
    const cell = get().cells.find((c) => c.id === targetId)
    if (!cell) return
    const module = registry[type]
    if (!module) return
    const instance = makeInstance(type, { ...module.defaults }, cell.indicators.length)!
    set((state) => ({
      cells: state.cells.map((c) =>
        c.id === targetId ? { ...c, indicators: [...c.indicators, instance] } : c
      )
    }))
  },
```

- [ ] **Step 4: Add the two new actions**

In `src/renderer/store.ts`, add these actions in the returned object right after `setCellTimeframe` (`store.ts:145-147`):

```ts
  setAllTimeframes: (tf) => set((state) => {
    const visible = cellCount(state.shape)
    return { cells: state.cells.map((c, i) => (i < visible ? { ...c, timeframe: tf } : c)) }
  }),
  addIndicatorToAll: (type, params) => {
    if (!registry[type]) return
    set((state) => {
      const visible = cellCount(state.shape)
      return {
        cells: state.cells.map((c, i) => {
          if (i >= visible) return c
          if (c.indicators.some((ind) => ind.type === type && sameParams(ind.params, params))) return c
          return { ...c, indicators: [...c.indicators, makeInstance(type, params, c.indicators.length)!] }
        })
      }
    })
  },
```

- [ ] **Step 5: Declare the new actions on the `AppState` type**

In `src/renderer/store.ts`, in the `type AppState = { ... }` block, add after the `setCellTimeframe` declaration (`store.ts:40`):

```ts
  // Bulk (apply-to-all) variants — act on the visible slice cells[0..cellCount(shape)-1].
  setAllTimeframes: (tf: Timeframe) => void
  addIndicatorToAll: (type: string, params: Params) => void
```

(`Timeframe` and `Params` are already imported at `store.ts:5`.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/renderer/store.test.ts`
Expected: PASS — the new `apply-to-all` block plus all pre-existing store tests (the `addIndicator` refactor must not regress them).

- [ ] **Step 7: Typecheck**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/store.ts tests/renderer/store.test.ts
git commit -m "feat(store): setAllTimeframes + addIndicatorToAll (shared makeInstance)"
```

---

## Task 2: Extract `ParamFields` and refactor `IndicatorEditForm`

**Files:**
- Create: `src/renderer/components/ParamFields.tsx`
- Modify: `src/renderer/components/IndicatorEditForm.tsx`

**Interfaces:**
- Produces: `ParamFields({ type: string; params: Params; onChange: (patch: Params) => void; onCommit?: () => void })` — renders a fragment of one row per non-color field. Enter in a number field fires `onCommit`.
- Consumes: `registry`, `FieldDesc`, `Source` from indicators; UI `Input` / `ToggleGroup`.

- [ ] **Step 1: Create `ParamFields.tsx`**

Create `src/renderer/components/ParamFields.tsx`:

```tsx
import React from 'react'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { registry } from '@/indicators/registry'
import type { FieldDesc, Source } from '@/indicators/types'
import type { Params } from '@shared/types'

const SOURCES: Source[] = ['close', 'open', 'high', 'low', 'hl2', 'hlc3']

// Renders the number/select/source fields for registry[type].params as a fragment of rows.
// Color is intentionally NOT rendered here — it lives in instance.colors and is written via a
// separate path (setColor); callers that edit color render it themselves (see IndicatorEditForm).
// onCommit fires on Enter inside a number field so a caller can close a dialog or apply.
export function ParamFields({
  type,
  params,
  onChange,
  onCommit
}: {
  type: string
  params: Params
  onChange: (patch: Params) => void
  onCommit?: () => void
}): React.JSX.Element | null {
  const module = registry[type]
  if (!module) return null

  const renderField = (field: FieldDesc): React.JSX.Element | null => {
    switch (field.kind) {
      case 'number': {
        const value = Number(params[field.key])
        return (
          <Input
            type="number"
            min={field.min}
            step={field.step}
            value={Number.isNaN(value) ? '' : value}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onCommit?.()
              }
            }}
            onChange={(e) => {
              const raw = e.target.value
              if (raw === '') return
              const parsed = Number(raw)
              if (Number.isNaN(parsed)) return
              const clamped = field.min !== undefined ? Math.max(field.min, parsed) : parsed
              onChange({ [field.key]: clamped })
            }}
          />
        )
      }
      case 'select':
        return (
          <ToggleGroup
            type="single"
            value={String(params[field.key])}
            onValueChange={(v) => { if (v) onChange({ [field.key]: v }) }}
          >
            {field.options.map((opt) => (
              <ToggleGroupItem key={opt} value={opt} size="sm">{opt}</ToggleGroupItem>
            ))}
          </ToggleGroup>
        )
      case 'source':
        return (
          <ToggleGroup
            type="single"
            value={String(params[field.key])}
            onValueChange={(v) => { if (v) onChange({ [field.key]: v }) }}
          >
            {SOURCES.map((src) => (
              <ToggleGroupItem key={src} value={src} size="sm">{src}</ToggleGroupItem>
            ))}
          </ToggleGroup>
        )
      case 'color':
        return null // handled by the caller
    }
  }

  return (
    <>
      {module.params.map((field) => {
        const control = renderField(field)
        if (!control) return null
        return (
          <div key={field.key} className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">{field.label}</span>
            {control}
          </div>
        )
      })}
    </>
  )
}
```

- [ ] **Step 2: Refactor `IndicatorEditForm.tsx` to use `ParamFields`**

Replace the entire contents of `src/renderer/components/IndicatorEditForm.tsx` with:

```tsx
import React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAppStore } from '@/store'
import { registry } from '@/indicators/registry'
import { ParamFields } from './ParamFields'

// D-25: renders purely from registry[type].params. ParamFields covers number/select/source;
// color stays here because it writes to instance.colors via setColor (fanned across every output),
// not to params. Color is the last field in every module's params array, so appending its row after
// ParamFields preserves the original top-to-bottom field order.
export function IndicatorEditForm({
  instanceId,
  open,
  onOpenChange
}: {
  instanceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element | null {
  const instance = useAppStore((s) => s.cells.flatMap((c) => c.indicators).find((i) => i.id === instanceId))
  const updateParams = useAppStore((s) => s.updateParams)
  const setColor = useAppStore((s) => s.setColor)

  if (!instance) return null
  const module = registry[instance.type]
  if (!module) return null

  const colorField = module.params.find((f) => f.kind === 'color')
  const firstOutputKey = module.outputs[0]?.key
  const colorValue = firstOutputKey ? instance.colors[firstOutputKey] ?? '#ffffff' : '#ffffff'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-6">
        <DialogHeader>
          <DialogTitle>{module.label(instance.params)}</DialogTitle>
        </DialogHeader>
        <div className="mt-4 flex flex-col gap-4">
          <ParamFields
            type={instance.type}
            params={instance.params}
            onChange={(patch) => updateParams(instance.id, patch)}
            onCommit={() => onOpenChange(false)}
          />
          {colorField && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">{colorField.label}</span>
              <input
                type="color"
                value={colorValue}
                onChange={(e) => {
                  for (const output of module.outputs) setColor(instance.id, output.key, e.target.value)
                }}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full test suite (guards against a broken refactor)**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ParamFields.tsx src/renderer/components/IndicatorEditForm.tsx
git commit -m "refactor(indicators): extract ParamFields from IndicatorEditForm"
```

---

## Task 3: Generalize `TimeframeRow` (optional `value`, new `label`)

**Files:**
- Modify: `src/renderer/components/TimeframeRow.tsx`

**Interfaces:**
- Produces: `TimeframeRow({ value?: Timeframe; onChange: (tf: Timeframe) => void; label?: string })`. When `value` is omitted no menu item is highlighted; the trigger shows `label` (or `TF_LABELS[value]` when `label` is absent). Gating (disable requires-plan / rate-limited items) is unchanged.
- Consumes: existing `TF_LABELS`, capability query.

- [ ] **Step 1: Update the props signature**

In `src/renderer/components/TimeframeRow.tsx`, change the function signature (`TimeframeRow.tsx:37-43`) to:

```tsx
export function TimeframeRow({
  value,
  onChange,
  label
}: {
  value?: Timeframe
  onChange: (tf: Timeframe) => void
  label?: string
}): React.JSX.Element {
```

- [ ] **Step 2: Update the trigger label**

In the same file, change the trigger button content (`TimeframeRow.tsx:51-54`) from `{TF_LABELS[value]}` to:

```tsx
        <Button variant="secondary" size="sm" className="h-6 gap-1 px-2 text-xs [&_svg]:size-3">
          {label ?? (value ? TF_LABELS[value] : '')}
          <ChevronDown />
        </Button>
```

(The `tf === value` highlight inside the menu already tolerates an `undefined` `value` — nothing is highlighted, which is correct for the bulk trigger.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: no errors (existing per-cell caller in `GridHost.tsx:221` passes `value`, still valid).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/TimeframeRow.tsx
git commit -m "refactor(timeframe): optional value + label prop for reuse"
```

---

## Task 4: `ApplyToAllToolbar` component + mount in header

**Files:**
- Create: `src/renderer/components/ApplyToAllToolbar.tsx`
- Modify: `src/renderer/App.tsx`

**Interfaces:**
- Consumes: `useAppStore` (`setAllTimeframes`, `addIndicatorToAll`), `TimeframeRow`, `ParamFields`, `registry`, `Params`.
- Produces: `ApplyToAllToolbar()` default-styled toolbar segment for the header.

- [ ] **Step 1: Create `ApplyToAllToolbar.tsx`**

Create `src/renderer/components/ApplyToAllToolbar.tsx`:

```tsx
import React, { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { TimeframeRow } from './TimeframeRow'
import { ParamFields } from './ParamFields'
import { registry } from '../indicators/registry'
import { useAppStore } from '../store'
import type { Params } from '@shared/types'

// Volume is fixed/non-addable (D-34) — mirror AddIndicatorMenu's filter.
const ADDABLE = Object.values(registry).filter((m) => m.type !== 'volume')

// Header toolbar: apply one timeframe, or one pre-configured indicator, to every visible grid cell.
export function ApplyToAllToolbar(): React.JSX.Element {
  const setAllTimeframes = useAppStore((s) => s.setAllTimeframes)
  const addIndicatorToAll = useAppStore((s) => s.addIndicatorToAll)
  const [open, setOpen] = useState(false)
  const [type, setType] = useState(ADDABLE[0].type)
  const [params, setParams] = useState<Params>({ ...ADDABLE[0].defaults })

  // Switching indicator type resets params to that module's defaults (fields differ per module).
  const selectType = (t: string): void => {
    setType(t)
    setParams({ ...registry[t].defaults })
  }
  const apply = (): void => {
    addIndicatorToAll(type, params)
    setOpen(false)
  }

  return (
    <div className="flex items-center gap-2">
      <TimeframeRow label="TF (all)" onChange={setAllTimeframes} />
      <Button
        size="sm"
        className="h-6 gap-1 px-2 text-xs [&_svg]:size-3"
        onClick={() => setOpen(true)}
      >
        <Plus />
        Indicator (all)
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="p-6">
          <DialogHeader>
            <DialogTitle>Apply indicator to all charts</DialogTitle>
          </DialogHeader>
          <div className="mt-4 flex flex-wrap gap-2">
            {ADDABLE.map((m) => (
              <Button
                key={m.type}
                variant={m.type === type ? 'default' : 'secondary'}
                size="sm"
                onClick={() => selectType(m.type)}
              >
                {m.type.toUpperCase()}
              </Button>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-4">
            <ParamFields
              type={type}
              params={params}
              onChange={(patch) => setParams((p) => ({ ...p, ...patch }))}
              onCommit={apply}
            />
          </div>
          <div className="mt-6 flex justify-end">
            <Button onClick={apply}>Apply to all</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 2: Mount it in the header**

In `src/renderer/App.tsx`, add the import near the other component imports (after the `GridShapePicker` import, `App.tsx:8`):

```tsx
import { ApplyToAllToolbar } from './components/ApplyToAllToolbar'
```

Then, in the header JSX, insert the toolbar right after `<GridShapePicker />` (`App.tsx:127`):

```tsx
          <GridShapePicker />
          <ApplyToAllToolbar />
          <WorkspaceSwitcher />
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification in the app**

Run: `npm run dev`
Verify:
1. Search two symbols into a 1x2 grid.
2. Click **TF (all)** → pick `1h` → both charts switch to 1h.
3. Click **Indicator (all)** → select `MA`, set Period `50` → **Apply to all** → both charts show an MA(50); the dialog closes.
4. Click **Indicator (all)** again → **Apply to all** with the same MA(50) → no duplicate MA(50) appears on either chart.
5. `volume` is absent from the indicator picker.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ApplyToAllToolbar.tsx src/renderer/App.tsx
git commit -m "feat(toolbar): apply timeframe/indicator to all visible grids"
```

---

## Self-Review Notes

- **Spec coverage:** TF-all → Task 1 (`setAllTimeframes`) + Task 4 UI. Indicator-all with pre-config + dedup → Task 1 (`addIndicatorToAll`, `sameParams`) + Task 4 dialog. `ParamFields` extraction → Task 2. `TimeframeRow` generalization + static label (mixed-tf Open Q) → Task 3/4. Volume exclusion → Task 4 `ADDABLE`. Type-change resets params → Task 4 `selectType`. gating unchanged → relies on existing `useCellCapabilityGating`. No-toast (YAGNI) → nothing built. All covered.
- **No placeholders:** every code step is complete and runnable.
- **Type consistency:** `makeInstance`/`sameParams`/`setAllTimeframes`/`addIndicatorToAll` signatures match across Task 1 definitions and Task 4 usage; `ParamFields` props identical in Tasks 2 and 4; `TimeframeRow` `label`/optional `value` consistent in Tasks 3 and 4.
