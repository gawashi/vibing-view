# Economic Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A separate window that lists macro-economic releases for one local week (Mon–Sun), with country / impact / text filters, local + ET times, and a day-granular SQLite cache that costs at most one FMP request per week viewed.

**Architecture:** Traces the existing Company-info path end to end — `FmpProvider` normalizes the FMP payload to UTC epoch seconds, `EconomicCalendarService` does day-granular read-through against a new `economic_days` table, `core.economicCalendar.getRange` exposes it electron-free, `ipc.ts` maps four channels, and the renderer mounts `EconomicCalendarWindow` off a `#economic=1` hash. Week arithmetic and filtering live in pure functions (`src/renderer/lib/economicWeek.ts`) so they're unit-testable without a DOM.

**Tech Stack:** TypeScript, Electron (`BrowserWindow`, `ipcMain`), React 19, TanStack Query, drizzle-orm + better-sqlite3, zod, date-fns + date-fns-tz, Vitest.

## Global Constraints

- Pin Vite at `^7` — do not touch build config in this plan.
- `SQLite = OHLCV cache / JSON = user preferences`. `economic_days` is cache (SQLite); `economicFilter` is a preference (`settings.json`).
- The renderer reaches the preload bridge only through `@/api` (`window.api`) — never touch `window.api` elsewhere.
- `src/main/core.ts` must not import `electron` — every electron/sqlite touchpoint arrives through `CoreDeps` injection.
- Tests live in `tests/**/*.test.ts` (`.ts` only — no `.tsx`, so React components are not unit-tested), `environment: 'node'`, run with `npm test`. Import source by relative path (`../../src/main/...`); the `@shared` and `@/` aliases also resolve.
- Typecheck gate: `npm run typecheck` (runs `tsconfig.node.json` + `tsconfig.web.json`).
- `better-sqlite3` is native and bound to Electron's ABI — Vitest never loads it (`db/client.ts` lazy-requires). Store modules therefore get no unit tests; their gate is typecheck plus the manual run in Task 10.
- Raw API captures go to the scratchpad, never into the repo. Only trimmed fixtures are committed.
- UI copy is English, matching the rest of the app and the spec's layout mockup (the spec's error table is written in Japanese as *description*, not as literal copy).

---

### Task 1: Pin down the `date` basis from the real API (EC-02)

**Blocking prerequisite.** No persistence code may be written before this task completes: a wrong basis writes `economic_days` rows under wrong keys, and unlike the conversion function those rows cannot be repaired.

**Files:**
- Create: `tests/fixtures/fmp-economic-calendar.json` (trimmed verbatim rows from a **summer** week)
- Create: `tests/fixtures/fmp-economic-calendar-winter.json` (trimmed verbatim rows from a **winter** week)
- Modify: `docs/superpowers/specs/2026-07-26-economic-calendar-design.md` (record the confirmed basis under EC-02)

**Interfaces:**
- Produces: a recorded fact — *"FMP's `economic-calendar` `date` is UTC-based"* or *"…is ET-based"* — consumed by Task 3's conversion function and its tests.

**Why two weeks:** US CPI is released at 08:30 America/New_York. In summer (EDT, UTC−4) a UTC-based `date` reads `12:30:00`; in winter (EST, UTC−5) it reads `13:30:00`. An ET-based `date` reads `08:30:00` in both. One week can't tell a fixed-offset bug from a correct basis; two weeks across the DST boundary can. Two requests out of a monthly quota is the cheap way to settle it permanently.

- [ ] **Step 1: Capture the summer week**

Ask the user to run this themselves (the FMP key lives in the encrypted keystore and is not readable from a script). Have them type, with `YOUR_KEY` replaced:

```
! curl -s "https://financialmodelingprep.com/stable/economic-calendar?from=2026-07-13&to=2026-07-17&apikey=YOUR_KEY" -o "$SCRATCH/raw-economic-summer.json" && node -e "const r=require(process.env.SCRATCH+'/raw-economic-summer.json'); console.log(Array.isArray(r)?r.length+' rows':JSON.stringify(r).slice(0,400))"
```

Where `$SCRATCH` is the session scratchpad directory. If the output is not `N rows` but a JSON object, it is an error payload (`402`/`403` = the endpoint is off-plan) — stop and report that to the user; the whole feature is blocked until the plan covers it.

- [ ] **Step 2: Capture the winter week**

```
! curl -s "https://financialmodelingprep.com/stable/economic-calendar?from=2026-01-12&to=2026-01-16&apikey=YOUR_KEY" -o "$SCRATCH/raw-economic-winter.json" && node -e "const r=require(process.env.SCRATCH+'/raw-economic-winter.json'); console.log(Array.isArray(r)?r.length+' rows':JSON.stringify(r).slice(0,400))"
```

- [ ] **Step 3: Read the US CPI row out of each capture**

```bash
node -e "for (const f of ['summer','winter']) { const r = require(process.env.SCRATCH + '/raw-economic-' + f + '.json'); console.log('== ' + f); console.log(JSON.stringify(r.filter(x => x.country === 'US' && /CPI/i.test(x.event)), null, 2)) }"
```

Read the `date` of the CPI row in each file and decide:

| summer `date` time | winter `date` time | Basis |
|---|---|---|
| `12:30:00` | `13:30:00` | **UTC** — offset tracks ET's DST shift, so the string is already UTC |
| `08:30:00` | `08:30:00` | **ET** — the string is exchange-local wall clock |

Anything else (e.g. both `12:30:00`, or no CPI row in either week) means neither model holds — stop, report the actual strings to the user, and do not proceed to Task 2.

- [ ] **Step 4: Also check the `from`/`to` behaviour**

```bash
node -e "for (const f of ['summer','winter']) { const r = require(process.env.SCRATCH + '/raw-economic-' + f + '.json'); console.log(f, [...new Set(r.map(x => x.date.slice(0,10)))].sort()) }"
```

Record whether the requested end dates (`2026-07-13`/`2026-07-17`, `2026-01-12`/`2026-01-16`) are present. Task 3 widens the requested range by one day on both ends unconditionally, so this is recorded as evidence, not as a decision — but note it, because a *missing* end date confirms the widening is load-bearing.

- [ ] **Step 5: Write the trimmed fixtures**

Build each fixture as a JSON array of rows **copied verbatim** from the capture (same key order, same values, nothing edited). Take about 6–10 rows each and make sure the set includes:

- the US CPI row (required — Task 3's test asserts on it)
- at least one non-US row (for the country filter and `Major`/`All` presets)
- at least one row whose `date` time-of-day is 20:00 or later (crosses the UTC day boundary under an ET basis)

```bash
node -e "
const fs = require('fs')
for (const [f, out] of [['summer','fmp-economic-calendar.json'], ['winter','fmp-economic-calendar-winter.json']]) {
  const r = require(process.env.SCRATCH + '/raw-economic-' + f + '.json')
  const cpi = r.filter(x => x.country === 'US' && /CPI/i.test(x.event))
  const late = r.filter(x => x.date.slice(11,13) >= '20').slice(0, 2)
  const other = r.filter(x => x.country !== 'US').slice(0, 3)
  const us = r.filter(x => x.country === 'US' && !/CPI/i.test(x.event)).slice(0, 2)
  const seen = new Set(), rows = []
  for (const x of [...cpi, ...late, ...other, ...us]) { const k = JSON.stringify(x); if (!seen.has(k)) { seen.add(k); rows.push(x) } }
  fs.writeFileSync('tests/fixtures/' + out, JSON.stringify(rows, null, 2) + '\n')
  console.log(out, rows.length, 'rows')
}
"
```

If a bucket comes up empty (e.g. no row at/after 20:00 in that week), just note it — do not synthesize rows into the fixtures. Synthetic edge cases (unknown `impact`, all-null FOMC-shaped rows, `actual: null`) are written inline in Task 3's test file, where their being hand-made is visible.

- [ ] **Step 6: Record the basis in the spec**

In `docs/superpowers/specs/2026-07-26-economic-calendar-design.md`, replace the paragraph beginning `確定した基準はこの設計書に追記し、` in the "着手前に確定させること（EC-02）" section with the finding. Use this shape, filling in the two bracketed spots from Steps 3–4:

```markdown
**確定した基準（2026-07-26 実測）**: `date` は **[UTC | ET]** 基準。米 CPI（08:30 ET）の行は
夏週 `tests/fixtures/fmp-economic-calendar.json` で `[実測値]`、冬週
`tests/fixtures/fmp-economic-calendar-winter.json` で `[実測値]`。`from`/`to` は要求した端の日が
`[返る | 欠ける]`。`FmpProvider` は要求範囲を両端 1 日広げる（基準に依らず安全で、リクエスト数は
変わらない）。変換関数の直上に同じ内容をコメントで残す。
```

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures/fmp-economic-calendar.json tests/fixtures/fmp-economic-calendar-winter.json docs/superpowers/specs/2026-07-26-economic-calendar-design.md
git commit -m "test(economic): capture economic-calendar fixtures and pin the date basis"
```

---

### Task 2: Shared window-hash helper

**Files:**
- Create: `src/shared/economicWindow.ts`
- Test: `tests/economicWindow.test.ts`

**Interfaces:**
- Produces:
  - `buildEconomicHash(): string` — returns `"economic=1"` (no leading `#`).
  - `parseEconomicWindow(hash: string): boolean` — accepts `location.hash` with or without a leading `#`; `true` when the economic window is the target.

- [ ] **Step 1: Write the failing test**

```ts
// tests/economicWindow.test.ts
import { describe, it, expect } from 'vitest'
import { buildEconomicHash, parseEconomicWindow } from '../src/shared/economicWindow'

describe('economic window hash', () => {
  it('round-trips through build → parse', () => {
    expect(parseEconomicWindow('#' + buildEconomicHash())).toBe(true)
  })

  it('parses with and without a leading #', () => {
    expect(parseEconomicWindow('#economic=1')).toBe(true)
    expect(parseEconomicWindow('economic=1')).toBe(true)
  })

  it('is false for an empty hash or another window', () => {
    expect(parseEconomicWindow('')).toBe(false)
    expect(parseEconomicWindow('#company=AAPL')).toBe(false)
    expect(parseEconomicWindow('#chart=1-2')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/economicWindow.test.ts`
Expected: FAIL — cannot resolve `../src/shared/economicWindow`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/economicWindow.ts
// 経済カレンダーウィンドウは main の renderer バンドルを使い回し、対象は #economic=1 で判別する。
// main.tsx が parseEconomicWindow で分岐し、main プロセスの index.ts が buildEconomicHash で URL を
// 組む。companyWindow.ts の双子。週は renderer state なので hash には乗せない（EC-09/EC-10）。
export function buildEconomicHash(): string {
  return 'economic=1'
}

export function parseEconomicWindow(hash: string): boolean {
  const q = hash.startsWith('#') ? hash.slice(1) : hash
  return new URLSearchParams(q).get('economic') !== null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/economicWindow.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/economicWindow.ts tests/economicWindow.test.ts
git commit -m "feat(economic): shared economic-window hash helper"
```

---

### Task 3: Types, zod schema, and `FmpProvider.getEconomicCalendar`

**Files:**
- Modify: `src/shared/types.ts` (append at end of file)
- Modify: `src/main/providers/fmp.schema.ts` (append at end of file)
- Modify: `src/main/providers/FmpProvider.ts`
- Test: `tests/main/providers/FmpProvider.test.ts` (append a new `describe`)

**Interfaces:**
- Consumes: the basis recorded in Task 1; `tests/fixtures/fmp-economic-calendar*.json`.
- Produces:
  - `EconomicImpact = 'High' | 'Medium' | 'Low'`
  - `EconomicEvent = { time: number; country: string; currency: string | null; event: string; impact: EconomicImpact; previous: number | null; estimate: number | null; actual: number | null }`
  - `EconomicRange = { events: EconomicEvent[]; fetchedAt: number; stale?: boolean }`
  - `EconomicCountryPreset = 'us' | 'major' | 'all'`
  - `EconomicFilterPref = { countries: EconomicCountryPreset; impacts: EconomicImpact[] }`
  - `fmpEconomicCalendarResponse` (zod)
  - `FmpProvider.getEconomicCalendar(from: string, to: string): Promise<EconomicEvent[]>` — `from`/`to` are UTC `'YYYY-MM-DD'`; returns events sorted ascending by `time`.

- [ ] **Step 1: Add the shared types**

Append to `src/shared/types.ts`:

```ts
// ── 経済カレンダー ──────────────────────────────────────────────────────────
export type EconomicImpact = 'High' | 'Medium' | 'Low'

export type EconomicEvent = {
  time: number            // UTC epoch 秒（Bar.time と同じ規約）
  country: string         // 'US' など、FMP が返すコードそのまま
  currency: string | null
  event: string           // 指標名。FMP は説明文を返さない
  impact: EconomicImpact
  previous: number | null
  estimate: number | null
  actual: number | null   // 未発表なら null
}

// getRange の戻り。fetchedAt は要求した日のうち最も古い取得時刻（一番古い情報がいつのものか）。
// stale は「古い行を返した、再取得は失敗した」— fetchedAt だけでは区別できない（CompanyInfo と同じ）。
// events は常に要求範囲の全日をカバーする（欠けがあれば throw、EC-18）。部分的な範囲は返らない。
export type EconomicRange = { events: EconomicEvent[]; fetchedAt: number; stale?: boolean }

// 国フィルタは単一選択のプリセット（EC-11）。データ由来の動的な国リストは持たない。
export type EconomicCountryPreset = 'us' | 'major' | 'all'
// settings.json の economicFilter。テキストフィルタは永続化しない（EC-13）。
export type EconomicFilterPref = { countries: EconomicCountryPreset; impacts: EconomicImpact[] }
```

- [ ] **Step 2: Add the zod schema**

Append to `src/main/providers/fmp.schema.ts` (after `fmpEarningsResponse`, so the local `num()` helper is in scope):

```ts
// /stable/economic-calendar returns a flat array. `impact` は z.string() で受けてから正規化する:
// 空文字 / 'None' / 休場表記など未知の値でパースを落とさない（EC-03、正規化は FmpProvider）。
// change / changePercentage は previous と actual から導出できるので受けない（EC-01）。
export const fmpEconomicCalendarResponse = z.array(z.object({
  date: z.string(),
  country: z.string(),
  currency: z.string().nullable().optional().catch(null),
  event: z.string(),
  previous: num(),
  estimate: num(),
  actual: num(),
  impact: z.string().nullable().optional().catch(null)
}).passthrough())
```

- [ ] **Step 3: Write the failing test**

Append to `tests/main/providers/FmpProvider.test.ts`. Fill the two `CPI_*` date constants from the fixtures written in Task 1 (`node -e "console.log(require('./tests/fixtures/fmp-economic-calendar.json').find(x=>x.country==='US'&&/CPI/i.test(x.event)).date)"`, same for the winter file). The asserted instants are the real-world fact — US CPI is released 08:30 America/New_York, i.e. 12:30Z under EDT and 13:30Z under EST — so they hold whichever basis Task 1 recorded, and they fail if the conversion is off by a fixed offset **or** ignores DST.

```ts
describe('FmpProvider.getEconomicCalendar', () => {
  // 夏週/冬週の米 CPI の暦日。Task 1 の fixture から転記（08:30 ET 発表という事実で epoch を固定する）。
  const CPI_SUMMER_DAY = '2026-07-14' // ← fixture の date の先頭 10 文字に合わせる
  const CPI_WINTER_DAY = '2026-01-13' // ← 同上（winter fixture）

  const cpiOf = (events: { event: string; country: string }[]) =>
    events.find((e) => e.country === 'US' && /CPI/i.test(e.event))!

  it('maps the summer CPI row to 08:30 America/New_York (= 12:30Z under EDT)', async () => {
    const events = await provider(fx('fmp-economic-calendar.json')).getEconomicCalendar('2026-07-13', '2026-07-17')
    expect(cpiOf(events).time).toBe(Math.floor(Date.parse(`${CPI_SUMMER_DAY}T12:30:00Z`) / 1000))
  })

  it('maps the winter CPI row to 08:30 America/New_York (= 13:30Z under EST)', async () => {
    const events = await provider(fx('fmp-economic-calendar-winter.json')).getEconomicCalendar('2026-01-12', '2026-01-16')
    expect(cpiOf(events).time).toBe(Math.floor(Date.parse(`${CPI_WINTER_DAY}T13:30:00Z`) / 1000))
  })

  it('returns events sorted ascending by time', async () => {
    const events = await provider(fx('fmp-economic-calendar.json')).getEconomicCalendar('2026-07-13', '2026-07-17')
    expect(events.length).toBeGreaterThan(1)
    expect(events.map((e) => e.time)).toEqual([...events.map((e) => e.time)].sort((a, b) => a - b))
  })

  // 要求範囲を両端 1 日広げる（EC-02）。ET 基準だと UTC 日の端が欠けるため。リクエスト数は変わらない。
  it('widens the requested range by one day on each end', async () => {
    const httpGetJson = vi.fn(async (_url: string) => fx('fmp-economic-calendar.json'))
    await new FmpProvider({ apiKey: 'k', httpGetJson }).getEconomicCalendar('2026-07-13', '2026-07-17')
    expect(httpGetJson).toHaveBeenCalledTimes(1)
    const url = httpGetJson.mock.calls[0][0]
    expect(url).toContain('/economic-calendar?')
    expect(url).toContain('from=2026-07-12')
    expect(url).toContain('to=2026-07-18')
  })

  // 以下 3 件は手書きの合成行。fixture には入れない（実レスポンスの verbatim 性を保つため）。
  it('normalizes an unknown impact to Low (EC-03)', async () => {
    const rows = [
      { date: '2026-07-14 12:30:00', country: 'US', currency: 'USD', event: 'A', previous: 1, estimate: 2, actual: 3, impact: '' },
      { date: '2026-07-14 13:30:00', country: 'US', currency: 'USD', event: 'B', previous: 1, estimate: 2, actual: 3, impact: 'None' },
      { date: '2026-07-14 14:30:00', country: 'US', currency: 'USD', event: 'C', previous: 1, estimate: 2, actual: 3, impact: 'Holiday' },
      { date: '2026-07-14 15:30:00', country: 'US', currency: 'USD', event: 'D', previous: 1, estimate: 2, actual: 3, impact: null }
    ]
    const events = await provider(rows).getEconomicCalendar('2026-07-14', '2026-07-14')
    expect(events.map((e) => e.impact)).toEqual(['Low', 'Low', 'Low', 'Low'])
  })

  it('keeps High/Medium/Low case-insensitively', async () => {
    const rows = ['high', 'Medium', 'LOW'].map((impact, i) => ({
      date: `2026-07-14 1${i}:00:00`, country: 'US', currency: 'USD', event: `E${i}`,
      previous: null, estimate: null, actual: null, impact
    }))
    const events = await provider(rows).getEconomicCalendar('2026-07-14', '2026-07-14')
    expect(events.map((e) => e.impact)).toEqual(['High', 'Medium', 'Low'])
  })

  it('passes through nulls: unreleased actual, and the all-null FOMC shape', async () => {
    const rows = [
      { date: '2026-07-14 12:30:00', country: 'US', currency: 'USD', event: 'CPI MoM', previous: 0.2, estimate: 0.3, actual: null, impact: 'High' },
      { date: '2026-07-14 18:00:00', country: 'US', currency: null, event: 'FOMC Rate Decision', previous: null, estimate: null, actual: null, impact: 'High' }
    ]
    const events = await provider(rows).getEconomicCalendar('2026-07-14', '2026-07-14')
    expect(events[0]).toMatchObject({ event: 'CPI MoM', previous: 0.2, estimate: 0.3, actual: null })
    expect(events[1]).toMatchObject({ event: 'FOMC Rate Decision', currency: null, previous: null, estimate: null, actual: null })
  })

  it('wraps an error-shaped 200 payload as FmpHttpError(200) so core can classify it', async () => {
    let caught: unknown
    try { await provider(fx('fmp-error.json')).getEconomicCalendar('2026-07-13', '2026-07-17') } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(FmpHttpError)
    expect(classify((caught as FmpHttpError).status, (caught as FmpHttpError).body)).toBe('requires-plan')
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/main/providers/FmpProvider.test.ts`
Expected: FAIL — `getEconomicCalendar is not a function`.

- [ ] **Step 5: Implement in `FmpProvider.ts`**

Add `EconomicEvent`, `EconomicImpact` to the `@shared/types` type import and `fmpEconomicCalendarResponse` to the `./fmp.schema` import. Add `addDays` to the existing `date-fns` import.

Add these two module-level helpers next to `nyDateTimeToEpochSeconds`. **Pick exactly one body for `economicDateToEpochSeconds`** — the one matching the basis Task 1 recorded in the spec — and delete the other line along with its trailing comment:

```ts
// FMP の /economic-calendar の `date` は "2026-07-14 12:30:00" 形式でタイムゾーンマーカーを持たない。
// 実測で確定した基準は spec の EC-02 に記録済み（米 CPI = 08:30 ET を夏週/冬週の両方で突き合わせた）。
// これが SQLite の economic_days のキー（UTC 日）を決めるので、基準を変えるときは client.ts で
// DROP TABLE economic_days する — 1 週 1 リクエストの安いキャッシュなので捨てるほうが小さい。
function economicDateToEpochSeconds(s: string): number {
  return Math.floor(Date.parse(`${s.replace(' ', 'T')}Z`) / 1000) // UTC 基準の場合
  // return nyDateTimeToEpochSeconds(s)                            // ET 基準の場合
}

// 'YYYY-MM-DD' を UTC 日で n 日ずらす。
function shiftUtcDay(day: string, n: number): string {
  return ymd(addDays(new Date(`${day}T00:00:00Z`), n))
}

const ECONOMIC_IMPACT: Record<string, EconomicImpact> = { high: 'High', medium: 'Medium', low: 'Low' }
```

Then add this method to the `FmpProvider` class, after `getCompanyProfile`:

```ts
  // from/to は UTC 日の 'YYYY-MM-DD'。範囲を両端 1 日広げる: FMP の from/to が ET 基準だと要求した
  // UTC 日の端が欠ける（EC-02）。広げてもリクエストは 1 本のままで、範囲外の日は
  // EconomicCalendarService が捨てる。
  async getEconomicCalendar(from: string, to: string): Promise<EconomicEvent[]> {
    const url = `${BASE}/economic-calendar?from=${shiftUtcDay(from, -1)}&to=${shiftUtcDay(to, 1)}&apikey=${this.apiKey}`
    const rows = this.parseOrThrowHttpError(fmpEconomicCalendarResponse, await this.httpGetJson(url))
    return rows
      .map((r) => ({
        time: economicDateToEpochSeconds(r.date),
        country: r.country,
        currency: r.currency ?? null,
        event: r.event,
        impact: ECONOMIC_IMPACT[(r.impact ?? '').toLowerCase()] ?? 'Low',
        previous: r.previous ?? null,
        estimate: r.estimate ?? null,
        actual: r.actual ?? null
      }))
      .sort((a, b) => a.time - b.time)
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/main/providers/FmpProvider.test.ts`
Expected: PASS. If the two CPI tests fail, the wrong branch of `economicDateToEpochSeconds` was kept — swap it and re-run. Do not "fix" the expected instants: 08:30 ET is the fact under test.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/providers/fmp.schema.ts src/main/providers/FmpProvider.ts tests/main/providers/FmpProvider.test.ts
git commit -m "feat(economic): FmpProvider.getEconomicCalendar with UTC-epoch normalization"
```

---

### Task 4: `economic_days` table and store

**Files:**
- Modify: `src/main/db/schema.ts` (append)
- Modify: `src/main/db/client.ts` (add a `CREATE TABLE IF NOT EXISTS`)
- Create: `src/main/db/economicDayStore.ts`

**Interfaces:**
- Consumes: `EconomicEvent` (Task 3).
- Produces:
  - `getDays(days: string[]): EconomicDayRow[]` where `EconomicDayRow = { date: string; events: EconomicEvent[]; fetchedAt: number }`
  - `upsertDays(rows: EconomicDayRow[]): void`

**Notes:** No unit test — this is pure blob I/O over `better-sqlite3`, which Vitest never loads (same as `companyProfileStore.ts`, which also has none). Its gate is typecheck plus Task 10's manual run.

- [ ] **Step 1: Add the drizzle table**

Append to `src/main/db/schema.ts`:

```ts
// 経済カレンダーの日単位キャッシュ（EC-05）。date は UTC 日の 'YYYY-MM-DD'、data はその日の
// EconomicEvent[] の JSON blob（company_profiles と同じ blob 方針でマイグレーション不要）。
// 発表が無い日も '[]' の行を書く（EC-08）— 書かないと土日祝が毎回ミス判定になり API を空撃ちする。
export const economicDays = sqliteTable('economic_days', {
  date: text('date').primaryKey(),
  data: text('data').notNull(),
  fetchedAt: integer('fetched_at').notNull()
})
```

- [ ] **Step 2: Add the DDL**

In `src/main/db/client.ts`, inside the `sqlite.exec(\`...\`)` template, after the `company_profiles` block:

```sql
    CREATE TABLE IF NOT EXISTS economic_days (
      date TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at INTEGER NOT NULL
    );
```

- [ ] **Step 3: Create the store**

```ts
// src/main/db/economicDayStore.ts
import { inArray } from 'drizzle-orm'
import type { EconomicEvent } from '@shared/types'
import { getDb } from './client'
import { economicDays } from './schema'

// data 列はその UTC 日の EconomicEvent[] の JSON blob。確定判定/欠け範囲の算出は
// EconomicCalendarService の責務で、ここは純粋な blob の read/write のみ（companyProfileStore と同じ）。
export type EconomicDayRow = { date: string; events: EconomicEvent[]; fetchedAt: number }

export function getDays(days: string[]): EconomicDayRow[] {
  if (days.length === 0) return []
  const rows = getDb().select().from(economicDays).where(inArray(economicDays.date, days)).all()
  return rows.map((r) => ({ date: r.date, events: JSON.parse(r.data) as EconomicEvent[], fetchedAt: r.fetchedAt }))
}

export function upsertDays(rows: EconomicDayRow[]): void {
  const db = getDb()
  for (const r of rows) {
    const blob = JSON.stringify(r.events)
    db.insert(economicDays)
      .values({ date: r.date, data: blob, fetchedAt: r.fetchedAt })
      .onConflictDoUpdate({ target: economicDays.date, set: { data: blob, fetchedAt: r.fetchedAt } })
      .run()
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/db/schema.ts src/main/db/client.ts src/main/db/economicDayStore.ts
git commit -m "feat(economic): economic_days table and day-blob store"
```

---

### Task 5: `EconomicCalendarService` — day-granular read-through

**Files:**
- Create: `src/main/calendar/EconomicCalendarService.ts`
- Test: `tests/main/calendar/EconomicCalendarService.test.ts`

**Interfaces:**
- Consumes: `EconomicEvent` / `EconomicRange` (Task 3); the `getDays`/`upsertDays` shape of `EconomicDayRow` (Task 4).
- Produces:
  - `createEconomicCalendarService(deps: { store: { getDays(days: string[]): EconomicDayRow[]; upsertDays(rows: EconomicDayRow[]): void }; fetch: (from: string, to: string) => Promise<EconomicEvent[]>; now?: () => number })`
  - `.getRange(from: string, to: string, opts?: { force?: boolean }): Promise<EconomicRange>` — `from`/`to` inclusive UTC `'YYYY-MM-DD'`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/calendar/EconomicCalendarService.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createEconomicCalendarService } from '../../../src/main/calendar/EconomicCalendarService'
import type { EconomicEvent } from '@shared/types'

// 2026-07-27 (Mon) 00:00Z = 1785110400。週の各日 12:00Z を epoch で扱う。
const DAY0 = Date.parse('2026-07-27T00:00:00Z') / 1000
const NOON = (dayOffset: number): number => DAY0 + dayOffset * 86400 + 12 * 3600
const ymd = (offset: number): string => new Date((DAY0 + offset * 86400) * 1000).toISOString().slice(0, 10)

const ev = (time: number, event = 'CPI'): EconomicEvent => ({
  time, country: 'US', currency: 'USD', event, impact: 'High',
  previous: null, estimate: null, actual: null
})

type Row = { date: string; events: EconomicEvent[]; fetchedAt: number }

function fakeStore(initial: Row[] = []) {
  const rows = new Map(initial.map((r) => [r.date, r]))
  return {
    rows,
    getDays: vi.fn((days: string[]) => days.flatMap((d) => (rows.has(d) ? [rows.get(d)!] : []))),
    upsertDays: vi.fn((next: Row[]) => { for (const r of next) rows.set(r.date, r) })
  }
}

// 週の月〜金 (2026-07-27..07-31) を要求範囲として使う。
const FROM = ymd(0)
const TO = ymd(4)
const DAYS = [ymd(0), ymd(1), ymd(2), ymd(3), ymd(4)]

// 全日を fetchedAt で埋めた行セット
const filled = (fetchedAt: number, events: EconomicEvent[] = []): Row[] =>
  DAYS.map((date) => ({ date, events: events.filter((e) => new Date(e.time * 1000).toISOString().slice(0, 10) === date), fetchedAt }))

describe('EconomicCalendarService.getRange — 確定判定 (EC-06)', () => {
  it('does not refetch a day whose row was fetched after that day ended (確定)', async () => {
    // その日の翌 00:00 UTC 以降に取得済み → 確定。now が遠い未来でも再取得しない。
    const store = fakeStore(filled(DAY0 + 5 * 86400, [ev(NOON(0))]))
    const fetch = vi.fn()
    const svc = createEconomicCalendarService({ store, fetch, now: () => DAY0 + 60 * 86400 })
    const r = await svc.getRange(FROM, TO)
    expect(fetch).not.toHaveBeenCalled()
    expect(r.events.map((e) => e.time)).toEqual([NOON(0)])
    expect(r.fetchedAt).toBe(DAY0 + 5 * 86400)
    expect(r.stale).toBeUndefined()
  })

  // 金曜 10:00Z に取った金曜の行は 13:30Z 発表分の actual が null。永続扱いにしてはいけない。
  it('refetches a row written before its own day ended, once past the TTL', async () => {
    const beforeDayEnd = DAY0 + 4 * 86400 + 10 * 3600 // Fri 10:00Z
    const rows = filled(DAY0 + 5 * 86400)
    rows[4] = { date: ymd(4), events: [], fetchedAt: beforeDayEnd }
    const store = fakeStore(rows)
    const fetch = vi.fn(async () => [ev(NOON(4), 'NFP')])
    const svc = createEconomicCalendarService({ store, fetch, now: () => beforeDayEnd + 4000 }) // > TTL 3600
    await svc.getRange(FROM, TO)
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(ymd(4), ymd(4))
  })

  it('does not refetch an unconfirmed row inside the 3600s TTL', async () => {
    const beforeDayEnd = DAY0 + 4 * 86400 + 10 * 3600
    const rows = filled(DAY0 + 5 * 86400)
    rows[4] = { date: ymd(4), events: [], fetchedAt: beforeDayEnd }
    const store = fakeStore(rows)
    const fetch = vi.fn()
    const svc = createEconomicCalendarService({ store, fetch, now: () => beforeDayEnd + 3599 })
    await svc.getRange(FROM, TO)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('EconomicCalendarService.getRange — 欠け範囲 (EC-07)', () => {
  it('folds non-contiguous missing days into a single min..max request', async () => {
    // Mon と Fri だけ欠け → Mon..Fri の 1 リクエスト（間の fresh な日も上書きされるが無害）
    const rows = filled(DAY0 + 5 * 86400).filter((r) => r.date !== ymd(0) && r.date !== ymd(4))
    const store = fakeStore(rows)
    const fetch = vi.fn(async () => [])
    const svc = createEconomicCalendarService({ store, fetch, now: () => DAY0 + 60 * 86400 })
    await svc.getRange(FROM, TO)
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(ymd(0), ymd(4))
  })

  it('makes exactly one request when nothing is cached', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => [])
    const svc = createEconomicCalendarService({ store, fetch, now: () => DAY0 + 60 * 86400 })
    await svc.getRange(FROM, TO)
    expect(fetch).toHaveBeenCalledExactlyOnceWith(FROM, TO)
  })
})

describe('EconomicCalendarService.getRange — 空日の行 (EC-08)', () => {
  it("writes a '[]' row for every requested day the response did not cover", async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => [ev(NOON(1))])
    const svc = createEconomicCalendarService({ store, fetch, now: () => DAY0 + 60 * 86400 })
    await svc.getRange(FROM, TO)
    expect([...store.rows.keys()].sort()).toEqual(DAYS)
    expect(store.rows.get(ymd(0))!.events).toEqual([])
    expect(store.rows.get(ymd(1))!.events.map((e) => e.time)).toEqual([NOON(1)])
  })

  it('does not fetch again on a second call for the same range', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => [ev(NOON(1))])
    const svc = createEconomicCalendarService({ store, fetch, now: () => DAY0 + 60 * 86400 })
    await svc.getRange(FROM, TO)
    const second = await svc.getRange(FROM, TO)
    expect(fetch).toHaveBeenCalledOnce()
    expect(second.events.map((e) => e.time)).toEqual([NOON(1)])
  })

  it('drops events that fall outside the requested range (provider widens by a day)', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => [ev(NOON(-1), 'before'), ev(NOON(2), 'inside'), ev(NOON(5), 'after')])
    const svc = createEconomicCalendarService({ store, fetch, now: () => DAY0 + 60 * 86400 })
    const r = await svc.getRange(FROM, TO)
    expect(r.events.map((e) => e.event)).toEqual(['inside'])
    expect([...store.rows.keys()].sort()).toEqual(DAYS)
  })
})

describe('EconomicCalendarService.getRange — フェッチ失敗 (EC-18)', () => {
  it('returns stale: true when the fetch fails but every requested day has a row', async () => {
    const stale = DAY0 + 4 * 86400 + 10 * 3600
    const rows = filled(DAY0 + 5 * 86400, [ev(NOON(0))])
    rows[4] = { date: ymd(4), events: [], fetchedAt: stale }
    const store = fakeStore(rows)
    const fetch = vi.fn(async () => { throw new Error('rate limited') })
    const svc = createEconomicCalendarService({ store, fetch, now: () => stale + 4000 })
    const r = await svc.getRange(FROM, TO)
    expect(r.stale).toBe(true)
    expect(r.events.map((e) => e.time)).toEqual([NOON(0)])
    expect(r.fetchedAt).toBe(stale) // 表示対象の日で最も古い取得時刻
  })

  // '[]' の行は「その日は発表なし」の意味なので、行があるとみなす。
  it("treats an empty-events row as present, not missing", async () => {
    const store = fakeStore(filled(DAY0 + 5 * 86400)) // 全日 events: []
    const fetch = vi.fn(async () => { throw new Error('down') })
    const svc = createEconomicCalendarService({ store, fetch, now: () => DAY0 + 60 * 86400 })
    const r = await svc.getRange(FROM, TO, { force: true })
    expect(r).toEqual({ events: [], fetchedAt: DAY0 + 5 * 86400, stale: true })
  })

  it('throws when the fetch fails and some requested day has no row (mixed state)', async () => {
    // 月〜水はキャッシュ済み、木〜金は未取得。部分的な範囲を stale で返すと欠けが空に見える。
    const rows = filled(DAY0 + 5 * 86400, [ev(NOON(0))]).slice(0, 3)
    const store = fakeStore(rows)
    const fetch = vi.fn(async () => { throw new Error('down') })
    const svc = createEconomicCalendarService({ store, fetch, now: () => DAY0 + 60 * 86400 })
    await expect(svc.getRange(FROM, TO)).rejects.toThrow('down')
  })

  it('throws when the fetch fails and nothing is cached', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => { throw new Error('down') })
    const svc = createEconomicCalendarService({ store, fetch, now: () => DAY0 + 60 * 86400 })
    await expect(svc.getRange(FROM, TO)).rejects.toThrow('down')
  })
})

describe('EconomicCalendarService.getRange — force', () => {
  it('refetches every requested day, ignoring 確定 and TTL', async () => {
    const store = fakeStore(filled(DAY0 + 5 * 86400, [ev(NOON(0), 'old')]))
    const fetch = vi.fn(async () => [ev(NOON(0), 'new')])
    const svc = createEconomicCalendarService({ store, fetch, now: () => DAY0 + 60 * 86400 })
    const r = await svc.getRange(FROM, TO, { force: true })
    expect(fetch).toHaveBeenCalledExactlyOnceWith(FROM, TO)
    expect(r.events.map((e) => e.event)).toEqual(['new'])
    expect(r.fetchedAt).toBe(DAY0 + 60 * 86400)
  })
})

describe('EconomicCalendarService.getRange — ordering', () => {
  it('returns events sorted ascending across day boundaries', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => [ev(NOON(3), 'd3'), ev(NOON(1), 'd1'), ev(NOON(2), 'd2')])
    const svc = createEconomicCalendarService({ store, fetch, now: () => DAY0 + 60 * 86400 })
    const r = await svc.getRange(FROM, TO)
    expect(r.events.map((e) => e.event)).toEqual(['d1', 'd2', 'd3'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/calendar/EconomicCalendarService.test.ts`
Expected: FAIL — cannot resolve `../../../src/main/calendar/EconomicCalendarService`.

- [ ] **Step 3: Write the implementation**

```ts
// src/main/calendar/EconomicCalendarService.ts
import type { EconomicEvent, EconomicRange } from '@shared/types'

// その日の翌 00:00 UTC 以降に取得した行は確定 — 以後フェッチしない。それ以外は TTL 3600 秒（EC-06）。
// 「過去日は永続」では穴が空く: 金曜 10:00 UTC に取った金曜の行は 13:30 UTC 発表分の actual が
// null のまま固定されてしまう。条件は取得時刻で切る。
const TTL_SECONDS = 3600

export type EconomicDayRow = { date: string; events: EconomicEvent[]; fetchedAt: number }

const utcYmd = (epochSeconds: number): string => new Date(epochSeconds * 1000).toISOString().slice(0, 10)
const dayStart = (day: string): number => Date.parse(`${day}T00:00:00Z`) / 1000

// from..to（両端含む）の UTC 日を昇順で列挙。
function enumerateDays(from: string, to: string): string[] {
  const days: string[] = []
  for (let t = dayStart(from), end = dayStart(to); t <= end; t += 86400) days.push(utcYmd(t))
  return days
}

export function createEconomicCalendarService(deps: {
  store: {
    getDays(days: string[]): EconomicDayRow[]
    upsertDays(rows: EconomicDayRow[]): void
  }
  fetch: (from: string, to: string) => Promise<EconomicEvent[]>
  now?: () => number // epoch seconds — injectable for tests
}) {
  const { store, fetch } = deps
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000))

  const isFresh = (row: EconomicDayRow): boolean =>
    row.fetchedAt >= dayStart(row.date) + 86400 || now() - row.fetchedAt < TTL_SECONDS

  // 要求した日の行を 1 本にまとめる。fetchedAt は最も古い取得時刻（一番古い情報がいつのものか）。
  const collect = (days: string[], cached: Map<string, EconomicDayRow>): EconomicRange => {
    const rows = days.map((d) => cached.get(d)!)
    return {
      events: rows.flatMap((r) => r.events).sort((a, b) => a.time - b.time),
      fetchedAt: Math.min(...rows.map((r) => r.fetchedAt))
    }
  }

  return {
    async getRange(from: string, to: string, opts?: { force?: boolean }): Promise<EconomicRange> {
      const days = enumerateDays(from, to)
      const cached = new Map(store.getDays(days).map((r) => [r.date, r]))
      // force は確定/TTL を無視して必要日を全部取り直す（company.info と同じ）。
      const missing = opts?.force ? days : days.filter((d) => {
        const row = cached.get(d)
        return !row || !isFresh(row)
      })

      if (missing.length > 0) {
        // 欠け日が飛んでいても min..max の 1 リクエストに畳む（EC-07）。範囲内の fresh な日も
        // 上書きされるが、新しいデータなので無害。
        const lo = missing[0]
        const hi = missing[missing.length - 1]
        try {
          const events = await fetch(lo, hi)
          const fetchedAt = now()
          // 要求範囲の全日に行を書く。返ってこなかった日は '[]'（EC-08）— 省くと土日祝が毎回ミス
          // 判定になり、その週を開くたびに API を空撃ちする。
          const byDay = new Map(enumerateDays(lo, hi).map((d) => [d, [] as EconomicEvent[]]))
          for (const e of events) byDay.get(utcYmd(e.time))?.push(e) // 範囲外の日は捨てる
          const rows = [...byDay].map(([date, evs]) => ({ date, events: evs, fetchedAt }))
          store.upsertDays(rows)
          for (const r of rows) cached.set(r.date, r)
        } catch (err) {
          // EC-18: stale で返すのは要求した全日に行があるときだけ。1 日でも無ければ throw する
          // （'[]' の行は「その日は発表なし」なので、行があるとみなす）。混在状態を部分的に返すと
          // 「発表が無い」と「取れなかった」が UI で区別できず、欠けが空に見える。
          if (days.some((d) => !cached.has(d))) throw err
          return { ...collect(days, cached), stale: true }
        }
      }

      return collect(days, cached)
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/calendar/EconomicCalendarService.test.ts`
Expected: PASS (14 tests).

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/calendar/EconomicCalendarService.ts tests/main/calendar/EconomicCalendarService.test.ts
git commit -m "feat(economic): day-granular read-through calendar service"
```

---

### Task 6: Core wiring and the off-plan short-circuit (EC-15)

**Files:**
- Modify: `src/main/core.ts`
- Modify: `src/main/index.ts` (inject the new store into `buildCore`)
- Test: `tests/main/core/economic.test.ts`

**Interfaces:**
- Consumes: `createEconomicCalendarService` (Task 5), `economicDayStore` (Task 4), `FmpProvider.getEconomicCalendar` (Task 3).
- Produces:
  - `CoreDeps.economicDayStore: Pick<typeof economicDayStoreModule, 'getDays' | 'upsertDays'>`
  - `ProviderLike` gains `'getEconomicCalendar'`
  - `core.economicCalendar.getRange(from: string, to: string, opts?: { force?: boolean }): Promise<EconomicRange>`

**Notes:** The off-plan latch stores the `FmpHttpError` instance rather than a boolean — the spec asks for "the same `FmpHttpError`" to be rethrown, and keeping the instance is the shortest way to honour that without reconstructing one.

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/core/economic.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createCore, type CoreDeps } from '../../../src/main/core'
import { FmpHttpError } from '../../../src/main/providers/FmpProvider'
import type { WorkspaceCollection } from '@shared/types'

const collection = (name: string): WorkspaceCollection => ({
  version: 3,
  active: name,
  workspaces: [{ name, items: [], layout: { schemaVersion: 1, cells: [], shape: { rows: 1, cols: 1 }, activeCellId: '1' } }]
})

// 2026-07-27 (Mon) 一日ぶんを要求範囲に使う。
const FROM = '2026-07-27'
const TO = '2026-07-27'

function deps(getEconomicCalendar: ReturnType<typeof vi.fn>, over: Partial<CoreDeps> = {}): CoreDeps {
  const base: CoreDeps = {
    broadcast: vi.fn(),
    barStore: {
      getCoverage: vi.fn(() => null),
      getBars: vi.fn(() => []),
      upsertBarsAndCoverage: vi.fn(),
      summarizeBars: vi.fn(() => [])
    },
    profileStore: { getProfile: vi.fn(() => null), upsertProfile: vi.fn() },
    companyProfileStore: { getCompanyProfile: vi.fn(() => null), upsertCompanyProfile: vi.fn() },
    economicDayStore: { getDays: vi.fn(() => []), upsertDays: vi.fn() },
    workspaceStore: { getWorkspaces: vi.fn(() => collection('W')), setWorkspaces: vi.fn() },
    capabilityCache: { getStatus: vi.fn(() => 'unknown' as const), setStatus: vi.fn(), clearForKeyChange: vi.fn() },
    keystore: {
      getApiKey: vi.fn(() => 'KEY'),
      setApiKey: vi.fn(() => ({ ok: true, encryptionAvailable: true })),
      getKeyStatus: vi.fn(() => ({ hasKey: true, encryptionAvailable: true })),
      clearApiKey: vi.fn()
    },
    makeProvider: vi.fn(() => ({
      getOHLCV: vi.fn(async () => []),
      searchSymbols: vi.fn(async () => []),
      getQuote: vi.fn(),
      getMarketStatus: vi.fn(),
      getCompanyProfile: vi.fn(),
      getEconomicCalendar
    })),
    nowSec: () => 1_000
  }
  return { ...base, ...over }
}

describe('core.economicCalendar.getRange', () => {
  it('reaches the provider and returns the normalized range', async () => {
    const getEconomicCalendar = vi.fn(async () => [{
      time: Date.parse('2026-07-27T12:30:00Z') / 1000,
      country: 'US', currency: 'USD', event: 'CPI MoM', impact: 'High' as const,
      previous: 0.2, estimate: 0.3, actual: 0.3
    }])
    const core = createCore(deps(getEconomicCalendar))
    const r = await core.economicCalendar.getRange(FROM, TO)
    expect(getEconomicCalendar).toHaveBeenCalledExactlyOnceWith(FROM, TO)
    expect(r.events.map((e) => e.event)).toEqual(['CPI MoM'])
  })

  it('throws NO_API_KEY without a key, without building a provider', async () => {
    const getEconomicCalendar = vi.fn()
    const d = deps(getEconomicCalendar)
    d.keystore.getApiKey = vi.fn(() => null)
    await expect(createCore(d).economicCalendar.getRange(FROM, TO)).rejects.toThrow('NO_API_KEY')
    expect(getEconomicCalendar).not.toHaveBeenCalled()
  })
})

describe('core.economicCalendar — off-plan short-circuit (EC-15)', () => {
  it.each([402, 403])('stops hitting the network after a %i and rethrows the same error', async (status) => {
    const err = new FmpHttpError(status, { 'Error Message': 'Exclusive Endpoint' })
    const getEconomicCalendar = vi.fn(async () => { throw err })
    const core = createCore(deps(getEconomicCalendar))

    await expect(core.economicCalendar.getRange(FROM, TO)).rejects.toBe(err)
    await expect(core.economicCalendar.getRange('2026-08-03', '2026-08-03')).rejects.toBe(err)
    expect(getEconomicCalendar).toHaveBeenCalledOnce() // 2 度目はネットワークに出ない
  })

  it('does not latch on a 429 (transient)', async () => {
    const getEconomicCalendar = vi.fn(async () => { throw new FmpHttpError(429, null) })
    const core = createCore(deps(getEconomicCalendar))
    await expect(core.economicCalendar.getRange(FROM, TO)).rejects.toBeInstanceOf(FmpHttpError)
    await expect(core.economicCalendar.getRange(FROM, TO)).rejects.toBeInstanceOf(FmpHttpError)
    expect(getEconomicCalendar).toHaveBeenCalledTimes(2)
  })

  it.each(['set', 'clear'] as const)('apikey.%s clears the latch', async (action) => {
    const err = new FmpHttpError(403, null)
    const getEconomicCalendar = vi.fn(async () => { throw err })
    const core = createCore(deps(getEconomicCalendar))

    await expect(core.economicCalendar.getRange(FROM, TO)).rejects.toBe(err)
    if (action === 'set') core.apikey.set('NEW') else core.apikey.clear()
    await expect(core.economicCalendar.getRange(FROM, TO)).rejects.toBe(err)
    expect(getEconomicCalendar).toHaveBeenCalledTimes(2) // 解除されたので再度ネットワークに出た
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/core/economic.test.ts`
Expected: FAIL — `economicDayStore` is not a known `CoreDeps` property / `core.economicCalendar` is undefined.

- [ ] **Step 3: Extend `src/main/core.ts`**

Add to the `@shared/types` type import: `type EconomicRange`. Add the store type import next to the other store imports:

```ts
import type * as economicDayStoreModule from './db/economicDayStore'
```

Add the service import next to `createCompanyInfoService`:

```ts
import { createEconomicCalendarService } from './calendar/EconomicCalendarService'
```

Extend `ProviderLike`:

```ts
export type ProviderLike = Pick<
  FmpProvider,
  'getOHLCV' | 'searchSymbols' | 'getQuote' | 'getMarketStatus' | 'getCompanyProfile' | 'getEconomicCalendar'
>
```

Add to `CoreDeps`, after `companyProfileStore`:

```ts
  economicDayStore: Pick<typeof economicDayStoreModule, 'getDays' | 'upsertDays'>
```

Inside `createCore`, after the `dailyOutOfPlan` declaration:

```ts
  // EC-15: /economic-calendar は現在のプランに含まれない可能性があり、queryKey は週ごとに違うので
  // 素朴に作ると週をめくるたび 402/403 を踏む。一度見たらネットワークに出ず同じエラーを投げる。
  // エラー実体を保持するのは「同じ FmpHttpError を投げる」の最短実装（boolean + 再構築より小さい）。
  let economicOutOfPlan: FmpHttpError | null = null
```

After the `companyInfoService` block:

```ts
  const economicCalendarService = createEconomicCalendarService({
    store: deps.economicDayStore,
    fetch: async (from, to) => {
      if (economicOutOfPlan) throw economicOutOfPlan
      try {
        return await providerFor().getEconomicCalendar(from, to)
      } catch (err) {
        if (err instanceof FmpHttpError && (err.status === 402 || err.status === 403)) economicOutOfPlan = err
        throw err
      }
    }
  })
```

In `apikey.set`, next to `dailyOutOfPlan.clear()`:

```ts
        economicOutOfPlan = null // a new key may cover the calendar endpoint
```

In `apikey.clear`, next to `dailyOutOfPlan.clear()`:

```ts
        economicOutOfPlan = null
```

And add the surface next to `company`:

```ts
    // どの UTC 日が必要かは呼び出し側（renderer の economicWeek.ts）が決める。ここは from..to を
    // そのまま日単位 read-through に渡すだけ。
    economicCalendar: {
      getRange: (from: string, to: string, opts?: { force?: boolean }): Promise<EconomicRange> =>
        economicCalendarService.getRange(from, to, opts)
    },
```

- [ ] **Step 4: Inject the store in `src/main/index.ts`**

Add the import next to the other stores:

```ts
import * as economicDayStore from './db/economicDayStore'
```

And add it to the `createCore({ ... })` call in `buildCore`, after `companyProfileStore,`:

```ts
    economicDayStore,
```

- [ ] **Step 5: Fix the existing core test fixtures**

`economicDayStore` is now required in `CoreDeps`, so every existing `deps()` factory must supply it. Add this line to the `base` object in each of `tests/main/core/fold.test.ts`, `tests/main/core/mutate.test.ts`, `tests/main/core/ohlcv.test.ts`, `tests/main/core/surfaces.test.ts`, `tests/main/core/uiRefresh.test.ts` (right after their `companyProfileStore:` line), and add `getEconomicCalendar: vi.fn()` to each `makeProvider` return object:

```ts
    economicDayStore: { getDays: vi.fn(() => []), upsertDays: vi.fn() },
```

Also check the MCP tests, which build cores too:

Run: `git grep -ln "companyProfileStore:" tests/`
Add the same two lines to every file listed that isn't already handled.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, including the 7 new tests in `tests/main/core/economic.test.ts`.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/core.ts src/main/index.ts tests/main
git commit -m "feat(economic): core.economicCalendar.getRange with off-plan short-circuit"
```

---

### Task 7: Persist the filter in `settings.json`

**Files:**
- Modify: `src/main/settings.ts`
- Test: `tests/main/settings.test.ts` (append a new `describe`)

**Interfaces:**
- Consumes: `EconomicFilterPref`, `EconomicImpact`, `EconomicCountryPreset` (Task 3).
- Produces: `getEconomicFilter(): EconomicFilterPref`, `setEconomicFilter(f: EconomicFilterPref): void`. Default `{ countries: 'us', impacts: ['High', 'Medium'] }`.

- [ ] **Step 1: Write the failing test**

Append to `tests/main/settings.test.ts`:

```ts
describe('settings economicFilter', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'settings-test-'))
  })
  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it("defaults to US only + High/Medium before anything is saved", () => {
    expect(settings.getEconomicFilter()).toEqual({ countries: 'us', impacts: ['High', 'Medium'] })
  })

  it('round-trips through set → get', () => {
    settings.setEconomicFilter({ countries: 'major', impacts: ['Low'] })
    expect(settings.getEconomicFilter()).toEqual({ countries: 'major', impacts: ['Low'] })
  })

  // 全トグル off はユーザーの正当な状態。既定に巻き戻してはいけない。
  it('preserves an empty impacts array', () => {
    settings.setEconomicFilter({ countries: 'all', impacts: [] })
    expect(settings.getEconomicFilter()).toEqual({ countries: 'all', impacts: [] })
  })

  it('falls back on a hand-edited / corrupt value instead of throwing', () => {
    settings.setEconomicFilter({ countries: 'bogus' as never, impacts: ['High', 'Nope' as never] })
    expect(settings.getEconomicFilter()).toEqual({ countries: 'us', impacts: ['High'] })
  })

  it('does not clobber theme when writing the filter', () => {
    settings.setTheme('dark')
    settings.setEconomicFilter({ countries: 'all', impacts: ['High'] })
    expect(settings.getTheme()).toBe('dark')
    expect(settings.getEconomicFilter().countries).toBe('all')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/settings.test.ts`
Expected: FAIL — `settings.getEconomicFilter is not a function`.

- [ ] **Step 3: Implement**

Add the type import at the top of `src/main/settings.ts`:

```ts
import type { EconomicCountryPreset, EconomicFilterPref, EconomicImpact } from '@shared/types'
```

And append before the MCP block:

```ts
// 経済カレンダーのフィルタ（UI chrome, JSON）。テキストフィルタは含めない — 次に開いたとき前回の
// 検索語が残っていると、イベントが少ないのがデータの都合か絞り込みの結果か分からない（EC-13）。
// 手編集や旧形式で壊れた値は既定に落とす（読みで throw させない）。impacts: [] は
// 「全トグル off」というユーザーの正当な状態なので、空配列は既定に巻き戻さない。
export function getEconomicFilter(): EconomicFilterPref {
  const raw = read().economicFilter
  const v = typeof raw === 'object' && raw !== null ? (raw as Partial<EconomicFilterPref>) : {}
  const isPreset = (c: unknown): c is EconomicCountryPreset => c === 'us' || c === 'major' || c === 'all'
  const isImpact = (i: unknown): i is EconomicImpact => i === 'High' || i === 'Medium' || i === 'Low'
  return {
    countries: isPreset(v.countries) ? v.countries : 'us',
    impacts: Array.isArray(v.impacts) ? v.impacts.filter(isImpact) : ['High', 'Medium']
  }
}

export function setEconomicFilter(filter: EconomicFilterPref): void {
  writeJsonFile(settingsPath(), { ...read(), economicFilter: filter })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/settings.test.ts`
Expected: PASS (5 new tests plus the existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/main/settings.ts tests/main/settings.test.ts
git commit -m "feat(economic): persist the calendar filter in settings.json"
```

---

### Task 8: IPC channels, preload bridge, and the window

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `core.economicCalendar.getRange` (Task 6), `getEconomicFilter`/`setEconomicFilter` (Task 7), `buildEconomicHash` (Task 2).
- Produces:
  - `CH.economicCalendar === 'economic:calendar'`, `CH.economicOpenWindow === 'economic:openWindow'`, `CH.settingsGetEconomicFilter === 'settings:getEconomicFilter'`, `CH.settingsSetEconomicFilter === 'settings:setEconomicFilter'`
  - `window.api.economic.getRange(from, to, opts?)` / `window.api.economic.openWindow()`
  - `window.api.settings.getEconomicFilter()` / `setEconomicFilter(f)`

- [ ] **Step 1: Add channels and Api types**

In `src/shared/ipc.ts`, extend the type import on line 1 with `EconomicFilterPref, EconomicRange`:

```ts
import type { Bar, SymbolResult, Timeframe, DateRange, WorkspaceCollection, Quote, MarketStatus, CompanyInfo, ClipboardCell, EconomicFilterPref, EconomicRange } from './types'
```

In the `CH` object, after `settingsSetAutoRefresh: 'settings:setAutoRefresh',`:

```ts
  settingsGetEconomicFilter: 'settings:getEconomicFilter',
  settingsSetEconomicFilter: 'settings:setEconomicFilter',
```

And after `companyOpenWindow: 'company:openWindow',`:

```ts
  economicCalendar: 'economic:calendar',
  economicOpenWindow: 'economic:openWindow',
```

In `interface Api`, add to the `settings` block (after `setAutoRefresh`):

```ts
    // 経済カレンダーの国/重要度フィルタ。テキストフィルタは永続化しない（EC-13）。
    getEconomicFilter(): Promise<EconomicFilterPref>
    setEconomicFilter(filter: EconomicFilterPref): Promise<void>
```

And add a new block after `company`:

```ts
  // 経済カレンダー。from/to は UTC 日の 'YYYY-MM-DD'（どの日が必要かは renderer が決める）。
  // ウィンドウは 1 枚だけなので openWindow は引数を取らない（EC-09）。
  economic: {
    getRange(from: string, to: string, opts?: { force?: boolean }): Promise<EconomicRange>
    openWindow(): Promise<void>
  }
```

- [ ] **Step 2: Expose them in preload**

In `src/preload/index.ts`, add to the `settings` block:

```ts
    getEconomicFilter: () => ipcRenderer.invoke(CH.settingsGetEconomicFilter),
    setEconomicFilter: (filter) => ipcRenderer.invoke(CH.settingsSetEconomicFilter, filter)
```

(add a comma to the previous `setAutoRefresh` line), and add a new block after `company`:

```ts
  economic: {
    getRange: (from, to, opts) => ipcRenderer.invoke(CH.economicCalendar, from, to, opts),
    openWindow: () => ipcRenderer.invoke(CH.economicOpenWindow)
  },
```

- [ ] **Step 3: Register the handlers in `src/main/ipc.ts`**

Extend the `./settings` import with `getEconomicFilter, setEconomicFilter,` and add the shared type import:

```ts
import type { Timeframe, DateRange, WorkspaceCollection, ClipboardCell, EconomicFilterPref } from '@shared/types'
```

Add after the `CH.companyInfo` handler:

```ts
  ipcMain.handle(CH.economicCalendar, (_e, from: string, to: string, opts?: { force?: boolean }) =>
    core.economicCalendar.getRange(from, to, opts)
  )
```

And after the `CH.settingsSetAutoRefresh` handler:

```ts
  ipcMain.handle(CH.settingsGetEconomicFilter, () => getEconomicFilter())
  ipcMain.handle(CH.settingsSetEconomicFilter, (_e, filter: EconomicFilterPref) => setEconomicFilter(filter))
```

- [ ] **Step 4: Open/focus the single window in `src/main/index.ts`**

Add the import next to `buildCompanyHash`:

```ts
import { buildEconomicHash } from '@shared/economicWindow'
```

Add the map after `chartWindows`:

```ts
// 経済カレンダーは 1 枚だけ。週は renderer の state なので、週ごとにウィンドウを増やす意味がない
// （EC-09）。固定キー 'calendar' で openHashWindow を使い回し、2 度目のクリックは既存を focus する。
const economicWindows = new Map<string, BrowserWindow>()
```

In `createWindow`'s `win.on('closed', ...)`, after the `chartWindows` loop:

```ts
    for (const w of economicWindows.values()) w.close()
```

And register the handler next to the other `openHashWindow` calls in `app.whenReady()`:

```ts
  ipcMain.handle(CH.economicOpenWindow, () => openHashWindow(economicWindows, 'calendar', 720, 900, buildEconomicHash()))
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (Renderer callers arrive in Tasks 9–10; the type and handler additions compile on their own.)

Run: `npm test`
Expected: PASS (unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/ipc.ts src/main/index.ts
git commit -m "feat(economic): IPC channels, preload bridge, and the calendar window"
```

---

### Task 9: `economicWeek.ts` — week arithmetic and filtering

**Files:**
- Create: `src/renderer/lib/economicWeek.ts`
- Test: `tests/renderer/economicWeek.test.ts`

**Interfaces:**
- Consumes: `EconomicEvent`, `EconomicImpact`, `EconomicCountryPreset` (Task 3).
- Produces:
  - `MAJOR_COUNTRIES: readonly string[]` — `['US', 'EU', 'JP', 'GB', 'CN']`
  - `weekUtcDays(weekStart: Date): string[]` — 9 consecutive UTC `'YYYY-MM-DD'` strings covering the local week
  - `eventsInWeek(events: EconomicEvent[], weekStart: Date): EconomicEvent[]`
  - `applyFilter(events: EconomicEvent[], f: { countries: EconomicCountryPreset; impacts: EconomicImpact[]; text: string }): EconomicEvent[]`
  - `groupByLocalDay(events: EconomicEvent[]): { key: string; events: EconomicEvent[] }[]` — `key` is the local `'yyyy-MM-dd'`

**Notes on test determinism:** Vitest runs in the machine's local timezone, so tests must not assume one. `weekUtcDays` and `eventsInWeek` are asserted with explicit UTC instants (their logic is UTC/instant math on the `Date` they're handed, so results are TZ-independent). `groupByLocalDay` is inherently local, so it is asserted on invariants that hold in every timezone (order preserved, no event lost, one local day per group, 30-minutes-apart groups together, 48-hours-apart do not).

- [ ] **Step 1: Write the failing test**

```ts
// tests/renderer/economicWeek.test.ts
import { describe, it, expect } from 'vitest'
import {
  MAJOR_COUNTRIES, applyFilter, eventsInWeek, groupByLocalDay, weekUtcDays
} from '../../src/renderer/lib/economicWeek'
import type { EconomicEvent, EconomicImpact } from '@shared/types'

const ev = (over: Partial<EconomicEvent> = {}): EconomicEvent => ({
  time: Date.parse('2026-07-28T12:30:00Z') / 1000,
  country: 'US', currency: 'USD', event: 'CPI MoM', impact: 'High',
  previous: null, estimate: null, actual: null,
  ...over
})

describe('weekUtcDays', () => {
  // ローカル週 → 必要 UTC 日。週 ±1 日ぶん広げるので常に 9 日、連続、昇順。
  it('returns 9 consecutive ascending UTC days', () => {
    const days = weekUtcDays(new Date('2026-07-27T00:00:00Z'))
    expect(days).toEqual([
      '2026-07-26', '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30',
      '2026-07-31', '2026-08-01', '2026-08-02', '2026-08-03'
    ])
  })

  it('starts one UTC day before the weekStart instant', () => {
    // UTC+9 のローカル月曜 00:00 は日曜 15:00Z。その 1 日前 = 土曜から始まる。
    expect(weekUtcDays(new Date('2026-07-26T15:00:00Z'))[0]).toBe('2026-07-25')
  })

  it('crosses a month boundary without gaps', () => {
    const days = weekUtcDays(new Date('2026-08-31T00:00:00Z'))
    expect(days).toHaveLength(9)
    expect(days[0]).toBe('2026-08-30')
    expect(days[8]).toBe('2026-09-07')
  })
})

describe('eventsInWeek', () => {
  // 時差で週の端に来るイベント: 境界は [weekStart, weekStart + 7 日) の半開区間。
  const weekStart = new Date('2026-07-27T00:00:00Z')
  const start = weekStart.getTime() / 1000
  const end = start + 7 * 86400

  it('includes the first instant and excludes the one before it', () => {
    const kept = eventsInWeek([ev({ time: start - 1, event: 'before' }), ev({ time: start, event: 'first' })], weekStart)
    expect(kept.map((e) => e.event)).toEqual(['first'])
  })

  it('includes the last instant and excludes the week end itself', () => {
    const kept = eventsInWeek([ev({ time: end - 1, event: 'last' }), ev({ time: end, event: 'next week' })], weekStart)
    expect(kept.map((e) => e.event)).toEqual(['last'])
  })

  it('drops the extra UTC days fetched on both ends', () => {
    const kept = eventsInWeek([
      ev({ time: start - 86400, event: 'day before' }),
      ev({ time: start + 3 * 86400, event: 'midweek' }),
      ev({ time: end + 86400, event: 'day after' })
    ], weekStart)
    expect(kept.map((e) => e.event)).toEqual(['midweek'])
  })
})

describe('applyFilter — country presets (EC-11)', () => {
  const events = [
    ev({ country: 'US', event: 'US CPI' }),
    ev({ country: 'JP', event: 'JP CPI' }),
    ev({ country: 'BR', event: 'BR CPI' })
  ]
  const all: EconomicImpact[] = ['High', 'Medium', 'Low']

  it("'us' keeps only US", () => {
    expect(applyFilter(events, { countries: 'us', impacts: all, text: '' }).map((e) => e.country)).toEqual(['US'])
  })

  it("'major' keeps the five hardcoded majors", () => {
    expect(applyFilter(events, { countries: 'major', impacts: all, text: '' }).map((e) => e.country)).toEqual(['US', 'JP'])
    expect(MAJOR_COUNTRIES).toEqual(['US', 'EU', 'JP', 'GB', 'CN'])
  })

  it("'all' keeps everything, including countries not in MAJOR_COUNTRIES", () => {
    expect(applyFilter(events, { countries: 'all', impacts: all, text: '' })).toHaveLength(3)
  })
})

describe('applyFilter — impact', () => {
  const events = (['High', 'Medium', 'Low'] as const).map((impact) => ev({ impact, event: impact }))

  it('keeps only the selected impacts', () => {
    expect(applyFilter(events, { countries: 'all', impacts: ['High', 'Medium'], text: '' }).map((e) => e.event))
      .toEqual(['High', 'Medium'])
  })

  it('keeps nothing when every toggle is off', () => {
    expect(applyFilter(events, { countries: 'all', impacts: [], text: '' })).toEqual([])
  })
})

describe('applyFilter — text (EC-12)', () => {
  const events = [
    ev({ country: 'US', event: 'CPI MoM' }),
    ev({ country: 'JP', event: 'Unemployment Rate' }),
    ev({ country: 'GB', event: 'CPI YoY' })
  ]
  const all: EconomicImpact[] = ['High', 'Medium', 'Low']

  it('matches the event name, case-insensitively', () => {
    expect(applyFilter(events, { countries: 'all', impacts: all, text: 'cpi' }).map((e) => e.country)).toEqual(['US', 'GB'])
  })

  it('matches the country code too, so All + JP narrows to Japan', () => {
    expect(applyFilter(events, { countries: 'all', impacts: all, text: 'jp' }).map((e) => e.event)).toEqual(['Unemployment Rate'])
  })

  it('an empty string filters nothing', () => {
    expect(applyFilter(events, { countries: 'all', impacts: all, text: '' })).toHaveLength(3)
  })

  it('trims surrounding whitespace before matching', () => {
    expect(applyFilter(events, { countries: 'all', impacts: all, text: '  cpi  ' })).toHaveLength(2)
  })

  it('combines with the country preset (AND, not OR)', () => {
    expect(applyFilter(events, { countries: 'us', impacts: all, text: 'cpi' }).map((e) => e.country)).toEqual(['US'])
  })
})

describe('groupByLocalDay', () => {
  // ローカル日でのグループ化なので TZ に依らない不変条件で検証する。
  const base = Date.parse('2026-07-28T12:00:00Z') / 1000

  it('groups events 30 minutes apart together', () => {
    const groups = groupByLocalDay([ev({ time: base }), ev({ time: base + 1800 })])
    expect(groups).toHaveLength(1)
    expect(groups[0].events).toHaveLength(2)
  })

  it('splits events 48 hours apart', () => {
    expect(groupByLocalDay([ev({ time: base }), ev({ time: base + 2 * 86400 })])).toHaveLength(2)
  })

  it('preserves every event, ascending, with one local day per group', () => {
    const times = [base + 3 * 86400, base, base + 86400 + 60, base + 86400, base + 3 * 86400 + 30]
    const groups = groupByLocalDay(times.map((time) => ev({ time })))
    expect(groups.flatMap((g) => g.events).map((e) => e.time)).toEqual([...times].sort((a, b) => a - b))
    expect(groups.map((g) => g.key)).toEqual([...groups.map((g) => g.key)].sort())
    for (const g of groups) {
      expect(new Set(g.events.map((e) => new Date(e.time * 1000).toDateString())).size).toBe(1)
    }
  })

  it('returns an empty array for no events', () => {
    expect(groupByLocalDay([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/renderer/economicWeek.test.ts`
Expected: FAIL — cannot resolve `../../src/renderer/lib/economicWeek`.

- [ ] **Step 3: Write the implementation**

```ts
// src/renderer/lib/economicWeek.ts
import { addDays, format } from 'date-fns'
import type { EconomicCountryPreset, EconomicEvent, EconomicImpact } from '@shared/types'

// 'Major' の 5 コードはハードコードする（EC-11）。全世界の国リスト（40 前後）はハードコードしない —
// 列挙を誤ると選べない国が生まれ、それを埋めるメンテが要る。'all' はフィルタ自体を素通しにする。
export const MAJOR_COUNTRIES = ['US', 'EU', 'JP', 'GB', 'CN'] as const

export type EconomicFilterInput = {
  countries: EconomicCountryPreset
  impacts: EconomicImpact[]
  text: string
}

const utcYmd = (d: Date): string => d.toISOString().slice(0, 10)

// ローカル週（月曜起点）に必要な UTC 日。weekStart の UTC 日から 1 日戻して 9 日ぶん。
// ±1 日 広げる理由は 2 つ:（1）ローカル週の端が別の UTC 日にまたがる、（2）FMP の from/to が ET 基準
// だと要求した UTC 日の端が欠ける（EC-02）。UTC±14h までのどのローカル時差でも週全体を覆う。
export function weekUtcDays(weekStart: Date): string[] {
  const first = addDays(new Date(`${utcYmd(weekStart)}T00:00:00Z`), -1)
  return Array.from({ length: 9 }, (_, i) => utcYmd(addDays(first, i)))
}

// ローカル週に入るものだけ残す（UTC 日で余分に取った両端を落とす）。境界は半開区間。
export function eventsInWeek(events: EconomicEvent[], weekStart: Date): EconomicEvent[] {
  const start = Math.floor(weekStart.getTime() / 1000)
  const end = Math.floor(addDays(weekStart, 7).getTime() / 1000)
  return events.filter((e) => e.time >= start && e.time < end)
}

// 国プリセット・重要度・テキストの AND。テキストは国コードと指標名の両方に部分一致（EC-12）—
// 'All' + 'JP' で日本だけ、'CPI' で全世界の CPI が並ぶ。国プルダウンで表現できない絞り込みをここで吸収する。
export function applyFilter(events: EconomicEvent[], f: EconomicFilterInput): EconomicEvent[] {
  const q = f.text.trim().toLowerCase()
  return events.filter((e) => {
    if (f.countries === 'us' && e.country !== 'US') return false
    if (f.countries === 'major' && !MAJOR_COUNTRIES.includes(e.country as (typeof MAJOR_COUNTRIES)[number])) return false
    if (!f.impacts.includes(e.impact)) return false
    if (q && !e.country.toLowerCase().includes(q) && !e.event.toLowerCase().includes(q)) return false
    return true
  })
}

// ローカル日ごとに束ねる（key はローカルの 'yyyy-MM-dd'）。日と、日の中のイベントの両方を昇順に。
export function groupByLocalDay(events: EconomicEvent[]): { key: string; events: EconomicEvent[] }[] {
  const byDay = new Map<string, EconomicEvent[]>()
  for (const e of [...events].sort((a, b) => a.time - b.time)) {
    const key = format(new Date(e.time * 1000), 'yyyy-MM-dd')
    const bucket = byDay.get(key)
    if (bucket) bucket.push(e)
    else byDay.set(key, [e])
  }
  return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([key, evs]) => ({ key, events: evs }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/economicWeek.test.ts`
Expected: PASS (20 tests).

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/economicWeek.ts tests/renderer/economicWeek.test.ts
git commit -m "feat(economic): week arithmetic and filter helpers"
```

---

### Task 10: `EconomicCalendarWindow`, hash branch, query key, and the header button

**Files:**
- Create: `src/renderer/components/EconomicCalendarWindow.tsx`
- Modify: `src/renderer/api.ts`
- Modify: `src/renderer/main.tsx`
- Modify: `src/renderer/App.tsx`

**Interfaces:**
- Consumes: `parseEconomicWindow` (Task 2), `api.economic.*` / `api.settings.*EconomicFilter` (Task 8), `weekUtcDays` / `eventsInWeek` / `applyFilter` / `groupByLocalDay` (Task 9), `EconomicRange` / `EconomicEvent` / `EconomicImpact` / `EconomicCountryPreset` (Task 3).
- Produces: `qk.economicCalendar(from: string, to: string)`; `EconomicCalendarWindow()` (no props — the week is component state, EC-10).

- [ ] **Step 1: Add the query key**

In `src/renderer/api.ts`, add to `qk`:

```ts
  economicCalendar: (from: string, to: string) => ['economic-calendar', from, to] as const
```

(add a comma to the `companyInfo` line above it).

- [ ] **Step 2: Create the window component**

```tsx
// src/renderer/components/EconomicCalendarWindow.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { addDays, addWeeks, format, isSameDay, startOfWeek } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { ChevronDown, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { api, qk } from '@/api'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { applyFilter, eventsInWeek, groupByLocalDay, weekUtcDays } from '@/lib/economicWeek'
import type { EconomicCountryPreset, EconomicEvent, EconomicImpact, EconomicRange } from '@shared/types'

const IMPACTS: EconomicImpact[] = ['High', 'Medium', 'Low']
const IMPACT_DOT: Record<EconomicImpact, string> = {
  High: 'bg-red-500', Medium: 'bg-amber-500', Low: 'bg-gray-500'
}
const COUNTRY_LABEL: Record<EconomicCountryPreset, string> = { us: 'US only', major: 'Major', all: 'All' }
const COUNTRY_PRESETS: EconomicCountryPreset[] = ['us', 'major', 'all']

const fmtValue = (n: number | null): string => (n == null ? '—' : String(n))

// 主時刻はローカル、右に小さく ET（EC-04: 変換は表示時だけ）。過去のイベント行は輝度を落とす。
function EventRow({ e, past }: { e: EconomicEvent; past: boolean }): React.JSX.Element {
  const d = new Date(e.time * 1000)
  const hasValues = e.previous != null || e.estimate != null || e.actual != null
  return (
    <div className={cn('flex flex-col gap-0.5 px-3 py-1.5', past && 'opacity-50')}>
      <div className="flex items-center gap-2 text-sm">
        <span className="w-11 shrink-0 tabular-nums">{format(d, 'HH:mm')}</span>
        <span className="w-16 shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatInTimeZone(d, 'America/New_York', 'HH:mm')} ET
        </span>
        <span className={cn('size-2 shrink-0 rounded-full', IMPACT_DOT[e.impact])} title={e.impact} />
        <span className="w-8 shrink-0 text-xs text-muted-foreground">{e.country}</span>
        <span className="truncate" title={e.event}>{e.event}</span>
      </div>
      {hasValues && (
        <div className="ml-[7.75rem] flex gap-4 text-xs tabular-nums text-muted-foreground">
          <span>prev {fmtValue(e.previous)}</span>
          <span>est {fmtValue(e.estimate)}</span>
          <span>act {fmtValue(e.actual)}</span>
        </div>
      )}
    </div>
  )
}

// company.info と同じ分岐方針。IPC 越しの message から判定するので新しい型は増やさない（EC-15）。
function errorMessage(err: unknown): string {
  const m = String((err as Error)?.message ?? '')
  if (/NO_API_KEY/.test(m)) return 'Set your FMP API key in Settings.'
  if (/FMP HTTP 429/.test(m)) return 'FMP request limit reached. Wait a moment and try again.'
  if (/FMP HTTP (200|40[0-9])/.test(m)) return 'The economic calendar isn’t available on your current FMP plan.'
  return 'Couldn’t load the economic calendar. Check your connection.'
}

function CalendarBody(): React.JSX.Element {
  const qc = useQueryClient()
  // 週の位置は永続化しない。開いたら常に今週（EC-10）。起点は月曜。
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [countries, setCountries] = useState<EconomicCountryPreset>('us')
  const [impacts, setImpacts] = useState<EconomicImpact[]>(['High', 'Medium'])
  // テキストフィルタは永続化しない（EC-13）— 前回の検索語が残るとデータの都合か絞り込みか分からない。
  const [text, setText] = useState('')

  useEffect(() => {
    void api.settings.getEconomicFilter().then((f) => {
      setCountries(f.countries)
      setImpacts(f.impacts)
    })
  }, [])

  const days = useMemo(() => weekUtcDays(weekStart), [weekStart])
  const from = days[0]
  const to = days[days.length - 1]

  const q = useQuery<EconomicRange>({
    queryKey: qk.economicCalendar(from, to),
    queryFn: () => api.economic.getRange(from, to)
  })
  const reload = useMutation({
    mutationFn: () => api.economic.getRange(from, to, { force: true }),
    onSuccess: (data) => qc.setQueryData(qk.economicCalendar(from, to), data)
  })

  const saveCountries = (next: EconomicCountryPreset): void => {
    setCountries(next)
    void api.settings.setEconomicFilter({ countries: next, impacts })
  }
  const saveImpacts = (next: EconomicImpact[]): void => {
    setImpacts(next)
    void api.settings.setEconomicFilter({ countries, impacts: next })
  }

  const inWeek = useMemo(() => eventsInWeek(q.data?.events ?? [], weekStart), [q.data, weekStart])
  const groups = useMemo(
    () => groupByLocalDay(applyFilter(inWeek, { countries, impacts, text })),
    [inWeek, countries, impacts, text]
  )

  const today = new Date()
  const nowSec = Math.floor(today.getTime() / 1000)
  const weekLabel = `${format(weekStart, 'MMM d')} – ${format(addDays(weekStart, 6), 'MMM d, yyyy')}`
  const asOf = q.data ? format(new Date(q.data.fetchedAt * 1000), 'HH:mm') : null

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setWeekStart((w) => addWeeks(w, -1))} aria-label="Previous week">
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-[11rem] text-center text-sm font-semibold tabular-nums">{weekLabel}</span>
          <Button variant="ghost" size="icon" onClick={() => setWeekStart((w) => addWeeks(w, 1))} aria-label="Next week">
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
            Today
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            {asOf ? `As of ${asOf}${q.data?.stale ? ' (update failed)' : ''}` : ''}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => reload.mutate()}
            disabled={reload.isPending}
            aria-label="Reload economic calendar"
            title="Reload economic calendar"
          >
            <RefreshCw className={cn('size-4', reload.isPending && 'animate-spin')} />
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="gap-1.5">
                {COUNTRY_LABEL[countries]}
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {COUNTRY_PRESETS.map((p) => (
                <DropdownMenuItem
                  key={p}
                  className={p === countries ? 'bg-accent text-accent-foreground' : ''}
                  onClick={() => saveCountries(p)}
                >
                  {COUNTRY_LABEL[p]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <ToggleGroup
            type="multiple"
            value={impacts}
            onValueChange={(v) => saveImpacts(v as EconomicImpact[])}
          >
            {IMPACTS.map((i) => (
              <ToggleGroupItem key={i} value={i} size="sm" aria-label={i}>
                <span className={cn('mr-1.5 size-2 rounded-full', IMPACT_DOT[i])} />{i}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Filter by country or event…"
            className="h-8 max-w-[16rem]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {q.isLoading && <div className="p-3 text-sm text-muted-foreground">Loading economic calendar…</div>}
        {q.isError && <div className="p-3 text-center text-sm text-muted-foreground">{errorMessage(q.error)}</div>}
        {/* EC-14: フィルタ前の件数を併記して、データが無いのかフィルタで消えたのかを区別できるようにする */}
        {!q.isLoading && !q.isError && groups.length === 0 && (
          <div className="p-3 text-center text-sm text-muted-foreground">
            No matching events. ({inWeek.length} {inWeek.length === 1 ? 'event' : 'events'} this week before filters)
          </div>
        )}
        {groups.map((g) => {
          const day = new Date(`${g.key}T00:00:00`) // key はローカル日なので Z を付けない
          return (
            <section key={g.key}>
              <h2
                className={cn(
                  'sticky top-0 border-b border-border bg-card px-3 py-1.5 text-xs font-semibold',
                  isSameDay(day, today) ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                {format(day, 'EEE MMM d')}
              </h2>
              {g.events.map((e, i) => (
                <EventRow key={`${e.time}-${e.country}-${e.event}-${i}`} e={e} past={e.time < nowSec} />
              ))}
            </section>
          )
        })}
      </div>
    </div>
  )
}

export function EconomicCalendarWindow(): React.JSX.Element {
  useEffect(() => { document.title = 'Economic calendar' }, [])
  return <CalendarBody />
}
```

- [ ] **Step 3: Branch on the hash in `src/renderer/main.tsx`**

Add the imports:

```tsx
import { parseEconomicWindow } from '@shared/economicWindow'
import { EconomicCalendarWindow } from './components/EconomicCalendarWindow'
```

Add the parse next to the other two:

```tsx
const isEconomic = parseEconomicWindow(window.location.hash)
```

And extend the render ternary:

```tsx
      {companySymbol
        ? <CompanyWindow symbol={companySymbol} />
        : chartCellId
          ? <ChartWindow cellId={chartCellId} />
          : isEconomic
            ? <EconomicCalendarWindow />
            : <App />}
```

- [ ] **Step 4: Add the header button in `src/renderer/App.tsx`**

Add `CalendarDays` to the `lucide-react` import on line 2:

```tsx
import { CalendarDays, PanelLeftClose, PanelLeftOpen, RefreshCw, Timer, TimerOff } from 'lucide-react'
```

And insert between `<SearchBar />` and `<SettingsDialog />`:

```tsx
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => void api.economic.openWindow()}
                  aria-label="Economic calendar"
                >
                  <CalendarDays className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Economic calendar</TooltipContent>
            </Tooltip>
```

- [ ] **Step 5: Typecheck and run the full suite**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm test`
Expected: PASS (whole suite).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/api.ts src/renderer/main.tsx src/renderer/App.tsx src/renderer/components/EconomicCalendarWindow.tsx
git commit -m "feat(economic): economic calendar window with week nav and filters"
```

- [ ] **Step 7: Manual verification**

Run: `npm run dev`

Then verify:
1. The header shows a calendar icon between the search box and the settings gear; clicking it opens a separate window titled "Economic calendar".
2. Clicking it again focuses the existing window instead of opening a second one (EC-09).
3. The current week loads; day headings are local dates, each row shows a local time and an ET time, and today's heading is highlighted.
4. `◀` / `▶` move by one week; `Today` returns to the current week. Every week loads at most one FMP request (watch the terminal / DevTools Network).
5. Re-visiting a week already viewed in this session issues **no** request (EC-08 — including weekends, which cache as `'[]'`).
6. Change the country preset and impact toggles, close the window, reopen it — the selections persist. Type in the text box, reopen — the text box is empty (EC-13).
7. Set the impact toggles all off → "No matching events." plus the pre-filter count (EC-14).
8. Press the reload button → the request goes out again even for confirmed days, and `As of` updates.
9. Close the main window → the app quits (the calendar window closes with it).

---

## Self-Review

**Spec coverage**

| Spec section / ID | Task |
|---|---|
| Endpoint fields, `change`/`changePercentage` dropped (EC-01) | 3 (zod schema omits them) |
| `date` basis determined before persistence (EC-02) | 1, and the conversion + widening in 3 |
| `impact` normalized, unknown → `Low` (EC-03) | 3 |
| UTC epoch in provider, local/ET only at render (EC-04) | 3 (provider), 10 (`formatInTimeZone`) |
| Day-granular cache (EC-05) | 4, 5 |
| Confirmed-vs-TTL freshness (EC-06) | 5 |
| Missing days folded into one min..max request (EC-07) | 5 |
| `'[]'` rows for uncovered days (EC-08) | 5 |
| Single window, fixed `'calendar'` key (EC-09) | 8 |
| Week not persisted, always opens on this week (EC-10) | 10 |
| Country preset dropdown, `MAJOR_COUNTRIES` hardcoded (EC-11) | 9, 10 |
| Text filter over country + event name (EC-12) | 9, 10 |
| Text filter not persisted (EC-13) | 7 (type excludes it), 10 |
| Zero-count message with pre-filter count (EC-14) | 10 |
| Off-plan latch cleared on key change (EC-15) | 6 |
| Stale only when every requested day has a row (EC-18) | 5 |
| `economic_days` schema / blob policy | 4 |
| Types (`EconomicEvent` / `EconomicRange` / …) | 3 |
| New + modified file list | 2, 3, 4, 5, 6, 7, 8, 9, 10 |
| Error table (NO_API_KEY / 402-403 / 429 / network / stale) | 10 |
| Test list (service / provider / core / economicWeek / window hash) | 5, 3, 6, 9, 2 |
| Non-scope: chart markers, economic-indicators (EC-16), MCP tool (EC-17), surprise coloring, month/day views, earnings calendar | not implemented, by design |

**Deviations from the spec, and why**

- **The provider widens `from`/`to` by one day unconditionally**, instead of only when Task 1 finds an ET basis. Same request count, correct under either basis, and it removes a second place the basis decision could go wrong. Task 1 still records the observed `from`/`to` behaviour as evidence.
- **A second, winter fixture** (`fmp-economic-calendar-winter.json`) and a second API call. The spec says "one request"; one week cannot distinguish a correct basis from a fixed-offset bug, and the spec's own test list demands "夏時間と冬時間の両方". Two calls is the cheapest way to have both.
- **`economicOutOfPlan` holds the `FmpHttpError`**, not a `boolean`. The spec requires rethrowing "the same `FmpHttpError`"; keeping the instance is the shortest way to do exactly that.
- **UI copy is English.** The spec's error table is written in Japanese as description, while its own layout mockup and the whole existing app are English.
- **DST/edge-case rows are written inline in the provider test**, not added to the fixtures, so the fixtures stay verbatim captures. The spec asked for these cases in tests, which is where they are.
- **No test for `economicDayStore`** (Task 4) — `better-sqlite3` never loads under Vitest and its twin `companyProfileStore.ts` has none either. Covered by typecheck and Task 10's manual run.
- **No React component test** — `vitest.config.ts` includes `tests/**/*.test.ts` only, and there is no jsdom dependency. All testable UI logic was pushed into `economicWeek.ts` (Task 9).

**Placeholder scan:** clean. The only values an implementer supplies are read out of files created earlier in the plan: the recorded basis (Task 1 Step 6 → Task 3 Step 5, both branches written out) and the two CPI calendar dates (Task 1 fixtures → Task 3 Step 3, with the exact command to read them).

**Type consistency:** `EconomicDayRow` is declared in `EconomicCalendarService.ts` (Task 5) and structurally matched by `economicDayStore.ts` (Task 4) — the same field names `date` / `events` / `fetchedAt`, and `CoreDeps.economicDayStore` (Task 6) is a `Pick` of the real module, so a drift is a typecheck error. `getRange(from, to, opts?)` keeps one signature across service (5), core (6), `Api` (8), preload (8), and the component (10). `EconomicFilterPref` is one shared type used by `settings.ts` (7), `Api` (8), and the component (10); `EconomicFilterInput` in `economicWeek.ts` (9) is deliberately distinct — it adds the non-persisted `text` field. `weekUtcDays` returns the 9-day array whose first and last elements become `from`/`to` in Task 10, matching the contiguous-range contract Task 5's `enumerateDays` assumes.
