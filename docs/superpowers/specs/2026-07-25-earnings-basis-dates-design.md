# Company info — earnings basis dates — Design

**Date:** 2026-07-25
**Status:** Approved (pending spec review)

## Problem

The company info window shows EPS and growth numbers with no indication of which
reporting period they came from.

Two gaps, both of them data we already fetch and then discard:

1. **前回の決算報告日** — `FmpProvider.getCompanyProfile` computes `reported`
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

`FmpProvider.getCompanyProfile`:

- `schedule.lastEarningsDate` ← `reported?.date ?? null`
- `growth.asOfDate` ← the `date` of the `/financial-growth` row already selected by
  `opt()` (newest-first, so `[0]` is the latest annual period)

**Fix `reported` while we are here.** `reported` currently selects the newest row with
a non-null `epsActual` and applies no date bound, while `upcoming` right above it
filters on `date >= today`. A future-dated row carrying an `epsActual` therefore
becomes "the last report" — invisible today because only the EPS numbers are shown,
but plainly wrong the moment we print its date. Add the symmetric bound:

```ts
const reported = (earnings ?? [])
  .filter((e) => e.epsActual != null && e.date <= today)
  .sort((a, b) => b.date.localeCompare(a.date))[0]
```

`lastEpsActual` / `lastEpsEstimated` keep coming from that same row, so the three
Schedule values stay consistent with each other.

`/financial-growth` ordering is not re-verified: the existing code already trusts
newest-first for the growth values themselves, and showing `asOfDate` makes a wrong
order visible rather than silent.

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
header stay hidden for that symbol until the **next successful fetch** — TTL expiry or
the force-reload button only triggers an attempt, and `CompanyInfoService` falls back
to the stale row when that attempt fails. No migration, no cache invalidation.

## Testing

`tests/main/providers/FmpProvider.test.ts`, using the existing fixtures — both
`fmp-earnings.json` and `fmp-financial-growth.json` already carry `date`, so no
fixture changes.

**Freeze the clock first.** Earnings selection reads `new Date()`, and the suite
currently passes only because the fixture's dates happen to straddle the real today;
it would start failing on its own once 2026-10-30 passes. Fake timers in the test are
enough — no clock injection into `FmpProvider`.

`vitest.config.ts:9` registers `setupFiles` for the renderer project only, so the main
tests have no shared timer setup and each test owns its clock: `vi.useFakeTimers()`
then `vi.setSystemTime(new Date('2026-07-25'))` before the call, `vi.useRealTimers()`
in a `finally`/`afterEach` so the fake clock cannot leak into the rest of the file.

Against that fixed date, `fmp-earnings.json` has rows `2026-10-30` (no actual),
`2026-07-31` (actual 1.4, **future**), `2026-05-01` (actual 1.52):

- `schedule.lastEarningsDate` is `2026-05-01` — the newest *past* reported row, not
  the future-dated `2026-07-31` one
- `schedule.lastEpsActual` is `1.52`, updating the existing assertion of `1.4`
  (`FmpProvider.test.ts:190`), which encoded the pre-fix behaviour
- `schedule.nextEarningsDate` stays `2026-10-30`
- `growth.asOfDate` equals the newest `/financial-growth` row's `date`
- `/earnings` with no past reported row → `lastEarningsDate`, `lastEpsActual` and
  `lastEpsEstimated` are all `null` while `nextEarningsDate` still populates

## Out of scope

- Any date or annotation for PER / TTM ratios — FMP does not return one.
- Quarterly-vs-annual selection for `/financial-growth`; we keep the current default.
- A dedicated schema test for the new `date` field. It uses the same
  `.catch(null)` shape as the numeric fields beside it; a test for it would be a test
  of zod.
- Component-render tests for the two new UI lines. `tests/renderer/` covers pure
  functions only, and this change does not justify introducing a rendering harness.
- Stricter `YYYY-MM-DD` validation. `Attr` already drops empty strings
  (`value == null || value === ''`), and a malformed date would be shown as-is
  rather than crashing.
