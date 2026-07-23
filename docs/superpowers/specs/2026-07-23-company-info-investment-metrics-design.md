# Company info dialog — investment metrics — Design

**Date:** 2026-07-23
**Status:** Approved (pending spec review)

## Problem

The company info window (`CompanyWindow` → `CompanyInfoBody`) currently shows only
FMP `/profile` data: sector, industry, market cap, CEO, employees, IPO date, beta,
52-week range, volume, dividend, description. There are no numbers that actually
support an investment decision — no valuation, profitability, financial health,
analyst view, growth, or upcoming schedule.

We want to enrich the window with investment-relevant data while respecting the
project's top constraint: **saving API calls**.

## Decision

Fetch a bundle of FMP endpoints **once, in parallel, when the window opens**, cache
it as a single JSON blob under the existing 1-day TTL, and present it across
**English-named tabs**.

- `/profile` is the **required anchor**. The other five endpoints are **optional**.
- Fetch all six with `Promise.allSettled`; merge whatever succeeds into one blob.
- A failed optional endpoint degrades only its own tab — never the whole window.
- Display shows **raw numbers with minimal cues** (color only on analyst consensus
  and price-target-vs-current; no good/bad coloring of ratios).

Cost: **~6 FMP calls per symbol, at most once per day** (TTL cache). Within TTL,
nothing is refetched even if some parts are missing — **except** an explicit
force-reload button (top-right), which bypasses the TTL on demand (see below).

## Endpoints → tabs

All endpoints are on the FMP `/stable` surface (same as the rest of `FmpProvider`).

| Endpoint | Feeds tab | Fields used |
|---|---|---|
| `/profile` (existing) | Overview | (unchanged) |
| `/ratios-ttm` | Valuation, Financials | P/E, P/B, P/S, PEG, dividend yield, ROE, ROA, net/operating/gross margin, current ratio, quick ratio, debt-to-equity |
| `/key-metrics-ttm` | Valuation | EV/EBITDA, earnings yield, FCF yield |
| `/grades-consensus` | Analyst | strongBuy / buy / hold / sell / strongSell counts + consensus |
| `/price-target-summary` | Analyst | target high / low / median / average |
| `/financial-growth` | Growth | revenue growth, net income growth, EPS growth (latest period) |
| `/earnings` | Schedule | next earnings date, latest actual/estimated EPS |

**Deferred (out of scope for v1):** next dividend / ex-dividend date. FMP free tier
does not reliably expose forward dividend dates; the Schedule tab ships with earnings
only. Add later when a reliable source is confirmed.

## Data model (`src/shared/types.ts`)

Extend `CompanyProfileData` with optional nested groups. The store persists a JSON
blob, so **no DB migration** is needed — new optional fields are backward-compatible
with existing cached rows.

```ts
export type CompanyProfileData = {
  // ...existing /profile fields...
  valuation: {
    peRatio, pbRatio, psRatio, pegRatio, dividendYield,
    evToEbitda, earningsYield, fcfYield          // all number | null
  } | null
  financials: {
    roe, roa, netMargin, operatingMargin, grossMargin,
    debtToEquity, currentRatio, quickRatio       // all number | null
  } | null
  analyst: {
    strongBuy, buy, hold, sell, strongSell,       // counts, number | null
    consensus: string | null,
    targetHigh, targetLow, targetMedian, targetAverage  // number | null
  } | null
  growth: {
    revenueGrowth, netIncomeGrowth, epsGrowth    // number | null
  } | null
  schedule: {
    nextEarningsDate: string | null,
    lastEpsActual, lastEpsEstimated: number | null
  } | null
}
```

Each group is `null` when its endpoint failed or is plan-gated. Individual fields are
nullable to tolerate FMP field-name drift / partial payloads.

## Components

### Provider (`src/main/providers/FmpProvider.ts`)
- Add private fetch helpers, one per new endpoint, each parsing through a new zod
  schema in `fmp.schema.ts` (all fields `optional().nullable()`, tolerant).
- `getCompanyProfile(symbol)` becomes the aggregator:
  - Fetch `/profile` first (throws on failure → existing not-covered / error path).
  - `Promise.allSettled` the five optional fetches; map each fulfilled result into its
    group, each rejected/absent result into `null`.
  - Return the enriched `CompanyProfileData`.
- The `DataSourceAdapter` contract (one method, one return type) is unchanged in shape.

### Schema (`src/main/providers/fmp.schema.ts`)
- Add `fmpRatiosTtmResponse`, `fmpKeyMetricsTtmResponse`, `fmpGradesConsensusResponse`,
  `fmpPriceTargetSummaryResponse`, `fmpFinancialGrowthResponse`, `fmpEarningsResponse`.
- Loose schemas (unknown fields ignored, target fields optional/nullable).

### Service / plumbing
- `CompanyInfoService`, `companyProfileStore`, IPC `company:info`, preload, and the
  renderer `useQuery(company:info)` are **unchanged** — they already pass the blob
  through opaquely. Only the blob's shape grows.

### Renderer (`src/renderer/components/CompanyWindow.tsx`)
- Replace the single scroll body with a **tab bar** (English labels):
  `Overview | Valuation | Financials | Analyst | Growth | Schedule`.
- Overview tab = current layout, verbatim.
- Each metric tab renders a grid of `Attr` rows (reuse the existing `Attr` component,
  which already hides null/empty rows).
- Analyst tab: consensus breakdown colored (buy = green, sell = red); target prices
  shown against the current price (above = green, below = red) using the quote the
  renderer can already fetch, or plain if unavailable.
- If a tab's group is `null`: show a small centered note
  "Not available on your current FMP plan / couldn't load." (reuse the not-covered vs
  generic wording already in `CompanyInfoBody`).
- Tab state is local component state; no store changes.
- **Force-reload button (top-right)**: `RefreshCw` icon (matching the main toolbar's
  reload button), `animate-spin` while in flight, tooltip "Reload company info". It
  bypasses the TTL and refetches the full bundle, then writes the fresh blob into the
  query cache. Disabled while in flight.

### Force reload plumbing
- `company:info` IPC / `CompanyInfoService.getInfo(symbol, opts?)` gain an optional
  `force` flag. When `force`, skip the TTL cache-hit early return and always fetch +
  upsert. (Stale-fallback on fetch failure is preserved.)
- Renderer: the button runs a `useMutation` calling `api.company.info(symbol, { force:
  true })`; on success `queryClient.setQueryData(qk.companyInfo(symbol), data)` so all
  tabs update from the one refreshed blob. Spinner = `mutation.isPending`.

## Data flow

window opens → `useQuery(company:info)` → main `CompanyInfoService.getInfo` →
cache hit (TTL) OR `FmpProvider.getCompanyProfile` (6 parallel fetches, merge) →
blob cached → renderer renders active tab from the one blob. No per-tab fetching.

## Error handling

- `/profile` fails + no cache → existing not-covered / generic error (whole window).
- `/profile` fails + stale cache → existing stale-fallback (returns cached blob).
- Any optional endpoint fails → its group is `null` → only that tab shows the note.
- Partial success is cached as-is; not refetched until TTL expires (call-saving), or
  until the user hits force-reload.
- Loose zod schemas prevent a single malformed field from throwing out a whole group.

## Testing

- `FmpProvider.test.ts`: `getCompanyProfile` merges a full happy-path bundle; a rejected
  optional endpoint yields that group `= null` while others populate; `/profile`
  rejection still throws.
- New schema parse tests: a representative FMP payload parses; an error-shaped / empty
  payload yields `null` group (not a throw).
- `CompanyInfoService.test.ts`: unchanged behavior with the enriched blob (cache
  hit/miss/stale-fallback still pass); `force: true` skips a fresh cache hit and
  refetches.
- Manual: open a covered symbol → all tabs populate; open with a free-tier-gated
  endpoint → that tab shows the note, others render.

## Out of scope

- Next dividend / ex-dividend date (deferred, see above).
- Peer / sector comparison (needs extra market-wide calls).
- Good/bad threshold coloring of ratios.
- Historical charts of fundamentals.
