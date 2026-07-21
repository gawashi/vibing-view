# Latest Price via Quote — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show one consistent "latest price" in both the watchlist and on every chart — `quote.price` during market hours, the most recent completed daily close otherwise.

**Architecture:** Add `getQuote`/`getMarketStatus` to the FMP adapter and expose them over IPC (bypassing the SQLite OHLCV cache — quotes are volatile). On the existing global reload, fetch market status once and, only when open, a single quote per visible/watchlist symbol into the TanStack Query cache. A render-time pure function `applyQuote` patches the chart's trailing candle; the watchlist reads the same quote. Quote/market-status errors reject and are swallowed → silent fallback to daily close.

**Tech Stack:** TypeScript, React, Electron, TanStack Query, zod, lightweight-charts, date-fns-tz, Vitest.

## Global Constraints

- Tech stack is TypeScript + React; provider access goes through the adapter (`FmpProvider`) — swapping it must not touch query/cache layers.
- **SQLite = OHLCV cache only. Quotes and market status must NOT be written to SQLite** (they live in the renderer's TanStack Query cache, replaced on reload).
- Data freshness may lag; **no polling / no fetch-on-mount** — quote/market-status refresh only on the global reload button.
- Free-tier resilience: a 402/403/429 on quote/market-status must degrade silently to the daily-close fallback, never crash.
- FMP `/stable` base URL; `batch-quote` is plan-gated (402) — use single `/stable/quote` per symbol.
- Test runner: `npx vitest run <path>`. Typecheck: `npm run typecheck`.

---

## File Structure

- `src/shared/types.ts` — add `Quote`, `MarketStatus` types (M)
- `src/main/providers/fmp.schema.ts` — add `fmpQuoteResponse`, `fmpMarketHoursResponse` (M)
- `src/main/providers/FmpProvider.ts` — add `getQuote`, `getMarketStatus` (M)
- `tests/fixtures/fmp-quote.json`, `tests/fixtures/fmp-market-hours.json` — provider test fixtures (C)
- `src/shared/ipc.ts` — add channels + `Api.quote`/`Api.market` (M)
- `src/main/ipc.ts` — add handlers (M)
- `src/preload/index.ts` — add bridge methods (M)
- `src/renderer/api.ts` — add `qk.quote`, `qk.marketStatus` (M)
- `src/renderer/lib/applyQuote.ts` — new pure fn (C)
- `src/renderer/lib/quoteTargets.ts` — new pure fn `quoteSymbols` (C)
- `src/renderer/lib/priceChange.ts` — add `latestPriceChange` helper (M)
- `src/renderer/App.tsx` — extend `handleReload` (M)
- `src/renderer/components/Watchlist.tsx` — consume quote + market status (M)
- `src/renderer/components/Chart.tsx` — consume quote + market status via `applyQuote` (M)
- Tests: `tests/main/providers/FmpProvider.test.ts` (M), `tests/renderer/applyQuote.test.ts` (C), `tests/renderer/quoteTargets.test.ts` (C), `tests/renderer/priceChange.test.ts` (M)

---

## Task 1: Provider `getQuote` + `getMarketStatus`

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/providers/fmp.schema.ts`
- Modify: `src/main/providers/FmpProvider.ts`
- Create: `tests/fixtures/fmp-quote.json`, `tests/fixtures/fmp-market-hours.json`
- Test: `tests/main/providers/FmpProvider.test.ts`

**Interfaces:**
- Produces: `Quote = { price, open, dayHigh, dayLow, previousClose, changePercentage, timestamp, exchange }` (all `number` except `exchange: string`); `MarketStatus = { isOpen: boolean }`; `FmpProvider.getQuote(symbol: string): Promise<Quote>`; `FmpProvider.getMarketStatus(exchange?: string): Promise<MarketStatus>`.

- [ ] **Step 1: Add types to `src/shared/types.ts`**

Append after the `Bar` type:

```ts
export type Quote = {
  price: number
  open: number
  dayHigh: number
  dayLow: number
  previousClose: number
  changePercentage: number
  timestamp: number // epoch seconds
  exchange: string
}

export type MarketStatus = { isOpen: boolean }
```

- [ ] **Step 2: Add schemas to `src/main/providers/fmp.schema.ts`**

Append at the end of the file:

```ts
// /stable/quote returns a flat array; we consume element [0]. Fields verified against a live key
// (2026-07-21). A missing/null field fails the parse → FmpHttpError(200) → silent daily-close fallback.
export const fmpQuoteRow = z.object({
  symbol: z.string(),
  price: z.number(),
  open: z.number(),
  dayHigh: z.number(),
  dayLow: z.number(),
  previousClose: z.number(),
  changePercentage: z.number(),
  timestamp: z.number(),
  exchange: z.string()
})
export const fmpQuoteResponse = z.array(fmpQuoteRow)

// /stable/exchange-market-hours returns a flat array; element [0] carries isMarketOpen.
export const fmpMarketHoursRow = z.object({
  exchange: z.string(),
  isMarketOpen: z.boolean()
})
export const fmpMarketHoursResponse = z.array(fmpMarketHoursRow)
```

- [ ] **Step 3: Create fixtures**

`tests/fixtures/fmp-quote.json`:

```json
[
  {
    "symbol": "AAPL",
    "price": 326.59,
    "open": 333.025,
    "dayHigh": 333.71,
    "dayLow": 323.7,
    "previousClose": 333.74,
    "changePercentage": -2.14239,
    "timestamp": 1784577600,
    "exchange": "NASDAQ"
  }
]
```

`tests/fixtures/fmp-market-hours.json`:

```json
[
  { "exchange": "NASDAQ", "name": "NASDAQ", "isMarketOpen": false }
]
```

- [ ] **Step 4: Write the failing tests**

Append to `tests/main/providers/FmpProvider.test.ts`:

```ts
import { fmpQuoteResponse, fmpMarketHoursResponse } from '../../../src/main/providers/fmp.schema'

describe('FmpProvider.getQuote', () => {
  it('maps the first quote row to a Quote', async () => {
    const q = await provider(fx('fmp-quote.json')).getQuote('AAPL')
    expect(q).toEqual({
      price: 326.59, open: 333.025, dayHigh: 333.71, dayLow: 323.7,
      previousClose: 333.74, changePercentage: -2.14239, timestamp: 1784577600, exchange: 'NASDAQ'
    })
  })
  it('calls /stable/quote with the symbol', async () => {
    const httpGetJson = vi.fn(async (_url: string) => fx('fmp-quote.json'))
    await new FmpProvider({ apiKey: 'k', httpGetJson }).getQuote('AAPL')
    expect(httpGetJson.mock.calls[0][0]).toContain('/quote?symbol=AAPL')
  })
  it('wraps an error-shaped 200 payload as FmpHttpError(200) so it classifies to requires-plan', async () => {
    let caught: unknown
    try { await provider(fx('fmp-error.json')).getQuote('AAPL') } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(FmpHttpError)
    expect(classify((caught as FmpHttpError).status, (caught as FmpHttpError).body)).toBe('requires-plan')
  })
})

describe('FmpProvider.getMarketStatus', () => {
  it('reads isMarketOpen from the first row', async () => {
    const s = await provider(fx('fmp-market-hours.json')).getMarketStatus()
    expect(s).toEqual({ isOpen: false })
  })
  it('defaults to the NASDAQ exchange', async () => {
    const httpGetJson = vi.fn(async (_url: string) => fx('fmp-market-hours.json'))
    await new FmpProvider({ apiKey: 'k', httpGetJson }).getMarketStatus()
    expect(httpGetJson.mock.calls[0][0]).toContain('exchange-market-hours?exchange=NASDAQ')
  })
})
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npx vitest run tests/main/providers/FmpProvider.test.ts`
Expected: FAIL — `getQuote`/`getMarketStatus` are not functions.

- [ ] **Step 6: Implement the provider methods**

In `src/main/providers/FmpProvider.ts`, update the import line:

```ts
import { fmpHistoricalResponse, fmpSearchResponse, fmpQuoteResponse, fmpMarketHoursResponse } from './fmp.schema'
```

Add `Quote, MarketStatus` to the type import from `@shared/types`:

```ts
import type { Bar, SymbolResult, Timeframe, DateRange, Quote, MarketStatus } from '@shared/types'
```

Add these two methods inside the `FmpProvider` class (after `getOHLCV`):

```ts
  async getQuote(symbol: string): Promise<Quote> {
    const url = `${BASE}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${this.apiKey}`
    const rows = this.parseOrThrowHttpError(fmpQuoteResponse, await this.httpGetJson(url))
    const r = rows[0]
    if (!r) throw new FmpHttpError(200, rows)
    return {
      price: r.price, open: r.open, dayHigh: r.dayHigh, dayLow: r.dayLow,
      previousClose: r.previousClose, changePercentage: r.changePercentage,
      timestamp: r.timestamp, exchange: r.exchange
    }
  }

  async getMarketStatus(exchange = 'NASDAQ'): Promise<MarketStatus> {
    const url = `${BASE}/exchange-market-hours?exchange=${encodeURIComponent(exchange)}&apikey=${this.apiKey}`
    const rows = this.parseOrThrowHttpError(fmpMarketHoursResponse, await this.httpGetJson(url))
    const r = rows[0]
    if (!r) throw new FmpHttpError(200, rows)
    return { isOpen: r.isMarketOpen }
  }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/main/providers/FmpProvider.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/main/providers/fmp.schema.ts src/main/providers/FmpProvider.ts tests/fixtures/fmp-quote.json tests/fixtures/fmp-market-hours.json tests/main/providers/FmpProvider.test.ts
git commit -m "feat(provider): add getQuote and getMarketStatus"
```

---

## Task 2: IPC + preload + query keys

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/api.ts`

**Interfaces:**
- Consumes: `FmpProvider.getQuote`, `FmpProvider.getMarketStatus` (Task 1); `Quote`, `MarketStatus`.
- Produces: `api.quote.get(symbol): Promise<Quote>`; `api.market.status(): Promise<MarketStatus>`; `qk.quote(symbol) = ['quote', symbol]`; `qk.marketStatus() = ['market-status']`.

- [ ] **Step 1: Add channels + Api surface in `src/shared/ipc.ts`**

Add to the `CH` object (after `ohlcvRefresh`):

```ts
  quoteGet: 'quote:get',
  marketStatus: 'market:status',
```

Update the top import to include the new types:

```ts
import type { Bar, SymbolResult, Timeframe, DateRange, Workspace, WatchlistCollection, Quote, MarketStatus } from './types'
```

Add to the `Api` interface (after the `ohlcv` block):

```ts
  quote: { get(symbol: string): Promise<Quote> }
  market: { status(): Promise<MarketStatus> }
```

- [ ] **Step 2: Add handlers in `src/main/ipc.ts`**

Inside `registerIpc`, after the `cacheFor` definition, add a provider factory:

```ts
  // Quote / market-status are volatile and NOT cached in SQLite (SQLite = OHLCV only). They call
  // the provider directly; errors reject and the renderer's reload flow swallows them → daily-close
  // fallback. Not recorded in the per-Timeframe capability cache (they aren't timeframes).
  const providerFor = () => {
    const apiKey = getApiKey()
    if (!apiKey) throw new Error('NO_API_KEY')
    return new FmpProvider({ apiKey })
  }
```

Register the handlers (near the `ohlcvRefresh` handler):

```ts
  ipcMain.handle(CH.quoteGet, (_e, symbol: string) => providerFor().getQuote(symbol))
  ipcMain.handle(CH.marketStatus, () => providerFor().getMarketStatus())
```

- [ ] **Step 3: Add preload bridge in `src/preload/index.ts`**

Add to the `api` object (after the `ohlcv` block):

```ts
  quote: { get: (symbol) => ipcRenderer.invoke(CH.quoteGet, symbol) },
  market: { status: () => ipcRenderer.invoke(CH.marketStatus) },
```

- [ ] **Step 4: Add query keys in `src/renderer/api.ts`**

Add to the `qk` object:

```ts
  quote: (symbol: string) => ['quote', symbol] as const,
  marketStatus: () => ['market-status'] as const
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors). This gates the IPC wiring end-to-end (the `Api` interface must match preload + `api.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/main/ipc.ts src/preload/index.ts src/renderer/api.ts
git commit -m "feat(ipc): expose quote and market-status channels"
```

---

## Task 3: `applyQuote` render-time merge

**Files:**
- Create: `src/renderer/lib/applyQuote.ts`
- Test: `tests/renderer/applyQuote.test.ts`

**Interfaces:**
- Consumes: `Bar`, `Quote`, `Timeframe`.
- Produces: `applyQuote(bars: Bar[], quote: Quote | undefined, isOpen: boolean, timeframe: Timeframe): Bar[]`.

- [ ] **Step 1: Write the failing tests**

Create `tests/renderer/applyQuote.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { applyQuote } from '../../src/renderer/lib/applyQuote'
import type { Bar, Quote } from '../../src/shared/types'

const DAY = 86400
const bar = (day: number, close: number): Bar => ({ time: day * DAY, open: close, high: close, low: close, close, volume: 0 })
// Jan 2 2026 15:00Z = 10:00 ET → NY trading date Jan 2 2026 → bucket = Date.UTC(2026,0,2)/1000.
const TS = Math.floor(Date.UTC(2026, 0, 2, 15, 0, 0) / 1000)
const JAN1 = Math.floor(Date.UTC(2026, 0, 1) / 1000)
const JAN2 = Math.floor(Date.UTC(2026, 0, 2) / 1000)
const quote = (over: Partial<Quote> = {}): Quote => ({
  price: 110, open: 105, dayHigh: 112, dayLow: 104, previousClose: 100,
  changePercentage: 10, timestamp: TS, exchange: 'NASDAQ', ...over
})

describe('applyQuote', () => {
  it('returns bars unchanged when closed', () => {
    const bars = [bar(1, 100)]
    expect(applyQuote(bars, quote(), false, '1d')).toBe(bars)
  })
  it('returns bars unchanged when no quote', () => {
    const bars = [bar(1, 100)]
    expect(applyQuote(bars, undefined, true, '1d')).toBe(bars)
  })
  it('returns bars unchanged when empty', () => {
    expect(applyQuote([], quote(), true, '1d')).toEqual([])
  })
  it('intraday: patches trailing bar close and extends high/low', () => {
    const out = applyQuote([bar(1, 90), { ...bar(1, 108), high: 108, low: 100 }], quote({ price: 111 }), true, '5m')
    expect(out).toHaveLength(2)
    expect(out[1].close).toBe(111)
    expect(out[1].high).toBe(111) // 111 > 108
    expect(out[1].low).toBe(100)  // 100 < 111
  })
  it('daily: appends a forming today bar when today is past the last daily bar', () => {
    const out = applyQuote([bar(0, 90), { time: JAN1, open: 100, high: 101, low: 99, close: 100, volume: 5 }], quote(), true, '1d')
    expect(out).toHaveLength(3)
    expect(out[2]).toEqual({ time: JAN2, open: 105, high: 112, low: 104, close: 110, volume: 0 })
  })
  it('daily: patches (does not append) when the last bar is already today', () => {
    const out = applyQuote([{ time: JAN2, open: 100, high: 101, low: 99, close: 100, volume: 5 }], quote({ price: 111 }), true, '1d')
    expect(out).toHaveLength(1)
    expect(out[0].close).toBe(111)
  })
  it('daily: never appends out of order (today before last bar → patch)', () => {
    const future = Math.floor(Date.UTC(2026, 0, 3) / 1000)
    const out = applyQuote([{ time: future, open: 100, high: 101, low: 99, close: 100, volume: 5 }], quote(), true, '1d')
    expect(out).toHaveLength(1)
    expect(out[0].close).toBe(110)
  })
  it('weekly/monthly: patches trailing bar only, never appends', () => {
    const bars = [{ time: JAN1, open: 100, high: 101, low: 99, close: 100, volume: 5 }]
    expect(applyQuote(bars, quote(), true, '1w')).toHaveLength(1)
    expect(applyQuote(bars, quote(), true, '1w')[0].close).toBe(110)
    expect(applyQuote(bars, quote(), true, '1M')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/renderer/applyQuote.test.ts`
Expected: FAIL — cannot find module `applyQuote`.

- [ ] **Step 3: Implement `applyQuote`**

Create `src/renderer/lib/applyQuote.ts`:

```ts
import { toZonedTime } from 'date-fns-tz'
import type { Bar, Quote, Timeframe } from '@shared/types'

const INTRADAY: ReadonlySet<Timeframe> = new Set<Timeframe>(['1m', '5m', '15m', '1h'])
const DERIVED: ReadonlySet<Timeframe> = new Set<Timeframe>(['1w', '1M'])

// UTC-midnight epoch seconds of the NY trading date for a quote timestamp. Daily bars are keyed at
// UTC midnight of the FMP date string (= the NY trading date), so the forming today-bar must use
// the same rule or it collides with / misorders against the last daily bar.
function nyTradingDayUtcMidnight(tsSeconds: number): number {
  const ny = toZonedTime(tsSeconds * 1000, 'America/New_York')
  return Math.floor(Date.UTC(ny.getFullYear(), ny.getMonth(), ny.getDate()) / 1000)
}

// Render-time overlay of the live quote onto the cached candles. Never mutates the query cache.
export function applyQuote(
  bars: Bar[],
  quote: Quote | undefined,
  isOpen: boolean,
  timeframe: Timeframe
): Bar[] {
  if (!isOpen || !quote || bars.length === 0) return bars

  const last = bars[bars.length - 1]
  const patched: Bar = {
    ...last,
    close: quote.price,
    high: Math.max(last.high, quote.price),
    low: Math.min(last.low, quote.price)
  }

  // Intraday and derived W/M: patch the trailing bar only (never invent a bucket boundary).
  if (INTRADAY.has(timeframe) || DERIVED.has(timeframe)) {
    return [...bars.slice(0, -1), patched]
  }

  // Daily: append a forming "today" bar if today's bucket is beyond the last cached bar; else patch.
  // Strictly-ascending guard: only append when today > last.time (lightweight-charts requires it).
  const today = nyTradingDayUtcMidnight(quote.timestamp)
  if (today > last.time) {
    return [...bars, { time: today, open: quote.open, high: quote.dayHigh, low: quote.dayLow, close: quote.price, volume: 0 }]
  }
  return [...bars.slice(0, -1), patched]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/applyQuote.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/applyQuote.ts tests/renderer/applyQuote.test.ts
git commit -m "feat(chart): applyQuote trailing-candle overlay"
```

---

## Task 4: `quoteSymbols` reload target selector

**Files:**
- Create: `src/renderer/lib/quoteTargets.ts`
- Test: `tests/renderer/quoteTargets.test.ts`

**Interfaces:**
- Consumes: `Cell`, `GridShape` (`@shared/types`); `VISIBLE_COUNT` (`../workspace`).
- Produces: `quoteSymbols(cells: Cell[], shape: GridShape, watchlistSymbols?: string[]): string[]`.

- [ ] **Step 1: Write the failing tests**

Create `tests/renderer/quoteTargets.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { quoteSymbols } from '../../src/renderer/lib/quoteTargets'
import type { Cell } from '../../src/shared/types'

const cell = (id: string, symbol: string | null): Cell => ({ id, symbol, timeframe: '1d', indicators: [] })

describe('quoteSymbols', () => {
  it('collects visible cell symbols, skipping empty cells', () => {
    expect(quoteSymbols([cell('a', 'AAPL'), cell('b', null)], '2x1')).toEqual(['AAPL'])
  })
  it('unions watchlist symbols and de-dupes', () => {
    const out = quoteSymbols([cell('a', 'AAPL')], '1x1', ['AAPL', 'MSFT'])
    expect(out.sort()).toEqual(['AAPL', 'MSFT'])
  })
  it('ignores cells beyond the visible count for the shape', () => {
    // 1x1 shows 1 cell → the second cell's symbol is not quoted.
    expect(quoteSymbols([cell('a', 'AAPL'), cell('b', 'MSFT')], '1x1')).toEqual(['AAPL'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/renderer/quoteTargets.test.ts`
Expected: FAIL — cannot find module `quoteTargets`.

- [ ] **Step 3: Implement `quoteSymbols`**

Create `src/renderer/lib/quoteTargets.ts`:

```ts
import type { Cell, GridShape } from '@shared/types'
import { VISIBLE_COUNT } from '../workspace'

// Symbols that get a quote on reload: visible cells' symbols ∪ watchlist symbols, de-duped.
// Mirrors refreshTargets' visible-slice + watchlist union, but keyed by symbol only (quote is
// timeframe-agnostic). Order: visible cells first, then any new watchlist symbols.
export function quoteSymbols(cells: Cell[], shape: GridShape, watchlistSymbols: string[] = []): string[] {
  const seen = new Set<string>()
  for (const cell of cells.slice(0, VISIBLE_COUNT[shape])) {
    if (cell.symbol) seen.add(cell.symbol)
  }
  for (const s of watchlistSymbols) seen.add(s)
  return [...seen]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/quoteTargets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/quoteTargets.ts tests/renderer/quoteTargets.test.ts
git commit -m "feat(reload): quoteSymbols target selector"
```

---

## Task 5: `latestPriceChange` watchlist helper

**Files:**
- Modify: `src/renderer/lib/priceChange.ts`
- Test: `tests/renderer/priceChange.test.ts`

**Interfaces:**
- Consumes: `computeChange` (same file), `Bar`, `Quote`.
- Produces: `latestPriceChange(daily: Bar[] | undefined, quote: Quote | undefined, isOpen: boolean): ChangeResult | null`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/renderer/priceChange.test.ts`:

```ts
import { latestPriceChange } from '../../src/renderer/lib/priceChange'
import type { Quote } from '../../src/shared/types'

const quote = (over: Partial<Quote> = {}): Quote => ({
  price: 110, open: 105, dayHigh: 112, dayLow: 104, previousClose: 100,
  changePercentage: 10, timestamp: 0, exchange: 'NASDAQ', ...over
})

describe('latestPriceChange', () => {
  const daily = [bar(10, 190), bar(11, 200)]
  it('open + quote: uses quote price and changePercentage', () => {
    expect(latestPriceChange(daily, quote({ price: 210, changePercentage: 5 }), true)).toEqual({ price: 210, pct: 5 })
  })
  it('closed: falls back to daily close change', () => {
    expect(latestPriceChange(daily, quote(), false)).toEqual({ price: 200, pct: 5 })
  })
  it('open but no quote yet: falls back to daily close change', () => {
    expect(latestPriceChange(daily, undefined, true)).toEqual({ price: 200, pct: 5 })
  })
  it('no daily and closed: null', () => {
    expect(latestPriceChange(undefined, undefined, false)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/renderer/priceChange.test.ts`
Expected: FAIL — `latestPriceChange` is not exported.

- [ ] **Step 3: Implement the helper**

In `src/renderer/lib/priceChange.ts`, update the import and append the function.

Change the import line to add `Quote`:

```ts
import type { Bar, Timeframe, Quote } from '@shared/types'
```

Append at the end of the file:

```ts
// Watchlist "latest price": during market hours use the live quote (price + FMP's own
// changePercentage, which is authoritative vs previousClose); otherwise the daily-close change.
export function latestPriceChange(
  daily: Bar[] | undefined,
  quote: Quote | undefined,
  isOpen: boolean
): ChangeResult | null {
  if (isOpen && quote) return { price: quote.price, pct: quote.changePercentage }
  return computeChange(daily, '1d', undefined)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/priceChange.test.ts`
Expected: PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/priceChange.ts tests/renderer/priceChange.test.ts
git commit -m "feat(watchlist): latestPriceChange quote-aware helper"
```

---

## Task 6: Reload flow fetches market status + quotes

**Files:**
- Modify: `src/renderer/App.tsx` (the `handleReload` handler, ~lines 82-107)

**Interfaces:**
- Consumes: `api.market.status`, `api.quote.get` (Task 2); `quoteSymbols` (Task 4); `qk.quote`, `qk.marketStatus` (Task 2).

- [ ] **Step 1: Add imports to `src/renderer/App.tsx`**

Add near the other `./lib` imports:

```ts
import { quoteSymbols } from './lib/quoteTargets'
```

- [ ] **Step 2: Extend `handleReload`**

Inside `handleReload`, in the existing `try` block, immediately **after** the line
`void queryClient.invalidateQueries({ queryKey: qk.capabilities() })`
insert:

```ts
      // Latest-price: fetch market status once; only when open, one quote per visible/watchlist
      // symbol. Closed → skip quotes entirely (consumers fall back to daily close). A gated/failed
      // quote or market-status is swallowed here so it never blocks the OHLCV reload.
      try {
        const status = await api.market.status()
        queryClient.setQueryData(qk.marketStatus(), status)
        if (status.isOpen) {
          const syms = quoteSymbols(cells, shape, watchlistSymbols)
          await Promise.allSettled(
            syms.map(async (s) => {
              const quote = await api.quote.get(s)
              queryClient.setQueryData(qk.quote(s), quote)
            })
          )
        }
      } catch {
        // market-status unavailable (e.g. plan-gated) → leave consumers on the daily-close fallback.
      }
```

(`cells`, `shape`, and `watchlistSymbols` are already in scope from the top of `handleReload`.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Run the full test suite (no regressions)**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(reload): fetch market status and quotes on reload"
```

---

## Task 7: Watchlist consumes quote + market status

**Files:**
- Modify: `src/renderer/components/Watchlist.tsx` (the `Row` component)

**Interfaces:**
- Consumes: `qk.quote`, `qk.marketStatus`, `api.quote.get`, `api.market.status`; `latestPriceChange` (Task 5); `Quote`, `MarketStatus`.

- [ ] **Step 1: Update imports in `src/renderer/components/Watchlist.tsx`**

Change the `computeChange` import to also pull the helper:

```ts
import { computeChange, latestPriceChange } from '@/lib/priceChange'
```

Extend the types import:

```ts
import type { Bar, WatchlistItem, Quote, MarketStatus } from '@shared/types'
```

- [ ] **Step 2: Subscribe to quote + market status and switch the change source**

In `Row`, replace the `computeChange` line (currently `const change = computeChange(bars, '1d', undefined)`) with:

```ts
  // Quote + market status are populated by the global reload only (enabled:false → never fetch on
  // mount, just read cache and re-render when reload calls setQueryData). Open → live quote; closed
  // or not-yet-loaded → daily-close change (computeChange fallback lives inside latestPriceChange).
  const { data: marketStatus } = useQuery<MarketStatus>({
    queryKey: qk.marketStatus(),
    queryFn: () => api.market.status(),
    enabled: false
  })
  const { data: quote } = useQuery<Quote>({
    queryKey: qk.quote(item.symbol),
    queryFn: () => api.quote.get(item.symbol),
    enabled: false
  })
  const change = latestPriceChange(bars, quote, marketStatus?.isOpen ?? false)
```

(The existing daily `useQuery` for `bars` stays unchanged; `computeChange` remains imported because `latestPriceChange` uses it, but if the linter flags `computeChange` as unused in this file, drop it from the import and keep only `latestPriceChange`.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Manual verification (documented)**

Run the app (`npm run dev`), set an FMP key, add symbols to the watchlist, click reload.
Expected: during US market hours the watchlist price matches the live quote; outside hours it shows the last daily close. No crash when the key is plan-gated (price falls back to daily close).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/Watchlist.tsx
git commit -m "feat(watchlist): show live quote price during market hours"
```

---

## Task 8: Chart consumes quote via `applyQuote`

**Files:**
- Modify: `src/renderer/components/Chart.tsx`

**Interfaces:**
- Consumes: `applyQuote` (Task 3); `qk.quote`, `qk.marketStatus`, `api.quote.get`, `api.market.status`; `Quote`, `MarketStatus`.

- [ ] **Step 1: Update imports in `src/renderer/components/Chart.tsx`**

Add `useMemo` to the React import:

```ts
import React, { useEffect, useMemo, useRef, useState } from 'react'
```

Add the merge fn and types:

```ts
import { applyQuote } from '@/lib/applyQuote'
```

Extend the shared-types import:

```ts
import type { Bar, Timeframe, Quote, MarketStatus } from '@shared/types'
```

- [ ] **Step 2: Subscribe to quote + market status and derive `displayBars`**

Immediately after the existing `const q = useQuery<Bar[]>({...})` block (~line 70), add:

```ts
  // Populated by the global reload only (enabled:false → read cache, re-render on setQueryData).
  const { data: marketStatus } = useQuery<MarketStatus>({
    queryKey: qk.marketStatus(),
    queryFn: () => api.market.status(),
    enabled: false
  })
  const { data: quote } = useQuery<Quote>({
    queryKey: qk.quote(symbol),
    queryFn: () => api.quote.get(symbol),
    enabled: false
  })
  // Trailing-candle overlay: quote.price replaces the last bar's close (or appends today's forming
  // daily bar) during market hours. Pure/derived — never written back into the ohlcv query cache.
  const displayBars = useMemo(
    () => applyQuote(q.data ?? [], quote, marketStatus?.isOpen ?? false, timeframe),
    [q.data, quote, marketStatus, timeframe]
  )
```

- [ ] **Step 3: Feed `displayBars` into the data-push effect**

In the effect that pushes data to the series (currently starts `const bars = q.data ?? []` around line 228), change that line to:

```ts
    const bars = displayBars
```

and change that effect's dependency array from `[q.data, symbol, timeframe]` to:

```ts
  }, [displayBars, symbol, timeframe])
```

- [ ] **Step 4: Point the indicator-reconcile and latest-value effects at `displayBars`**

The indicator-reconcile effect (deps currently `[indicators, q.data, timeframe]`, ~line 459) and the latest-value effect (deps currently `[indicators, q.data, timeframe, cellId]`, ~line 408) both read `barsRef.current`, which is now assigned from `displayBars` in Step 3. Update **both** dependency arrays, replacing `q.data` with `displayBars`:

```ts
  }, [indicators, displayBars, timeframe])       // indicator-reconcile effect
```

```ts
  }, [indicators, displayBars, timeframe, cellId]) // latest-value effect
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Run the full test suite (no regressions)**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 7: Manual verification (documented)**

Run the app, open a chart, click reload during market hours.
Expected: the trailing candle's close and the legend `C` value equal the live quote and match the watchlist for the same symbol; on a `1d` chart during hours a forming today candle appears; outside hours the chart shows completed bars only. Switching timeframe (`1m`/`1h`/`1d`/`1w`/`1M`) keeps the latest value consistent with the watchlist. Panning still gap-fetches without jumping (regression check).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/Chart.tsx
git commit -m "feat(chart): overlay live quote on trailing candle and legend"
```

---

## Self-Review Notes

- **Spec coverage:** provider (Task 1) · IPC/keys (Task 2) · applyQuote merge incl. daily append/patch, W/M patch-only, ascending guard, intraday patch (Task 3) · reload union + market-open skip (Tasks 4, 6) · watchlist quote price + pct (Tasks 5, 7) · chart trailing candle + legend (Task 8) · capability/free-tier fallback via swallowed rejects (Tasks 2, 6) · quotes never in SQLite (Task 2) · reload-only cadence via `enabled:false` (Tasks 7, 8). All spec sections map to a task.
- **Known limitation carried from spec:** crypto follows NASDAQ hours in v1 (accepted). Not implemented — no task needed.
- **Type consistency:** `Quote`/`MarketStatus` defined in Task 1 and used verbatim in Tasks 2/3/5/7/8; `qk.quote`/`qk.marketStatus`, `api.quote.get`/`api.market.status`, `applyQuote`, `quoteSymbols`, `latestPriceChange` signatures match across producer/consumer tasks.
