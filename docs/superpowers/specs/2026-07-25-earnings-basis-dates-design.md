# Company info — earnings basis dates — Design

**Date:** 2026-07-25
**Status:** Approved (pending spec review)

## Problem

The company info window shows EPS and growth numbers with no indication of which
reporting period they came from.

Two gaps, both of them data we already fetch and then discard:

1. **前回の決算報告日** — `FmpProvider.fetchCompanyProfile` computes `reported`
   (`FmpProvider.ts:254`, the newest `/earnings` row with a non-null `epsActual`) and
   surfaces `lastEpsActual` / `lastEpsEstimated` from it, but throws away
   `reported.date`. The Schedule tab shows the *next* earnings date and last EPS
   values, but never says when that last report happened.
2. **成長率の基準期** — `/financial-growth` returns a fiscal period `date`, which
   `fmpFinancialGrowthResponse` does not parse. The Growth tab shows revenue / net
   income / EPS growth with no period attached.

PER and the other TTM ratios are out of scope: FMP's `ratios-ttm` and
`key-metrics-ttm` endpoints return no period date, so there is nothing to display.
They stay as-is, with no annotation.

## Decision

Surface both dates. **No new API calls** — both values already arrive in responses we
fetch today.

### Data layer

`FmpProvider.fetchCompanyProfile`:

- `schedule.lastEarningsDate` ← `reported?.date ?? null`
- `growth.asOfDate` ← the `date` of the `/financial-growth` row already selected by
  `opt()` (newest-first, so `[0]` is the latest annual period)

`fmp.schema.ts` — add to `fmpFinancialGrowthResponse`:

```ts
date: z.string().nullable().optional().catch(null)
```

`.catch(null)` matches the tolerance of the numeric fields in the same object: FMP
field drift degrades one value, never the whole row.

### Types

Both new fields are **optional keys inside existing optional groups**:

```ts
schedule?: {
  nextEarningsDate: string | null
  lastEarningsDate?: string | null
  lastEpsActual: number | null
  lastEpsEstimated: number | null
} | null

growth?: {
  asOfDate?: string | null
  revenueGrowth: number | null
  netIncomeGrowth: number | null
  epsGrowth: number | null
} | null
```

Rationale: `companyProfileStore.getCompanyProfile` does a plain `JSON.parse` + cast
with no re-validation, so blobs cached before this change simply parse back with the
new keys `undefined`. Declaring them required would make the type lie about those
rows. Consumers must treat `undefined` and `null` identically — the same rule the
existing group-level fields already carry.

### UI (`CompanyWindow.tsx`)

Labels stay English, matching the existing tabs.

**ScheduleTab** — `Last earnings date` goes **above** `Next earnings date`, so the
tab reads in time order (past report → next report):

```
Last earnings date   Next earnings date
Last EPS (actual)    Last EPS (estimate)
```

`Attr` already returns `null` when its value is `null`/empty, so a stale cached row
renders the tab exactly as it does today, minus the new row.

**GrowthTab** — one line above the three `GrowthBar`s, since all three come from the
same annual row:

```
Fiscal period end · 2025-09-27
```

Rendered in the muted style used by `Attr`'s label. Omitted entirely when
`asOfDate` is missing.

### Cache behaviour

Rows cached before this change lack both keys, so the new date row and the Growth
header stay hidden for that symbol until the 1-day TTL expires or the user hits the
existing force-reload button. No migration, no cache invalidation.

## Testing

`tests/main/providers/FmpProvider.test.ts`, using the existing fixtures — both
`fmp-earnings.json` and `fmp-financial-growth.json` already carry `date`, so no
fixture changes:

- `schedule.lastEarningsDate` equals the date of the newest row that has an
  `epsActual`, not the newest row overall
- `growth.asOfDate` equals the newest `/financial-growth` row's `date`
- `/earnings` with no reported row (all `epsActual` null) → `lastEarningsDate` is
  `null` while the rest of `schedule` still populates

## Out of scope

- Any date or annotation for PER / TTM ratios — FMP does not return one.
- Quarterly-vs-annual selection for `/financial-growth`; we keep the current default.
