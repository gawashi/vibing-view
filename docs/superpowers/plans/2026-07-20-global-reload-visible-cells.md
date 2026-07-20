# Global Reload Button (Visible Cells, Differential Fetch) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one global header reload button that refreshes only the currently-visible grid cells by fetching just the new bars (cached `newestTime` → now), so intraday charts reflect the current time.

**Architecture:** A new `ohlcv:refresh` IPC path drives a new `CacheService.refreshOHLCV` that fetches only the right-edge differential and merges it. `barStore` upsert becomes coverage-union + last-write-wins so the differential merge cannot corrupt coverage or leave a stale in-progress bar. The renderer computes visible refresh targets (de-duped, gated-skipped) via a pure helper and updates the TanStack query cache in place.

**Tech Stack:** TypeScript, Electron (main/preload/renderer), React, TanStack Query, Zustand, better-sqlite3 + drizzle-orm, lightweight-charts, Vitest.

## Context

Investigating "FMP free→starter but intraday still unavailable" found the root cause was a sticky `requires-plan` capability verdict that only clears on API-key change (`capabilityCache.ts` `resolveStatus`); re-saving the key fixed it immediately. As the durable follow-up, the user chose a **reload button** whose main purpose is that **intraday charts reflect the current time**.

The technical blocker: the read-through cache (`src/main/cache/CacheService.ts`) never fetches when coverage exists for a range-less request, so the **right edge (newest bars) never advances** once cached. The existing gap-fetch only backfills the **left** (older) edge. Reload needs a right-edge differential fetch. Two latent `barStore` defects must be fixed for the merge to be correct: `upsertBarsAndCoverage` (1) **overwrites** coverage with the input range instead of unioning it, and (2) its bars `onConflictDoUpdate` set clause references `bars.*` (existing values) rather than `excluded.*`, so a re-fetched (in-progress) bar never updates.

## Global Constraints

- Tech stack: TypeScript + React only.
- Data source stays behind `FmpProvider`; do not add provider-specific logic outside it.
- Saving API calls is the top priority: refresh fetches only the differential; `1d`/`1w`/`1M` cost at most one request per symbol.
- SQLite = OHLCV cache only; JSON = preferences. This feature touches only the OHLCV cache.
- Pin Vite `^7`; better-sqlite3 rebuilt against Electron ABI (already handled by `postinstall`).
- Test runner: `npx vitest run <path>` (single file), `npm test` (all). Typecheck: `npm run typecheck`.
- Follow the repo convention: pure logic is unit-tested; DB I/O and IPC wiring are not (verified by typecheck + manual UAT).

## File Structure

- `src/main/db/barStore.ts` — add pure `unionCoverage`; fix upsert to union coverage + write `excluded.*` values.
- `src/main/cache/CacheService.ts` — add injectable `now`; add `refreshOHLCV(symbol, tf)`.
- `src/shared/ipc.ts` — add `CH.ohlcvRefresh` + `Api.ohlcv.refresh` signature.
- `src/preload/index.ts` — expose `ohlcv.refresh`.
- `src/main/ipc.ts` — extract shared capability-tracking wrapper; register `ohlcv:refresh`.
- `src/renderer/lib/refreshTargets.ts` (new) — pure helper computing visible, de-duped, gated-skipped targets.
- `src/renderer/App.tsx` — reload button + handler.
- Tests: `tests/main/db/unionCoverage.test.ts` (new), `tests/main/cache/CacheService.test.ts` (extend), `tests/renderer/refreshTargets.test.ts` (new).

---

### Task 1: barStore — coverage union + last-write-wins upsert

**Files:**
- Modify: `src/main/db/barStore.ts`
- Test: `tests/main/db/unionCoverage.test.ts` (create)

**Interfaces:**
- Produces: `unionCoverage(a, b): { oldestTime: number; newestTime: number }` where `a`/`b` are `{ oldestTime: number; newestTime: number }`.
- `upsertBarsAndCoverage(symbol, tf, input)` signature unchanged; behavior now unions coverage with any existing row and writes fetched bar values on conflict.

- [ ] **Step 1: Write the failing test** — `tests/main/db/unionCoverage.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { unionCoverage } from '../../../src/main/db/barStore'

describe('unionCoverage', () => {
  it('takes the min oldest and max newest of both ranges', () => {
    expect(unionCoverage({ oldestTime: 100, newestTime: 200 }, { oldestTime: 180, newestTime: 300 }))
      .toEqual({ oldestTime: 100, newestTime: 300 })
  })
  it('preserves the wider range when one contains the other', () => {
    expect(unionCoverage({ oldestTime: 100, newestTime: 500 }, { oldestTime: 200, newestTime: 300 }))
      .toEqual({ oldestTime: 100, newestTime: 500 })
  })
  it('extends only the right edge for a differential merge', () => {
    // existing history + a right-edge differential must keep oldestTime
    expect(unionCoverage({ oldestTime: 100, newestTime: 200 }, { oldestTime: 200, newestTime: 260 }))
      .toEqual({ oldestTime: 100, newestTime: 260 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/db/unionCoverage.test.ts`
Expected: FAIL — `unionCoverage` is not exported.

- [ ] **Step 3: Add `unionCoverage` and fix the upsert** in `src/main/db/barStore.ts`

Add `sql` to the drizzle import:

```typescript
import { and, eq, gte, lte, asc, sql } from 'drizzle-orm'
```

Add the pure helper after `coverageFromBars`:

```typescript
// Widen an existing coverage window with a newly-fetched one (never shrink it). Required for the
// right-edge differential refresh: upserting only the new bars must not drop the older history.
export function unionCoverage(
  a: { oldestTime: number; newestTime: number },
  b: { oldestTime: number; newestTime: number }
): { oldestTime: number; newestTime: number } {
  return { oldestTime: Math.min(a.oldestTime, b.oldestTime), newestTime: Math.max(a.newestTime, b.newestTime) }
}
```

Replace the body of `upsertBarsAndCoverage` so bars conflict-update to the *fetched* values and coverage unions with the existing row:

```typescript
export function upsertBarsAndCoverage(symbol: string, tf: Timeframe, input: Bar[]): void {
  const cov = coverageFromBars(input)
  if (!cov) return
  const db = getDb()
  db.insert(bars)
    .values(input.map((b) => ({ symbol, timeframe: tf, ...b })))
    .onConflictDoUpdate({
      target: [bars.symbol, bars.timeframe, bars.time],
      // excluded.* = the row we just tried to insert. A re-fetched in-progress bar (right-edge
      // refresh) must overwrite the stale cached one — referencing bars.* would keep the old value.
      set: {
        open: sql`excluded.open`, high: sql`excluded.high`, low: sql`excluded.low`,
        close: sql`excluded.close`, volume: sql`excluded.volume`
      }
    })
    .run()
  // Union with any existing coverage so a partial (differential) upsert never shrinks the window.
  const existing = getCoverage(symbol, tf)
  const merged = existing ? unionCoverage(existing, cov) : cov
  db.insert(coverage)
    .values({ symbol, timeframe: tf, ...merged })
    .onConflictDoUpdate({
      target: [coverage.symbol, coverage.timeframe],
      set: { oldestTime: merged.oldestTime, newestTime: merged.newestTime }
    })
    .run()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/db/unionCoverage.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/db/barStore.ts tests/main/db/unionCoverage.test.ts
git commit -m "fix(cache): union coverage + last-write-wins upsert in barStore"
```

---

### Task 2: CacheService.refreshOHLCV (right-edge differential)

**Files:**
- Modify: `src/main/cache/CacheService.ts`
- Test: `tests/main/cache/CacheService.test.ts`

**Interfaces:**
- Consumes: `store.getCoverage`, `store.getBars`, `store.upsertBarsAndCoverage`; `provider.getOHLCV(symbol, tf, range)`; `deriveWeekly`/`deriveMonthly`.
- Produces: `createCacheService({ provider, store, now? })` where `now?: () => number` returns epoch **seconds** (default `() => Math.floor(Date.now() / 1000)`); new method `refreshOHLCV(symbol: string, tf: Timeframe): Promise<Bar[]>`.

- [ ] **Step 1: Write the failing tests** — append to `tests/main/cache/CacheService.test.ts`

```typescript
describe('CacheService.refreshOHLCV', () => {
  it('fetches only the right-edge differential (newestTime → now) when cached', async () => {
    const store = fakeStore([bar(100), bar(200)], { oldestTime: 100, newestTime: 200 })
    const provider = { getOHLCV: vi.fn(async () => [bar(200), bar(260)]), searchSymbols: vi.fn() }
    const svc = createCacheService({ provider, store, now: () => 300 })

    await svc.refreshOHLCV('AAPL', '5m')

    expect(provider.getOHLCV).toHaveBeenCalledOnce()
    expect(provider.getOHLCV).toHaveBeenCalledWith('AAPL', '5m', { from: 200, to: 300 })
  })

  it('falls back to a full fetch when nothing is cached yet', async () => {
    const store = fakeStore() // no coverage
    const provider = { getOHLCV: vi.fn(async () => [bar(100), bar(200)]), searchSymbols: vi.fn() }
    const svc = createCacheService({ provider, store, now: () => 300 })

    const bars = await svc.refreshOHLCV('AAPL', '5m')

    expect(provider.getOHLCV).toHaveBeenCalledWith('AAPL', '5m', undefined)
    expect(bars.map((b) => b.time)).toEqual([100, 200])
  })

  it('refreshes the underlying daily and re-derives for \'1w\'', async () => {
    const dailyBars = [
      { time: day('2024-01-01'), open: 10, high: 12, low: 9, close: 11, volume: 100 },
      { time: day('2024-01-05'), open: 9, high: 16, low: 6, close: 18, volume: 500 }
    ]
    const store = fakeStore(dailyBars, { oldestTime: dailyBars[0].time, newestTime: dailyBars[1].time })
    const provider = { getOHLCV: vi.fn(async () => dailyBars), searchSymbols: vi.fn() }
    const svc = createCacheService({ provider, store, now: () => day('2024-02-01') })

    const bars = await svc.refreshOHLCV('AAPL', '1w')

    expect(provider.getOHLCV).toHaveBeenCalledWith('AAPL', '1d', { from: dailyBars[1].time, to: day('2024-02-01') })
    expect(bars).toEqual(deriveWeekly(dailyBars))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/cache/CacheService.test.ts`
Expected: FAIL — `svc.refreshOHLCV is not a function` (existing `getOHLCV` tests still PASS).

- [ ] **Step 3: Add `now` dep and `refreshOHLCV`** in `src/main/cache/CacheService.ts`

Update the factory signature and destructure:

```typescript
export function createCacheService(deps: {
  provider: Pick<FmpProvider, 'getOHLCV' | 'searchSymbols'>
  store: typeof barStore
  now?: () => number // epoch SECONDS; injectable for tests
}) {
  const { provider, store } = deps
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000))
  return {
    async getOHLCV(symbol: string, tf: Timeframe, range: DateRange): Promise<Bar[]> {
      // ...unchanged...
    },
```

Add the new method inside the returned object (after `getOHLCV`):

```typescript
    // Right-edge differential (reload): advance the cached newest bar up to `now`. W/M re-derive
    // from a refreshed daily. Never re-fetches already-cached older history (API-call budget).
    async refreshOHLCV(symbol: string, tf: Timeframe): Promise<Bar[]> {
      if (tf === '1w' || tf === '1M') {
        const daily = await this.refreshOHLCV(symbol, '1d')
        return tf === '1w' ? deriveWeekly(daily) : deriveMonthly(daily)
      }
      const cov = store.getCoverage(symbol, tf)
      // Nothing cached → behave like a first fetch. (`1d` ignores range and returns full history;
      // intraday fetches only newestTime→now.)
      const fetched = cov
        ? await provider.getOHLCV(symbol, tf, { from: cov.newestTime, to: now() })
        : await provider.getOHLCV(symbol, tf, undefined)
      store.upsertBarsAndCoverage(symbol, tf, fetched)
      return store.getBars(symbol, tf, undefined)
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/cache/CacheService.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/main/cache/CacheService.ts tests/main/cache/CacheService.test.ts
git commit -m "feat(cache): add refreshOHLCV right-edge differential fetch"
```

---

### Task 3: IPC wiring (shared type, preload, main handler)

**Files:**
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts`

**Interfaces:**
- Produces: `CH.ohlcvRefresh = 'ohlcv:refresh'`; `Api.ohlcv.refresh(symbol: string, timeframe: Timeframe): Promise<Bar[]>`.
- Consumes: `cacheFor().refreshOHLCV` (Task 2); existing `classify`, `capabilityCache`, `FmpHttpError`, `dailyOutOfPlan`, `DERIVED_TIMEFRAMES`, `DAILY_BACKED`.

- [ ] **Step 1: Add the channel + Api signature** in `src/shared/ipc.ts`

In the `CH` object add:

```typescript
  ohlcvGet: 'ohlcv:get',
  ohlcvRefresh: 'ohlcv:refresh',
```

In `interface Api` change the `ohlcv` block to:

```typescript
  ohlcv: {
    get(symbol: string, timeframe: Timeframe, range: DateRange): Promise<Bar[]>
    // Reload: fetch only the new bars (cached newest → now) and return the merged series.
    refresh(symbol: string, timeframe: Timeframe): Promise<Bar[]>
  }
```

- [ ] **Step 2: Expose it in preload** — `src/preload/index.ts`, in the `ohlcv` block:

```typescript
  ohlcv: {
    get: (symbol, timeframe: Timeframe, range: DateRange) =>
      ipcRenderer.invoke(CH.ohlcvGet, symbol, timeframe, range),
    refresh: (symbol, timeframe: Timeframe) =>
      ipcRenderer.invoke(CH.ohlcvRefresh, symbol, timeframe)
  },
```

- [ ] **Step 3: Refactor the capability bookkeeping into a shared wrapper and register the handler** in `src/main/ipc.ts`

Inside `registerIpc`, after `dailyOutOfPlan` is declared and `cacheFor` is defined, add:

```typescript
  // Shared capability bookkeeping for every real OHLCV fetch (get + refresh): short-circuit known
  // out-of-plan daily-backed symbols, record 'available' on success, and classify FmpHttpErrors.
  const withCapabilityTracking = async (
    symbol: string, timeframe: Timeframe, run: () => Promise<Bar[]>
  ): Promise<Bar[]> => {
    if (DAILY_BACKED.includes(timeframe) && dailyOutOfPlan.has(symbol)) return []
    try {
      const bars = await run()
      const apiKey = getApiKey()
      if (apiKey && !DERIVED_TIMEFRAMES.includes(timeframe)) {
        capabilityCache.setStatus(apiKey, timeframe, 'available')
      }
      return bars
    } catch (err) {
      if (err instanceof FmpHttpError && DAILY_BACKED.includes(timeframe) && (err.status === 402 || err.status === 403)) {
        dailyOutOfPlan.add(symbol)
      }
      const apiKey = getApiKey()
      if (apiKey && !DERIVED_TIMEFRAMES.includes(timeframe) && err instanceof FmpHttpError) {
        const verdict = classify(err.status, err.body)
        if (!(timeframe === '1d' && verdict === 'requires-plan')) {
          capabilityCache.setStatus(apiKey, timeframe, verdict)
        }
      }
      throw err
    }
  }
```

Add `Bar` to the type import at the top:

```typescript
import type { Bar, Timeframe, DateRange, Workspace, WatchlistCollection } from '@shared/types'
```

Replace the existing `CH.ohlcvGet` handler body with the wrapper call (behavior identical):

```typescript
  ipcMain.handle(CH.ohlcvGet, async (_e, symbol: string, timeframe: Timeframe, range: DateRange) =>
    withCapabilityTracking(symbol, timeframe, () => cacheFor().getOHLCV(symbol, timeframe, range))
  )

  ipcMain.handle(CH.ohlcvRefresh, async (_e, symbol: string, timeframe: Timeframe) =>
    withCapabilityTracking(symbol, timeframe, () => cacheFor().refreshOHLCV(symbol, timeframe))
  )
```

- [ ] **Step 4: Typecheck (verifies IPC wiring; no unit tests for IPC handlers by convention)**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Run the full main test suite (guards the refactor)**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/ipc.ts
git commit -m "feat(ipc): add ohlcv:refresh channel and shared capability tracking"
```

---

### Task 4a: refreshTargets pure helper

**Files:**
- Create: `src/renderer/lib/refreshTargets.ts`
- Test: `tests/renderer/refreshTargets.test.ts`

**Interfaces:**
- Consumes: `VISIBLE_COUNT` from `src/renderer/workspace.ts`; `Cell`, `Timeframe`, `GridShape` from `@shared/types`; `CapabilityStatus` from `@shared/ipc`.
- Produces: `refreshTargets(cells, shape, caps): { symbol: string; timeframe: Timeframe }[]` — visible cells only, de-duped by `symbol|tf`, gated tfs skipped, plus `1d` per intraday cell for the prev-close change label.

- [ ] **Step 1: Write the failing test** — `tests/renderer/refreshTargets.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { refreshTargets } from '../../src/renderer/lib/refreshTargets'
import type { Cell } from '@shared/types'

const cell = (id: string, symbol: string | null, timeframe: Cell['timeframe']): Cell =>
  ({ id, symbol, timeframe, indicators: [] })

describe('refreshTargets', () => {
  it('returns only visible cells for the shape', () => {
    const cells = [cell('a', 'AAPL', '1d'), cell('b', 'MSFT', '1d'), cell('c', 'TSLA', '1d')]
    expect(refreshTargets(cells, '1x1', undefined)).toEqual([{ symbol: 'AAPL', timeframe: '1d' }])
  })

  it('adds a 1d target for each intraday cell (prev-close label) and de-dupes', () => {
    const cells = [cell('a', 'AAPL', '5m'), cell('b', 'AAPL', '1d')]
    expect(refreshTargets(cells, '2x1', undefined)).toEqual([
      { symbol: 'AAPL', timeframe: '5m' },
      { symbol: 'AAPL', timeframe: '1d' }
    ])
  })

  it('skips gated timeframes', () => {
    const cells = [cell('a', 'AAPL', '5m')]
    const caps = { '1m': 'available', '5m': 'requires-plan', '15m': 'available', '1h': 'available',
      '1d': 'available', '1w': 'available', '1M': 'available' } as const
    expect(refreshTargets(cells, '1x1', caps)).toEqual([{ symbol: 'AAPL', timeframe: '1d' }])
  })

  it('ignores cells without a symbol', () => {
    expect(refreshTargets([cell('a', null, '1d')], '1x1', undefined)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/refreshTargets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper** — `src/renderer/lib/refreshTargets.ts`

```typescript
import type { Cell, Timeframe, GridShape } from '@shared/types'
import type { CapabilityStatus } from '@shared/ipc'
import { VISIBLE_COUNT } from '@/workspace'

export type RefreshTarget = { symbol: string; timeframe: Timeframe }

const INTRADAY: Timeframe[] = ['1m', '5m', '15m', '1h']

// Visible cells only, de-duped by symbol|tf. Gated tfs (requires-plan/rate-limited) are skipped so
// reload never burns an API request that will just 402/429. Intraday cells also refresh their '1d'
// so the prev-close-based change label stays correct across a trading-day boundary.
export function refreshTargets(
  cells: Cell[],
  shape: GridShape,
  caps: Partial<Record<Timeframe, CapabilityStatus>> | undefined
): RefreshTarget[] {
  const gated = (tf: Timeframe): boolean =>
    caps?.[tf] === 'requires-plan' || caps?.[tf] === 'rate-limited'
  const seen = new Set<string>()
  const out: RefreshTarget[] = []
  const push = (symbol: string, tf: Timeframe): void => {
    if (gated(tf)) return
    const key = `${symbol}|${tf}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ symbol, timeframe: tf })
  }
  for (const cell of cells.slice(0, VISIBLE_COUNT[shape])) {
    if (!cell.symbol) continue
    push(cell.symbol, cell.timeframe)
    if (INTRADAY.includes(cell.timeframe)) push(cell.symbol, '1d')
  }
  return out
}
```

(`GridShape` is exported from `@shared/types`; `VISIBLE_COUNT` in `src/renderer/workspace.ts` is `Record<GridShape, number>`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/refreshTargets.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/refreshTargets.ts tests/renderer/refreshTargets.test.ts
git commit -m "feat(renderer): add refreshTargets helper for visible-cell reload"
```

---

### Task 4b: Reload button in the header

**Files:**
- Modify: `src/renderer/App.tsx`

**Interfaces:**
- Consumes: `refreshTargets` (Task 4a); `api.ohlcv.refresh` (Task 3); `qk` from `@/api`; `useAppStore` state (`cells`, `shape`); `useQueryClient`; `toast` from `sonner`; `RefreshCw` from `lucide-react`.

- [ ] **Step 1: Add imports** to `src/renderer/App.tsx`

```typescript
import { PanelLeftClose, PanelLeftOpen, RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, qk } from './api'
import { refreshTargets } from './lib/refreshTargets'
import type { CapabilityStatus } from '@shared/ipc'
import type { Timeframe } from '@shared/types'
```

(Update the existing `import { api } from './api'` line to `import { api, qk } from './api'`, and the existing lucide import to include `RefreshCw`.)

- [ ] **Step 2: Add reload state + handler** inside the `App` component (after `toggleSidebar`)

```typescript
  const queryClient = useQueryClient()
  const [reloading, setReloading] = useState(false)

  const handleReload = async (): Promise<void> => {
    const { cells, shape } = useAppStore.getState()
    const caps = queryClient.getQueryData<Record<Timeframe, CapabilityStatus>>(qk.capabilities())
    const targets = refreshTargets(cells, shape, caps)
    if (targets.length === 0) return
    setReloading(true)
    try {
      const results = await Promise.allSettled(
        targets.map(async (t) => {
          const bars = await api.ohlcv.refresh(t.symbol, t.timeframe)
          queryClient.setQueryData(qk.ohlcv(t.symbol, t.timeframe), bars)
        })
      )
      // Capability verdicts may have changed (a refresh re-probes the fetched tf); re-gate the row.
      void queryClient.invalidateQueries({ queryKey: qk.capabilities() })
      if (results.some((r) => r.status === 'rejected')) {
        toast('Some charts couldn’t be refreshed. Check your connection or FMP plan.')
      }
    } finally {
      setReloading(false)
    }
  }
```

- [ ] **Step 3: Add the button** to the header, next to the sidebar toggle (before `<GridShapeRow />`)

```tsx
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleReload}
                disabled={reloading}
                aria-label="Reload visible charts"
              >
                <RefreshCw className={cn('size-4', reloading && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reload visible charts</TooltipContent>
          </Tooltip>
```

Add `import { cn } from './lib/utils'` if not already imported.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Build (renderer wiring has no unit test; build + UAT verify it)**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(renderer): global reload button for visible charts"
```

---

## Verification (end-to-end UAT)

Prereq: a starter-plan FMP key configured; run `npm run dev`.

1. **Intraday freshness (core):** Open a `5m` chart for a liquid symbol during/after market hours. Note the rightmost bar's time. Click the header reload button (spinner shows). The rightmost bar advances toward the current time; older bars and pan position are unchanged (no view jump).
2. **API-call thrift:** With DevTools Network open, reload — confirm intraday requests use `historical-chart/...&from=<lastBar>&to=<now>` (a short range), not a full-history fetch. `1d` cells make at most one request.
3. **Visible-only:** In a 2×2 layout, reload refreshes exactly the four visible cells' symbols (plus their `1d` for intraday cells). Cells beyond the visible shape are not requested.
4. **Gated skip:** If any visible tf is rate-limited/requires-plan, it is not requested (verify no request for it in Network).
5. **Change label:** After a new trading day, reloading an intraday cell updates the % change (its `1d` prev-close refreshed).
6. **No-op safety:** Reloading again immediately fetches the (small) differential and does not corrupt the chart or duplicate bars.
7. **Regression:** `npm test` and `npm run typecheck` pass; left-edge pan/gap-fetch still backfills older history and coverage no longer shrinks (checked by `unionCoverage` tests + step 1 view stability).

## Notes / risks

- `barStore` DB I/O and IPC handlers have no unit tests in this repo (by convention); their correctness is covered by the pure-function tests (`unionCoverage`, `refreshOHLCV` with a fake store, `refreshTargets`) plus the UAT above.
- The `excluded.*` upsert fix changes conflict behavior repo-wide (now last-write-wins). This is strictly more correct and required for in-progress bar updates; the full-suite run in Task 3 Step 5 guards it.
