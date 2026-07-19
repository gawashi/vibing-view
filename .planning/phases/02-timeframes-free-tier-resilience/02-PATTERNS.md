# Phase 2: Timeframes & Free-Tier Resilience - Pattern Map

**Mapped:** 2026-07-19
**Files analyzed:** 24 (10 modified, 8 new source, 6 test files [2 extended, 4 new])
**Analogs found:** 24 / 24 whole-file (2 sub-patterns flagged with no codebase precedent — see `## No Analog Found`)

No RESEARCH.md exists for this phase (intentionally skipped). Source of the file list: `02-CONTEXT.md`
§Canonical References + §Existing Code Insights, and `02-DESIGN-ADDENDUM.md` (authoritative
file/symbol spec). All excerpts below are read verbatim from the committed P1 code (`72e150a`).

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/shared/types.ts` | model | n/a (type defs) | itself (extend in place) | exact |
| `src/main/providers/FmpProvider.ts` | provider | request-response | itself (extend `getOHLCV`) | exact |
| `src/main/providers/fmp.schema.ts` | utility (validation) | transform | itself (mirror `fmpHistoricalRow`) | exact |
| `src/main/cache/CacheService.ts` | service | CRUD (read-through) | itself (extend `covers`/`getOHLCV`) | exact |
| `src/renderer/components/Chart.tsx` | component | event-driven + request-response | itself (extend query key + effects) | exact |
| `src/shared/ipc.ts` | config (contract) | request-response | itself (extend `CH`/`Api`) | exact |
| `src/main/ipc.ts` | controller | request-response | itself (add handler, mirrors `apikeyStatus`) | exact |
| `src/preload/index.ts` | middleware (bridge) | request-response | itself (add bridge, mirrors `apikey.status`) | exact |
| `src/renderer/api.ts` | utility | request-response | itself (extend `qk.ohlcv`) | exact |
| `src/renderer/App.tsx` | component | request-response | itself (mount `<Toaster/>`) | exact |
| `src/renderer/store.ts` | store | event-driven | itself (add `activeTimeframe`, if lifted to global) | exact |
| `src/main/capabilityClassifier.ts` (new) | utility | transform | `src/main/providers/FmpProvider.ts` + `fmp.schema.ts` (zod-parse-throws-on-bad-shape is the existing "detect a bad response" mechanism) | role-match |
| `src/main/capabilityCache.ts` (new) | service | file-I/O | `src/main/settings.ts` (small JSON under userData) + `src/main/keystore.ts` (in-memory cache var + explicit invalidation) | exact |
| `src/main/aggregate.ts` (new, W/M derivation) | utility | batch/transform | `src/main/db/barStore.ts` → `coverageFromBars` (pure function reducing `Bar[]` to a derived value) | role-match |
| `src/renderer/components/TimeframeRow.tsx` (new) | component | event-driven | `src/renderer/components/SearchBar.tsx` (control-row wiring store + query + click handlers) | role-match |
| `src/renderer/components/ui/toggle-group.tsx` (new, shadcn CLI) | component | n/a | `src/renderer/components/ui/button.tsx` (cva + forwardRef + `cn`) | exact |
| `src/renderer/components/ui/tooltip.tsx` (new, shadcn CLI) | component | n/a | `src/renderer/components/ui/button.tsx` | exact |
| `src/renderer/components/ui/badge.tsx` (new, shadcn CLI) | component | n/a | `src/renderer/components/ui/alert.tsx` (cva variants + sub-component split) | exact |
| `src/renderer/components/ui/sonner.tsx` (new, shadcn CLI) | component | n/a | `src/renderer/components/ui/dialog.tsx` (Radix-wrapper-via-shadcn convention) | exact |
| `tests/main/providers/FmpProvider.test.ts` (extended) | test | request-response | itself (add intraday fixture case) | exact |
| `tests/main/cache/CacheService.test.ts` (extended) | test | CRUD | itself (add gap-fetch fake-store case) | exact |
| `tests/main/capabilityClassifier.test.ts` (new) | test | transform | `tests/main/providers/FmpProvider.test.ts` (fixture-based pure-function test) | exact |
| `tests/main/aggregate.test.ts` (new) | test | batch/transform | `tests/main/db/coverageFromBars.test.ts` (pure function over `Bar[]`) | exact |
| `tests/main/capabilityCache.test.ts` (new) | test | file-I/O | `tests/main/searchCache.test.ts` (TTL via injected `now()`) | partial-match — see caveat below |

**Not modified, referenced as load-bearing seams (no code change expected):** `src/main/db/barStore.ts`,
`src/main/db/schema.ts`, `src/main/db/client.ts`, `src/main/providers/IDataProvider.ts`. Per CONTEXT.md
§Existing Code Insights, the `(symbol, timeframe, time)` primary key and `covers()`/`coverageFromBars`
already accommodate intraday and W/M rows unmodified — new timeframe values just flow through as new
`timeframe` column values.

**Caveat on `capabilityCache.test.ts`:** `settings.ts`/`keystore.ts` (its closest structural analogs)
have **no existing unit tests in P1** — they depend on `app.getPath('userData')`, and P1 never mocked
Electron's `app` module (unlike `db/client.ts`'s lazy-`require` trick, built specifically so Vitest can
load pure logic without Electron — see that file's pattern below). Two options for the planner: (a)
follow the P1 precedent and leave the userData-file I/O untested, testing only the pure TTL/status-map
logic in isolation (inject the path, like `searchCache.ts` injects `now()`), or (b) accept the gap
consistent with `settings.ts`/`keystore.ts`. Either is a real choice, not an oversight — flagging it here
so it's a deliberate call, not a silent gap.

---

## Pattern Assignments

### `src/shared/types.ts` (model)

**Analog:** itself — line 1 is the entire seam.

**Current type to widen** (line 1):
```typescript
export type Timeframe = '1d'
```
Per DESIGN-ADDENDUM §2, widen to:
```typescript
export type Timeframe = '1m' | '5m' | '15m' | '1h' | '1d' | '1w' | '1M'
```
`Bar`, `SymbolResult`, `DateRange` (lines 3-18) are untouched — every downstream file that imports
`Timeframe` from `@shared/types` picks up the wider union automatically (no other type-level ripple).

---

### `src/main/providers/FmpProvider.ts` (provider, request-response)

**Analog:** itself — the seam is explicitly marked in the current code.

**Imports pattern** (lines 1-3):
```typescript
import type { Bar, SymbolResult, Timeframe, DateRange } from '@shared/types'
import type { IDataProvider } from './IDataProvider'
import { fmpHistoricalResponse, fmpSearchResponse } from './fmp.schema'
```

**Existing daily-only seam to branch on timeframe** (lines 40-50):
```typescript
async getOHLCV(symbol: string, _timeframe: Timeframe, _range: DateRange): Promise<Bar[]> {
  // P1: daily EOD only, full history in one request (D-08). timeframe/range are the P2 seam.
  const url = `${BASE}/historical-price-eod/full?symbol=${encodeURIComponent(symbol)}&apikey=${this.apiKey}`
  const parsed = fmpHistoricalResponse.parse(await this.httpGetJson(url))
  return parsed
    .map((r) => ({
      time: dateToEpochSeconds(r.date),
      open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume
    }))
    .sort((a, b) => a.time - b.time) // FMP returns newest-first; charts need ascending
}
```
Per DESIGN-ADDENDUM §3, this becomes a branch: `'1d'` keeps the existing full-EOD call; `'1m'|'5m'|'15m'|'1h'`
hit `/stable/historical-chart/{interval}?symbol&from&to&apikey` where `interval` is **not** the same
string as the `Timeframe` value — FMP's path segments are `1min`/`5min`/`15min`/`1hour`. A small mapping
object next to `BASE` (same file-local-const style as `BASE` on line 6) is the natural extension point:
```typescript
const INTRADAY_PATH: Record<'1m' | '5m' | '15m' | '1h', string> = { '1m': '1min', '5m': '5min', '15m': '15min', '1h': '1hour' }
```
`'1w'`/`'1M'` never reach this file — they're derived-only (DESIGN-ADDENDUM §2/§6), intercepted before the
provider is called (see `CacheService.ts` / `aggregate.ts` below).

**Existing UTC-midnight date helper — needs a timezone-aware sibling for intraday** (lines 16-18):
```typescript
function dateToEpochSeconds(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000)
}
```
This only works because daily FMP dates are date-only strings treated as UTC midnight. Intraday responses
return exchange-local timestamps (e.g. `"2024-01-02 09:30:00"`, no timezone marker) — `Date.parse` on that
string is environment-dependent and wrong. DESIGN-ADDENDUM §3 calls for `date-fns-tz` (`America/New_York`)
here; this is a genuinely new pattern with zero P1 precedent — see `## No Analog Found`.

**Error handling / auth pattern** (line 10-13, `defaultHttpGetJson`):
```typescript
const defaultHttpGetJson: HttpGetJson = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`FMP HTTP ${res.status}`)
  return res.json()
}
```
This throws a plain `Error` on any non-2xx **before** the caller ever sees the response body — the
capability classifier (D-19/D-20) needs the actual status code and body, so `httpGetJson`'s contract
likely needs to surface `res.status` + parsed body on failure (not just a message string) so
`capabilityClassifier.ts` can inspect it. This is the one part of `FmpProvider.ts` that isn't a "just
extend it" seam — flag for the planner as a signature change, not just an addition.

**Constructor injection pattern (for testability)** (lines 20-27):
```typescript
constructor(opts: { apiKey: string; httpGetJson?: HttpGetJson }) {
  this.apiKey = opts.apiKey
  this.httpGetJson = opts.httpGetJson ?? defaultHttpGetJson
}
```
`tests/main/providers/FmpProvider.test.ts` already relies on this (`httpGetJson: async () => payload`) —
reuse verbatim for intraday-endpoint test cases.

---

### `src/main/providers/fmp.schema.ts` (utility/validation, transform)

**Analog:** itself — mirror the existing row/response pair.

**Existing pattern to mirror** (lines 3-13):
```typescript
export const fmpHistoricalRow = z.object({
  date: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number()
})

// FMP stable `historical-price-eod/full` returns a flat array (no { symbol, historical } wrapper).
export const fmpHistoricalResponse = z.array(fmpHistoricalRow)
```
Per DESIGN-ADDENDUM §3 ("Same newest-first → ascending normalize as daily"), the intraday
`historical-chart` endpoint returns the same flat-array shape, just with a datetime-valued `date` field.
Add `fmpIntradayRow`/`fmpIntradayResponse` following this exact row/response pairing — likely identical
schema to `fmpHistoricalRow` (zod doesn't need to distinguish date-only vs datetime strings unless you
want to validate the format), so this may end up being a re-export/alias rather than a new object.

**Why `.parse()` (not `.safeParse()`) matters here** — this is the mechanism the capability classifier
hooks into (see below): a zod `.parse()` throw on an HTTP-200 body **is** the "error-shaped payload"
signal from DESIGN-ADDENDUM §7's `requires-plan` condition. Keep using `.parse()`, not `.safeParse()`,
for any new schema so the throw-based detection stays consistent.

---

### `src/main/cache/CacheService.ts` (service, CRUD/read-through)

**Analog:** itself — extend the existing `covers()` check and the miss branch.

**Full current file is the seam** (lines 10-33):
```typescript
function covers(
  cov: { oldestTime: number; newestTime: number } | null,
  range: DateRange
): boolean {
  if (!cov) return false
  if (!range) return true // any coverage satisfies an "all available" request in P1 (D-08)
  return cov.oldestTime <= range.from && cov.newestTime >= range.to
}

export function createCacheService(deps: { provider: IDataProvider; store: BarStore }) {
  const { provider, store } = deps
  return {
    async getOHLCV(symbol: string, tf: Timeframe, range: DateRange): Promise<Bar[]> {
      const cov = store.getCoverage(symbol, tf)
      if (covers(cov, range)) {
        return store.getBars(symbol, tf, range) // cache hit → no network
      }
      // P1: miss → fetch all history once, persist, then serve
      const fetched = await provider.getOHLCV(symbol, tf, undefined)
      store.upsertBarsAndCoverage(symbol, tf, fetched)
      return store.getBars(symbol, tf, range)
    }
  }
}
```
Per DESIGN-ADDENDUM §1/§5, the miss branch's `provider.getOHLCV(symbol, tf, undefined)` (always fetch
everything) becomes a **gap calculation**: when `cov` exists but doesn't fully cover `range`, compute
`[range.from, cov.oldestTime - 1]` (the missing left sub-range, contiguous per §1) and fetch only that,
rather than re-fetching `undefined` (everything). `covers()` itself is the exact boolean this gap
calculation is the complement of — extend alongside it, same file, same style.

Per DESIGN-ADDENDUM §6, `'1w'`/`'1M'` requests should short-circuit here (or in a thin wrapper around this
factory): read `'1d'` coverage/bars via the existing `store` calls, then hand off to `aggregate.ts` instead
of ever calling `provider.getOHLCV`. This mirrors the existing internal split in this codebase between
**orchestration + I/O** (this file) and **pure computation delegated to a sibling pure function**
(`barStore.ts`'s `coverageFromBars`, called from `upsertBarsAndCoverage` below) — `aggregate.ts` should
be called from here the same way `coverageFromBars` is called from `barStore.ts`.

**Test analog** — `tests/main/cache/CacheService.test.ts` lines 7-18 (`fakeStore` factory) is the exact
harness to extend with a new coverage-exists-but-partial-range fixture to assert the gap-fetch calls
`provider.getOHLCV` with the narrowed range, not `undefined`.

---

### `src/main/db/barStore.ts` (model/data-access — reference only)

**No modification expected.** Per CONTEXT.md §Reusable Assets, the `(symbol, timeframe, time)` /
`(symbol, timeframe)` composite keys (schema.ts lines 3-27) already accept any `Timeframe` string value —
intraday and derived W/M rows fit without a migration. Cited here only because `coverageFromBars`
(lines 6-15) is the **pure-function delegate pattern** `aggregate.ts` should copy:
```typescript
export function coverageFromBars(input: Bar[]): { oldestTime: number; newestTime: number } | null {
  if (input.length === 0) return null
  let oldest = input[0].time
  let newest = input[0].time
  for (const b of input) {
    if (b.time < oldest) oldest = b.time
    if (b.time > newest) newest = b.time
  }
  return { oldestTime: oldest, newestTime: newest }
}
```
Same shape as `aggregate.ts` needs: pure function, `Bar[]` in, derived structure out, no I/O, trivially
unit-testable (see `coverageFromBars.test.ts` below).

---

### `src/renderer/components/Chart.tsx` (component, event-driven + request-response)

**Analog:** itself.

**Imports pattern** (lines 1-5):
```typescript
import React, { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createChart, CandlestickSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts'
import { api, qk } from '@/api'
import type { Bar } from '@shared/types'
```

**Query-key seam that hardcodes the timeframe** (lines 12-15):
```typescript
const q = useQuery<Bar[]>({
  queryKey: qk.ohlcv(symbol),
  queryFn: () => api.ohlcv.get(symbol, '1d', undefined)
})
```
Both the key (`qk.ohlcv`, see `api.ts` below) and the literal `'1d'` argument need a `timeframe` parameter
— this is the exact seam CONTEXT.md §Reusable Assets flags ("`qk.ohlcv(symbol)`... extend to include
timeframe so query separates per-timeframe cache entries").

**Chart-instance lifecycle effect (create once)** (lines 18-37) — unchanged by this phase, reuse as-is;
new code (pan subscription) attaches inside this same effect after `chart.addSeries(...)`:
```typescript
const chart = createChart(containerRef.current, { /* ... */ })
const series = chart.addSeries(CandlestickSeries, { /* ... */ })
chartRef.current = chart
seriesRef.current = series
return () => { chart.remove(); chartRef.current = null; seriesRef.current = null }
```
Per DESIGN-ADDENDUM §5, add `chart.timeScale().subscribeVisibleLogicalRangeChange(handler)` here, with a
matching `unsubscribeVisibleLogicalRangeChange` in the cleanup (same teardown-pairs-with-setup shape
already used for `chart.remove()`).

**Data-push effect + `fitContent`** (lines 40-46) — this is D-11's "always reset to latest" already
built in; reuse verbatim per timeframe switch (switching timeframe just changes the query key, this
effect re-fires and calls `fitContent()` again automatically since it's a `useEffect` keyed on `q.data`):
```typescript
useEffect(() => {
  if (!seriesRef.current || !q.data) return
  seriesRef.current.setData(
    q.data.map((b) => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close }))
  )
  chartRef.current?.timeScale().fitContent()
}, [q.data])
```

**Loading/error JSX pattern** (lines 48-60) — the existing inline-absolute-overlay convention; the new
gap-fetch "subtle non-blocking indicator" (UI-SPEC E3) should follow this same absolute-overlay
positioning convention, not a new layout mechanism:
```tsx
<div className="relative h-full w-full">
  <div ref={containerRef} className="h-full w-full" />
  {q.isLoading && (
    <div className="absolute inset-0 p-6 text-muted-foreground">Loading chart…</div>
  )}
  {q.isError && (
    <div className="absolute inset-0 p-6 text-destructive">
      Couldn't load chart data. Check your connection or your FMP API key in Settings, then try again.
    </div>
  )}
</div>
```

---

### `src/shared/ipc.ts` (config/contract, request-response)

**Analog:** itself — extend the channel map and interface.

**Channel name constants** (lines 3-11):
```typescript
export const CH = {
  symbolsSearch: 'symbols:search',
  ohlcvGet: 'ohlcv:get',
  apikeySet: 'apikey:set',
  apikeyStatus: 'apikey:status',
  apikeyClear: 'apikey:clear',
  settingsGetLastSymbol: 'settings:getLastSymbol',
  settingsSetLastSymbol: 'settings:setLastSymbol'
} as const
```
Add `capabilitiesGet: 'capabilities:get'` following the `noun:verb` naming convention already established.

**Api interface — `ohlcv.get` already takes `timeframe`/`range`, no shape change needed there** (line 18):
```typescript
ohlcv: { get(symbol: string, timeframe: Timeframe, range: DateRange): Promise<Bar[]> }
```
This is a free win: because `Timeframe` widens at the type-definition source (`types.ts`), this signature
needs **zero edits** — it already threads timeframe end-to-end.

**New interface member to add**, following the existing `apikey`/`settings` sub-object convention
(lines 19-27):
```typescript
capabilities: { get(): Promise<Record<Timeframe, CapabilityStatus>> }
```
(`CapabilityStatus` = new exported union type, e.g. `'available' | 'requires-plan' | 'rate-limited' | 'unknown'`
per DESIGN-ADDENDUM §8 — define next to `KeyStatus`/`SetKeyResult` on lines 13-14.)

---

### `src/main/ipc.ts` (controller, request-response)

**Analog:** itself — mirror the simplest existing no-arg handler.

**Handler-registration pattern** (line 35, the exact shape a no-arg `capabilities.get()` handler mirrors):
```typescript
ipcMain.handle(CH.apikeyStatus, () => getKeyStatus())
```

**Cache-check-then-fetch pattern already exists for search** (lines 20-28) — same shape the capability
cache's "lazily probed on first request" (D-21) should follow:
```typescript
ipcMain.handle(CH.symbolsSearch, async (_e, query: string) => {
  const cached = searchCache.get(query)
  if (cached) return cached
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('NO_API_KEY')
  const results = await new FmpProvider({ apiKey }).searchSymbols(query)
  searchCache.set(query, results)
  return results
})
```

**`cacheFor()` factory reading the current key each call** (lines 14-18) — the capability cache's
key-change invalidation (D-21) hooks in exactly here, since this is already the one place that reads
`getApiKey()` fresh per request:
```typescript
const cacheFor = () => {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('NO_API_KEY')
  return createCacheService({ provider: new FmpProvider({ apiKey }), store: barStore })
}
```

---

### `src/preload/index.ts` (middleware/bridge, request-response)

**Analog:** itself — mirror the simplest existing bridge member.

**No-arg bridge pattern** (line 13, exact shape for `capabilities.get`):
```typescript
status: () => ipcRenderer.invoke(CH.apikeyStatus)
```

**Full `apikey` sub-object as the structural template** (lines 11-15):
```typescript
apikey: {
  set: (key) => ipcRenderer.invoke(CH.apikeySet, key),
  status: () => ipcRenderer.invoke(CH.apikeyStatus),
  clear: () => ipcRenderer.invoke(CH.apikeyClear)
}
```
Add `capabilities: { get: () => ipcRenderer.invoke(CH.capabilitiesGet) }` alongside it (line 22 is where
`contextBridge.exposeInMainWorld('api', api)` runs — unaffected, `api` object just grows one key).

---

### `src/renderer/api.ts` (utility, request-response)

**Analog:** itself — the entire file is the seam (7 lines).

**Current query-key builder hardcodes `'1d'`** (line 5):
```typescript
export const qk = {
  ohlcv: (symbol: string) => ['ohlcv', symbol, '1d'] as const,
  search: (query: string) => ['search', query] as const
}
```
Change to `ohlcv: (symbol: string, tf: Timeframe) => ['ohlcv', symbol, tf] as const` so TanStack Query
naturally separates per-timeframe cache entries (each timeframe switch is then just a `useQuery` key
change — no manual invalidation needed, consistent with how `SettingsDialog.tsx`'s
`queryClient.invalidateQueries({ queryKey: ['ohlcv'] })` already invalidates by the shared `'ohlcv'` prefix
regardless of the trailing key segments).

---

### `src/renderer/App.tsx` (component, request-response)

**Analog:** itself.

**Current root composition** (full file, lines 1-30) — the mount point for `<Toaster />` (Sonner, shadcn):
```tsx
return (
  <div className="flex h-screen flex-col bg-background text-foreground">
    <header className="flex items-center gap-4 border-b border-border bg-card px-8 py-4">
      <span className="text-2xl font-semibold">{activeSymbol ?? '—'}</span>
      <div className="ml-auto flex items-center gap-4">
        <SearchBar />
        <SettingsDialog />
      </div>
    </header>
    <main className="flex-1">
      {activeSymbol
        ? <Chart symbol={activeSymbol} />
        : <div className="p-6 text-muted-foreground">Search a symbol to begin.</div>}
    </main>
  </div>
)
```
`<Toaster />` mounts once here (sibling to the top-level `<div>`, per shadcn's own convention), not inside
`Chart.tsx` — toast state is app-global, chart-local mounting would remount/duplicate it on symbol change.

**D-06/D-07 restore-on-boot pattern** (lines 11-13) — unaffected by this phase (D-12: default timeframe
is always `'D'`, never persisted), included for context since it's the sibling decision:
```typescript
useEffect(() => {
  void api.settings.getLastSymbol().then((last) => setActiveSymbol(last ?? 'AAPL')) // D-06/D-07
}, [setActiveSymbol])
```

---

### `src/renderer/store.ts` (store, event-driven)

**Analog:** itself — the entire file is the template (11 lines):
```typescript
import { create } from 'zustand'

type AppState = {
  activeSymbol: string | null
  setActiveSymbol: (symbol: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  activeSymbol: null,
  setActiveSymbol: (symbol) => set({ activeSymbol: symbol })
}))
```
If the planner lifts `activeTimeframe` to global state (needed only if something other than
`TimeframeRow`+`Chart` must read it), add it following this exact `field` + `setField` pairing. **Note
for planner:** if `TimeframeRow.tsx` and `Chart.tsx` end up composed as parent/child (row owns the
canvas) rather than siblings under `App.tsx`, plain `useState` in the parent may suffice — don't lift to
Zustand pre-emptively (YAGNI; this file has exactly one field today for the same reason).

---

### `src/main/capabilityClassifier.ts` (new; utility, transform)

**Analog:** `src/main/providers/FmpProvider.ts` (error surfacing) + `src/main/providers/fmp.schema.ts`
(zod-throw-as-signal).

**The existing "detect a bad response" mechanism this hooks into** — `fmpHistoricalResponse.parse(...)`
throwing on an HTTP-200 error-shaped payload (already proven by the real fixture below) is exactly
DESIGN-ADDENDUM §7's `requires-plan` condition #2 ("HTTP-200 error-shaped payload, zod parse fails"):

`tests/fixtures/fmp-error.json` (real captured FMP shape, already in the repo):
```json
{ "Error Message": "Invalid API KEY. Please retry or visit our documentation" }
```

`src/main/providers/FmpProvider.ts` line 32 comment already states the intent this classifier formalizes:
```typescript
// zod .parse throws on error-shaped payloads → never surfaces bad data
```

Per DESIGN-ADDENDUM §7, this is a pure function (no I/O) — `classify(status: number, body: unknown):
'requires-plan' | 'rate-limited' | 'available'` — checking HTTP 403/429 first, then message-content
sniffing (`premium`/`exclusive`/`legacy` → requires-plan; rate-limit wording → rate-limited) on whatever
body the now-status-aware `httpGetJson` (see FmpProvider note above) surfaces. Mark the message-string
conditions with `// ponytail:` per DESIGN-ADDENDUM §7 ("known tuning point pending real-key verification").

---

### `src/main/capabilityCache.ts` (new; service, file-I/O)

**Analog:** `src/main/settings.ts` (full file, 24 lines — near-exact structural match) +
`src/main/keystore.ts` (in-memory cache invalidation).

**Exact template to copy** — small JSON under userData, corrupt-file self-heals, plain read/write
functions, `// ponytail:` comment explaining why no dependency was added:
```typescript
import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

// ponytail: one small JSON under userData, not electron-store — no dependency for one field (design doc)
const settingsPath = (): string => join(app.getPath('userData'), 'settings.json')

function read(): Record<string, unknown> {
  if (!existsSync(settingsPath())) return {}
  try {
    return JSON.parse(readFileSync(settingsPath(), 'utf8'))
  } catch {
    return {} // corrupt file → treat as empty; next write heals it
  }
}
```
Swap `settings.json` → `capabilities.json`, and the value shape → `{ [keyHash]: { [tf]: { status, probedAt? } } }`
per DESIGN-ADDENDUM §8.

**Invalidate-on-key-change pattern to copy from `keystore.ts`** (lines 33-36, `clearApiKey`):
```typescript
export function clearApiKey(): void {
  cached = null
  if (existsSync(keyPath())) rmSync(keyPath())
}
```
DESIGN-ADDENDUM §8's "cleared on API-key change" is the same shape — call the capability-cache
equivalent from wherever `setApiKey`/`clearApiKey` are called in `main/ipc.ts` (currently
`ipcMain.handle(CH.apikeySet, ...)` / `ipcMain.handle(CH.apikeyClear, ...)`, lines 34/36), since that's
already the one choke point every key change passes through.

**TTL asymmetry (no generic TTL — two different rules)**: unlike `searchCache.ts`'s uniform TTL, DESIGN-
ADDENDUM §8 needs two different expiry rules (`rate-limited` expires next UTC day; `requires-plan` never
expires until key change) — don't reuse `searchCache.ts`'s single-`ttlMs` shape as-is; store a per-status
expiry rule instead, or two fields.

---

### `src/main/aggregate.ts` (new; utility, batch/transform)

**Analog:** `src/main/db/barStore.ts` → `coverageFromBars` (pure function, `Bar[]` in, derived shape out).

**Pattern to copy** (barStore.ts lines 6-15 — loop-and-reduce over `Bar[]`, no I/O, trivially testable):
```typescript
export function coverageFromBars(input: Bar[]): { oldestTime: number; newestTime: number } | null {
  if (input.length === 0) return null
  let oldest = input[0].time
  let newest = input[0].time
  for (const b of input) {
    if (b.time < oldest) oldest = b.time
    if (b.time > newest) newest = b.time
  }
  return { oldestTime: oldest, newestTime: newest }
}
```
Per DESIGN-ADDENDUM §6: `deriveWeekly(daily: Bar[]): Bar[]` / `deriveMonthly(daily: Bar[]): Bar[]` —
bucket by Monday-start week / calendar month (boundaries cut on `America/New_York` date), then per bucket:
`open` = first, `high` = max, `low` = min, `close` = last, `volume` = sum. Same "pure function, no I/O"
shape as `coverageFromBars`; called from `CacheService.ts`'s orchestration layer (see above), never
called directly by `barStore.ts` or the provider. This is the one place `date-fns-tz` week/month-boundary
logic is genuinely new — see `## No Analog Found`.

---

### `src/renderer/components/TimeframeRow.tsx` (new; component, event-driven)

**Analog:** `src/renderer/components/SearchBar.tsx` (control-row: store + query + click handler wiring).

**Structural pattern to copy** (SearchBar.tsx lines 9-25 — store setter + `useQuery` + click handler,
collapsed to the relevant shape):
```tsx
export function SearchBar(): React.JSX.Element {
  const [text, setText] = useState('')
  const setActiveSymbol = useAppStore((s) => s.setActiveSymbol)

  const q = useQuery({
    queryKey: qk.search(confirmed),
    queryFn: () => api.symbols.search(confirmed),
    enabled: confirmed.length > 0
  })

  const onSelect = (symbol: string): void => {
    setActiveSymbol(symbol)
    void api.settings.setLastSymbol(symbol)
    // ...
  }
  // ...
}
```
`TimeframeRow` follows the same shape: `useQuery({ queryKey: ['capabilities'], queryFn: api.capabilities.get })`
for the per-tf status map (UI-SPEC's "last-known + revalidate" — default `q.data` to all-`'available'`
optimistically per the UI-SPEC's explicit fallback rule when `undefined`), a fixed array of the 7
timeframe labels (never data-driven — UI-SPEC "zero-one-many: fixed set of exactly 7"), and an
`onSelect(tf)` handler that mirrors `SearchBar`'s `onSelect(symbol)` shape.

**Disabled-interactive-element precedent already exists** (`SettingsDialog.tsx` line 58) — reuse this
exact idea (native `disabled` prop, not a CSS-only fake-disabled state) for gated buttons:
```tsx
<Button onClick={save} disabled={key.length === 0}>Save API Key</Button>
```
Radix `ToggleGroupItem` (shadcn's `toggle-group.tsx`) passes `disabled` straight through to the underlying
button element the same way.

**Gated-badge sub-rendering** — UI-SPEC describes a Lock/Clock badge + Tooltip riding on each gated
button. Given it's a few lines of JSX per toggle-group item (badge + tooltip wrapping one button, not a
reusable-elsewhere unit), consider inlining it inside `TimeframeRow.tsx` as a small local sub-component
rather than a separate file — the codebase's existing convention for a component-with-sub-parts
(`SettingsDialog.tsx` keeping its own dialog body inline; `SearchResults.tsx` living in its own file
because `SearchBar.tsx` conditionally mounts it as a distinct overlay) suggests "own file" is reserved for
things that toggle their own mount/unmount, not for JSX-only conditional styling. Planner's call.

---

### `src/renderer/components/ui/{toggle-group,tooltip,badge,sonner}.tsx` (new, shadcn CLI)

**Analog:** `src/renderer/components/ui/button.tsx` (cva variants + `forwardRef` + `cn`) and
`src/renderer/components/ui/alert.tsx` (cva + multi-part composition: `Alert`/`AlertTitle`/`AlertDescription`).

**The convention every existing `ui/*.tsx` file follows** (button.tsx lines 1-6, 42-54):
```typescript
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
// ...
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  }
)
Button.displayName = "Button"
```
These four new files are generated by `npx shadcn add toggle-group tooltip badge sonner` (per UI-SPEC
§Registry Safety — shadcn official, no user prompt needed since `components.json` already exists with
the confirmed `zinc`/CSS-variables/dark-mode preset). The shadcn CLI output already matches this exact
convention verbatim — no hand-adaptation needed beyond confirming the generated files land under
`src/renderer/components/ui/` per the existing `aliases.components: "@/components"` in `components.json`.
`sonner` (the underlying npm package, not just the shadcn wrapper) is a **new dependency** — not yet in
`package.json`; the shadcn CLI adds it automatically.

**`cn()` helper these all depend on** (`src/renderer/lib/utils.ts`, full file):
```typescript
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

---

### Test files

**`tests/main/capabilityClassifier.test.ts`** — analog `tests/main/providers/FmpProvider.test.ts`
(fixture-based pure-function tests, lines 6-8 fixture loader + lines 19-21 error-payload assertion):
```typescript
const fx = (name: string) => JSON.parse(readFileSync(join(__dirname, '../../fixtures', name), 'utf8'))
// ...
it('throws on an error-shaped 200 payload, never returning bars', async () => {
  await expect(provider(fx('fmp-error.json')).getOHLCV('AAPL', '1d', undefined)).rejects.toThrow()
})
```
Reuse the existing `tests/fixtures/fmp-error.json` directly for the requires-plan case. Add two new
fixtures: a 403-body and a 429/rate-limit-message body, following the same flat-JSON-file convention as
`fmp-error.json`/`fmp-historical.json`/`fmp-search.json`.

**`tests/main/aggregate.test.ts`** — analog `tests/main/db/coverageFromBars.test.ts` (full file, 14 lines
— table-style pure-function assertions):
```typescript
const bar = (time: number): Bar => ({ time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 })

describe('coverageFromBars', () => {
  it('returns null for empty input', () => {
    expect(coverageFromBars([])).toBeNull()
  })
  it('returns min and max time regardless of order', () => {
    expect(coverageFromBars([bar(300), bar(100), bar(200)])).toEqual({ oldestTime: 100, newestTime: 300 })
  })
})
```
Same `bar(time)` factory-function convention, extended with `open`/`high`/`low`/`close`/`volume` values
that make weekly/monthly OHLC aggregation assertable (first/max/min/last/sum per bucket).

**`tests/main/cache/CacheService.test.ts` (extended)** — analog is itself; copy the `fakeStore` factory
(lines 7-18) and add a case where `cov` exists but doesn't fully cover `range`, asserting
`provider.getOHLCV` is called with the narrowed gap range, not `undefined`:
```typescript
function fakeStore(initialBars: Bar[] = [], cov: { oldestTime: number; newestTime: number } | null = null) {
  let stored = [...initialBars]
  let coverage = cov
  return {
    getCoverage: vi.fn(() => coverage),
    getBars: vi.fn(() => [...stored].sort((a, b) => a.time - b.time)),
    upsertBarsAndCoverage: vi.fn((_s: string, _tf: string, bars: Bar[]) => { /* ... */ })
  }
}
```

**`tests/main/capabilityCache.test.ts`** — analog `tests/main/searchCache.test.ts` (TTL-via-injected-`now()`,
full file 31 lines) for the pure TTL-expiry logic:
```typescript
it('expires results after the TTL window', () => {
  let t = 0
  const cache = createSearchCache({ ttlMs: 1000, now: () => t })
  cache.set('AAPL', results)
  t = 1001
  expect(cache.get('AAPL')).toBeUndefined()
})
```
See the caveat in `## File Classification` above — the userData JSON I/O portion has no tested P1
precedent; this pattern only covers the in-memory TTL/expiry-rule logic, injected the same way.

---

## Shared Patterns

### Read-through cache / lazy-probe-then-cache
**Source:** `src/main/cache/CacheService.ts` lines 22-31
**Apply to:** `CacheService.ts`'s gap-fetch extension; `capabilityCache.ts`'s "lazily probed on first
request" (D-21) — same check-cache → miss → do-the-expensive-thing → store → return shape.

### zod `.parse()` throw as the "bad response" signal
**Source:** `src/main/providers/fmp.schema.ts` + `src/main/providers/FmpProvider.ts` line 32 comment
**Apply to:** New intraday schema in `fmp.schema.ts`; `capabilityClassifier.ts`'s `requires-plan`
detection (an HTTP-200 payload that fails `.parse()` **is** the signal — don't build a second detection
mechanism).

### Small JSON file under userData, corrupt-file self-heals
**Source:** `src/main/settings.ts` (full file)
```typescript
function read(): Record<string, unknown> {
  if (!existsSync(settingsPath())) return {}
  try {
    return JSON.parse(readFileSync(settingsPath(), 'utf8'))
  } catch {
    return {} // corrupt file → treat as empty; next write heals it
  }
}
```
**Apply to:** `capabilityCache.ts` — exact template, swap the filename and value shape.

### Main-process-only secrets — renderer only ever sees a classified status
**Source:** `src/main/keystore.ts` `getKeyStatus()` (never returns the raw key, only `{hasKey, encryptionAvailable}`)
**Apply to:** `capabilities.get()` IPC — renderer only ever receives the classified per-tf status map,
never a raw FMP response body or status code.

### Typed IPC contract mirrored 1:1 across three files
**Source:** `src/shared/ipc.ts` (`CH` + `Api`) / `src/main/ipc.ts` (`ipcMain.handle`) / `src/preload/index.ts` (`ipcRenderer.invoke`)
**Apply to:** The new `capabilities.get` channel — add the constant, the interface member, the handler,
and the bridge, in that order, each mirroring the existing `apikeyStatus` triplet exactly.

### shadcn `ui/*.tsx` convention: cva + forwardRef + `cn`
**Source:** `src/renderer/components/ui/button.tsx`, `alert.tsx`
**Apply to:** The four new shadcn-generated files (`toggle-group`, `tooltip`, `badge`, `sonner`) — CLI
output already follows this; no manual adaptation expected.

### Fixture-based Vitest for pure functions
**Source:** `tests/main/providers/FmpProvider.test.ts` (`tests/fixtures/*.json`), `tests/main/db/coverageFromBars.test.ts`
**Apply to:** `capabilityClassifier.test.ts` (new fixtures for 403/429 bodies), `aggregate.test.ts` (bar-array
table tests).

### TanStack Query key must include every cache-varying parameter
**Source:** `src/renderer/api.ts` line 5 (currently missing `timeframe`)
**Apply to:** `api.ts`'s `qk.ohlcv`, `Chart.tsx`'s `useQuery` call — both must add `tf` to the key so
switching timeframe is a plain key change, no manual `invalidateQueries` needed (consistent with how
`SettingsDialog.tsx` already invalidates by the `['ohlcv']` prefix on API-key change).

### Orchestration (I/O) vs. pure computation split
**Source:** `src/main/cache/CacheService.ts` (orchestration) delegating to `src/main/db/barStore.ts`'s
`coverageFromBars` (pure function)
**Apply to:** `CacheService.ts` should delegate W/M requests to `aggregate.ts` the same way it already
implicitly relies on `barStore.ts`'s pure helpers — keep `aggregate.ts` I/O-free and unit-testable in
isolation, called from the orchestration layer, not from `barStore.ts` or the provider.

---

## No Analog Found

Sub-patterns (not whole files — the files they live in do have analogs above) with zero precedent
anywhere in the P1 codebase. Planner should follow `02-DESIGN-ADDENDUM.md` directly for these, not a
codebase analog:

| Sub-pattern | Lives in | Reason |
|---|---|---|
| Exchange-local → UTC timezone conversion (`date-fns-tz`, `America/New_York`) | `FmpProvider.ts` (intraday timestamp parsing), `aggregate.ts` (week/month boundary cuts) | P1's only date handling is `dateToEpochSeconds`'s UTC-midnight parse (`FmpProvider.ts` lines 16-18) — no timezone-aware parsing exists. `date-fns-tz`/Luxon is **not yet a dependency** in `package.json` (confirmed — CLAUDE.md recommends it, but P1 never needed it since daily EOD dates are timezone-free). This is a genuinely new capability, not an extension. |
| Transient toast notification triggered mid-session | `TimeframeRow.tsx` or `Chart.tsx` (wherever the active-timeframe rate-limit is observed), `App.tsx` (`<Toaster/>` mount) | P1's only error-surfacing pattern is a **persistent inline** `<Alert>`/error `<div>` (`SettingsDialog.tsx` lines 42-48, `Chart.tsx` lines 54-58, `SearchResults.tsx` lines 13-18) — never a transient, self-dismissing notification. Sonner itself is a new dependency (added via shadcn CLI). Follow UI-SPEC's exact copy contract and DESIGN-ADDENDUM §7/§8's transient-vs-sticky status distinction directly. |

---

## Metadata

**Analog search scope:** `src/` (all of `main`, `preload`, `renderer`, `shared`), `tests/` (all existing
test files + fixtures), `package.json`, `components.json`, `tsconfig.web.json`.
**Files scanned:** 25 existing source files (all ≤ 151 lines — every file read in a single pass, no
re-reads), 4 existing test files, 3 existing fixtures, `package.json`/`components.json`/`tsconfig.web.json`.
**Pattern extraction date:** 2026-07-19
**Dependency gap noted:** `date-fns-tz` (or Luxon) is in `CLAUDE.md`'s stack table but **not yet installed**
— needed for `FmpProvider.ts` intraday parsing and `aggregate.ts` week/month boundaries. `sonner` (npm
package) is added transitively when `npx shadcn add sonner` runs.
