# Bulk Delete (All Charts / All Indicators) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a trash-can dropdown to the header's `ApplyToAllToolbar` with "Clear all charts" and "Clear all indicators", each behind a confirm dialog.

**Architecture:** Two pure Zustand mutations (`clearAllCells`, `removeAllIndicators`) mirror the existing `setAllTimeframes`/`addIndicatorToAll`, but map over ALL cells of the active workspace (not the visible slice). A small `BulkDeleteMenu` component renders the dropdown + a reused confirm `Dialog`; the charts↔indicators binding lives in a pure `bulkDelete.ts` config so it is unit-testable in the node test env (no DOM).

**Tech Stack:** TypeScript + React, Zustand (`subscribeWithSelector`), Radix (`@radix-ui/react-dropdown-menu`, `@radix-ui/react-dialog`), shadcn UI wrappers, lucide-react, Vitest (node env).

## Global Constraints

- Delete scope = **active workspace only** (mutations map `state.cells` = hot grid; other workspaces untouched).
- Delete targets **all cells** (visible + hidden), unlike the visible-slice apply ops.
- Fixed Volume (`fixed: true`) is never deleted; grid shape/cell count unchanged.
- All display text (menu items, dialog copy, buttons) is **English**.
- Persistence: none added — the existing debounced auto-save picks up state changes.
- Test env is `node` (`tests/**/*.test.ts`); no jsdom/testing-library — do not add them.

---

## File Structure

- Modify `src/renderer/store.ts` — add `clearAllCells` / `removeAllIndicators` mutations + their `AppState` type members; `export` the `AppState` type.
- Modify `src/renderer/components/ui/dialog.tsx` — add & export `DialogDescription`.
- Create `src/renderer/components/bulkDelete.ts` — pure `BulkTarget` type + `BULK_DELETE` config (dialog copy + store-action selector). No React imports (type-only import of `AppState`).
- Create `src/renderer/components/BulkDeleteMenu.tsx` — trash dropdown + confirm dialog, consumes `BULK_DELETE`.
- Modify `src/renderer/components/ApplyToAllToolbar.tsx` — render `<BulkDeleteMenu />`.
- Modify `tests/renderer/store.test.ts` — tests for the two mutations.
- Create `tests/renderer/bulkDelete.test.ts` — routing/copy test for `BULK_DELETE`.

---

### Task 1: Store mutations `clearAllCells` / `removeAllIndicators`

**Files:**
- Modify: `src/renderer/store.ts` (AppState type block ~line 52-58; return block after `removeIndicator` ~line 242)
- Test: `tests/renderer/store.test.ts`

**Interfaces:**
- Consumes: existing `Cell`, `crosshairByCell`, the `fixed` indicator flag.
- Produces:
  - `export type AppState` (now exported for `bulkDelete.ts`).
  - `clearAllCells: () => void` — every cell in the active workspace: `symbol=null`, drop non-fixed indicators (keep Volume); clear all `crosshairByCell`.
  - `removeAllIndicators: () => void` — every cell: drop non-fixed indicators (keep Volume); symbols/timeframes untouched.

- [ ] **Step 1: Write the failing tests**

Add this block inside the top-level `describe('useAppStore grid shape logic', ...)` in `tests/renderer/store.test.ts` (e.g. right after the `describe('clearCell', ...)` block):

```ts
  describe('bulk delete (all cells, active workspace)', () => {
    beforeEach(() => {
      // Two cells, each with fixed Volume + a user-added MA, plus a symbol and a crosshair.
      useAppStore.setState({
        cells: [
          { id: 'b0', symbol: 'AAPL', timeframe: '1d', indicators: [
            { id: 'v0', type: 'volume', params: {}, colors: {}, visible: true, fixed: true },
            { id: 'm0', type: 'ma', params: {}, colors: {}, visible: true }
          ] },
          { id: 'b1', symbol: 'MSFT', timeframe: '1h', indicators: [
            { id: 'v1', type: 'volume', params: {}, colors: {}, visible: true, fixed: true },
            { id: 'm1', type: 'ma', params: {}, colors: {}, visible: true }
          ] }
        ],
        activeCellId: 'b0',
        shape: { rows: 1, cols: 1 } // b1 is hidden — bulk delete must still hit it
      })
      useAppStore.getState().setCrosshair('b0', { price: { open: 1, high: 1, low: 1, close: 1 } })
    })

    it('clearAllCells empties every cell (incl. hidden): null symbol, only fixed Volume kept, crosshairs cleared', () => {
      useAppStore.getState().clearAllCells()
      const { cells, crosshairByCell } = useAppStore.getState()
      for (const c of cells) {
        expect(c.symbol).toBeNull()
        expect(c.indicators.map((i) => i.type)).toEqual(['volume'])
        expect(c.indicators.every((i) => i.fixed)).toBe(true)
      }
      expect(crosshairByCell).toEqual({})
    })

    it('removeAllIndicators strips user indicators from every cell but keeps symbols and Volume', () => {
      useAppStore.getState().removeAllIndicators()
      const { cells } = useAppStore.getState()
      expect(cells[0].symbol).toBe('AAPL')
      expect(cells[1].symbol).toBe('MSFT')
      for (const c of cells) {
        expect(c.indicators.map((i) => i.type)).toEqual(['volume'])
      }
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- store`
Expected: FAIL — `clearAllCells is not a function` / `removeAllIndicators is not a function`.

- [ ] **Step 3: Export the AppState type**

In `src/renderer/store.ts`, change the type declaration:

```ts
export type AppState = {
```

(was `type AppState = {`)

- [ ] **Step 4: Declare the two members in the AppState type block**

In `src/renderer/store.ts`, add these lines right after the `clearCell: (cellId: string) => void` declaration (~line 53):

```ts
  // Bulk delete — mirror of setAllTimeframes/addIndicatorToAll, but act on ALL cells of the active
  // workspace (visible + hidden): "clear all" means all. Fixed Volume is kept (see clearCell).
  clearAllCells: () => void
  removeAllIndicators: () => void
```

- [ ] **Step 5: Implement the two mutations**

In `src/renderer/store.ts`, add right after the `removeIndicator` mutation in the returned object (~line 242, after its closing `})),`):

```ts
  clearAllCells: () => set((state) => ({
    cells: state.cells.map((c) => ({ ...c, symbol: null, indicators: c.indicators.filter((i) => i.fixed) })),
    crosshairByCell: {}
  })),
  removeAllIndicators: () => set((state) => ({
    cells: state.cells.map((c) => ({ ...c, indicators: c.indicators.filter((i) => i.fixed) }))
  })),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- store`
Expected: PASS (all store tests, including the two new ones).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/store.ts tests/renderer/store.test.ts
git commit -m "feat(store): clearAllCells / removeAllIndicators bulk mutations"
```

---

### Task 2: Trash dropdown UI + confirm dialog + routing config

**Files:**
- Modify: `src/renderer/components/ui/dialog.tsx` (add `DialogDescription`)
- Create: `src/renderer/components/bulkDelete.ts`
- Create: `src/renderer/components/BulkDeleteMenu.tsx`
- Modify: `src/renderer/components/ApplyToAllToolbar.tsx`
- Test: `tests/renderer/bulkDelete.test.ts`

**Interfaces:**
- Consumes: `clearAllCells` / `removeAllIndicators` (Task 1), `AppState` type (Task 1), existing `ui/dialog.tsx`, `ui/dropdown-menu.tsx`, `ui/button.tsx`, `ui/tooltip.tsx`.
- Produces:
  - `DialogDescription` export from `ui/dialog.tsx`.
  - `type BulkTarget = 'charts' | 'indicators'` and `BULK_DELETE: Record<BulkTarget, { title: string; description: string; action: (s: Pick<AppState,'clearAllCells'|'removeAllIndicators'>) => () => void }>` from `bulkDelete.ts`.
  - `BulkDeleteMenu` React component.

- [ ] **Step 1: Write the failing routing test**

Create `tests/renderer/bulkDelete.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { BULK_DELETE } from '../../src/renderer/components/bulkDelete'

describe('BULK_DELETE config', () => {
  it('routes charts → clearAllCells and indicators → removeAllIndicators (no swap)', () => {
    const clearAllCells = (): void => {}
    const removeAllIndicators = (): void => {}
    const store = { clearAllCells, removeAllIndicators }
    expect(BULK_DELETE.charts.action(store)).toBe(clearAllCells)
    expect(BULK_DELETE.indicators.action(store)).toBe(removeAllIndicators)
  })

  it('confirm copy names the right nouns and warns it is irreversible', () => {
    expect(BULK_DELETE.charts.title).toBe('Clear all charts?')
    expect(BULK_DELETE.indicators.title).toBe('Clear all indicators?')
    expect(BULK_DELETE.charts.description).toContain('symbol')
    expect(BULK_DELETE.charts.description).toContain("can't be undone")
    expect(BULK_DELETE.indicators.description).toContain('Symbols and volume are kept')
    expect(BULK_DELETE.indicators.description).toContain("can't be undone")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- bulkDelete`
Expected: FAIL — cannot find module `../../src/renderer/components/bulkDelete`.

- [ ] **Step 3: Create the pure config module**

Create `src/renderer/components/bulkDelete.ts`:

```ts
import type { AppState } from '../store'

export type BulkTarget = 'charts' | 'indicators'

// Only the two bulk actions are needed to run a delete — keep the selector param narrow so the
// config is trivially testable with a fake store (no full AppState needed).
type BulkActions = Pick<AppState, 'clearAllCells' | 'removeAllIndicators'>

// Single source of truth for both bulk-delete actions: confirm-dialog copy + which store mutation
// to run. `action` is a pure selector so the charts↔indicators binding is data, not a branch — a
// swap is caught by tests/renderer/bulkDelete.test.ts, not just at runtime.
export const BULK_DELETE: Record<
  BulkTarget,
  { title: string; description: string; action: (s: BulkActions) => () => void }
> = {
  charts: {
    title: 'Clear all charts?',
    description:
      "This removes the symbol and all user-added indicators from every cell in this workspace, including hidden cells. This can't be undone.",
    action: (s) => s.clearAllCells
  },
  indicators: {
    title: 'Clear all indicators?',
    description:
      "This removes all user-added indicators from every cell in this workspace, including hidden cells. Symbols and volume are kept. This can't be undone.",
    action: (s) => s.removeAllIndicators
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- bulkDelete`
Expected: PASS.

- [ ] **Step 5: Add `DialogDescription` to the dialog wrapper**

In `src/renderer/components/ui/dialog.tsx`, add after the `DialogTitle` definition (before the `export {` block):

```tsx
const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName
```

Then add `DialogDescription,` to the `export { ... }` list:

```tsx
export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
}
```

- [ ] **Step 6: Create the `BulkDeleteMenu` component**

Create `src/renderer/components/BulkDeleteMenu.tsx`:

```tsx
import React, { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { useAppStore } from '../store'
import { BULK_DELETE, type BulkTarget } from './bulkDelete'

// Trash dropdown: the "clear all" counterpart to ApplyToAllToolbar's "apply to all". Two items →
// one reused confirm dialog → the store mutation chosen by BULK_DELETE[target].
export function BulkDeleteMenu(): React.JSX.Element {
  const [target, setTarget] = useState<BulkTarget | null>(null)
  const clearAllCells = useAppStore((s) => s.clearAllCells)
  const removeAllIndicators = useAppStore((s) => s.removeAllIndicators)

  const confirm = (): void => {
    if (target) BULK_DELETE[target].action({ clearAllCells, removeAllIndicators })()
    setTarget(null)
  }

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 [&_svg]:size-3.5"
                aria-label="Bulk delete"
              >
                <Trash2 />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Clear all charts or indicators</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => setTarget('charts')}>Clear all charts</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTarget('indicators')}>Clear all indicators</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={target !== null} onOpenChange={(o) => { if (!o) setTarget(null) }}>
        <DialogContent className="p-6">
          <DialogHeader>
            <DialogTitle>{target ? BULK_DELETE[target].title : ''}</DialogTitle>
            <DialogDescription>{target ? BULK_DELETE[target].description : ''}</DialogDescription>
          </DialogHeader>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirm}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
```

- [ ] **Step 7: Render `BulkDeleteMenu` in the toolbar**

In `src/renderer/components/ApplyToAllToolbar.tsx`:

Add the import near the other component imports (after the `TimeframeRow` import line):

```tsx
import { BulkDeleteMenu } from './BulkDeleteMenu'
```

Then render it right after the indicator `Tooltip` block and before the `<Dialog ...>` (i.e. as a sibling inside the outer `<div className="flex items-center gap-2">`):

```tsx
      </Tooltip>
      <BulkDeleteMenu />
      <Dialog open={open} onOpenChange={setOpen}>
```

(The `</Tooltip>` shown is the closing tag of the existing "Add an indicator to all charts" tooltip — insert `<BulkDeleteMenu />` immediately after it.)

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (Confirms `variant="destructive"`/`"secondary"` and `DialogDescription` resolve, and `BULK_DELETE` action typing matches.)

- [ ] **Step 9: Run the full test suite**

Run: `npm test`
Expected: PASS (store + bulkDelete + existing suites).

- [ ] **Step 10: Manual smoke check**

Run: `npm run dev`. In the header, click the trash icon (between the Indicator button and the reload/search cluster). Verify:
- Menu shows "Clear all charts" and "Clear all indicators".
- Each opens a confirm dialog with the matching title/description; **Delete** is red.
- "Clear all charts" → every cell (expand the grid to confirm hidden cells too) goes blank, Volume stays.
- "Clear all indicators" → symbols stay, only user indicators are removed.
- Cancel / clicking outside / the ✕ closes with no change.

- [ ] **Step 11: Commit**

```bash
git add src/renderer/components/ui/dialog.tsx src/renderer/components/bulkDelete.ts src/renderer/components/BulkDeleteMenu.tsx src/renderer/components/ApplyToAllToolbar.tsx tests/renderer/bulkDelete.test.ts
git commit -m "feat(toolbar): bulk-delete dropdown for all charts / all indicators"
```

---

## Self-Review

**Spec coverage:**
- Placement in `ApplyToAllToolbar` (trash dropdown) → Task 2 Steps 6-7. ✓
- Scope = active workspace, all cells, keep Volume → Task 1 (mutations map `state.cells`). ✓
- Confirm dialog with English copy + destructive Delete → Task 2 Steps 3, 6. ✓
- `DialogDescription` added (Codex P2) → Task 2 Step 5. ✓
- Store mutation tests → Task 1 Step 1. ✓
- Routing/no-swap + copy test (Codex P2 test gap) → Task 2 Step 1. ✓
- Persistence: no wiring (auto-save) → nothing to do, per Global Constraints. ✓

**Placeholder scan:** none — all code and commands are literal.

**Type consistency:** `clearAllCells`/`removeAllIndicators` names identical across store type, store impl, `bulkDelete.ts` (`Pick<AppState,...>`), test fake store, and `BulkDeleteMenu`. `BulkTarget` used consistently. `DialogDescription` defined before use.
