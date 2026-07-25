# Earnings Basis Dates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the last earnings report date in the Schedule tab and the fiscal period end in the Growth tab of the company info window.

**Architecture:** Both dates already arrive inside FMP responses the app fetches today (`/earnings`, `/financial-growth`) and are discarded during mapping in `FmpProvider.getCompanyProfile`. Task 1 carries them through the schema → provider → `CompanyProfileData` blob; Task 2 renders them. No new API calls, no cache migration.

**Tech Stack:** TypeScript, Electron main process, zod (FMP response parsing), React + Tailwind (renderer), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-25-earnings-basis-dates-design.md`

## Global Constraints

- No new FMP API calls. Both values come from responses already fetched in `getCompanyProfile`.
- New fields are **optional keys** (`?:`) inside the existing optional `schedule` / `growth` groups. `companyProfileStore.getCompanyProfile` does a plain `JSON.parse` + cast with no re-validation, so pre-existing cached blobs parse back with these keys `undefined`. Consumers must treat `undefined` and `null` identically.
- UI labels are English, matching the existing tabs (`Next earnings date`, `Last EPS (actual)`, …).
- No fixture changes. `tests/fixtures/fmp-earnings.json` and `tests/fixtures/fmp-financial-growth.json` already carry `date`.
- Out of scope: any date for PER / TTM ratios (FMP returns none), a dedicated zod test for the new `date` field, component-render tests, and stricter `YYYY-MM-DD` validation.

---

### Task 1: Carry both dates through the data layer

**Files:**
- Modify: `tests/main/providers/FmpProvider.test.ts` (imports on line 1; `describe('FmpProvider.getCompanyProfile')` starting line 153; happy-path assertions at lines 189-190)
- Modify: `src/shared/types.ts:151-160` (the `growth` and `schedule` groups of `CompanyProfileData`)
- Modify: `src/main/providers/fmp.schema.ts:119-123` (`fmpFinancialGrowthResponse`)
- Modify: `src/main/providers/FmpProvider.ts:242-259` (the `growth` / `reported` / `schedule` mapping inside `getCompanyProfile`)
- Test: `tests/main/providers/FmpProvider.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: two optional fields on `CompanyProfileData` (exported from `src/shared/types.ts`), consumed by Task 2:
  - `schedule?.lastEarningsDate?: string | null` — `YYYY-MM-DD` of the most recent **past** earnings report
  - `growth?.asOfDate?: string | null` — `YYYY-MM-DD` fiscal period end of the growth figures

**Background — why `reported` changes too.** `getCompanyProfile` currently picks the "last report" as the newest `/earnings` row with a non-null `epsActual`, with no date bound, while `upcoming` two lines above it filters on `date >= today`. A future-dated row carrying an `epsActual` therefore wins as "the last report". That is invisible today because only EPS numbers are shown, but it becomes plainly wrong the moment its date is printed. The test fixture contains exactly such a row (`2026-07-31`, `epsActual: 1.4`), which is why the existing `lastEpsActual` expectation changes from `1.4` to `1.52` in this task.

- [ ] **Step 1: Freeze the clock in the company-profile test block**

`getCompanyProfile` compares earnings dates against `new Date()`. The suite currently passes only because the fixture's dates happen to straddle the real today — it would start failing on its own once 2026-10-30 passes. Fake only `Date` so the fake clock cannot interfere with promise scheduling.

In `tests/main/providers/FmpProvider.test.ts`, change the first import line to add `beforeEach` and `afterEach`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
```

Then insert these two hooks at the top of the `describe('FmpProvider.getCompanyProfile', () => {` block (line 153), immediately above the `const routed = ...` helper:

```ts
  // Earnings selection compares against `new Date()`; pin it so the fixture's
  // past/future rows keep their meaning as real time moves on.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-25T00:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })
```

- [ ] **Step 2: Update the happy-path assertions and add the no-past-report test**

In the `it('merges profile + all six optional groups on the happy path', ...)` test, replace these two lines:

```ts
    expect(c.schedule?.nextEarningsDate).toBe('2026-10-30') // soonest row with epsActual == null
    expect(c.schedule?.lastEpsActual).toBe(1.4) // most recent row with epsActual != null
```

with:

```ts
    expect(c.growth?.asOfDate).toBe('2025-09-27') // fiscal period end of element [0]
    expect(c.schedule?.nextEarningsDate).toBe('2026-10-30') // soonest row with epsActual == null
    // 2026-07-31 also carries an epsActual but is in the future, so 2026-05-01 is the last report.
    expect(c.schedule?.lastEarningsDate).toBe('2026-05-01')
    expect(c.schedule?.lastEpsActual).toBe(1.52)
    expect(c.schedule?.lastEpsEstimated).toBe(1.5)
```

Then add this test directly after that `it(...)` block:

```ts
  it('nulls the whole last-report trio when no earnings row is both reported and past', async () => {
    const c = await routed({ 'earnings': [
      { date: '2026-10-30', epsActual: null, epsEstimated: 1.55 },
      { date: '2026-07-31', epsActual: 1.4, epsEstimated: 1.35 }
    ] }).getCompanyProfile('AAPL')
    expect(c.schedule?.lastEarningsDate).toBeNull()
    expect(c.schedule?.lastEpsActual).toBeNull()
    expect(c.schedule?.lastEpsEstimated).toBeNull()
    expect(c.schedule?.nextEarningsDate).toBe('2026-10-30') // upcoming still resolves
  })
```

The `routed(over)` helper matches `over` keys as URL substrings and returns the given value as the parsed JSON body, so `'earnings'` swaps just that endpoint's payload.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- tests/main/providers/FmpProvider.test.ts`

Expected: FAIL. The happy-path test fails on `expected undefined to be '2025-09-27'` (`asOfDate` is not produced yet) and, once that is reached, on `lastEpsActual` being `1.4` rather than `1.52`. The new test fails because `lastEarningsDate` is `undefined`, not `null`.

- [ ] **Step 4: Add the two optional fields to the shared type**

In `src/shared/types.ts`, replace the `growth` and `schedule` groups (lines 151-160) with:

```ts
  growth?: {
    // Fiscal period end of the row these figures come from; optional because blobs
    // cached before 2026-07-25 lack the key and parse back as undefined.
    asOfDate?: string | null
    revenueGrowth: number | null
    netIncomeGrowth: number | null
    epsGrowth: number | null
  } | null
  schedule?: {
    nextEarningsDate: string | null
    // Optional for the same cached-blob reason as growth.asOfDate.
    lastEarningsDate?: string | null
    lastEpsActual: number | null
    lastEpsEstimated: number | null
  } | null
```

- [ ] **Step 5: Parse the fiscal period date from /financial-growth**

In `src/main/providers/fmp.schema.ts`, replace `fmpFinancialGrowthResponse` (lines 119-123) with:

```ts
export const fmpFinancialGrowthResponse = z.array(z.object({
  date: z.string().nullable().optional().catch(null),
  revenueGrowth: num(),
  netIncomeGrowth: num(),
  epsgrowth: num()
}).passthrough())
```

`.catch(null)` matches the tolerance the `num()` fields beside it already have: FMP field drift degrades one value instead of throwing out the whole row.

- [ ] **Step 6: Map both dates in the provider**

In `src/main/providers/FmpProvider.ts`, replace the `growth` block (lines 242-246) with:

```ts
    const growth = growthRows ? {
      asOfDate: growthRows.date ?? null,
      revenueGrowth: growthRows.revenueGrowth ?? null,
      netIncomeGrowth: growthRows.netIncomeGrowth ?? null,
      epsGrowth: growthRows.epsgrowth ?? null
    } : null
```

Then replace the `reported` and `schedule` lines (lines 254-259) with:

```ts
    // Bound `reported` by today for the same reason `upcoming` is: a future-dated row can
    // carry an epsActual, and it must not be presented as the last report.
    const reported = (earnings ?? [])
      .filter((e) => e.epsActual != null && e.date <= today)
      .sort((a, b) => b.date.localeCompare(a.date))[0]
    const schedule = earnings ? {
      nextEarningsDate: upcoming?.date ?? null,
      lastEarningsDate: reported?.date ?? null,
      lastEpsActual: reported?.epsActual ?? null,
      lastEpsEstimated: reported?.epsEstimated ?? null
    } : null
```

Leave the `upcoming` computation and the `const today = ...` line above it untouched — `today` is reused as-is.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- tests/main/providers/FmpProvider.test.ts`

Expected: PASS, all tests in the file.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`

Expected: no output, exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/shared/types.ts src/main/providers/fmp.schema.ts src/main/providers/FmpProvider.ts tests/main/providers/FmpProvider.test.ts
git commit -m "feat(company): carry last earnings date and growth fiscal period through the data layer"
```

---

### Task 2: Show both dates in the company info window

**Files:**
- Modify: `src/renderer/components/CompanyWindow.tsx:225-247` (`GrowthTab` and `ScheduleTab`)

**Interfaces:**
- Consumes: `CompanyInfo['schedule']['lastEarningsDate']` and `CompanyInfo['growth']['asOfDate']` from Task 1 — both `string | null | undefined`.
- Produces: nothing consumed by later tasks.

No test in this task. `tests/renderer/` covers pure functions only; this change adds no logic beyond two conditional renders, and introducing a component-render harness for it is explicitly out of scope in the spec.

- [ ] **Step 1: Add the fiscal period header to the Growth tab**

All three `GrowthBar`s come from the same annual row, so the period is stated once above them. In `src/renderer/components/CompanyWindow.tsx`, replace the body of `GrowthTab` (lines 225-235) with:

```tsx
function GrowthTab({ c }: { c: CompanyInfo }): React.JSX.Element {
  const g = c.growth
  if (g == null) return <NotAvailable />
  return (
    <div className="flex flex-col gap-3">
      {g.asOfDate && <div className="text-xs text-muted-foreground">Fiscal period end · {g.asOfDate}</div>}
      <GrowthBar label="Revenue growth" value={g.revenueGrowth} />
      <GrowthBar label="Net income growth" value={g.netIncomeGrowth} />
      <GrowthBar label="EPS growth" value={g.epsGrowth} />
    </div>
  )
}
```

`g.asOfDate &&` covers `undefined` (blob cached before Task 1), `null` (endpoint returned no date) and `''` in one guard — the header is simply absent in all three cases. `text-xs text-muted-foreground` is the same muted style `Attr` uses for its labels.

- [ ] **Step 2: Add the last earnings date to the Schedule tab**

It goes **first** so the two-column `Grid` reads in time order — past report on the left, next report on the right. Replace the body of `ScheduleTab` (lines 237-247) with:

```tsx
function ScheduleTab({ c }: { c: CompanyInfo }): React.JSX.Element {
  const s = c.schedule
  if (s == null) return <NotAvailable />
  return (
    <Grid>
      <Attr label="Last earnings date" value={s.lastEarningsDate} />
      <Attr label="Next earnings date" value={s.nextEarningsDate} />
      <Attr label="Last EPS (actual)" value={fmtRatio(s.lastEpsActual)} />
      <Attr label="Last EPS (estimate)" value={fmtRatio(s.lastEpsEstimated)} />
    </Grid>
  )
}
```

`Attr` already returns `null` when its value is `null`/`undefined`/`''` (`CompanyWindow.tsx:16`), so a blob cached before Task 1 renders the tab exactly as it does today, minus the new row.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`

Expected: no output, exit 0. This is the real check for this task — it proves the two new optional fields are read with types that match Task 1's declarations.

- [ ] **Step 4: Run the full suite**

Run: `npm test`

Expected: PASS, 30 files / 256 tests (255 before this plan, plus the one added in Task 1), 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/CompanyWindow.tsx
git commit -m "feat(company): show last earnings date and growth fiscal period"
```

---

## Manual verification (optional, after Task 2)

`npm run dev`, open a company info window for a symbol, and check the Schedule and Growth tabs. A symbol cached within the last 24 hours shows neither new value until the force-reload button (top-right of the window) fetches successfully — the cached JSON blob predates these fields, and `CompanyInfoService` falls back to the stale row if the refetch fails.
