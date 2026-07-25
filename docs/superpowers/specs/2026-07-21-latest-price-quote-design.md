# Latest Price via Quote — Design

**Date:** 2026-07-21
**Status:** Approved (design), pending implementation plan

## Problem

The chart's displayed latest value and the watchlist's price do not match.

Root cause (confirmed by code investigation): both read the **`close` of the last cached bar** from the same SQLite OHLCV store via the same IPC path, but:

- **Watchlist** (`src/renderer/components/Watchlist.tsx`) is hard-wired to `1d`, `staleTime: Infinity` → shows the last **daily EOD close**.
- **Chart** (`src/renderer/components/Chart.tsx`) uses the cell's own timeframe (often intraday), `staleTime: 0`, plus live gap-fetch/merge → shows the last bar close of **its own timeframe**, which during a session differs from the prior daily close.

So an intraday chart shows the latest intraday print while the watchlist shows the previous daily close. They only match when the chart cell is also `1d` (they share query key `['ohlcv', symbol, '1d']`).

## Goal

Always show the **latest price**, consistently, in both the watchlist and on the chart (legend **and** trailing candle), for every timeframe including `1D`/`1W`/`1M`.

Definition:

```
latestPrice(symbol) = marketOpen ? quote.price : <most recent completed daily close>
```

## Constraints & Decisions

- **Source:** FMP `/stable/quote` (single symbol) + `/stable/exchange-market-hours`. Decided over reusing OHLCV or a polling loop.
- **Chart scope:** during market hours, update the trailing (forming) candle's close with the quote — not just the legend number.
- **Market-open detection:** FMP `exchange-market-hours` endpoint (`isMarketOpen`, holiday-aware). No local ET computation.
- **Refresh cadence:** on the existing global **reload button only**. No polling, no fetch-on-mount.
- **Quotes/market-status are volatile → NOT written to the SQLite OHLCV cache** (SQLite = OHLCV only, per project rules). They live in the TanStack Query cache in the renderer, `staleTime: Infinity`, replaced on the next reload.
- **Provider seam preserved:** new capabilities added to the adapter interface; swapping the provider must not touch the query/cache layers.

### Endpoint verification (2026-07-21, against the project's FMP key — Starter plan)

| Endpoint | Result | Notes |
|---|---|---|
| `/stable/batch-quote?symbols=...` | **HTTP 402** | Restricted — not available on free **or** Starter. Batching is out. |
| `/stable/quote?symbol=AAPL` | **HTTP 200** | Returns `price, open, previousClose, dayHigh, dayLow, changePercentage, timestamp, exchange`. |
| `/stable/exchange-market-hours?exchange=NASDAQ` | **HTTP 200** | Returns `isMarketOpen` directly, plus `timezone`, opening/closing hours. |

Consequence: **single quote per symbol** (no batch). FMP docs also confirm the quote endpoint only updates during regular trading hours — consistent with the market-open/daily-close split.

## Architecture

### 1. Provider layer (adapter extension)

Add two methods to the FMP adapter (`src/main/providers/FmpProvider.ts`) and the adapter interface:

- `getQuote(symbol): Promise<Quote>` → `/stable/quote?symbol=...`
  - `Quote = { price: number; open: number; dayHigh: number; dayLow: number; previousClose: number; changePercentage: number; timestamp: number; exchange: string }`
- `getMarketStatus(exchange = 'NASDAQ'): Promise<{ isOpen: boolean }>` → `/stable/exchange-market-hours?exchange=...`, reads `isMarketOpen`.

Parsing reuses the existing zod-parse-or-throw-`FmpHttpError(200, body)` pattern so error-shaped 200 bodies and non-2xx surface as typed `FmpHttpError`. Unlike OHLCV, quote/market-status are **not** recorded in the per-`Timeframe` capability cache (they aren't timeframes). Instead, their IPC handlers call the provider directly and let errors reject; the reload flow swallows the rejection (`Promise.allSettled`) and consumers fall back to the daily close. A 402/403 on a free-tier install therefore degrades silently to daily-close, never crashing.

### 2. IPC (`src/shared/ipc.ts`, `src/main/ipc.ts`, preload)

New channels / API surface:

- `api.quote.get(symbol): Promise<Quote>`
- `api.market.status(): Promise<{ isOpen: boolean }>`

These call the provider **directly** (a thin pass-through) — they do **not** go through `CacheService` (which is OHLCV/SQLite only).

### 3. Query keys (`src/renderer/api.ts`)

```ts
qk.quote        = (symbol) => ['quote', symbol]
qk.marketStatus = ()       => ['market-status']
```

### 4. Reload flow (`src/renderer/App.tsx` `handleReload`)

Extend the existing handler (OHLCV refresh unchanged):

1. Fetch `market.status()` once → `queryClient.setQueryData(qk.marketStatus(), status)`.
2. **If `status.isOpen`:** for the union of visible-cell symbols ∪ (sidebar-open) watchlist symbols, deduped, fetch `quote.get(symbol)` and `setQueryData(qk.quote(symbol), quote)`.
3. **If closed:** skip all quote fetches. Consumers fall back to daily close.

Failures follow the existing `Promise.allSettled` + toast pattern; a failed quote/market-status just leaves consumers on the daily-close fallback (no capability-cache write).

**API cost per reload:** closed → **+1** (market-status only); open → **+1 + (distinct symbol count)**.

### 5. Quote → candle merge (render-time pure function)

New pure module `src/renderer/lib/applyQuote.ts`:

```
applyQuote(bars, quote, isOpen, timeframe): Bar[]
```

- `!isOpen` or no quote → return `bars` unchanged.
- Open:
  - **Intraday (`1m/5m/15m/1h`):** patch the last bar — `close = quote.price`, `high = max(high, price)`, `low = min(low, price)`.
  - **Daily (`1d`):** compute today's bucket time using the **same key rule as daily bars** (`dateToEpochSeconds`-style UTC-midnight of the NY trading date derived from `quote.timestamp`).
    - If `last.time === todayBucket` → patch last bar (close/high/low as above).
    - Else if `todayBucket > last.time` → **append** a forming bar `{ time: todayBucket, open: quote.open, high: quote.dayHigh, low: quote.dayLow, close: quote.price, volume: 0 }`.
    - **Ascending-order guard:** never append a bar whose `time <= last.time`; fall back to patch. (lightweight-charts requires strictly-ascending unique times, else `setData` asserts/crashes.)
  - **Weekly / Monthly (`1w/1M`):** **patch only** — set the last derived bar's `close = quote.price`, extend high/low. Never append a new bucket (the derived series is aggregated main-side by `deriveWeekly/deriveMonthly`; inventing a bucket boundary here risks duplicating/misaligning the last bar). The rare "new week/month with no daily bar yet" case is accepted.

The merge is applied at render time only; the `qk.ohlcv` query data is **not** mutated, keeping gap-fetch/refresh logic clean.

### 6. Consumers

- **Chart (`Chart.tsx`):** subscribe to `qk.quote(symbol)` + `qk.marketStatus()`; compute `const bars = useMemo(() => applyQuote(q.data, quote, isOpen, timeframe), ...)` and feed that to `setData` and the last-bar latest-value logic (lines ~400-407). The trailing candle and the non-hover legend then both reflect `latestPrice`.
- **Watchlist (`Watchlist.tsx` / `computeChange`):** subscribe to `qk.quote(symbol)` + `qk.marketStatus()`.
  - Open: `price = quote.price`, `pct = quote.changePercentage` (authoritative; no manual computation).
  - Closed: current behavior (last daily close, pct vs prev daily close).

## Edge cases / known limitations

- **Crypto (24/7):** v1 uses NASDAQ's `isMarketOpen` as the single global signal, so during equity close crypto also falls back to daily close. Accepted for v1 (decision F). Could later query market-hours per `quote.exchange`.
- **Free-tier / plan gating:** if `quote` or `market-hours` returns 402/403/429, the capability classifier marks it unavailable and consumers stay on the daily-close fallback — no crash. (Project's own key is Starter; batch is 402 even there.)
- **Stale forming candle after close:** if the market closes between reloads, the last-fetched quote keeps showing as a forming candle until the next reload finalizes it into a real EOD bar. Accepted (reload-only + delay-OK).
- **Timezone collision on daily append:** guarded by the ascending-order rule in §5.

## Testing

- `applyQuote` — pure-function unit tests: closed/no-quote passthrough; intraday patch; daily patch vs append; daily ascending-order guard (append refused on collision); W/M patch-only.
- `FmpProvider.getQuote` / `getMarketStatus` — injected `httpGetJson`: field mapping; 402/403/429 → `FmpHttpError` classification.
- `computeChange` — open branch uses `quote.changePercentage`; closed branch unchanged.
- Reload flow — market closed skips quotes; open fetches deduped union; failures leave fallback intact.

## Out of scope

- Real-time streaming / polling.
- Pre-market / after-hours quotes (separate FMP endpoints).
- Per-exchange market-hours resolution (crypto correctness).
- Batch quotes (plan-gated).
