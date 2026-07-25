# Keyboard Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add keyboard shortcuts to the main window for refresh, favorite-toggle, and grid-cell copy/cut/paste/delete, operating on the active (selected) cell.

**Architecture:** A single `keydown` listener lives in `App` via a thin hook `useGridShortcuts(reload)`. All decision logic sits in a pure, DOM-free function `handleGridShortcut(event, deps)` so it can be unit-tested in the existing `node` Vitest environment. The favorite-toggle logic (currently duplicated between `FavoriteStar` and `ChartContextMenu`) is extracted into a shared `toggleWatchlist(symbol, queryClient)` helper that both call, plus the new shortcut.

**Tech Stack:** TypeScript + React, Zustand (`useAppStore`), TanStack Query (`useQueryClient`, `qk`), Vitest (`node` env).

## Global Constraints

- Tech stack: TypeScript + React only. No new dependencies (no hotkey library).
- Scope: **main window (`App`) only** — do not touch `ChartWindow` or `CompanyWindow`.
- Tests run under Vitest `environment: 'node'` (`vitest.config.ts`) with `tests/renderer/setup.ts` stubbing only `window` — **no jsdom / no real DOM** available in tests.
- Test glob: `tests/**/*.test.ts`. Path aliases: `@` → `src/renderer`, `@shared` → `src/shared`.
- Follow existing patterns: profile name/exchange come from the query cache via `qk.profile(symbol)` (no fetch); watched? = `selectActiveItems(state).some((w) => w.symbol === symbol)`.

---

### Task 1: Extract shared `toggleWatchlist` helper and rewire the two duplicate sites

**Files:**
- Create: `src/renderer/lib/watchlist.ts`
- Test: `tests/renderer/watchlist.test.ts`
- Modify: `src/renderer/components/ChartContextMenu.tsx` (remove local `toggleWatchlist`, call shared)
- Modify: `src/renderer/components/GridHost.tsx:177-209` (`FavoriteStar` onClick → shared helper)

**Interfaces:**
- Consumes: `useAppStore` + `selectActiveItems` from `@/store`; `qk` from `@/api`; `SymbolResult` from `@shared/types`.
- Produces: `toggleWatchlist(symbol: string, queryClient: QueryClient): void` — used by Task 3.

> Note (deviation from spec §付随改善): `SearchBar.tsx` is intentionally **not** folded into this helper. Its add path (`SearchBar.tsx:44`) is add-only with metadata already in hand from the search result — it does not do the profile-cache fallback and is keyed per-result, not the active cell. Merging it would add indirection, not remove duplication. The real duplicate pair is `FavoriteStar` ↔ `ChartContextMenu`.

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/watchlist.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { toggleWatchlist } from '../../src/renderer/lib/watchlist'
import { useAppStore, selectActiveItems } from '../../src/renderer/store'
import { qk } from '../../src/renderer/api'

// Minimal fake QueryClient — only getQueryData is used by toggleWatchlist.
function fakeQueryClient(profiles: Record<string, { name: string; exchange: string }>) {
  return {
    getQueryData: (key: readonly unknown[]) => {
      // qk.profile(sym) shape: match on the symbol appearing in the key
      const sym = key[key.length - 1] as string
      return profiles[sym]
    }
  } as any
}

describe('toggleWatchlist', () => {
  beforeEach(() => {
    const s = useAppStore.getState()
    // clear the active workspace's items
    useAppStore.setState({
      workspaces: s.workspaces.map((w) =>
        w.name === s.activeWorkspace ? { ...w, items: [] } : w
      )
    })
  })

  it('adds with profile name/exchange from the query cache when not watched', () => {
    const qc = fakeQueryClient({ AAPL: { name: 'Apple Inc.', exchange: 'NASDAQ' } })
    toggleWatchlist('AAPL', qc)
    const items = selectActiveItems(useAppStore.getState())
    expect(items).toContainEqual({ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' })
  })

  it('falls back to symbol/empty exchange when profile not cached', () => {
    const qc = fakeQueryClient({})
    toggleWatchlist('TSLA', qc)
    const items = selectActiveItems(useAppStore.getState())
    expect(items).toContainEqual({ symbol: 'TSLA', name: 'TSLA', exchange: '' })
  })

  it('removes when already watched', () => {
    const qc = fakeQueryClient({})
    toggleWatchlist('TSLA', qc) // add
    toggleWatchlist('TSLA', qc) // remove
    const items = selectActiveItems(useAppStore.getState())
    expect(items.some((i) => i.symbol === 'TSLA')).toBe(false)
  })

  // Guards against key-shape drift: the helper must read the same cache key SymbolLabel writes.
  it('reads the profile under qk.profile(symbol)', () => {
    expect(qk.profile('AAPL')[qk.profile('AAPL').length - 1]).toBe('AAPL')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/watchlist.test.ts`
Expected: FAIL — `Cannot find module '.../lib/watchlist'` (or `toggleWatchlist is not a function`).

- [ ] **Step 3: Create the shared helper**

Create `src/renderer/lib/watchlist.ts`:

```ts
import type { QueryClient } from '@tanstack/react-query'
import { qk } from '@/api'
import { useAppStore, selectActiveItems } from '@/store'
import type { SymbolResult } from '@shared/types'

// Single source of truth for "toggle this symbol in the active workspace's watchlist".
// Shared by FavoriteStar, ChartContextMenu, and the keyboard shortcut so all three stay in sync.
// Profile name/exchange are read from the query cache (SymbolLabel already populates it) — no fetch.
export function toggleWatchlist(symbol: string, queryClient: QueryClient): void {
  const state = useAppStore.getState()
  const watched = selectActiveItems(state).some((w) => w.symbol === symbol)
  if (watched) {
    state.removeFromWatchlist(symbol)
  } else {
    const p = queryClient.getQueryData<SymbolResult>(qk.profile(symbol))
    state.addToWatchlist({ symbol, name: p?.name ?? symbol, exchange: p?.exchange ?? '' })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/watchlist.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 5: Rewire `ChartContextMenu.tsx` to the shared helper**

In `src/renderer/components/ChartContextMenu.tsx`:

Add the import (top, with the other `@/` imports):

```ts
import { toggleWatchlist } from '@/lib/watchlist'
```

Delete the local `toggleWatchlist` block (lines 29-39) **and** the now-unused `addToWatchlist` / `removeFromWatchlist` selectors (lines 22-23). Keep `watched` (used for the label) and `queryClient`.

Change the menu item (was line 51) to call the shared helper:

```tsx
<ContextMenuItem onSelect={() => symbol && toggleWatchlist(symbol, queryClient)}>
  {watched ? 'Remove from watchlist' : 'Add to watchlist'}
</ContextMenuItem>
```

- [ ] **Step 6: Rewire `FavoriteStar` in `GridHost.tsx` to the shared helper**

In `src/renderer/components/GridHost.tsx`, add imports if missing:

```ts
import { useQueryClient } from '@tanstack/react-query'
import { toggleWatchlist } from '@/lib/watchlist'
```

Rewrite `FavoriteStar` (lines 177-209). Keep the reactive `watched` selector for the icon; drop `addToWatchlist`, `removeFromWatchlist`, and `useProfile` (only used for the old add path); add `useQueryClient`:

```tsx
function FavoriteStar({ symbol }: { symbol: string }): React.JSX.Element {
  const watched = useAppStore((s) => selectActiveItems(s).some((w) => w.symbol === symbol))
  const queryClient = useQueryClient()

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            toggleWatchlist(symbol, queryClient)
          }}
          aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
          className={cn(
            'shrink-0 cursor-pointer self-center',
            watched ? 'text-primary hover:text-muted-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Star className={cn('size-4', watched && 'fill-current')} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{watched ? 'Remove from watchlist' : 'Add to watchlist'}</TooltipContent>
    </Tooltip>
  )
}
```

If `useProfile` is now unused anywhere in `GridHost.tsx`, remove its import; if it's still used by other components in the file, leave the import.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors (in particular, no "unused variable" from removed selectors — remove any leftover unused imports).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/lib/watchlist.ts tests/renderer/watchlist.test.ts src/renderer/components/ChartContextMenu.tsx src/renderer/components/GridHost.tsx
git commit -m "refactor(watchlist): extract shared toggleWatchlist helper"
```

---

### Task 2: Pure `handleGridShortcut` decision function

**Files:**
- Create: `src/renderer/lib/gridShortcuts.ts`
- Test: `tests/renderer/gridShortcuts.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (pure, dependency-injected).
- Produces:
  - `ShortcutEvent` — `{ key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; repeat: boolean; target: unknown }`
  - `ShortcutDeps` — `{ reload: () => void; copyCell: (id: string) => void; cutCell: (id: string) => void; pasteCell: (id: string) => void; clearCell: (id: string) => void; toggleWatchlist: (symbol: string) => void; getActiveCellId: () => string; getActiveSymbol: () => string | null; hasSelection: () => boolean }`
  - `handleGridShortcut(e: ShortcutEvent, deps: ShortcutDeps): boolean` — returns `true` when it handled the event (caller then calls `preventDefault`).

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/gridShortcuts.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleGridShortcut, type ShortcutDeps, type ShortcutEvent } from '../../src/renderer/lib/gridShortcuts'

function makeDeps(overrides: Partial<ShortcutDeps> = {}): ShortcutDeps {
  return {
    reload: vi.fn(),
    copyCell: vi.fn(),
    cutCell: vi.fn(),
    pasteCell: vi.fn(),
    clearCell: vi.fn(),
    toggleWatchlist: vi.fn(),
    getActiveCellId: () => 'cell-1',
    getActiveSymbol: () => 'AAPL',
    hasSelection: () => false,
    ...overrides
  }
}

function ev(over: Partial<ShortcutEvent>): ShortcutEvent {
  return { key: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, repeat: false, target: { tagName: 'DIV' }, ...over }
}

describe('handleGridShortcut', () => {
  let deps: ShortcutDeps
  beforeEach(() => { deps = makeDeps() })

  it('Ctrl+R triggers reload and is handled', () => {
    expect(handleGridShortcut(ev({ key: 'r', ctrlKey: true }), deps)).toBe(true)
    expect(deps.reload).toHaveBeenCalledTimes(1)
  })

  it('F5 (no modifiers) triggers reload and is handled', () => {
    expect(handleGridShortcut(ev({ key: 'F5' }), deps)).toBe(true)
    expect(deps.reload).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+D toggles watchlist for the active symbol', () => {
    expect(handleGridShortcut(ev({ key: 'd', ctrlKey: true }), deps)).toBe(true)
    expect(deps.toggleWatchlist).toHaveBeenCalledWith('AAPL')
  })

  it('Ctrl+D with no active symbol is swallowed but toggles nothing', () => {
    deps = makeDeps({ getActiveSymbol: () => null })
    expect(handleGridShortcut(ev({ key: 'd', ctrlKey: true }), deps)).toBe(true)
    expect(deps.toggleWatchlist).not.toHaveBeenCalled()
  })

  it('Ctrl+C copies the active cell when no text is selected', () => {
    expect(handleGridShortcut(ev({ key: 'c', ctrlKey: true }), deps)).toBe(true)
    expect(deps.copyCell).toHaveBeenCalledWith('cell-1')
  })

  it('Ctrl+C falls through (returns false, no copy) when text is selected', () => {
    deps = makeDeps({ hasSelection: () => true })
    expect(handleGridShortcut(ev({ key: 'c', ctrlKey: true }), deps)).toBe(false)
    expect(deps.copyCell).not.toHaveBeenCalled()
  })

  it('Ctrl+X cuts, Ctrl+V pastes', () => {
    expect(handleGridShortcut(ev({ key: 'x', ctrlKey: true }), deps)).toBe(true)
    expect(deps.cutCell).toHaveBeenCalledWith('cell-1')
    expect(handleGridShortcut(ev({ key: 'v', ctrlKey: true }), deps)).toBe(true)
    expect(deps.pasteCell).toHaveBeenCalledWith('cell-1')
  })

  it('Delete clears the active cell', () => {
    expect(handleGridShortcut(ev({ key: 'Delete' }), deps)).toBe(true)
    expect(deps.clearCell).toHaveBeenCalledWith('cell-1')
  })

  it('ignores shortcuts when target is a form field', () => {
    const r = handleGridShortcut(ev({ key: 'c', ctrlKey: true, target: { tagName: 'INPUT' } }), deps)
    expect(r).toBe(false)
    expect(deps.copyCell).not.toHaveBeenCalled()
  })

  it('ignores shortcuts inside a dialog/menu (role match via closest)', () => {
    const target = { tagName: 'BUTTON', closest: (sel: string) => (sel.includes('dialog') ? {} : null) }
    expect(handleGridShortcut(ev({ key: 'Delete', target }), deps)).toBe(false)
    expect(deps.clearCell).not.toHaveBeenCalled()
  })

  it('ignores extra-modifier combos (Ctrl+Shift+C)', () => {
    expect(handleGridShortcut(ev({ key: 'c', ctrlKey: true, shiftKey: true }), deps)).toBe(false)
    expect(deps.copyCell).not.toHaveBeenCalled()
  })

  it('ignores key-repeat for mutating shortcuts (Ctrl+D held)', () => {
    expect(handleGridShortcut(ev({ key: 'd', ctrlKey: true, repeat: true }), deps)).toBe(false)
    expect(deps.toggleWatchlist).not.toHaveBeenCalled()
  })

  it('still handles repeated Ctrl+R (reload is inFlight-guarded upstream)', () => {
    expect(handleGridShortcut(ev({ key: 'r', ctrlKey: true, repeat: true }), deps)).toBe(true)
    expect(deps.reload).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/gridShortcuts.test.ts`
Expected: FAIL — `Cannot find module '.../lib/gridShortcuts'`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/lib/gridShortcuts.ts`:

```ts
// Pure, DOM-free shortcut decision logic. The hook (useGridShortcuts) is a thin adapter that
// builds `deps` from the store/query-client and calls preventDefault when this returns true.
// Kept free of real DOM so it runs in the `node` Vitest environment.

export interface ShortcutEvent {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  repeat: boolean
  target: unknown
}

export interface ShortcutDeps {
  reload: () => void
  copyCell: (id: string) => void
  cutCell: (id: string) => void
  pasteCell: (id: string) => void
  clearCell: (id: string) => void
  toggleWatchlist: (symbol: string) => void
  getActiveCellId: () => string
  getActiveSymbol: () => string | null
  hasSelection: () => boolean
}

// True when the event originated from a text field or from inside a dialog/menu — in those
// contexts native behavior (typing, native copy/paste/delete) must win.
function isEditableTarget(target: unknown): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean; closest?: (s: string) => unknown } | null
  if (!el || typeof el !== 'object') return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  if (typeof el.closest === 'function' && el.closest('[role="dialog"], [role="menu"]')) return true
  return false
}

export function handleGridShortcut(e: ShortcutEvent, deps: ShortcutDeps): boolean {
  if (isEditableTarget(e.target)) return false

  const noMods = !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey
  const ctrlOnly = e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey
  const key = e.key.toLowerCase()

  // Refresh — Ctrl+R / F5. reload() is guarded by an inFlight ref upstream, so repeats are no-ops;
  // always return true so Electron's built-in page reload never fires.
  if ((ctrlOnly && key === 'r') || (noMods && e.key === 'F5')) {
    deps.reload()
    return true
  }

  // Everything below mutates cells/watchlist — ignore auto-repeat from a held key.
  if (e.repeat) return false

  if (noMods && e.key === 'Delete') {
    deps.clearCell(deps.getActiveCellId())
    return true
  }
  if (ctrlOnly && key === 'd') {
    const sym = deps.getActiveSymbol()
    if (sym) deps.toggleWatchlist(sym)
    return true // swallow even with no symbol (avoid browser "bookmark" default)
  }
  if (ctrlOnly && key === 'c') {
    if (deps.hasSelection()) return false // let the browser copy selected text
    deps.copyCell(deps.getActiveCellId())
    return true
  }
  if (ctrlOnly && key === 'x') {
    deps.cutCell(deps.getActiveCellId())
    return true
  }
  if (ctrlOnly && key === 'v') {
    deps.pasteCell(deps.getActiveCellId())
    return true
  }

  return false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/gridShortcuts.test.ts`
Expected: PASS (14 passed).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/gridShortcuts.ts tests/renderer/gridShortcuts.test.ts
git commit -m "feat(shortcuts): pure handleGridShortcut decision function"
```

---

### Task 3: `useGridShortcuts` hook and wire into `App`

**Files:**
- Create: `src/renderer/hooks/useGridShortcuts.ts`
- Modify: `src/renderer/App.tsx` (import + call the hook)

**Interfaces:**
- Consumes: `handleGridShortcut`, `ShortcutDeps` (Task 2); `toggleWatchlist` (Task 1); `useAppStore` from `@/store`; `useQueryClient` from `@tanstack/react-query`.
- Produces: `useGridShortcuts(reload: () => void): void`.

- [ ] **Step 1: Create the hook**

Create `src/renderer/hooks/useGridShortcuts.ts`:

```ts
import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/store'
import { toggleWatchlist } from '@/lib/watchlist'
import { handleGridShortcut } from '@/lib/gridShortcuts'

// Mounts the single main-window keydown listener. `reload` is App's local closure, so it's passed
// in and kept in a ref to avoid re-subscribing on every App render.
export function useGridShortcuts(reload: () => void): void {
  const queryClient = useQueryClient()
  const reloadRef = useRef(reload)
  reloadRef.current = reload

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const store = useAppStore.getState()
      const handled = handleGridShortcut(e, {
        reload: () => reloadRef.current(),
        copyCell: store.copyCell,
        cutCell: store.cutCell,
        pasteCell: store.pasteCell,
        clearCell: store.clearCell,
        toggleWatchlist: (sym) => toggleWatchlist(sym, queryClient),
        getActiveCellId: () => useAppStore.getState().activeCellId,
        getActiveSymbol: () => {
          const s = useAppStore.getState()
          return s.cells.find((c) => c.id === s.activeCellId)?.symbol ?? null
        },
        hasSelection: () => (window.getSelection()?.toString().length ?? 0) > 0
      })
      if (handled) e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [queryClient])
}
```

- [ ] **Step 2: Wire into `App.tsx`**

In `src/renderer/App.tsx`, add the import with the other hook imports:

```ts
import { useGridShortcuts } from '@/hooks/useGridShortcuts'
```

Call it once inside the `App` component, after `reload` is defined (it's declared at `App.tsx:78`; the auto-refresh scheduler `useEffect` ends at line 183 — add the call right after, before the `AutoIcon` line at 189):

```ts
useGridShortcuts(() => void reload({ source: 'manual' }))
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Full test + build sanity**

Run: `npm test`
Expected: all suites pass (including the two new files).

Run: `npm run build`
Expected: build succeeds (verifies imports/aliases resolve in the real bundle).

- [ ] **Step 5: Manual verification in the app**

Run: `npm run dev`. In the main window, click a chart cell to make it active (ring highlight), then verify:
- `Ctrl+R` and `F5` → charts refresh (spinner), page does NOT reload.
- `Ctrl+D` → active cell's symbol appears/disappears in the watchlist; star toggles.
- `Ctrl+C` then click an empty cell + `Ctrl+V` → chart copied; `Ctrl+X` moves it; `Delete` clears the active cell.
- Focus the search box, select text, `Ctrl+C` → normal text copy (chart NOT copied). Open a dialog, press `Delete`/`Ctrl+C` → normal behavior, no cell mutation.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/hooks/useGridShortcuts.ts src/renderer/App.tsx
git commit -m "feat(shortcuts): wire keyboard shortcuts into main window"
```

---

## Self-Review

**Spec coverage:**
- Ctrl+R / F5 refresh (intercept Electron reload) → Task 2 (refresh branch, always-true) + Task 3 (preventDefault, `reload({source:'manual'})`). ✓
- Ctrl+D favorite toggle → Task 1 (helper) + Task 2 (branch) + Task 3 (wiring). ✓
- Ctrl+C/X/V, Delete on active cell → Task 2 branches + Task 3. ✓
- Input/dialog/menu focus guard → Task 2 `isEditableTarget` (form elements + `[role="dialog"], [role="menu"]`). ✓
- Ctrl+C text-selection fall-through → Task 2 `hasSelection` branch. ✓
- Strict modifier matching + preventDefault only on handled → Task 2 (`ctrlOnly`/`noMods`, boolean return) + Task 3. ✓
- Key-repeat suppression for mutating keys → Task 2 (`if (e.repeat) return false`). ✓
- Pure function for `node`-env testability → Task 2. ✓
- Shared `toggleWatchlist` helper (dedup) → Task 1. ✓ (SearchBar deliberately excluded — noted in Task 1.)
- Main-window-only scope → only `App.tsx` wires the hook; `ChartWindow`/`CompanyWindow` untouched. ✓

**Placeholder scan:** none — all steps contain runnable code/commands.

**Type consistency:** `handleGridShortcut`, `ShortcutDeps`, `ShortcutEvent` identical across Tasks 2/3; `toggleWatchlist(symbol, queryClient)` identical across Tasks 1/3; store action names (`copyCell`/`cutCell`/`pasteCell`/`clearCell`/`addToWatchlist`/`removeFromWatchlist`) match `store.ts`. ✓
