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

- `/profile` is the **required anchor**. **Six** other endpoints are **optional**
  (**seven total**).
- Fetch all seven with `Promise.allSettled`; merge whatever succeeds into one blob.
- A failed optional endpoint degrades only its own tab — never the whole window. All
  failures collapse to the same neutral "not available" note per tab; we do **not**
  try to distinguish plan-gated from load-failure per group (that info is lost once a
  `null` group is cached, and the distinction isn't worth persisting).
- Display shows **raw numbers with minimal cues** (color only on analyst consensus
  and price-target-vs-current; no good/bad coloring of ratios).

Cost: **~7 FMP calls per symbol, at most once per day** (TTL cache). Within TTL,
nothing is refetched even if some parts are missing — **except** an explicit
force-reload button (top-right), which bypasses the TTL on demand (see below).

## Endpoints → tabs

All endpoints are on the FMP `/stable` surface (same as the rest of `FmpProvider`).

| Endpoint | Feeds tab | Fields used |
|---|---|---|
| `/profile` (existing) | Overview | (unchanged) + `price` (already in the payload; used for the Analyst price-target comparison — no extra call) |
| `/ratios-ttm` | Valuation, Financials | P/E, P/B, P/S, PEG, dividend yield, ROE, ROA, net/operating/gross margin, current ratio, quick ratio, debt-to-equity |
| `/key-metrics-ttm` | Valuation | EV/EBITDA, earnings yield, FCF yield |
| `/grades-consensus` | Analyst | strongBuy / buy / hold / sell / strongSell counts + consensus |
| `/price-target-consensus` | Analyst | targetHigh / targetLow / targetMedian / targetConsensus |
| `/financial-growth` | Growth | revenue growth, net income growth, EPS growth (latest **annual** period) |
| `/earnings` | Schedule | next earnings date, latest actual/estimated EPS |

**Deferred (out of scope for v1):** next dividend / ex-dividend date. FMP free tier
does not reliably expose forward dividend dates; the Schedule tab ships with earnings
only. Add later when a reliable source is confirmed.

## Data model (`src/shared/types.ts`)

Extend `CompanyProfileData` with **optional** nested groups. The store persists a JSON
blob, so **no DB migration** is needed. Groups are declared `?:` (may be absent) so
existing cached rows — which lack these keys and parse back as `undefined`, not
`null` — remain valid. A fresh fetch always sets each group (to `null` if its endpoint
failed). Consumers must treat `group == null` (covers both `undefined` and `null`) as
"no data".

```ts
export type CompanyProfileData = {
  // ...existing /profile fields...
  price?: number | null                            // from /profile, for Analyst comparison
  valuation?: {
    peRatio, pbRatio, psRatio, pegRatio, dividendYield,
    evToEbitda, earningsYield, fcfYield          // all number | null
  } | null
  financials?: {
    roe, roa, netMargin, operatingMargin, grossMargin,
    debtToEquity, currentRatio, quickRatio       // all number | null
  } | null
  analyst?: {
    strongBuy, buy, hold, sell, strongSell,       // counts, number | null
    consensus: string | null,
    targetHigh, targetLow, targetMedian, targetConsensus  // number | null
  } | null
  growth?: {
    revenueGrowth, netIncomeGrowth, epsGrowth    // number | null
  } | null
  schedule?: {
    nextEarningsDate: string | null,
    lastEpsActual, lastEpsEstimated: number | null
  } | null
}
```

Each group is `null` when its endpoint failed, `undefined` in pre-existing cached
rows, and populated otherwise. Individual fields are nullable to tolerate FMP
field-name drift / partial payloads.

## Components

### Provider (`src/main/providers/FmpProvider.ts`)
- Add private fetch helpers, one per new endpoint, each parsing through a new zod
  schema in `fmp.schema.ts`.
- Add `price` to the existing `/profile` mapping (`fmpProfileRow` already
  `.passthrough()`s it; add `price: z.coerce.number().nullable().optional()`).
- `getCompanyProfile(symbol)` becomes the aggregator:
  - Fetch `/profile` first (throws on failure → existing not-covered / error path).
  - `Promise.allSettled` the six optional fetches; map each fulfilled result into its
    group, each rejected/absent result into `null`.
  - **Row selection** for array endpoints (FMP returns newest-first):
    - `/ratios-ttm`, `/key-metrics-ttm`, `/grades-consensus`,
      `/price-target-consensus`: take element `[0]` (the TTM / current-consensus row).
    - `/financial-growth`: request **annual** (default period), take element `[0]`
      (most recent fiscal year).
    - `/earnings`: `nextEarningsDate` = earliest row with `date >= today` and no
      `epsActual`; `lastEpsActual`/`lastEpsEstimated` = most recent row that has an
      `epsActual`. (Empty either side → `null`.)
  - Return the enriched `CompanyProfileData`.
- `FmpProvider` is the only adapter; its `getCompanyProfile` return type widens but its
  signature is unchanged.

### Schema (`src/main/providers/fmp.schema.ts`)
- Add `fmpRatiosTtmResponse`, `fmpKeyMetricsTtmResponse`, `fmpGradesConsensusResponse`,
  `fmpPriceTargetConsensusResponse`, `fmpFinancialGrowthResponse`, `fmpEarningsResponse`.
- Each numeric target field is `z.coerce.number().nullable().optional().catch(null)` —
  the **`.catch(null)`** makes a malformed *present* value (wrong type, unparseable)
  degrade to `null` instead of throwing out the whole group. Objects `.passthrough()`
  so unknown fields are ignored. This is what makes "a single bad field doesn't kill
  the group" actually true.

### Service / plumbing
- `companyProfileStore` and the renderer's `useQuery(company:info)` are **unchanged** —
  they pass the blob through opaquely; only its shape grows.
- `CompanyInfoService.getInfo`, the `company:info` IPC channel, and the preload wrapper
  gain an **optional `force` argument** (see Force reload plumbing). No other signature
  changes.

### Renderer (`src/renderer/components/CompanyWindow.tsx`)
- Replace the single scroll body with a **tab bar** (English labels):
  `Overview | Valuation | Financials | Analyst | Growth | Schedule`.
- Overview tab = current layout, verbatim.
- Each metric tab renders a grid of `Attr` rows (reuse the existing `Attr` component,
  which already hides null/empty rows).
- **Display units** (formatting helpers in `CompanyWindow`):
  - Plain ratios (P/E, P/B, P/S, PEG, EV/EBITDA, debt-to-equity, current/quick ratio):
    2 decimals, no suffix (e.g. `24.31`).
  - Percentages (dividend yield, earnings/FCF yield, ROE, ROA, all margins, all growth
    rates): `× 100`, 1 decimal, `%` suffix (e.g. `18.4%`). FMP returns these as ratios
    (0.184), so multiply.
  - Currency (target high/low/median/consensus, EPS actual/estimated, price): `$` +
    2 decimals.
  - `null`/`undefined` fields are hidden by `Attr` (unchanged).
- Analyst tab: consensus breakdown colored (buy = green, sell = red); target prices
  shown against `data.price` from `/profile` (above = green, below = red). No quote
  fetch — the company window has its own QueryClient and fetching a quote would be an
  extra uncounted API call. If `data.price` is null, show targets plain.
- If a tab's group is `null`/`undefined`: show a small centered neutral note,
  "Not available." (single wording — we don't distinguish plan-gated from load-failure
  here; see Decision).
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
cache hit (TTL) OR `FmpProvider.getCompanyProfile` (7 parallel fetches, merge) →
blob cached → renderer renders active tab from the one blob. No per-tab fetching.

## Error handling

- `/profile` fails + no cache → existing not-covered / generic error (whole window).
- `/profile` fails + stale cache → existing stale-fallback (returns cached blob).
- Any optional endpoint fails → its group is `null` → only that tab shows the note.
- Pre-existing cached rows (from before this change) have `undefined` groups → tabs
  show the note until the next fetch/force-reload repopulates them.
- Partial success is cached as-is; not refetched until TTL expires (call-saving), or
  until the user hits force-reload.
- `.catch(null)` on schema fields prevents a single malformed field from throwing out
  a whole group.

## Testing

- `FmpProvider.test.ts`: `getCompanyProfile` merges a full happy-path bundle; a rejected
  optional endpoint yields that group `= null` while others populate; `/profile`
  rejection still throws.
- New schema parse tests: a representative FMP payload parses; an error-shaped / empty
  payload yields `null` group (not a throw); a **malformed present field** (e.g. a
  string where a number is expected) degrades to `null` via `.catch(null)` rather than
  throwing.
- Row-selection tests: `/earnings` picks the correct next-date and last-actual rows
  from a mixed past/future array; `/financial-growth` takes the latest annual row.
- Backward-compat: a cached blob without the new groups still renders (groups read as
  `undefined`, tabs show "Not available").
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
