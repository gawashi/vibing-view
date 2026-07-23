# Company Info Investment Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the company info window with investment-relevant data (valuation, financials, analyst view, growth, schedule) across English-named tabs, plus a force-reload button.

**Architecture:** `FmpProvider.getCompanyProfile` becomes an aggregator that fetches `/profile` (required) plus six optional endpoints in parallel (`Promise.allSettled`), merging whatever succeeds into one JSON blob. The blob rides the existing SQLite 1-day TTL cache and `company:info` IPC unchanged in shape. A `force` flag threads through the service/IPC/preload to bypass the TTL on demand. The renderer renders the one blob across a local-state tab bar.

**Tech Stack:** TypeScript, Electron, React, TanStack Query, zod, Vitest, better-sqlite3 (drizzle), lucide-react.

## Global Constraints

- **Saving API calls is the top priority.** All new data is fetched only when the window opens (or force-reload), and only once per day per symbol (existing TTL). No per-tab fetching. No quote fetch — reuse `price` from `/profile`.
- **SQLite = OHLCV cache / JSON blob = company profile.** No DB migration: `companyProfiles.data` is an opaque JSON blob; new fields are additive.
- FMP is on the `/stable` surface. All endpoints use `?symbol=…&apikey=…`.
- New nested groups are **optional** (`?:`) so pre-existing cached rows (which lack them, parsing back as `undefined`) stay valid. Consumers treat `group == null` (covers `undefined` and `null`) as "no data".
- Numeric schema fields use `z.coerce.number().nullable().optional().catch(null)` so a malformed present value degrades to `null` instead of throwing out the group. Objects `.passthrough()`.
- No new dependencies (no `@radix-ui/react-tabs` — the tab bar is local state + buttons).
- Pin Vite `^7`; better-sqlite3 rebuilt against Electron ABI (unchanged here).

---

### Task 1: Types + zod schemas for the six new endpoints

**Files:**
- Modify: `src/shared/types.ts:96-115` (extend `CompanyProfileData`)
- Modify: `src/main/providers/fmp.schema.ts:52-72` (add `price` to profile; add six new schemas)
- Test: `tests/main/providers/fmpSchema.test.ts` (create)

**Interfaces:**
- Consumes: nothing (leaf task).
- Produces:
  - `CompanyProfileData` gains optional groups: `price?`, `valuation?`, `financials?`, `analyst?`, `growth?`, `schedule?` (see code below).
  - Exported schemas: `fmpRatiosTtmResponse`, `fmpKeyMetricsTtmResponse`, `fmpGradesConsensusResponse`, `fmpPriceTargetConsensusResponse`, `fmpFinancialGrowthResponse`, `fmpEarningsResponse` — each a `z.array(...)` of a `.passthrough()` row object.

- [ ] **Step 1: Extend `CompanyProfileData` in `src/shared/types.ts`**

Replace the existing `CompanyProfileData` type (currently lines 96-115, ending at the closing `}` before the `fetchedAt` comment) with:

```ts
export type CompanyProfileData = {
  symbol: string
  companyName: string
  image: string | null
  exchange: string | null
  sector: string | null
  industry: string | null
  country: string | null
  marketCap: number | null
  ceo: string | null
  fullTimeEmployees: number | null
  ipoDate: string | null
  website: string | null
  description: string | null
  beta: number | null
  range: string | null
  volume: number | null
  averageVolume: number | null
  lastDividend: number | null
  // Investment metrics (added 2026-07-23). Optional so pre-existing cached rows (which lack
  // these keys and parse back as undefined) stay valid. A fresh fetch always sets each group,
  // to null if its endpoint failed. Consumers must test `group == null` (undefined OR null).
  price?: number | null // from /profile, for the Analyst price-target comparison
  valuation?: {
    peRatio: number | null
    pbRatio: number | null
    psRatio: number | null
    pegRatio: number | null
    dividendYield: number | null
    evToEbitda: number | null
    earningsYield: number | null
    fcfYield: number | null
  } | null
  financials?: {
    roe: number | null
    roa: number | null
    netMargin: number | null
    operatingMargin: number | null
    grossMargin: number | null
    debtToEquity: number | null
    currentRatio: number | null
    quickRatio: number | null
  } | null
  analyst?: {
    strongBuy: number | null
    buy: number | null
    hold: number | null
    sell: number | null
    strongSell: number | null
    consensus: string | null
    targetHigh: number | null
    targetLow: number | null
    targetMedian: number | null
    targetConsensus: number | null
  } | null
  growth?: {
    revenueGrowth: number | null
    netIncomeGrowth: number | null
    epsGrowth: number | null
  } | null
  schedule?: {
    nextEarningsDate: string | null
    lastEpsActual: number | null
    lastEpsEstimated: number | null
  } | null
}
```

- [ ] **Step 2: Add `price` to the profile schema + the six new schemas in `src/main/providers/fmp.schema.ts`**

Add `price` to `fmpProfileRow` (after the `lastDividend` line, before the closing `})` / `.passthrough()`):

```ts
  lastDividend: z.coerce.number().nullable().optional(),
  price: z.coerce.number().nullable().optional()
}).passthrough()
```

Append at the end of the file:

```ts
// Investment-metric endpoints. All numeric fields tolerate FMP field-name drift and bad values:
// .catch(null) turns a malformed present value (wrong type, unparseable) into null rather than
// throwing out the whole row. .passthrough() ignores the many fields we don't surface.
// FMP returns single-element arrays for the *-ttm / consensus endpoints; we take element [0].
const num = () => z.coerce.number().nullable().optional().catch(null)

export const fmpRatiosTtmResponse = z.array(z.object({
  priceToEarningsRatioTTM: num(),
  priceToBookRatioTTM: num(),
  priceToSalesRatioTTM: num(),
  priceToEarningsGrowthRatioTTM: num(),
  dividendYieldTTM: num(),
  returnOnEquityTTM: num(),
  returnOnAssetsTTM: num(),
  netProfitMarginTTM: num(),
  operatingProfitMarginTTM: num(),
  grossProfitMarginTTM: num(),
  currentRatioTTM: num(),
  quickRatioTTM: num(),
  debtToEquityRatioTTM: num()
}).passthrough())

export const fmpKeyMetricsTtmResponse = z.array(z.object({
  // FMP has used both spellings across versions; try evToEBITDATTM, fall back handled in provider.
  evToEBITDATTM: num(),
  enterpriseValueOverEBITDATTM: num(),
  earningsYieldTTM: num(),
  freeCashFlowYieldTTM: num()
}).passthrough())

export const fmpGradesConsensusResponse = z.array(z.object({
  strongBuy: num(),
  buy: num(),
  hold: num(),
  sell: num(),
  strongSell: num(),
  consensus: z.string().nullable().optional().catch(null)
}).passthrough())

export const fmpPriceTargetConsensusResponse = z.array(z.object({
  targetHigh: num(),
  targetLow: num(),
  targetMedian: num(),
  targetConsensus: num()
}).passthrough())

export const fmpFinancialGrowthResponse = z.array(z.object({
  // FMP field names for growth; loose so a rename degrades to null, not a throw.
  revenueGrowth: num(),
  growthRevenue: num(),
  netIncomeGrowth: num(),
  growthNetIncome: num(),
  epsgrowth: num(),
  growthEPS: num()
}).passthrough())

export const fmpEarningsResponse = z.array(z.object({
  date: z.string(),
  epsActual: num(),
  epsEstimated: num()
}).passthrough())
```

- [ ] **Step 3: Write the failing schema test**

Create `tests/main/providers/fmpSchema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  fmpRatiosTtmResponse, fmpEarningsResponse, fmpGradesConsensusResponse
} from '../../../src/main/providers/fmp.schema'

describe('fmp investment-metric schemas', () => {
  it('parses a well-formed ratios-ttm row', () => {
    const parsed = fmpRatiosTtmResponse.parse([{ priceToEarningsRatioTTM: 24.3, returnOnEquityTTM: 0.18 }])
    expect(parsed[0].priceToEarningsRatioTTM).toBe(24.3)
    expect(parsed[0].returnOnEquityTTM).toBe(0.18)
  })

  it('degrades a malformed present numeric field to null instead of throwing (.catch)', () => {
    const parsed = fmpRatiosTtmResponse.parse([{ priceToEarningsRatioTTM: 'oops', returnOnEquityTTM: 0.18 }])
    expect(parsed[0].priceToEarningsRatioTTM).toBeNull()
    expect(parsed[0].returnOnEquityTTM).toBe(0.18)
  })

  it('ignores unknown fields (passthrough) and tolerates missing ones', () => {
    const parsed = fmpGradesConsensusResponse.parse([{ buy: 12, sell: 1, somethingElse: 'x' }])
    expect(parsed[0].buy).toBe(12)
    expect(parsed[0].hold ?? null).toBeNull()
  })

  it('parses an earnings array with mixed actual/null rows', () => {
    const parsed = fmpEarningsResponse.parse([
      { date: '2026-10-30', epsActual: null, epsEstimated: 1.5 },
      { date: '2026-07-31', epsActual: 1.4, epsEstimated: 1.35 }
    ])
    expect(parsed).toHaveLength(2)
    expect(parsed[0].epsActual).toBeNull()
    expect(parsed[1].epsActual).toBe(1.4)
  })
})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/main/providers/fmpSchema.test.ts`
Expected: PASS (4 tests). If `.catch` behaves unexpectedly, confirm zod version supports `.catch` (it does in zod ^3.20).

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/providers/fmp.schema.ts tests/main/providers/fmpSchema.test.ts
git commit -m "feat(company): types + zod schemas for investment-metric endpoints"
```

---

### Task 2: `FmpProvider.getCompanyProfile` aggregator

**Files:**
- Modify: `src/main/providers/FmpProvider.ts:171-196` (rewrite `getCompanyProfile`)
- Modify: `tests/main/providers/FmpProvider.test.ts:153-181` (extend the describe block)
- Create fixtures: `tests/fixtures/fmp-ratios-ttm.json`, `fmp-key-metrics-ttm.json`, `fmp-grades-consensus.json`, `fmp-price-target-consensus.json`, `fmp-financial-growth.json`, `fmp-earnings.json`

**Interfaces:**
- Consumes: schemas + `CompanyProfileData` shape from Task 1; existing `FmpProvider.parseOrThrowHttpError`, `FmpHttpError`, `this.httpGetJson`, `BASE`.
- Produces: `getCompanyProfile(symbol: string): Promise<CompanyProfileData>` — `/profile` still required (throws on failure/empty); the six optional groups are populated or `null`.

- [ ] **Step 1: Create the six fixtures**

`tests/fixtures/fmp-ratios-ttm.json`:
```json
[{ "priceToEarningsRatioTTM": 24.31, "priceToBookRatioTTM": 47.2, "priceToSalesRatioTTM": 8.1, "priceToEarningsGrowthRatioTTM": 2.3, "dividendYieldTTM": 0.0045, "returnOnEquityTTM": 1.47, "returnOnAssetsTTM": 0.28, "netProfitMarginTTM": 0.247, "operatingProfitMarginTTM": 0.31, "grossProfitMarginTTM": 0.46, "currentRatioTTM": 0.87, "quickRatioTTM": 0.83, "debtToEquityRatioTTM": 1.87 }]
```

`tests/fixtures/fmp-key-metrics-ttm.json`:
```json
[{ "evToEBITDATTM": 26.4, "earningsYieldTTM": 0.041, "freeCashFlowYieldTTM": 0.033 }]
```

`tests/fixtures/fmp-grades-consensus.json`:
```json
[{ "strongBuy": 12, "buy": 21, "hold": 8, "sell": 1, "strongSell": 0, "consensus": "Buy" }]
```

`tests/fixtures/fmp-price-target-consensus.json`:
```json
[{ "targetHigh": 300, "targetLow": 200, "targetMedian": 260, "targetConsensus": 258.4 }]
```

`tests/fixtures/fmp-financial-growth.json`:
```json
[{ "date": "2025-09-27", "revenueGrowth": 0.08, "netIncomeGrowth": 0.11, "epsgrowth": 0.13 }, { "date": "2024-09-28", "revenueGrowth": 0.02, "netIncomeGrowth": 0.03, "epsgrowth": 0.04 }]
```

`tests/fixtures/fmp-earnings.json`:
```json
[{ "date": "2026-10-30", "epsActual": null, "epsEstimated": 1.55 }, { "date": "2026-07-31", "epsActual": 1.4, "epsEstimated": 1.35 }, { "date": "2026-05-01", "epsActual": 1.52, "epsEstimated": 1.5 }]
```

Also add `"price": 245.5` to `tests/fixtures/fmp-profile.json` (inside the single object, after `lastDividend`).

- [ ] **Step 2: Write the failing aggregator tests**

Replace the `describe('FmpProvider.getCompanyProfile', ...)` block in `tests/main/providers/FmpProvider.test.ts` with (keep the earlier describe blocks intact):

```ts
describe('FmpProvider.getCompanyProfile', () => {
  // URL-routed fake: /profile + 6 optional endpoints. Mirrors the searchSymbols multi-endpoint pattern.
  const routed = (over: Record<string, unknown> = {}) => {
    const map: Record<string, string> = {
      '/profile': 'fmp-profile.json',
      'ratios-ttm': 'fmp-ratios-ttm.json',
      'key-metrics-ttm': 'fmp-key-metrics-ttm.json',
      'grades-consensus': 'fmp-grades-consensus.json',
      'price-target-consensus': 'fmp-price-target-consensus.json',
      'financial-growth': 'fmp-financial-growth.json',
      'earnings': 'fmp-earnings.json'
    }
    return new FmpProvider({ apiKey: 'k', httpGetJson: async (url: string) => {
      for (const key of Object.keys(over)) if (url.includes(key)) {
        const v = over[key]
        if (v instanceof Error) throw v
        return v
      }
      for (const [key, file] of Object.entries(map)) if (url.includes(key)) return fx(file)
      throw new Error(`unexpected url ${url}`)
    } })
  }

  it('merges profile + all six optional groups on the happy path', async () => {
    const c = await routed().getCompanyProfile('AAPL')
    expect(c.symbol).toBe('AAPL')
    expect(c.price).toBe(245.5)
    expect(c.valuation?.peRatio).toBe(24.31)
    expect(c.valuation?.dividendYield).toBe(0.0045)
    expect(c.valuation?.evToEbitda).toBe(26.4)
    expect(c.financials?.roe).toBe(1.47)
    expect(c.financials?.debtToEquity).toBe(1.87)
    expect(c.analyst?.buy).toBe(21)
    expect(c.analyst?.consensus).toBe('Buy')
    expect(c.analyst?.targetConsensus).toBe(258.4)
    expect(c.growth?.revenueGrowth).toBe(0.08) // latest (element [0]) fiscal year
    expect(c.schedule?.nextEarningsDate).toBe('2026-10-30') // soonest row with epsActual == null
    expect(c.schedule?.lastEpsActual).toBe(1.4) // most recent row with epsActual != null
  })

  it('sets an optional group to null when its endpoint fails, keeping the others', async () => {
    const c = await routed({ 'ratios-ttm': new Error('rate limited') }).getCompanyProfile('AAPL')
    expect(c.valuation).toBeNull()
    expect(c.financials).toBeNull() // ratios-ttm feeds both
    expect(c.analyst?.buy).toBe(21) // unaffected
    expect(c.symbol).toBe('AAPL')
  })

  it('still throws when /profile itself fails (no partial anchor)', async () => {
    await expect(routed({ '/profile': [] }).getCompanyProfile('AAPL')).rejects.toBeInstanceOf(FmpHttpError)
  })

  it('calls /stable/profile with the symbol', async () => {
    const httpGetJson = vi.fn(async (url: string) => (url.includes('/profile') ? fx('fmp-profile.json') : []))
    await new FmpProvider({ apiKey: 'k', httpGetJson }).getCompanyProfile('AAPL')
    expect(httpGetJson.mock.calls.some((cc) => cc[0].includes('/profile?symbol=AAPL'))).toBe(true)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/main/providers/FmpProvider.test.ts`
Expected: FAIL — `c.valuation` etc. are `undefined` (aggregator not implemented yet).

- [ ] **Step 4: Rewrite `getCompanyProfile` in `src/main/providers/FmpProvider.ts`**

First add the imports at the top (extend the existing `fmp.schema` import):

```ts
import {
  fmpHistoricalResponse, fmpSearchResponse, fmpQuoteResponse, fmpMarketHoursResponse, fmpProfileResponse,
  fmpRatiosTtmResponse, fmpKeyMetricsTtmResponse, fmpGradesConsensusResponse,
  fmpPriceTargetConsensusResponse, fmpFinancialGrowthResponse, fmpEarningsResponse
} from './fmp.schema'
```

Replace the entire `getCompanyProfile` method (lines ~171-196) with:

```ts
  async getCompanyProfile(symbol: string): Promise<CompanyProfileData> {
    const sym = encodeURIComponent(symbol)
    // Required anchor: throws (FmpHttpError) on failure/empty → existing not-covered / error path.
    const profileRows = this.parseOrThrowHttpError(fmpProfileResponse, await this.httpGetJson(`${BASE}/profile?symbol=${sym}&apikey=${this.apiKey}`))
    const r = profileRows[0]
    if (!r) throw new FmpHttpError(200, profileRows)

    // Optional groups: fetch in parallel, never let one failure sink another. A rejected fetch,
    // an empty array, or a parse miss all collapse to a null group (→ "Not available" tab).
    const opt = async <T>(path: string, schema: { parse(v: unknown): T[] }): Promise<T | null> => {
      try {
        const rows = schema.parse(await this.httpGetJson(`${BASE}/${path}?symbol=${sym}&apikey=${this.apiKey}`))
        return rows[0] ?? null
      } catch {
        return null
      }
    }

    const [ratios, keyMetrics, grades, targets, growthRows, earnings] = await Promise.all([
      opt('ratios-ttm', fmpRatiosTtmResponse),
      opt('key-metrics-ttm', fmpKeyMetricsTtmResponse),
      opt('grades-consensus', fmpGradesConsensusResponse),
      opt('price-target-consensus', fmpPriceTargetConsensusResponse),
      // financial-growth returns newest-first; opt() already takes [0] = latest annual period.
      opt('financial-growth', fmpFinancialGrowthResponse),
      // earnings needs the whole array (next vs last), so fetch it raw and pick below.
      (async () => {
        try { return fmpEarningsResponse.parse(await this.httpGetJson(`${BASE}/earnings?symbol=${sym}&apikey=${this.apiKey}`)) }
        catch { return null }
      })()
    ])

    const valuation = ratios || keyMetrics ? {
      peRatio: ratios?.priceToEarningsRatioTTM ?? null,
      pbRatio: ratios?.priceToBookRatioTTM ?? null,
      psRatio: ratios?.priceToSalesRatioTTM ?? null,
      pegRatio: ratios?.priceToEarningsGrowthRatioTTM ?? null,
      dividendYield: ratios?.dividendYieldTTM ?? null,
      evToEbitda: keyMetrics?.evToEBITDATTM ?? keyMetrics?.enterpriseValueOverEBITDATTM ?? null,
      earningsYield: keyMetrics?.earningsYieldTTM ?? null,
      fcfYield: keyMetrics?.freeCashFlowYieldTTM ?? null
    } : null

    const financials = ratios ? {
      roe: ratios.returnOnEquityTTM ?? null,
      roa: ratios.returnOnAssetsTTM ?? null,
      netMargin: ratios.netProfitMarginTTM ?? null,
      operatingMargin: ratios.operatingProfitMarginTTM ?? null,
      grossMargin: ratios.grossProfitMarginTTM ?? null,
      debtToEquity: ratios.debtToEquityRatioTTM ?? null,
      currentRatio: ratios.currentRatioTTM ?? null,
      quickRatio: ratios.quickRatioTTM ?? null
    } : null

    const analyst = grades || targets ? {
      strongBuy: grades?.strongBuy ?? null,
      buy: grades?.buy ?? null,
      hold: grades?.hold ?? null,
      sell: grades?.sell ?? null,
      strongSell: grades?.strongSell ?? null,
      consensus: grades?.consensus ?? null,
      targetHigh: targets?.targetHigh ?? null,
      targetLow: targets?.targetLow ?? null,
      targetMedian: targets?.targetMedian ?? null,
      targetConsensus: targets?.targetConsensus ?? null
    } : null

    const growth = growthRows ? {
      revenueGrowth: growthRows.revenueGrowth ?? growthRows.growthRevenue ?? null,
      netIncomeGrowth: growthRows.netIncomeGrowth ?? growthRows.growthNetIncome ?? null,
      epsGrowth: growthRows.epsgrowth ?? growthRows.growthEPS ?? null
    } : null

    // Upcoming earnings carry epsActual === null; reported ones have it set. No clock needed.
    const upcoming = (earnings ?? []).filter((e) => e.epsActual == null).sort((a, b) => a.date.localeCompare(b.date))[0]
    const reported = (earnings ?? []).filter((e) => e.epsActual != null).sort((a, b) => b.date.localeCompare(a.date))[0]
    const schedule = earnings ? {
      nextEarningsDate: upcoming?.date ?? null,
      lastEpsActual: reported?.epsActual ?? null,
      lastEpsEstimated: reported?.epsEstimated ?? null
    } : null

    return {
      symbol: r.symbol,
      companyName: r.companyName,
      image: r.image ?? null,
      exchange: r.exchange ?? null,
      sector: r.sector ?? null,
      industry: r.industry ?? null,
      country: r.country ?? null,
      marketCap: r.marketCap ?? null,
      ceo: r.ceo ?? null,
      fullTimeEmployees: r.fullTimeEmployees ?? null,
      ipoDate: r.ipoDate ?? null,
      website: r.website ?? null,
      description: r.description ?? null,
      beta: r.beta ?? null,
      range: r.range ?? null,
      volume: r.volume ?? null,
      averageVolume: r.averageVolume ?? null,
      lastDividend: r.lastDividend ?? null,
      price: r.price ?? null,
      valuation, financials, analyst, growth, schedule
    }
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/main/providers/FmpProvider.test.ts`
Expected: PASS (all existing + 4 new getCompanyProfile tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/providers/FmpProvider.ts tests/main/providers/FmpProvider.test.ts tests/fixtures/
git commit -m "feat(company): aggregate investment-metric endpoints in getCompanyProfile"
```

---

### Task 3: `force` flag through service → IPC → preload → Api type

**Files:**
- Modify: `src/main/profile/CompanyInfoService.ts:18-32` (`getInfo` gains `opts`)
- Modify: `src/main/ipc.ts:85` (pass `opts` through)
- Modify: `src/preload/index.ts:53` (`info` forwards `opts`)
- Modify: `src/shared/ipc.ts:85` (`Api.company.info` signature)
- Modify: `tests/main/profile/CompanyInfoService.test.ts` (add a force test)

**Interfaces:**
- Consumes: existing `createCompanyInfoService`, `CompanyInfo`.
- Produces: `getInfo(symbol: string, opts?: { force?: boolean }): Promise<CompanyInfo>`; `Api.company.info(symbol: string, opts?: { force?: boolean })`.

- [ ] **Step 1: Write the failing force test**

Add to `tests/main/profile/CompanyInfoService.test.ts` inside the `describe`:

```ts
  it('force: true refetches even when the row is fresh (within TTL)', async () => {
    const store = fakeStore({ data: DATA, fetchedAt: NOW - 100 }) // fresh
    const fetch = vi.fn(async () => DATA)
    const svc = createCompanyInfoService({ store, fetch, now: () => NOW })
    const info = await svc.getInfo('AAPL', { force: true })
    expect(fetch).toHaveBeenCalledOnce()
    expect(store.upsertCompanyProfile).toHaveBeenCalledWith('AAPL', DATA, NOW)
    expect(info).toEqual({ ...DATA, fetchedAt: NOW })
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/main/profile/CompanyInfoService.test.ts`
Expected: FAIL — fresh row still short-circuits, `fetch` not called.

- [ ] **Step 3: Add the `opts` param in `src/main/profile/CompanyInfoService.ts`**

Change the `getInfo` signature and the cache-hit guard:

```ts
    async getInfo(symbol: string, opts?: { force?: boolean }): Promise<CompanyInfo> {
      const cached = store.getCompanyProfile(symbol)
      if (!opts?.force && cached && now() - cached.fetchedAt < TTL_SECONDS) {
        return { ...cached.data, fetchedAt: cached.fetchedAt }
      }
```

(The rest of the method — fetch, upsert, stale fallback — is unchanged.)

- [ ] **Step 4: Thread `opts` through IPC and preload**

`src/main/ipc.ts` line 85:
```ts
  ipcMain.handle(CH.companyInfo, (_e, symbol: string, opts?: { force?: boolean }) => companyInfoService.getInfo(symbol, opts))
```

`src/preload/index.ts` line 53:
```ts
    info: (symbol, opts) => ipcRenderer.invoke(CH.companyInfo, symbol, opts),
```

`src/shared/ipc.ts` line 85 (inside `company:`):
```ts
    info(symbol: string, opts?: { force?: boolean }): Promise<CompanyInfo>
```

- [ ] **Step 5: Run the service test + typecheck**

Run: `npx vitest run tests/main/profile/CompanyInfoService.test.ts`
Expected: PASS (all existing + the new force test).

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/profile/CompanyInfoService.ts src/main/ipc.ts src/preload/index.ts src/shared/ipc.ts tests/main/profile/CompanyInfoService.test.ts
git commit -m "feat(company): force flag to bypass company-info TTL cache"
```

---

### Task 4: Renderer — tabs, formatting, analyst coloring, force-reload button

**Files:**
- Modify: `src/renderer/components/CompanyWindow.tsx` (rewrite the body)
- Create: `tests/renderer/companyFormat.test.ts`

**Interfaces:**
- Consumes: `CompanyProfileData`/`CompanyInfo` shape (Task 1), `api.company.info(symbol, opts?)` (Task 3), existing `qk.companyInfo`, `useQuery`, `useMutation`, `useQueryClient`, `RefreshCw` from `lucide-react`, `cn` util, `Tooltip`/`TooltipContent` (as used in `App.tsx`).
- Produces: none (leaf/UI task).

- [ ] **Step 1: Write the failing formatter test**

The number formatting is the one piece of non-trivial logic worth a unit test. Extract three pure helpers from the component into module scope and export them. Create `tests/renderer/companyFormat.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { fmtRatio, fmtPct, fmtMoney } from '../../src/renderer/components/CompanyWindow'

describe('company metric formatters', () => {
  it('fmtRatio: 2 decimals, null-safe', () => {
    expect(fmtRatio(24.312)).toBe('24.31')
    expect(fmtRatio(null)).toBeNull()
    expect(fmtRatio(undefined)).toBeNull()
  })
  it('fmtPct: ratio → percent, 1 decimal', () => {
    expect(fmtPct(0.184)).toBe('18.4%')
    expect(fmtPct(1.47)).toBe('147.0%')
    expect(fmtPct(null)).toBeNull()
  })
  it('fmtMoney: $ + 2 decimals', () => {
    expect(fmtMoney(258.4)).toBe('$258.40')
    expect(fmtMoney(null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/renderer/companyFormat.test.ts`
Expected: FAIL — `fmtRatio`/`fmtPct`/`fmtMoney` not exported.

- [ ] **Step 3: Rewrite `src/renderer/components/CompanyWindow.tsx`**

Replace the whole file with:

```tsx
import React, { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { api, qk } from '@/api'
import { cn } from '@/lib/utils'
import type { CompanyInfo } from '@shared/types'

const fmtCompact = (n: number | null | undefined): string | null =>
  n == null ? null : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n)
export const fmtRatio = (n: number | null | undefined): string | null => (n == null ? null : n.toFixed(2))
export const fmtPct = (n: number | null | undefined): string | null => (n == null ? null : `${(n * 100).toFixed(1)}%`)
export const fmtMoney = (n: number | null | undefined): string | null => (n == null ? null : `$${n.toFixed(2)}`)

// 値が null/空なら行ごと出さない（未取得フィールドで空ラベルが並ぶのを防ぐ）。
function Attr({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element | null {
  if (value == null || value === '') return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  )
}

const Grid = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div className="grid grid-cols-2 gap-x-6 gap-y-3">{children}</div>
)

// group == null (undefined from old cached rows OR null from a failed endpoint) → neutral note.
const NotAvailable = (): React.JSX.Element => (
  <div className="p-2 text-center text-sm text-muted-foreground">Not available.</div>
)

const TABS = ['Overview', 'Valuation', 'Financials', 'Analyst', 'Growth', 'Schedule'] as const
type Tab = (typeof TABS)[number]

function OverviewTab({ c }: { c: CompanyInfo }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <Grid>
        <Attr label="Sector" value={c.sector} />
        <Attr label="Industry" value={c.industry} />
        <Attr label="Country" value={c.country} />
        <Attr label="Market cap" value={fmtCompact(c.marketCap)} />
        <Attr label="CEO" value={c.ceo} />
        <Attr label="Employees" value={fmtCompact(c.fullTimeEmployees)} />
        <Attr label="IPO date" value={c.ipoDate} />
        <Attr label="Beta" value={fmtRatio(c.beta)} />
        <Attr label="52-week range" value={c.range} />
        <Attr label="Volume" value={fmtCompact(c.volume)} />
        <Attr label="Avg volume" value={fmtCompact(c.averageVolume)} />
        <Attr label="Last dividend" value={fmtRatio(c.lastDividend)} />
      </Grid>
      {c.description && <p className="text-sm text-muted-foreground">{c.description}</p>}
      {c.website && (
        <a href={c.website} target="_blank" rel="noreferrer" className="truncate text-xs text-primary hover:underline">{c.website}</a>
      )}
    </div>
  )
}

function ValuationTab({ c }: { c: CompanyInfo }): React.JSX.Element {
  const v = c.valuation
  if (v == null) return <NotAvailable />
  return (
    <Grid>
      <Attr label="P/E" value={fmtRatio(v.peRatio)} />
      <Attr label="P/B" value={fmtRatio(v.pbRatio)} />
      <Attr label="P/S" value={fmtRatio(v.psRatio)} />
      <Attr label="PEG" value={fmtRatio(v.pegRatio)} />
      <Attr label="EV/EBITDA" value={fmtRatio(v.evToEbitda)} />
      <Attr label="Dividend yield" value={fmtPct(v.dividendYield)} />
      <Attr label="Earnings yield" value={fmtPct(v.earningsYield)} />
      <Attr label="FCF yield" value={fmtPct(v.fcfYield)} />
    </Grid>
  )
}

function FinancialsTab({ c }: { c: CompanyInfo }): React.JSX.Element {
  const f = c.financials
  if (f == null) return <NotAvailable />
  return (
    <Grid>
      <Attr label="ROE" value={fmtPct(f.roe)} />
      <Attr label="ROA" value={fmtPct(f.roa)} />
      <Attr label="Net margin" value={fmtPct(f.netMargin)} />
      <Attr label="Operating margin" value={fmtPct(f.operatingMargin)} />
      <Attr label="Gross margin" value={fmtPct(f.grossMargin)} />
      <Attr label="Debt / equity" value={fmtRatio(f.debtToEquity)} />
      <Attr label="Current ratio" value={fmtRatio(f.currentRatio)} />
      <Attr label="Quick ratio" value={fmtRatio(f.quickRatio)} />
    </Grid>
  )
}

function AnalystTab({ c }: { c: CompanyInfo }): React.JSX.Element {
  const a = c.analyst
  if (a == null) return <NotAvailable />
  const price = c.price
  const targetColor = (t: number | null): string =>
    price == null || t == null ? '' : t >= price ? 'text-green-500' : 'text-red-500'
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">Consensus</span>
        <span className="text-sm">{a.consensus ?? '—'}</span>
      </div>
      <Grid>
        <Attr label="Strong buy" value={a.strongBuy != null ? <span className="text-green-500">{a.strongBuy}</span> : null} />
        <Attr label="Buy" value={a.buy != null ? <span className="text-green-500">{a.buy}</span> : null} />
        <Attr label="Hold" value={a.hold} />
        <Attr label="Sell" value={a.sell != null ? <span className="text-red-500">{a.sell}</span> : null} />
        <Attr label="Strong sell" value={a.strongSell != null ? <span className="text-red-500">{a.strongSell}</span> : null} />
      </Grid>
      <Grid>
        <Attr label="Target high" value={a.targetHigh != null ? <span className={targetColor(a.targetHigh)}>{fmtMoney(a.targetHigh)}</span> : null} />
        <Attr label="Target median" value={a.targetMedian != null ? <span className={targetColor(a.targetMedian)}>{fmtMoney(a.targetMedian)}</span> : null} />
        <Attr label="Target consensus" value={a.targetConsensus != null ? <span className={targetColor(a.targetConsensus)}>{fmtMoney(a.targetConsensus)}</span> : null} />
        <Attr label="Target low" value={a.targetLow != null ? <span className={targetColor(a.targetLow)}>{fmtMoney(a.targetLow)}</span> : null} />
        <Attr label="Current price" value={fmtMoney(price ?? null)} />
      </Grid>
    </div>
  )
}

function GrowthTab({ c }: { c: CompanyInfo }): React.JSX.Element {
  const g = c.growth
  if (g == null) return <NotAvailable />
  return (
    <Grid>
      <Attr label="Revenue growth" value={fmtPct(g.revenueGrowth)} />
      <Attr label="Net income growth" value={fmtPct(g.netIncomeGrowth)} />
      <Attr label="EPS growth" value={fmtPct(g.epsGrowth)} />
    </Grid>
  )
}

function ScheduleTab({ c }: { c: CompanyInfo }): React.JSX.Element {
  const s = c.schedule
  if (s == null) return <NotAvailable />
  return (
    <Grid>
      <Attr label="Next earnings date" value={s.nextEarningsDate} />
      <Attr label="Last EPS (actual)" value={fmtRatio(s.lastEpsActual)} />
      <Attr label="Last EPS (estimate)" value={fmtRatio(s.lastEpsEstimated)} />
    </Grid>
  )
}

function CompanyInfoBody({ symbol }: { symbol: string }): React.JSX.Element {
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('Overview')
  const q = useQuery<CompanyInfo>({ queryKey: qk.companyInfo(symbol), queryFn: () => api.company.info(symbol) })
  const reload = useMutation({
    mutationFn: () => api.company.info(symbol, { force: true }),
    onSuccess: (data) => qc.setQueryData(qk.companyInfo(symbol), data)
  })

  if (q.isLoading) return <div className="p-2 text-muted-foreground">Loading company info…</div>
  if (q.isError || !q.data) {
    const notCovered = /FMP HTTP (200|40[0-9])/.test(String((q.error as Error)?.message))
    return (
      <div className="p-2 text-center text-muted-foreground">
        {notCovered
          ? 'Company info isn’t available on your current FMP plan.'
          : 'Couldn’t load company info. Check your connection or your FMP API key in Settings.'}
      </div>
    )
  }

  const c = q.data
  const asOf = new Date(c.fetchedAt * 1000).toISOString().slice(0, 10)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {c.image && <img src={c.image} alt="" className="h-10 w-10 shrink-0 rounded" />}
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-base font-semibold">{c.companyName}</span>
          <span className="text-sm text-muted-foreground">{c.symbol}{c.exchange ? ` · ${c.exchange}` : ''}</span>
        </div>
        <button
          type="button"
          onClick={() => reload.mutate()}
          disabled={reload.isPending}
          aria-label="Reload company info"
          title="Reload company info"
          className="ml-auto shrink-0 rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn('size-4', reload.isPending && 'animate-spin')} />
        </button>
      </div>

      <div className="flex gap-1 border-b border-border text-sm">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'border-b-2 px-2 py-1',
              tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && <OverviewTab c={c} />}
      {tab === 'Valuation' && <ValuationTab c={c} />}
      {tab === 'Financials' && <FinancialsTab c={c} />}
      {tab === 'Analyst' && <AnalystTab c={c} />}
      {tab === 'Growth' && <GrowthTab c={c} />}
      {tab === 'Schedule' && <ScheduleTab c={c} />}

      <div className="text-right text-xs text-muted-foreground">As of {asOf}</div>
    </div>
  )
}

export function CompanyWindow({ symbol }: { symbol: string }): React.JSX.Element {
  useEffect(() => { document.title = symbol }, [symbol])
  return (
    <div className="h-screen overflow-auto bg-background p-6 text-foreground">
      <h1 className="mb-4 text-sm font-semibold text-muted-foreground">Company info</h1>
      <CompanyInfoBody symbol={symbol} />
    </div>
  )
}
```

> Note: `cn` lives at `src/renderer/lib/utils` (App.tsx imports it as `./lib/utils`). From `components/` use the `@/lib/utils` alias as written above — `@` resolves to `src/renderer` (this file already imports `@/api`).

- [ ] **Step 4: Run the formatter test to verify it passes**

Run: `npx vitest run tests/renderer/companyFormat.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + full test run**

Run: `npm run typecheck` then `npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 6: Manual smoke test**

Run: `npm run dev`. Right-click a chart cell or watchlist row → "Show company info". Confirm:
- Six tabs render; Overview matches the old content.
- A covered symbol (e.g. AAPL) populates Valuation/Financials/Analyst/Growth/Schedule.
- The force-reload button (top-right) spins and refetches (watch the network / a changed "As of" is not expected same-day, but the spinner completes without error).
- A symbol/endpoint not on your plan shows "Not available." on the affected tab only; other tabs still render.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/CompanyWindow.tsx tests/renderer/companyFormat.test.ts
git commit -m "feat(company): tabbed investment-metrics view with force reload"
```

---

## Self-Review Notes

- **Spec coverage:** endpoints→tabs (Task 1/2), backward-compat optional groups (Task 1), `.catch(null)` tolerance (Task 1), row selection incl. clock-free earnings next/last (Task 2), profile `price` reuse for Analyst comparison (Task 2/4), per-tab neutral "Not available" (Task 4), display units ratio/percent/currency (Task 4), force-reload button + plumbing (Task 3/4). Deferred dividend dates remain out of scope.
- **Type consistency:** `getInfo(symbol, opts?)`, `Api.company.info(symbol, opts?)`, group field names (`peRatio`, `evToEbitda`, `targetConsensus`, `revenueGrowth`, `nextEarningsDate`, `lastEpsActual`) are used identically across tasks.
- **Field-name risk:** FMP `/stable` field names for ratios/key-metrics/growth are best-known but may drift. Schemas are loose (`.passthrough()` + `.catch(null)`) and the provider tries both known spellings for EV/EBITDA and growth. If a live payload shows a tab stuck on "Not available", capture the real field name and add it to the mapping/`??` chain — tests use the fixtures above and stay green regardless.
```
