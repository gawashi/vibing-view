# イールドカーブ（`/treasury-rates`）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** FMP の `/stable/treasury-rates` から米国債の満期別利回りを取り、別ウィンドウで「満期軸の断面（重ね描き）＋ 時間軸の推移（満期・スプレッド）＋ 表」として表示する。

**Architecture:** `FmpProvider.getTreasuryRates(from, to)`（1 窓 = 1 リクエストで 12 満期）→ `TreasuryCurveService`（TTL 12h の read-through ＋ 応答幅に追従する窓の遡り、`date` キーの union マージ）→ `core.yieldCurve.getCurves({ years, force })` → IPC → `YieldCurveWindow`（断面は自前 SVG、推移は lightweight-charts の複数 Line 系列）。窓は singleton で、選択状態（比較日・トグル）はすべて renderer の使い捨て state。

**Tech Stack:** TypeScript / React 19 / Electron / better-sqlite3 + drizzle-orm / zod 3 / TanStack Query 5 / lightweight-charts 5.2 / Vitest 3 / date-fns 4 / Tailwind 3 + Radix

**設計書:** `docs/superpowers/specs/2026-07-30-yield-curve-design.md`（YC-01〜YC-12 の番号はこの計画中で参照する）

## Global Constraints

- 依存を追加しない。この機能に必要なライブラリ（lightweight-charts / Radix ToggleGroup / lucide / date-fns）はすべて導入済み。日付ピッカーはネイティブの `<input type="date">`（YC-06）。
- Vite は `^7` に固定（electron-vite@5 が Vite 8 を peer に持たない）。
- `better-sqlite3` は Electron の Node ABI にリビルドされている前提。**新しいストアモジュールでも `electron` / `better-sqlite3` を静的 import してはいけない** — `src/main/db/client.ts` の `getDb()` の遅延 require 経由でのみ触る（Vitest が plain Node で読めなくなる）。
- SQLite = 取得データのキャッシュ、JSON（`settings.json`） = ユーザー設定。この機能は SQLite のみ使う（比較日・トグル状態は永続化しない）。
- API リクエストの節約が最優先。TTL は 12 時間（`43200` 秒）。**同じ地平の中での再描画・トグル操作・比較日の追加でリクエストを発生させてはいけない**。地平を広げる操作（1Y → 5Y）とリロードボタンだけがネットワークに出る。
- 日付は `'YYYY-MM-DD'` 文字列のまま扱う。epoch への変換はどこにも入れない（API が時刻を返さない）。日ずらしは `@shared/utcDay` の `shiftUtcDay` を使う（`date-fns` の `addDays` はローカル時刻基準で DST をまたぐと 24h にならない）。
- 名前は 2 系統で使い分ける（設計書「アーキテクチャ」）: **窓と機能 = `yieldCurve`**、**データ・テーブル・サービス = `treasuryCurve(s)` / `treasury`**。
- テストコマンドは `npm test`（`vitest run`）。型チェックは `npm run typecheck`。単体実行は `npx vitest run <path>`。
- Vitest の alias は `@` → `src/renderer`、`@shared` → `src/shared`。`src/main` は相対パスで import する（既存テストに倣う）。
- コメントは既存ファイルの言語に合わせる。`src/main/economic/`・`src/shared/treasury.ts`・`src/renderer/lib/treasuryCurve.ts` は日本語（カレンダー・統計指標と同じ）。
- 作業ブランチは `feat/yield-curve`（Task 1 の Step 1 で `develop` から切る）。各タスクの最後にコミットする。

## File Structure

### 新規

| ファイル | 責務 |
|---|---|
| `src/shared/treasury.ts` | 満期レジストリ（`key`/`label`/`months`）、スプレッド定義、`TREASURY_YEARS`。schema のフィールド名と renderer の軸・ラベルが同じ表を見るので shared |
| `src/main/db/treasuryCurveStore.ts` | `treasury_curves` の read/write（blob の出し入れのみ。TTL も遡りもここには置かない） |
| `src/main/economic/TreasuryCurveService.ts` | TTL 12h read-through ＋ 窓の遡り ＋ `date` union マージ ＋ stale フォールバック |
| `src/renderer/lib/treasuryCurve.ts` | 断面切り出し・スナップ・系列化・スプレッド・表・書式の純関数（テスト対象はここに集約する） |
| `src/renderer/components/YieldCurveChart.tsx` | 満期軸の断面（自前 SVG。横軸が満期なので lightweight-charts に乗らない） |
| `src/renderer/components/TreasuryHistoryChart.tsx` | 時間軸の折れ線（lightweight-charts、系列の集合がトグルで変わる） |
| `src/renderer/components/YieldCurveWindow.tsx` | 窓本体。query・状態・レイアウトだけを持ち、計算は `treasuryCurve.ts` に出す |
| `tests/fixtures/fmp-treasury-rates.json` | provider テスト用の応答 fixture（`null` 満期を含む） |
| `tests/main/providers/treasuryRates.test.ts` | provider のパース・マッピング・行の落とし方 |
| `tests/main/economic/TreasuryCurveService.test.ts` | キャッシュ契約と窓の遡り（この機能の中核テスト） |
| `tests/main/core/yieldCurve.test.ts` | `treasuryOutOfPlan` ラッチ |
| `tests/renderer/treasuryCurve.test.ts` | 純関数 |

### 変更

| ファイル | 変更 |
|---|---|
| `src/shared/types.ts` | `TreasuryMaturityKey` / `TreasuryCurvePoint` / `TreasuryYears` / `TreasuryCurves` を追記 |
| `src/main/providers/fmp.schema.ts` | `fmpTreasuryRatesResponse` を追記 |
| `src/main/providers/FmpProvider.ts` | `getTreasuryRates(from, to)` と `isUtcDay` を追加 |
| `src/main/db/schema.ts` | `treasuryCurves` テーブル |
| `src/main/db/client.ts` | `treasury_curves` の `CREATE TABLE IF NOT EXISTS` |
| `src/main/core.ts` | `yieldCurve.getCurves`、`treasuryOutOfPlan` ラッチ、`ProviderLike` に 1 メソッド、`CoreDeps` に 1 ストア、`apikey.set`/`clear` でラッチ解除 |
| `src/main/index.ts` | ストア注入と `CH.yieldCurveOpenWindow` ハンドラ |
| `src/main/ipc.ts` | チャンネル 1 本（`treasuryCurves`） |
| `src/shared/ipc.ts` | `CH` に 2 本、`Api.yieldCurve` |
| `src/shared/windowHash.ts` | `WindowKind` に `'yieldCurve'` |
| `src/preload/index.ts` | `api.yieldCurve` |
| `src/renderer/main.tsx` | ハッシュ分岐に 1 本 |
| `src/renderer/api.ts` | `qk.treasuryCurves(years)` |
| `src/renderer/App.tsx` | ヘッダーに `TrendingUp` ボタン |
| `tests/windowHash.test.ts` | `'yieldCurve'` の往復 |
| `tests/main/core/*.test.ts`（6 ファイル） | `deps()` に `treasuryCurveStore`、provider スタブに `getTreasuryRates` |

---

### Task 1: YC-02 — 実 API の実測と fixture

`STEP_DAYS` を実測で確定させる。バックフィルは応答幅に追従するので定数が間違っても穴は空かないが、間違っているとリクエスト数が増える（大きすぎれば追従で余計な窓、小さすぎれば単純に本数増）。

**Files:**
- Create: `tests/fixtures/fmp-treasury-rates.json`
- Create（一時、コミットしない）: `probe-treasury.mjs`

**Interfaces:**
- Consumes: なし
- Produces: `tests/fixtures/fmp-treasury-rates.json`（3 行、最古の行は `year20` / `year30` が `null`）、および後続タスクが使う `STEP_DAYS` の値

- [ ] **Step 1: ブランチを切る**

```bash
cd "C:/Users/010230240/work/vibing-view" && git switch -c feat/yield-curve
```

- [ ] **Step 2: 実測スクリプトを書く**

リポジトリ直下に `probe-treasury.mjs` を作る（使い捨て。Step 6 で削除する）。

```js
// probe-treasury.mjs — /stable/treasury-rates の実測用。コミットしない。
const key = process.env.FMP_API_KEY
if (!key) { console.error('FMP_API_KEY=... を渡してください'); process.exit(1) }

const get = async (from, to) => {
  const res = await fetch(`https://financialmodelingprep.com/stable/treasury-rates?from=${from}&to=${to}&apikey=${key}`)
  const body = await res.text()
  console.log(`--- from=${from} to=${to} status=${res.status}`)
  let rows
  try { rows = JSON.parse(body) } catch { console.log(body.slice(0, 300)); return null }
  if (!Array.isArray(rows)) { console.log(JSON.stringify(rows).slice(0, 300)); return null }
  const dates = rows.map((r) => r.date).sort()
  console.log(`rows=${rows.length} oldest=${dates[0]} newest=${dates.at(-1)} keys=${Object.keys(rows[0] ?? {}).join(',')}`)
  return rows
}

const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
const today = day(0)

// 窓の上限を探す: 90 → 200 → 400 日。oldest が要求した from に届いているかを見る。
const rows90 = await get(day(90), today)
await get(day(200), today)
await get(day(400), today)
// 一部満期が null の時代（30 年債は 2002-02〜2006-02 が未発行、YC-03）
await get('2003-01-01', '2003-03-31')

if (rows90) {
  const { writeFileSync } = await import('fs')
  // FMP が返した順序をそのまま保存する（provider が昇順に直すことをテストで固定するため）
  writeFileSync('tests/fixtures/fmp-treasury-rates.json', JSON.stringify(rows90.slice(0, 3), null, 2) + '\n')
  console.log('wrote tests/fixtures/fmp-treasury-rates.json (3 rows)')
}
```

- [ ] **Step 3: 実行して観測値を記録する**

```bash
cd "C:/Users/010230240/work/vibing-view" && FMP_API_KEY=<キー> node probe-treasury.mjs
```

観測すべきこと（設計書「窓上限は定数に依存させない」の表）:

1. `from`/`to` で返る最大範囲 → `STEP_DAYS = その日数 - 5`
2. フィールド名が `month1/month2/month3/month6/year1/year2/year3/year5/year7/year10/year20/year30` であること
3. 行の順序（昇順・降順どちらでも provider が直す）
4. 2003 年の窓で `year30` が `null` で返るか
5. プランに含まれるか（`status=402/403` または 200 + `Error Message` なら YC-08 のラッチが受ける）

**キーが無い / エンドポイントがプラン外の場合**: `STEP_DAYS = 85`（統計指標と同じ、想定 90 日窓 − 5）のまま進める。応答が要求窓より狭ければ返却最古に追従するので穴は空かない（YC-02）。この場合 Step 4 の fixture を手書きのまま使う。

- [ ] **Step 4: fixture を確定させる**

`tests/fixtures/fmp-treasury-rates.json` を以下の内容にする。Step 3 で実データが書き込まれた場合は、**最古の 1 行の `year20` / `year30` を `null` に書き換える**（`null` 満期の保持をテストで固定するため。2003 年の窓から実際の `null` 行を持ってきてもよい）。

```json
[
  {
    "date": "2026-07-29",
    "month1": 4.35, "month2": 4.33, "month3": 4.3, "month6": 4.22,
    "year1": 4.05, "year2": 3.88, "year3": 3.85, "year5": 3.9,
    "year7": 4.02, "year10": 4.18, "year20": 4.55, "year30": 4.62
  },
  {
    "date": "2026-07-28",
    "month1": 4.36, "month2": 4.34, "month3": 4.31, "month6": 4.23,
    "year1": 4.06, "year2": 3.9, "year3": 3.87, "year5": 3.92,
    "year7": 4.04, "year10": 4.2, "year20": 4.57, "year30": 4.64
  },
  {
    "date": "2026-07-27",
    "month1": 4.37, "month2": 4.35, "month3": 4.32, "month6": 4.24,
    "year1": 4.07, "year2": 3.91, "year3": 3.88, "year5": 3.93,
    "year7": 4.05, "year10": 4.21, "year20": null, "year30": null
  }
]
```

> 3 行が `date` 降順であることに意味がある: provider が昇順に直すことを Task 2 のテストで固定する。

- [ ] **Step 5: 観測結果を設計書に反映する**

`docs/superpowers/specs/2026-07-30-yield-curve-design.md` の「窓上限は定数に依存させない（YC-02）」の表の「実装前の想定」列を実測値に置き換える（上限日数・行の順序・`null` 満期の有無・プラン可否）。実測できなかった項目は「未実測（想定 90 日）」と明記する — 後から読む人が想定と実測を区別できるようにする。

- [ ] **Step 6: 一時スクリプトを消してコミットする**

```bash
cd "C:/Users/010230240/work/vibing-view"
rm probe-treasury.mjs
git add tests/fixtures/fmp-treasury-rates.json docs/superpowers/specs/2026-07-30-yield-curve-design.md
git commit -m "chore(yield-curve): /treasury-rates の実測と fixture"
```

---

### Task 2: 型・満期レジストリ・provider

**Files:**
- Modify: `src/shared/types.ts`（末尾に追記）
- Create: `src/shared/treasury.ts`
- Modify: `src/main/providers/fmp.schema.ts`（末尾に追記）
- Modify: `src/main/providers/FmpProvider.ts`（`isUtcDay` とメソッド 1 本を追加）
- Test: `tests/main/providers/treasuryRates.test.ts`

**Interfaces:**
- Consumes: `tests/fixtures/fmp-treasury-rates.json`（Task 1）
- Produces:
  - `TreasuryMaturityKey`（12 リテラルの union）
  - `TreasuryCurvePoint = { date: string; rates: Record<TreasuryMaturityKey, number | null> }`
  - `TreasuryYears = 1 | 5`
  - `TreasuryCurves = { points: TreasuryCurvePoint[]; coveredFrom: string; fetchedAt: number; stale?: boolean }`
  - `MATURITIES` / `SPREADS` / `TREASURY_YEARS`（`@shared/treasury`）
  - `fmpTreasuryRatesResponse`（zod schema）
  - `FmpProvider.getTreasuryRates(from: string, to: string): Promise<TreasuryCurvePoint[]>`

- [ ] **Step 1: 型を追加する**

`src/shared/types.ts` の末尾（`EconomicIndicatorSeries` の後）に追記する。

```ts
// ── 米国債イールドカーブ ──────────────────────────────────────────────────────────
// /treasury-rates の 12 満期フィールド名そのまま。ラベル・月数は @shared/treasury が持つ。
export type TreasuryMaturityKey =
  | 'month1' | 'month2' | 'month3' | 'month6'
  | 'year1' | 'year2' | 'year3' | 'year5' | 'year7' | 'year10' | 'year20' | 'year30'

// 1 営業日ぶんのカーブ。null は「その満期の債券がその日に存在しない/未公表」（YC-03）。
// 値は % 表記（4.25 = 4.25%）。date は 'YYYY-MM-DD' で epoch に変換しない（API が時刻を返さない）。
export type TreasuryCurvePoint = {
  date: string
  rates: Record<TreasuryMaturityKey, number | null>
}

// 取得地平。85 日ステップで 1Y = 5 リクエスト / 5Y = 22 リクエスト。
// service / IPC / renderer が同じ値集合を見るので shared に置く。
export type TreasuryYears = 1 | 5

// coveredFrom は遡って取得済みの下限。日付ピッカーの min もこれに縛る（YC-06）。
// stale は「古い points を返した、更新はできなかった」（EconomicIndicatorSeries と同じ理由）。
export type TreasuryCurves = {
  points: TreasuryCurvePoint[] // date 昇順
  coveredFrom: string
  fetchedAt: number // epoch 秒
  stale?: boolean
}
```

- [ ] **Step 2: 満期レジストリを作る**

`src/shared/treasury.ts` を新規作成する。

```ts
// 満期のキー・ラベル・月数を 1 箇所に置く。zod schema のフィールド名、provider のマッピング、
// renderer の軸の並びとラベルが同じ表を見るので shared（economicIndicators.ts と同じ判断）。
import type { TreasuryMaturityKey, TreasuryYears } from './types'

export const MATURITIES: { key: TreasuryMaturityKey; label: string; months: number }[] = [
  { key: 'month1', label: '1M', months: 1 },
  { key: 'month2', label: '2M', months: 2 },
  { key: 'month3', label: '3M', months: 3 },
  { key: 'month6', label: '6M', months: 6 },
  { key: 'year1', label: '1Y', months: 12 },
  { key: 'year2', label: '2Y', months: 24 },
  { key: 'year3', label: '3Y', months: 36 },
  { key: 'year5', label: '5Y', months: 60 },
  { key: 'year7', label: '7Y', months: 84 },
  { key: 'year10', label: '10Y', months: 120 },
  { key: 'year20', label: '20Y', months: 240 },
  { key: 'year30', label: '30Y', months: 360 }
]

// 定番の 2 本だけ。10Y-2Y は最も広く見られている逆イールド指標、10Y-3M は NY Fed の
// 景気後退確率モデルが使う組み合わせ。任意の 2 満期を選ばせる UI は入れない（YC-07）。
export const SPREADS: { key: string; label: string; long: TreasuryMaturityKey; short: TreasuryMaturityKey }[] = [
  { key: '10y2y', label: '10Y-2Y', long: 'year10', short: 'year2' },
  { key: '10y3m', label: '10Y-3M', long: 'year10', short: 'month3' }
]

// 既定は先頭の 1 — 初回に開いたときのリクエストが 5 本で済むほうを選ぶ（5Y は 22 本）。
export const TREASURY_YEARS: TreasuryYears[] = [1, 5]
```

> `months` は表示順の根拠を 1 箇所にするために持つ。横軸の座標には使わない（YC-07: 等間隔）。

- [ ] **Step 3: zod schema を追加する**

`src/main/providers/fmp.schema.ts` の末尾（`fmpEconomicIndicatorResponse` の後）に追記する。`num()` は同ファイル 79 行目の `z.coerce.number().nullable().optional().catch(null)`。

```ts
// /stable/treasury-rates は 1 行 = 1 営業日で、date と 12 満期を返す（値は % 表記）。
// 12 満期すべて null 許容: 20 年債・30 年債は発行と公表が止まっていた期間があり、その日は
// 他の満期だけが埋まる（YC-03）。行ごと落とすと日が消えるので、num() で null を通す。
// .passthrough() を付けない（既定の strip で未知フィールドは無害に落ちる）: provider が
// MATURITIES のキーで添字アクセスするので、catchall の unknown が混ざると型が崩れる。
export const fmpTreasuryRatesResponse = z.array(z.object({
  date: z.string(),
  month1: num(), month2: num(), month3: num(), month6: num(),
  year1: num(), year2: num(), year3: num(), year5: num(),
  year7: num(), year10: num(), year20: num(), year30: num()
}))
```

- [ ] **Step 4: 失敗するテストを書く**

`tests/main/providers/treasuryRates.test.ts` を新規作成する。

```ts
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { FmpProvider, FmpHttpError } from '../../../src/main/providers/FmpProvider'
import { MATURITIES, SPREADS } from '@shared/treasury'

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(`tests/fixtures/${name}.json`), 'utf8'))

const provider = (httpGetJson: ReturnType<typeof vi.fn>): FmpProvider =>
  new FmpProvider({ apiKey: 'KEY', httpGetJson })

// 12 満期すべてを持つ 1 行（date 以外は上書き可能）。
const row = (date: string, over: Record<string, number | null> = {}): Record<string, unknown> => ({
  date,
  ...Object.fromEntries(MATURITIES.map((m, i) => [m.key, 4 + i / 100])),
  ...over
})

describe('満期レジストリと schema の対応', () => {
  it('MATURITIES は 12 満期で、キーが一意・月数が昇順', () => {
    expect(MATURITIES).toHaveLength(12)
    expect(new Set(MATURITIES.map((m) => m.key)).size).toBe(12)
    const months = MATURITIES.map((m) => m.months)
    expect([...months].sort((a, b) => a - b)).toEqual(months)
  })

  it('SPREADS が参照する満期はすべて MATURITIES にある', () => {
    const keys = new Set(MATURITIES.map((m) => m.key))
    for (const s of SPREADS) {
      expect(keys.has(s.long)).toBe(true)
      expect(keys.has(s.short)).toBe(true)
    }
  })
})

describe('FmpProvider.getTreasuryRates', () => {
  it('sends both from and to (統計指標と違い from が効く)', async () => {
    const httpGetJson = vi.fn(async () => [])
    await provider(httpGetJson).getTreasuryRates('2026-05-06', '2026-07-30')
    const url = httpGetJson.mock.calls[0][0] as string
    expect(url).toContain('/treasury-rates?from=2026-05-06')
    expect(url).toContain('to=2026-07-30')
  })

  it('parses the fixture into date-ascending points with all 12 maturities', async () => {
    const httpGetJson = vi.fn(async () => fixture('fmp-treasury-rates'))
    const points = await provider(httpGetJson).getTreasuryRates('2026-07-27', '2026-07-29')

    expect(points).toHaveLength(3)
    // fixture は FMP の応答そのままで date 降順。昇順に直っていることを固定する。
    expect(points.map((p) => p.date)).toEqual(['2026-07-27', '2026-07-28', '2026-07-29'])
    for (const p of points) {
      expect(Object.keys(p.rates).sort()).toEqual(MATURITIES.map((m) => m.key).sort())
      for (const m of MATURITIES) {
        const v = p.rates[m.key]
        expect(v === null || typeof v === 'number').toBe(true)
      }
    }
  })

  it('keeps a null maturity instead of dropping the day (YC-03)', async () => {
    const httpGetJson = vi.fn(async () => fixture('fmp-treasury-rates'))
    const points = await provider(httpGetJson).getTreasuryRates('2026-07-27', '2026-07-29')
    // fixture の最古の行は 20Y/30Y が null。行は残り、その満期だけ null になる。
    expect(points[0].rates.year30).toBeNull()
    expect(points[0].rates.year20).toBeNull()
    expect(points[0].rates.year10).not.toBeNull()
  })

  it('maps a missing maturity field to null (仕様変更で満期が消えても行は残す)', async () => {
    const partial = { ...row('2026-07-29') }
    delete partial.year30
    const httpGetJson = vi.fn(async () => [partial])
    const points = await provider(httpGetJson).getTreasuryRates('2026-07-29', '2026-07-29')
    expect(points[0].rates.year30).toBeNull()
  })

  it('coerces numeric strings (FMP は型を混ぜることがある)', async () => {
    const httpGetJson = vi.fn(async () => [row('2026-07-29', { year10: '4.18' as unknown as number })])
    const points = await provider(httpGetJson).getTreasuryRates('2026-07-29', '2026-07-29')
    expect(points[0].rates.year10).toBe(4.18)
  })

  it.each(['2026-99-99', '2026-7-1', 'not-a-date', ''])(
    'drops the row whose date does not round-trip as a UTC day: %s',
    async (bad) => {
      const httpGetJson = vi.fn(async () => [row(bad), row('2026-07-29')])
      const points = await provider(httpGetJson).getTreasuryRates('2026-07-01', '2026-07-29')
      // 正規表現で形だけ見ると '2026-99-99' が通り、それが窓の最古になった瞬間 shiftUtcDay が
      // Invalid Date の toISOString() で throw してバックフィルが止まる（YC-03）。
      expect(points.map((p) => p.date)).toEqual(['2026-07-29'])
    }
  )

  it('returns [] for an empty body (service が「取得失敗」として扱う)', async () => {
    const httpGetJson = vi.fn(async () => [])
    expect(await provider(httpGetJson).getTreasuryRates('2026-05-06', '2026-07-30')).toEqual([])
  })

  it('wraps an out-of-schema body as FmpHttpError(200)', async () => {
    const httpGetJson = vi.fn(async () => ({ 'Error Message': 'Exclusive Endpoint' }))
    const p = provider(httpGetJson)
    await expect(p.getTreasuryRates('2026-05-06', '2026-07-30')).rejects.toBeInstanceOf(FmpHttpError)
    await expect(p.getTreasuryRates('2026-05-06', '2026-07-30')).rejects.toMatchObject({ status: 200 })
  })
})
```

- [ ] **Step 5: テストを実行して失敗を確認する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npx vitest run tests/main/providers/treasuryRates.test.ts
```

Expected: FAIL — `getTreasuryRates is not a function`

- [ ] **Step 6: provider を実装する**

`src/main/providers/FmpProvider.ts` を 4 箇所直す。

(a) import を足す（`@shared/types` の type import に `TreasuryCurvePoint` / `TreasuryMaturityKey`、`fmp.schema` の import に `fmpTreasuryRatesResponse`、そして満期レジストリ）:

```ts
import { MATURITIES } from '@shared/treasury'
```

(b) `economicDateToEpochSeconds` の直後に判定関数を足す:

```ts
// UTC 日として往復しない date の行は落とす（YC-03）。正規表現で形だけ見ると '2026-99-99' が通り、
// それが窓の最古になった瞬間 shiftUtcDay が Invalid Date の toISOString() で throw して
// バックフィルが止まる。shiftUtcDay 自身が throw する側なので try で受ける。
function isUtcDay(date: string): boolean {
  try {
    return shiftUtcDay(date, 0) === date
  } catch {
    return false
  }
}
```

(c) クラス末尾（`getEconomicIndicator` の直後、閉じ括弧の前）にメソッドを足す:

```ts
  // /treasury-rates は 1 行 = 1 営業日で、1 リクエストで 12 満期すべてを返す（YC-01: これが
  // この機能をリクエスト予算に収めている前提）。from / to は両方効くので窓の両端を指定でき、
  // 範囲外の行を受け取らない。窓を連続に遡るのは TreasuryCurveService の責務で、ここは 1 窓だけ。
  // date は 'YYYY-MM-DD' の日付のみなので epoch に変換しない。行の順序は保証されないので昇順に直す。
  // 一部満期が null の日は行ごと落とさない（YC-03）— 落とすとその日がカーブから消える。
  async getTreasuryRates(from: string, to: string): Promise<TreasuryCurvePoint[]> {
    const url = `${BASE}/treasury-rates?from=${from}&to=${to}&apikey=${this.apiKey}`
    const rows = this.parseOrThrowHttpError(fmpTreasuryRatesResponse, await this.httpGetJson(url))
    return rows
      .filter((r) => isUtcDay(r.date))
      .map((r) => {
        const rates = {} as Record<TreasuryMaturityKey, number | null>
        for (const m of MATURITIES) rates[m.key] = r[m.key] ?? null
        return { date: r.date, rates }
      })
      .sort((a, b) => a.date.localeCompare(b.date))
  }
```

- [ ] **Step 7: テストと型チェックを実行する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npx vitest run tests/main/providers/treasuryRates.test.ts && npm run typecheck
```

Expected: 全 PASS、typecheck エラーなし

> `r[m.key]` が `unknown` になると型エラーになる。その場合は schema に `.passthrough()` が付いていないことを確認する（catchall の `[k: string]: unknown` が literal key の型を潰す）。

- [ ] **Step 8: Commit**

```bash
cd "C:/Users/010230240/work/vibing-view"
git add src/shared/types.ts src/shared/treasury.ts src/main/providers/fmp.schema.ts src/main/providers/FmpProvider.ts tests/main/providers/treasuryRates.test.ts
git commit -m "feat(yield-curve): 型・満期レジストリ・FmpProvider.getTreasuryRates"
```

---

### Task 3: `treasury_curves` テーブルとストア

**Files:**
- Modify: `src/main/db/schema.ts`（末尾に追記）
- Modify: `src/main/db/client.ts`（`CREATE TABLE IF NOT EXISTS` を 1 本追加）
- Create: `src/main/db/treasuryCurveStore.ts`

**Interfaces:**
- Consumes: `TreasuryCurvePoint`（Task 2）
- Produces:
  - `TreasuryCurveRow = { points: TreasuryCurvePoint[]; coveredFrom: string; fetchedAt: number }`
  - `getCurves(id: string): TreasuryCurveRow | null`
  - `upsertCurves(id: string, points: TreasuryCurvePoint[], coveredFrom: string, fetchedAt: number): void`

テストは書かない。`economicIndicatorStore` と同型の純粋な blob 出し入れで、意味のあるテストには実 SQLite が必要になる（既存の `companyProfileStore` / `economicDayStore` / `economicIndicatorStore` にもテストは無く、ロジックは Service 側でテストされている）。

- [ ] **Step 1: drizzle のテーブル定義を追加する**

`src/main/db/schema.ts` の末尾（`economicIndicators` の後）に追記する。

```ts
// 米国債イールドカーブのキャッシュ。id は固定 'us'（行は 1 本）。米国債専用のエンドポイントなので
// 現状キーに意味は無いが、他国を足すときに 'us' / 'jp' で分かれる（YC-11）。
// data は取得済みカーブ（TreasuryCurvePoint[]、date 昇順）の JSON blob — company_profiles /
// economic_indicators と同じ blob 方針で、満期フィールドの増減にマイグレーションが要らない。
// covered_from は「どこまで遡って取得済みか」の 'YYYY-MM-DD'。窓を連続に遡るのでカバー範囲は
// 常に [covered_from, 最新] の 1 区間で表せ、bars のような区間リストは要らない。
// economic_indicators に混ぜない理由は YC-04（同じ列に 2 種類の blob が入り、読む側が区別できない）。
export const treasuryCurves = sqliteTable('treasury_curves', {
  id: text('id').primaryKey(),
  data: text('data').notNull(),
  coveredFrom: text('covered_from').notNull(),
  fetchedAt: integer('fetched_at').notNull()
})
```

- [ ] **Step 2: `CREATE TABLE` を追加する**

`src/main/db/client.ts` の `sqlite.exec` テンプレート内、`economic_indicators` の直後に追記する。

```sql
    CREATE TABLE IF NOT EXISTS treasury_curves (
      id TEXT PRIMARY KEY, data TEXT NOT NULL, covered_from TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );
```

- [ ] **Step 3: ストアを実装する**

`src/main/db/treasuryCurveStore.ts` を新規作成する。**`electron` / `better-sqlite3` を静的 import してはいけない** — `getDb()` の遅延 require 経由でのみ触る（`economicIndicatorStore.ts` と同じ形）。

```ts
import { eq } from 'drizzle-orm'
import type { TreasuryCurvePoint } from '@shared/types'
import { getDb } from './client'
import { treasuryCurves } from './schema'

// data 列は TreasuryCurvePoint[] の JSON blob。TTL 判定・窓の遡り・マージは
// TreasuryCurveService の責務で、ここは純粋な read/write のみ（economicIndicatorStore と同じ）。
export type TreasuryCurveRow = {
  points: TreasuryCurvePoint[]
  coveredFrom: string
  fetchedAt: number
}

export function getCurves(id: string): TreasuryCurveRow | null {
  const row = getDb().select().from(treasuryCurves)
    .where(eq(treasuryCurves.id, id)).get()
  return row
    ? {
        points: JSON.parse(row.data) as TreasuryCurvePoint[],
        coveredFrom: row.coveredFrom,
        fetchedAt: row.fetchedAt
      }
    : null
}

export function upsertCurves(
  id: string,
  points: TreasuryCurvePoint[],
  coveredFrom: string,
  fetchedAt: number
): void {
  const data = JSON.stringify(points)
  getDb().insert(treasuryCurves)
    .values({ id, data, coveredFrom, fetchedAt })
    .onConflictDoUpdate({
      target: treasuryCurves.id,
      set: { data, coveredFrom, fetchedAt }
    })
    .run()
}
```

- [ ] **Step 4: 型チェックと全テストを実行する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npm run typecheck && npm test
```

Expected: エラーなし、既存テストは全 PASS

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/010230240/work/vibing-view"
git add src/main/db/schema.ts src/main/db/client.ts src/main/db/treasuryCurveStore.ts
git commit -m "feat(yield-curve): treasury_curves テーブルとストア"
```

---

### Task 4: TreasuryCurveService（TTL 12h ＋ 応答幅に追従する窓の遡り）

このタスクがこの機能の中核。設計書「契約は統計指標と同じ」「窓の遡り方」の全項目がここに入る。統計指標と**逆**なのは 2 点だけ（YC-05）: 空応答は失敗、`force` は TTL を無視するだけで履歴を捨てない。

**Files:**
- Create: `src/main/economic/TreasuryCurveService.ts`
- Test: `tests/main/economic/TreasuryCurveService.test.ts`

**Interfaces:**
- Consumes: `TreasuryCurveRow`（Task 3）、`TreasuryCurvePoint` / `TreasuryCurves` / `TreasuryYears`（Task 2）
- Produces:
  - `STEP_DAYS`（テストが期待窓数を計算するために export する）
  - `createTreasuryCurveService(deps)` → `{ getCurves(opts?: { years?: TreasuryYears; force?: boolean }): Promise<TreasuryCurves> }`
  - `deps` は `{ store: { getCurves(id), upsertCurves(id, points, coveredFrom, fetchedAt) }, fetch: (from: string, to: string) => Promise<TreasuryCurvePoint[]>, now?: () => number }`

- [ ] **Step 1: 失敗するテストを書く**

`tests/main/economic/TreasuryCurveService.test.ts` を新規作成する。

```ts
import { describe, it, expect, vi } from 'vitest'
import { createTreasuryCurveService, STEP_DAYS } from '../../../src/main/economic/TreasuryCurveService'
import { shiftUtcDay } from '@shared/utcDay'
import { MATURITIES } from '@shared/treasury'
import type { TreasuryCurvePoint, TreasuryMaturityKey } from '@shared/types'

// 2026-07-30T00:00:00Z。now を注入するのでテストは実際の日付に依存しない。
const T0 = Date.parse('2026-07-30T00:00:00Z') / 1000
const TODAY = '2026-07-30'
const TTL = 43200 // 12h
const FROM_1Y = '2025-07-30'
const FROM_5Y = '2021-07-30'
const ID = 'us'

// 12 満期すべてに同じ値を入れたカーブ。サービスは rates の中身を見ないので値に意味は無い。
const curve = (date: string, v = 4): TreasuryCurvePoint => ({
  date,
  rates: Object.fromEntries(MATURITIES.map((m) => [m.key, v])) as Record<TreasuryMaturityKey, number | null>
})

// 期待窓数は固定クロックと STEP_DAYS から計算する。22 のような数字を直接書くと、STEP_DAYS を
// 実測値に変えたときにテストだけが落ちる。
const windowCount = (from: string, to: string): number => {
  let n = 0
  for (let t = to; t >= from; t = shiftUtcDay(t, -STEP_DAYS)) n++
  return n
}

type Row = { points: TreasuryCurvePoint[]; coveredFrom: string; fetchedAt: number }

function fakeStore(initial?: Row) {
  const rows = new Map<string, Row>()
  if (initial) rows.set(ID, initial)
  return {
    rows,
    getCurves: vi.fn((id: string) => rows.get(id) ?? null),
    upsertCurves: vi.fn((id: string, points: TreasuryCurvePoint[], coveredFrom: string, fetchedAt: number) => {
      rows.set(id, { points, coveredFrom, fetchedAt })
    })
  }
}

const svc = (store: ReturnType<typeof fakeStore>, fetch: ReturnType<typeof vi.fn>, now = T0) =>
  createTreasuryCurveService({ store, fetch, now: () => now })

// 要求窓ぶんをそのまま返す（API 上限が STEP_DAYS 以上あるケース）。
const fullWindows = () =>
  vi.fn(async (from: string, to: string) => [curve(from), curve(to)])

const froms = (fetch: ReturnType<typeof vi.fn>): string[] => fetch.mock.calls.map((c) => c[0] as string)
const tos = (fetch: ReturnType<typeof vi.fn>): string[] => fetch.mock.calls.map((c) => c[1] as string)

describe('窓数の期待値（設計書の 5 本 / 22 本を固定クロックで確認）', () => {
  it('1Y = 5 windows, 5Y = 22 windows at STEP_DAYS = 85', () => {
    expect(STEP_DAYS).toBe(85)
    expect(windowCount(FROM_1Y, TODAY)).toBe(5)
    expect(windowCount(FROM_5Y, TODAY)).toBe(22)
  })
})

describe('getCurves — 初回取得', () => {
  it('walks [wantFrom, today] newest-first and stores everything it got', async () => {
    const store = fakeStore()
    const fetch = fullWindows()
    const r = await svc(store, fetch).getCurves({ years: 1 })

    expect(fetch).toHaveBeenCalledTimes(windowCount(FROM_1Y, TODAY))
    expect(tos(fetch)[0]).toBe(TODAY)
    expect(froms(fetch)[0]).toBe(shiftUtcDay(TODAY, -STEP_DAYS))
    expect(r.coveredFrom).toBe(FROM_1Y)
    expect(r.fetchedAt).toBe(T0)
    expect(r.stale).toBeUndefined()
    expect(store.upsertCurves).toHaveBeenCalledOnce()
  })

  it('leaves no gap between consecutive windows', async () => {
    const store = fakeStore()
    const fetch = fullWindows()
    await svc(store, fetch).getCurves({ years: 1 })

    // 次の窓の to は前の窓の from（1 日重なる）。隙間があるとその日は誰にも取得されない。
    const f = froms(fetch)
    const t = tos(fetch)
    for (let i = 1; i < t.length; i++) expect(t[i]).toBe(f[i - 1])
  })

  it('needs 22 windows for the 5Y horizon from scratch', async () => {
    const store = fakeStore()
    const fetch = fullWindows()
    await svc(store, fetch).getCurves({ years: 5 })
    expect(fetch).toHaveBeenCalledTimes(windowCount(FROM_5Y, TODAY))
  })

  it('defaults to the 1Y horizon', async () => {
    const store = fakeStore()
    const fetch = fullWindows()
    await svc(store, fetch).getCurves()
    expect(fetch).toHaveBeenCalledTimes(windowCount(FROM_1Y, TODAY))
  })

  it('returns points sorted by date', async () => {
    const store = fakeStore()
    // 窓は新しい側から取るので、マージ順は日付順にならない。provider が昇順で返す契約なので
    // 窓の中身は昇順で渡す（降順で渡すと rows[0] が最古でなくなり、遡りが 1 日ずつになる）。
    const fetch = vi.fn(async (_f: string, to: string) => [curve(shiftUtcDay(to, -3)), curve(to)])
    const r = await svc(store, fetch).getCurves({ years: 1 })
    const dates = r.points.map((p) => p.date)
    expect([...dates].sort()).toEqual(dates)
  })
})

describe('getCurves — 応答が要求窓より狭いとき（YC-02）', () => {
  it('follows the oldest returned date instead of the constant', async () => {
    const store = fakeStore()
    // API 上限が 30 日しかないケース: 要求した from より新しい日しか返さない。
    const fetch = vi.fn(async (_f: string, to: string) => [curve(shiftUtcDay(to, -30)), curve(to)])
    await svc(store, fetch).getCurves({ years: 1 })

    // 2 本目の to は「返ってきた最古の 1 日前」。定数どおり進めると 55 日ぶんの穴が空く。
    expect(tos(fetch)[1]).toBe(shiftUtcDay(TODAY, -31))
    expect(tos(fetch)[2]).toBe(shiftUtcDay(TODAY, -62))
    // 追従しても地平は埋まる（無限ループしない）。
    expect(store.rows.get(ID)!.coveredFrom).toBe(FROM_1Y)
  })
})

describe('getCurves — キャッシュ判定', () => {
  it('serves from cache inside the TTL when the horizon is covered', async () => {
    const store = fakeStore({ points: [curve(TODAY)], coveredFrom: FROM_1Y, fetchedAt: T0 })
    const fetch = vi.fn()
    const r = await svc(store, fetch, T0 + TTL - 1).getCurves({ years: 1 })

    expect(fetch).not.toHaveBeenCalled()
    expect(r).toEqual({ points: [curve(TODAY)], coveredFrom: FROM_1Y, fetchedAt: T0 })
  })

  it('refetches only the latest window once the TTL has elapsed', async () => {
    const store = fakeStore({ points: [curve('2026-07-29')], coveredFrom: FROM_1Y, fetchedAt: T0 - TTL })
    const fetch = fullWindows()
    const r = await svc(store, fetch).getCurves({ years: 1 })

    expect(fetch).toHaveBeenCalledOnce() // 遡りは走らない
    expect(tos(fetch)).toEqual([TODAY])
    expect(r.coveredFrom).toBe(FROM_1Y)
    expect(r.points.some((p) => p.date === '2026-07-29')).toBe(true) // 既存行は残る
  })

  it('covers the whole gap when the row is older than STEP_DAYS', async () => {
    // 前回取得から 200 日開いた行を 1 窓だけで更新すると、その間が誰にも取得されない穴として残る。
    const fetchedAt = T0 - 200 * 86400
    const store = fakeStore({ points: [curve('2026-01-11')], coveredFrom: FROM_5Y, fetchedAt })
    const fetch = fullWindows()
    await svc(store, fetch).getCurves({ years: 1 })

    expect(fetch).toHaveBeenCalledTimes(windowCount(shiftUtcDay(TODAY, -200), TODAY))
  })

  it('backfills from coveredFrom when the horizon widens (1Y → 5Y)', async () => {
    const store = fakeStore({ points: [curve(TODAY)], coveredFrom: FROM_1Y, fetchedAt: T0 })
    const fetch = fullWindows()
    const r = await svc(store, fetch).getCurves({ years: 5 })

    // TTL 内なので直近窓は取り直さない。1Y の下限から 5Y の下限までを遡るだけ。
    // 一括で 5Y を取る（22 本）より 1 本多いのは、遡りの起点が既存カバーの下限そのものだから。
    expect(fetch).toHaveBeenCalledTimes(windowCount(FROM_5Y, FROM_1Y))
    expect(tos(fetch)[0]).toBe(FROM_1Y)
    expect(r.coveredFrom).toBe(FROM_5Y)
  })

  it('does not refetch when narrowing the horizon back to 1Y', async () => {
    const store = fakeStore({ points: [curve(TODAY)], coveredFrom: FROM_5Y, fetchedAt: T0 })
    const fetch = vi.fn()
    const r = await svc(store, fetch).getCurves({ years: 1 })

    expect(fetch).not.toHaveBeenCalled()
    expect(r.coveredFrom).toBe(FROM_5Y) // 広いカバー範囲を狭めない
  })

  it('refetches when fetched_at is in the future (clock went backwards)', async () => {
    const store = fakeStore({ points: [curve(TODAY)], coveredFrom: FROM_1Y, fetchedAt: T0 + 10 * TTL })
    const fetch = fullWindows()
    const r = await svc(store, fetch).getCurves({ years: 1 })

    expect(fetch).toHaveBeenCalledOnce()
    expect(tos(fetch)).toEqual([TODAY])
    expect(r.fetchedAt).toBe(T0) // 未来の値を正常な now に書き戻す
  })
})

describe('getCurves — date union マージ', () => {
  it('lets the refetched window win for the same date and keeps the rest', async () => {
    const store = fakeStore({
      points: [curve('2026-07-29', 1), curve('2020-01-02', 1)],
      coveredFrom: FROM_5Y,
      fetchedAt: T0 - TTL
    })
    const fetch = vi.fn(async () => [curve('2026-07-29', 9)])
    const r = await svc(store, fetch).getCurves({ years: 1 })

    expect(r.points.find((p) => p.date === '2026-07-29')!.rates.year10).toBe(9)
    // 窓の外の履歴（5Y 地平で取った 2020 年）は残る
    expect(r.points.find((p) => p.date === '2020-01-02')!.rates.year10).toBe(1)
  })

  it('re-reads the store immediately before writing (別の地平要求との競合)', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async (_f: string, to: string) => {
      // 直列フェッチ中に、別の getCurves（5Y）が書き終えた状況を作る。
      store.rows.set(ID, { points: [curve('2021-08-02')], coveredFrom: FROM_5Y, fetchedAt: T0 })
      return [curve(to)]
    })
    const r = await svc(store, fetch).getCurves({ years: 1 })

    // 判定時の snapshot（行なし）のまま書くと、相手の履歴と coveredFrom を丸ごと捨てて
    // 次の 5Y 表示で 22 本取り直すことになる。
    expect(r.points.some((p) => p.date === '2021-08-02')).toBe(true)
    expect(r.coveredFrom).toBe(FROM_5Y)
  })
})

describe('getCurves — 空応答は取得失敗（YC-05: 統計指標と逆）', () => {
  it('returns the untouched row with stale: true and never advances coveredFrom', async () => {
    const store = fakeStore({ points: [curve('2026-07-29')], coveredFrom: FROM_1Y, fetchedAt: T0 })
    const fetch = vi.fn(async () => [])
    const r = await svc(store, fetch).getCurves({ years: 5 })

    // 85 日窓に営業日が 1 日も無いことはないので、空応答は 200 + 空配列のプラン拒否か仕様変更。
    // 前進させると coveredFrom が穴を跨いで「取得済み」になり、その穴は二度と埋まらない。
    expect(store.upsertCurves).not.toHaveBeenCalled()
    expect(r).toEqual({ points: [curve('2026-07-29')], coveredFrom: FROM_1Y, fetchedAt: T0, stale: true })
  })

  it('stops at the first empty window instead of walking the rest', async () => {
    const store = fakeStore({ points: [curve('2026-07-29')], coveredFrom: FROM_1Y, fetchedAt: T0 })
    const fetch = vi.fn(async () => [])
    await svc(store, fetch).getCurves({ years: 5 })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('throws when nothing is cached', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => [])
    await expect(svc(store, fetch).getCurves({ years: 1 })).rejects.toThrow(/EMPTY/)
    expect(store.upsertCurves).not.toHaveBeenCalled()
  })
})

describe('getCurves — フェッチ失敗', () => {
  it('returns the cached row with stale: true and writes nothing', async () => {
    const store = fakeStore({ points: [curve('2026-07-29')], coveredFrom: FROM_1Y, fetchedAt: T0 - TTL })
    const fetch = vi.fn(async () => { throw new Error('down') })
    const r = await svc(store, fetch).getCurves({ years: 1 })

    expect(r).toEqual({ points: [curve('2026-07-29')], coveredFrom: FROM_1Y, fetchedAt: T0 - TTL, stale: true })
    expect(store.upsertCurves).not.toHaveBeenCalled()
  })

  it('does not advance coveredFrom when a backfill window fails halfway', async () => {
    const store = fakeStore({ points: [curve(TODAY)], coveredFrom: FROM_1Y, fetchedAt: T0 })
    let n = 0
    const fetch = vi.fn(async (_f: string, to: string) => {
      if (++n > 3) throw new Error('down')
      return [curve(to)]
    })
    const r = await svc(store, fetch).getCurves({ years: 5 })

    expect(store.upsertCurves).not.toHaveBeenCalled()
    expect(r.coveredFrom).toBe(FROM_1Y)
    expect(r.stale).toBe(true)
  })

  it('rethrows when nothing is cached', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => { throw new Error('down') })
    await expect(svc(store, fetch).getCurves({ years: 1 })).rejects.toThrow('down')
  })
})

describe('getCurves — force（YC-05: 統計指標と逆）', () => {
  it('ignores the TTL but keeps history outside the refetched window', async () => {
    const store = fakeStore({
      points: [curve('2026-07-29', 1), curve('2020-01-02', 1)],
      coveredFrom: FROM_5Y,
      fetchedAt: T0
    })
    const fetch = vi.fn(async (_f: string, to: string) => [curve(to, 9)])
    const r = await svc(store, fetch).getCurves({ years: 1, force: true })

    // TTL 内でも直近窓を取り直す。行は捨てないので 5Y ぶんの履歴と coveredFrom は残る
    // （捨てると次の 5Y 表示で 22 本かかる）。
    expect(fetch).toHaveBeenCalledOnce()
    expect(r.coveredFrom).toBe(FROM_5Y)
    expect(r.points.some((p) => p.date === '2020-01-02')).toBe(true)
    expect(r.points.some((p) => p.date === TODAY)).toBe(true)
  })

  it('falls back to the existing row even under force', async () => {
    const store = fakeStore({ points: [curve(TODAY)], coveredFrom: FROM_1Y, fetchedAt: T0 })
    const fetch = vi.fn(async () => { throw new Error('down') })
    const r = await svc(store, fetch).getCurves({ years: 1, force: true })
    expect(r.stale).toBe(true)
    expect(store.upsertCurves).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npx vitest run tests/main/economic/TreasuryCurveService.test.ts
```

Expected: FAIL — `Failed to resolve import ".../TreasuryCurveService"`

- [ ] **Step 3: サービスを実装する**

`src/main/economic/TreasuryCurveService.ts` を新規作成する。

```ts
import type { TreasuryCurvePoint, TreasuryCurves, TreasuryYears } from '@shared/types'
import { shiftUtcDay, utcYmdFromEpoch } from '@shared/utcDay'
// 型だけ（`import type` は消えるので sqlite は読み込まれない — core.ts と同じ扱い）。
import type { TreasuryCurveRow } from '../db/treasuryCurveStore'

// TTL は直近窓の取り直しにだけ掛かる。確定判定は持たない — 財務省の公表値は基本的に改訂されないが、
// 確定判定を入れる利益（リクエスト 0 本ぶん）が、入れる複雑さに見合わない。
const TTL_SECONDS = 43200

// 1 窓で取りにいく日数。応答が要求窓より狭ければ返却最古に追従するので、この定数が間違っていても
// 穴は空かない（YC-02）— 役割は「1 回で何日ぶん取るか」の最適化だけ。実測上限より 5 日小さく取り、
// 境界の inclusive/exclusive の取り違えを吸収する（統計指標の 85 日ステップと同じ手）。
// テストが期待窓数をこの値から計算するので export する。
export const STEP_DAYS = 85

// 行は 1 本だけ。他国の国債を足すときにここが 'us' / 'jp' に分かれる（YC-11）。
const ID = 'us'

// 空応答は「落ちた」に含める（YC-05: 統計指標は四半期系列が合法的に空窓を返すので空を異常扱い
// しないが、85 日窓に営業日が 1 日も無いことはない）。throw にして下の catch に合流させることで、
// 「部分結果を 1 バイトも書かずに stale で返す」経路を 1 本に保つ。
const EMPTY_WINDOW = new Error('TREASURY_EMPTY_WINDOW')

// 年だけ引く。'YYYY-MM-DD' は辞書順が日付順と一致するので、'2024-02-29' のような実在しない日付でも
// 境界として正しく働く（renderer の sliceRange と同じ手）。
const shiftYears = (day: string, n: number): string => `${Number(day.slice(0, 4)) + n}${day.slice(4)}`

export function createTreasuryCurveService(deps: {
  store: {
    getCurves(id: string): TreasuryCurveRow | null
    upsertCurves(
      id: string, points: TreasuryCurvePoint[], coveredFrom: string, fetchedAt: number
    ): void
  }
  fetch: (from: string, to: string) => Promise<TreasuryCurvePoint[]>
  now?: () => number // epoch seconds — injectable for tests
}) {
  const { store, fetch } = deps
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000))

  return {
    async getCurves(opts?: { years?: TreasuryYears; force?: boolean }): Promise<TreasuryCurves> {
      const years = opts?.years ?? 1
      const today = utcYmdFromEpoch(now())
      const wantFrom = shiftYears(today, -years)

      // force は TTL を無視するだけ（company.info と同じ）。行は捨てない: 財務省の公表値は改訂
      // されないので捨てる利益が無く、捨てると 5Y のあと 1Y で force した瞬間に 4 年ぶんが消え、
      // 次の 5Y 表示で 22 リクエストかかる（YC-05）。
      const row = store.getCurves(ID)
      const needBackfill = !row || row.coveredFrom > wantFrom
      // fetchedAt が未来なら差が負になって TTL を永久に満たさない（時計を進めて書いたあと戻した
      // 場合）。未来を「取り直す」側に倒して fetchedAt を正常な値に書き戻す。
      const needRefresh =
        !row || opts?.force === true || row.fetchedAt > now() || now() - row.fetchedAt >= TTL_SECONDS

      if (!needBackfill && !needRefresh) {
        return { points: row.points, coveredFrom: row.coveredFrom, fetchedAt: row.fetchedAt }
      }

      const merged = new Map((row?.points ?? []).map((p) => [p.date, p]))

      // [from, to] を新しい側から窓に割って取る。空応答・例外はそのまま呼び出し元へ投げ、
      // 途中結果を書かせない。
      const walk = async (from: string, to: string): Promise<void> => {
        let t = to
        while (t >= from) {
          const step = shiftUtcDay(t, -STEP_DAYS)
          const rows = await fetch(step, t)
          if (rows.length === 0) throw EMPTY_WINDOW
          for (const p of rows) merged.set(p.date, p)
          // 応答が要求窓より狭い＝API 上限が STEP_DAYS 未満。返ってきた最古の 1 日前を次の窓の
          // 終端にすれば、上限が何日でも隙間なく遡れる。前進量は必ず 1 日以上あるので
          // 無限ループしない（oldest <= t なので oldest - 1 < t）。
          const oldest = rows[0].date // provider が昇順に直しているので先頭が最古
          t = oldest > step ? shiftUtcDay(oldest, -1) : step
        }
      }

      try {
        // 行が無いときは下の backfill が today から遡るので、直近窓を別に取ると 1 本無駄になる。
        // 起点は min(fetched_at, now) の日（クロック後退の保護）。前回取得から STEP_DAYS 以上
        // 開いた行を 1 窓だけで更新すると、その間が誰にも取得されない穴として残る。
        if (needRefresh && row) await walk(utcYmdFromEpoch(Math.min(row.fetchedAt, now())), today)
        if (needBackfill) await walk(wantFrom, row ? row.coveredFrom : today)
      } catch (err) {
        if (!row) throw err
        // 途中で落ちたら 1 バイトも書かない。covered_from だけ進めると埋まっていない範囲を
        // 「取得済み」と記録することになり、その穴は以後どのリクエストでも埋まらない。
        return { points: row.points, coveredFrom: row.coveredFrom, fetchedAt: row.fetchedAt, stale: true }
      }

      // 直列フェッチの最中に別の getCurves（別の地平）が書き込んでいることがある。判定に使った
      // snapshot のまま書くと、狭い地平の要求が後に書いたときに相手の履歴と coveredFrom を丸ごと
      // 捨てる。書く直前に読み直して union する。取り直した値のほうが新しいので同じ date は自分を残す。
      const prior = store.getCurves(ID)
      if (prior) for (const p of prior.points) if (!merged.has(p.date)) merged.set(p.date, p)

      const points = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date))
      // 地平を狭めても記録上のカバー範囲は狭めない（5Y を取ったあと 1Y に戻して再取得しない）。
      let coveredFrom = wantFrom
      for (const c of [row?.coveredFrom, prior?.coveredFrom]) if (c && c < coveredFrom) coveredFrom = c
      const fetchedAt = now()

      store.upsertCurves(ID, points, coveredFrom, fetchedAt)
      return { points, coveredFrom, fetchedAt }
    }
  }
}
```

- [ ] **Step 4: テストと型チェックを実行する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npx vitest run tests/main/economic/TreasuryCurveService.test.ts && npm run typecheck
```

Expected: 全 PASS

> Task 1 で `STEP_DAYS` を 85 以外に確定させた場合、`STEP_DAYS` を実測値に直し、テストの「1Y = 5 windows, 5Y = 22 windows」だけを新しい値に更新する（他の期待値は `windowCount` 経由なので自動で追従する）。

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/010230240/work/vibing-view"
git add src/main/economic/TreasuryCurveService.ts tests/main/economic/TreasuryCurveService.test.ts
git commit -m "feat(yield-curve): TreasuryCurveService（応答幅に追従する窓の遡りと date マージ）"
```

---

### Task 5: core 配線と `treasuryOutOfPlan` ラッチ（YC-08）

**Files:**
- Modify: `src/main/core.ts`
- Modify: `src/main/index.ts`（`buildCore` に `treasuryCurveStore` を渡す）
- Test: `tests/main/core/yieldCurve.test.ts`（新規）
- Test: `tests/main/core/*.test.ts`（既存 6 ファイルの `deps()` を更新）

**Interfaces:**
- Consumes: `createTreasuryCurveService`（Task 4）、`getCurves` / `upsertCurves`（Task 3）、`isPlanDenial`（`core.ts` の既存関数）
- Produces: `core.yieldCurve.getCurves(opts?)`。`CoreDeps` に `treasuryCurveStore: Pick<typeof treasuryCurveStoreModule, 'getCurves' | 'upsertCurves'>` が増え、`ProviderLike` に `'getTreasuryRates'` が増える（既存の core テストの `deps()` はすべて更新が必要）

**ラッチの効く範囲:** 1 回の `getCurves` は最大 22 窓を直列に取る。1 窓目でプラン拒否が来たら、その `getCurves` の 2 窓目以降も即座に落ちる（`fetch` の先頭で見ているため）。カレンダー（`economicOutOfPlan`）・統計指標（`economicIndicatorOutOfPlan`）と**共用しない** — 片方の拒否でもう片方が使えなくなる。

- [ ] **Step 1: 失敗するテストを書く**

`tests/main/core/yieldCurve.test.ts` を新規作成する。

```ts
import { describe, it, expect, vi } from 'vitest'
import { createCore, type CoreDeps } from '../../../src/main/core'
import { FmpHttpError } from '../../../src/main/providers/FmpProvider'
import { MATURITIES } from '@shared/treasury'
import type { TreasuryCurvePoint, TreasuryMaturityKey, WorkspaceCollection } from '@shared/types'

const collection = (name: string): WorkspaceCollection => ({
  version: 3,
  active: name,
  workspaces: [{ name, items: [], layout: { schemaVersion: 1, cells: [], shape: { rows: 1, cols: 1 }, activeCellId: '1' } }]
})

// プラン拒否 body。classify がこれを 'requires-plan' に落とすことがラッチの前提。
const DENIED_BODY = {
  'Error Message': 'Invalid API KEY. Feel free to create a Free API Key or visit https://site.financialmodelingprep.com/faqs?search=why-is-my-api-key-invalid for more information.'
}

const curve = (date: string): TreasuryCurvePoint => ({
  date,
  rates: Object.fromEntries(MATURITIES.map((m) => [m.key, 4])) as Record<TreasuryMaturityKey, number | null>
})

function deps(getTreasuryRates: ReturnType<typeof vi.fn>, over: Partial<CoreDeps> = {}): CoreDeps {
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
    economicIndicatorStore: { getIndicator: vi.fn(() => null), upsertIndicator: vi.fn() },
    treasuryCurveStore: { getCurves: vi.fn(() => null), upsertCurves: vi.fn() },
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
      getEconomicCalendar: vi.fn(async () => []),
      getEconomicIndicator: vi.fn(async () => []),
      getTreasuryRates
    })),
    nowSec: () => 1_000
  }
  return { ...base, ...over }
}

describe('core.yieldCurve.getCurves', () => {
  it('reaches the provider with a from/to window and returns the curves', async () => {
    const getTreasuryRates = vi.fn(async (from: string, _to: string) => [curve(from)])
    const d = deps(getTreasuryRates)
    const r = await createCore(d).yieldCurve.getCurves({ years: 1 })

    expect(getTreasuryRates).toHaveBeenCalled()
    for (const [from, to] of getTreasuryRates.mock.calls) {
      expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(from < to).toBe(true)
    }
    expect(r.points.length).toBeGreaterThan(0)
    expect(r.coveredFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(d.treasuryCurveStore.getCurves).toHaveBeenCalledWith('us')
  })

  it('throws NO_API_KEY without a key, without building a provider', async () => {
    const getTreasuryRates = vi.fn()
    const d = deps(getTreasuryRates)
    d.keystore.getApiKey = vi.fn(() => null)

    await expect(createCore(d).yieldCurve.getCurves()).rejects.toThrow('NO_API_KEY')
    expect(getTreasuryRates).not.toHaveBeenCalled()
    expect(d.makeProvider).not.toHaveBeenCalled()
  })
})

describe('core.yieldCurve — off-plan short-circuit (YC-08)', () => {
  it.each([402, 403])('stops hitting the network after a %i and rethrows the same error', async (status) => {
    const err = new FmpHttpError(status, DENIED_BODY)
    const getTreasuryRates = vi.fn(async () => { throw err })
    const core = createCore(deps(getTreasuryRates))

    // 1 窓目でラッチするので、この getCurves の残りの窓（最大 22 本）も空撃ちしない。
    await expect(core.yieldCurve.getCurves()).rejects.toBe(err)
    await expect(core.yieldCurve.getCurves({ years: 5 })).rejects.toBe(err)
    expect(getTreasuryRates).toHaveBeenCalledOnce()
  })

  it('latches on an HTTP 200 plan-denial payload', async () => {
    // parseOrThrowHttpError はスキーマ外の body を FmpHttpError(200) で投げるので、
    // status 判定（402/403）だけではプラン拒否が抜ける。
    const err = new FmpHttpError(200, DENIED_BODY)
    const getTreasuryRates = vi.fn(async () => { throw err })
    const core = createCore(deps(getTreasuryRates))

    await expect(core.yieldCurve.getCurves()).rejects.toBe(err)
    await expect(core.yieldCurve.getCurves()).rejects.toBe(err)
    expect(getTreasuryRates).toHaveBeenCalledOnce()
  })

  it('does NOT latch on a schema mismatch that carries no Error Message', async () => {
    // 逆方向の保護: 純粋なスキーマ不一致で以後の取得を全部止めてはいけない。
    const err = new FmpHttpError(200, [{ bogus: 1 }])
    const getTreasuryRates = vi.fn(async () => { throw err })
    const core = createCore(deps(getTreasuryRates))

    await expect(core.yieldCurve.getCurves()).rejects.toBe(err)
    await expect(core.yieldCurve.getCurves()).rejects.toBe(err)
    expect(getTreasuryRates).toHaveBeenCalledTimes(2)
  })

  it('does not latch on a 429 (transient)', async () => {
    const getTreasuryRates = vi.fn(async () => { throw new FmpHttpError(429, null) })
    const core = createCore(deps(getTreasuryRates))

    await expect(core.yieldCurve.getCurves()).rejects.toBeInstanceOf(FmpHttpError)
    await expect(core.yieldCurve.getCurves()).rejects.toBeInstanceOf(FmpHttpError)
    expect(getTreasuryRates).toHaveBeenCalledTimes(2)
  })

  it.each(['set', 'clear'] as const)('apikey.%s clears the latch', async (action) => {
    const err = new FmpHttpError(403, DENIED_BODY)
    const getTreasuryRates = vi.fn(async () => { throw err })
    const core = createCore(deps(getTreasuryRates))

    await expect(core.yieldCurve.getCurves()).rejects.toBe(err)
    if (action === 'set') core.apikey.set('NEW'); else core.apikey.clear()
    await expect(core.yieldCurve.getCurves()).rejects.toBe(err)
    expect(getTreasuryRates).toHaveBeenCalledTimes(2)
  })

  it('is independent of the calendar and indicator latches', async () => {
    const err = new FmpHttpError(403, DENIED_BODY)
    const getEconomicCalendar = vi.fn(async () => { throw err })
    const getEconomicIndicator = vi.fn(async () => { throw err })
    const getTreasuryRates = vi.fn(async (from: string) => [curve(from)])
    const d = deps(getTreasuryRates)
    d.makeProvider = vi.fn(() => ({
      getOHLCV: vi.fn(async () => []),
      searchSymbols: vi.fn(async () => []),
      getQuote: vi.fn(),
      getMarketStatus: vi.fn(),
      getCompanyProfile: vi.fn(),
      getEconomicCalendar,
      getEconomicIndicator,
      getTreasuryRates
    }))
    const core = createCore(d)

    await expect(core.economicCalendar.getRange('2026-07-30', '2026-07-30')).rejects.toBe(err)
    await expect(core.economicIndicator.getSeries('CPI')).rejects.toBe(err)
    // 他の 2 つがラッチされてもイールドカーブは取れる
    const r = await core.yieldCurve.getCurves()
    expect(r.points.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 既存の core テストの `deps()` を更新する**

`CoreDeps` と `ProviderLike` に必須メンバーが増えるので、既存の 6 ファイルを直す。該当箇所を洗い出す。

```bash
cd "C:/Users/010230240/work/vibing-view" && grep -rn "economicIndicatorStore:" tests/ && grep -rn "getEconomicIndicator: vi.fn\|getEconomicIndicator$\|getEconomicIndicator," tests/
```

`economicIndicatorStore:` の各行の直後に挿入する。

```ts
    treasuryCurveStore: { getCurves: vi.fn(() => null), upsertCurves: vi.fn() },
```

`makeProvider` のスタブ（`getEconomicCalendar` を書いている箇所）にも 1 行足す。

```ts
      getTreasuryRates: vi.fn(async () => []),
```

- [ ] **Step 3: テストを実行して失敗を確認する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npx vitest run tests/main/core
```

Expected: FAIL — `core.yieldCurve` が undefined（`Cannot read properties of undefined`）

- [ ] **Step 4: core.ts を実装する**

5 箇所を変更する。

(a) import を足す（`economicIndicatorStoreModule` の隣、`createEconomicIndicatorService` の隣）:

```ts
import type * as treasuryCurveStoreModule from './db/treasuryCurveStore'
import { createTreasuryCurveService } from './economic/TreasuryCurveService'
```

(b) `ProviderLike`（`core.ts:45`）に 1 メソッド追加する:

```ts
export type ProviderLike = Pick<
  FmpProvider,
  'getOHLCV' | 'searchSymbols' | 'getQuote' | 'getMarketStatus' | 'getCompanyProfile'
  | 'getEconomicCalendar' | 'getEconomicIndicator' | 'getTreasuryRates'
>
```

(c) `CoreDeps` に 1 行追加する（`economicIndicatorStore` の直後、`core.ts:59`）:

```ts
  treasuryCurveStore: Pick<typeof treasuryCurveStoreModule, 'getCurves' | 'upsertCurves'>
```

(d) `economicIndicatorOutOfPlan` の宣言（`core.ts:86`）の直後にフラグを足す:

```ts
  // YC-08: /treasury-rates も別プラン階層の可能性がある。1 回の getCurves が最大 22 窓を直列に
  // 取るので、ラッチが無いと 1 回の窓オープンで 22 回空撃ちする。カレンダー・統計指標と
  // 共用しない（片方の拒否でもう片方が使えなくなる）。
  let treasuryOutOfPlan: FmpHttpError | null = null
```

(e) `economicIndicatorService` の直後にサービスを足す:

```ts
  // 1 窓 = 1 リクエストで 12 満期ぶん返る（YC-01）。ラッチは fetch の先頭で見る — 1 窓目で
  // 拒否されたらその getCurves の残りの窓も空撃ちしない。
  const treasuryCurveService = createTreasuryCurveService({
    store: deps.treasuryCurveStore,
    fetch: async (from, to) => {
      if (treasuryOutOfPlan) throw treasuryOutOfPlan
      try {
        return await providerFor().getTreasuryRates(from, to)
      } catch (err) {
        if (isPlanDenial(err)) treasuryOutOfPlan = err
        throw err
      }
    }
  })
```

返り値オブジェクトの `economicIndicator: economicIndicatorService,` の直後に追記する:

```ts
    // 窓と機能の名前は yieldCurve、データとテーブルは treasuryCurve（設計書「アーキテクチャ」）。
    // opts.years が取得地平（1 | 5）。表示上のスライスは renderer 側。
    yieldCurve: treasuryCurveService,
```

`apikey.set` / `apikey.clear` の `economicIndicatorOutOfPlan = null` を書いている 2 箇所（`core.ts:254` と `263`）の隣に追記する:

```ts
        treasuryOutOfPlan = null
```

- [ ] **Step 5: main/index.ts でストアを注入する**

import に追加する（`economicIndicatorStore` の隣）:

```ts
import * as treasuryCurveStore from './db/treasuryCurveStore'
```

`buildCore()` の `createCore({...})` に追加する（`economicIndicatorStore,` の直後）:

```ts
    treasuryCurveStore,
```

- [ ] **Step 6: テストと型チェックを実行する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npm test && npm run typecheck
```

Expected: 全 PASS。Step 2 で拾い漏れた `deps()` があれば typecheck が指摘する。

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/010230240/work/vibing-view"
git add src/main/core.ts src/main/index.ts tests/main/core
git commit -m "feat(yield-curve): core 配線と treasuryOutOfPlan ラッチ（YC-08）"
```

---

### Task 6: IPC・preload・窓ハンドラ・ハッシュ

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/windowHash.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Test: `tests/windowHash.test.ts`（既存に追加）

**Interfaces:**
- Consumes: `core.yieldCurve.getCurves`（Task 5）、`TreasuryCurves` / `TreasuryYears`（Task 2）
- Produces:
  - `CH.treasuryCurves` / `CH.yieldCurveOpenWindow`
  - `Api['yieldCurve'] = { getCurves(opts?), openWindow() }`
  - `WindowKind` に `'yieldCurve'`

- [ ] **Step 1: windowHash の失敗するテストを書く**

`tests/windowHash.test.ts` の末尾に追記する。

```ts
// イールドカーブ窓も singleton。値は固定 '1' で有無だけ見るので、他の窓の hash で誤って
// 開かないことを押さえる。
describe('windowHash — yieldCurve', () => {
  it('round-trips the singleton marker', () => {
    expect(parseHash('yieldCurve', '#' + buildHash('yieldCurve', '1'))).toBe('1')
  })

  it('does not parse as another kind', () => {
    const hash = '#' + buildHash('yieldCurve', '1')
    expect(parseHash('economic', hash)).toBeNull()
    expect(parseHash('economicIndicator', hash)).toBeNull()
    expect(parseHash('company', hash)).toBeNull()
    expect(parseHash('chart', hash)).toBeNull()
    expect(parseHash('symbolChart', hash)).toBeNull()
  })

  it('is not matched by the other singleton hashes', () => {
    expect(parseHash('yieldCurve', '#' + buildHash('economic', '1'))).toBeNull()
    expect(parseHash('yieldCurve', '#' + buildHash('economicIndicator', 'CPI'))).toBeNull()
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npx vitest run tests/windowHash.test.ts
```

Expected: FAIL — `'yieldCurve'` は `WindowKind` に無い（型エラー）

- [ ] **Step 3: `WindowKind` を拡張する**

`src/shared/windowHash.ts` の冒頭コメントと型を更新する。

```ts
// Satellite windows (company info / enlarge-chart / watchlist symbol / economic calendar /
// economic indicator / yield curve) all reuse the main renderer bundle; the target rides in the
// URL hash (#company=AAPL, #chart=CELLID, #symbolChart=AAPL, #economic=1,
// #economicIndicator=CPI, #yieldCurve=1).
// main-process index.ts builds it, main.tsx branches on it. Shared so both sides agree on the
// format, and one kind's hash never parses as another's.
// 'economic' and 'yieldCurve' are singleton windows, so their value is a fixed '1' — callers only
// check presence（イールドカーブは選択状態を main に持たせないので、hash に載せるものが無い）.
// 'economicIndicator' is also a single window (main pins its key), but its hash carries the
// selected series so the renderer has it on the first render instead of pulling for it.
export type WindowKind = 'company' | 'chart' | 'symbolChart' | 'economic' | 'economicIndicator' | 'yieldCurve'
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npx vitest run tests/windowHash.test.ts
```

Expected: PASS

- [ ] **Step 5: `shared/ipc.ts` にチャンネルと型を足す**

`CH` の `economicIndicatorSelect: 'economicIndicator:select',` の直後に追記する。

```ts
  treasuryCurves: 'treasury:curves',
  yieldCurveOpenWindow: 'yieldCurve:openWindow',
```

1 行目の `import type` に `TreasuryCurves` と `TreasuryYears` を追加し、`Api` の `economicIndicator: {...}` ブロックの直後に追記する。

```ts
  // イールドカーブ窓。窓は 1 枚だけで、選択状態（比較日・トグル）はすべて renderer の使い捨て
  // state なので openWindow は引数を取らない（経済カレンダー EC-09 と同型）。
  // チャンネル名がデータ側（treasury）なのは、断面図を出さない用途でデータだけ使うことが
  // あり得るため（MCP ツール YC-09）。
  yieldCurve: {
    // years は取得地平（1 | 5）。省略時は 1。地平を広げる呼び出しだけがバックフィルを起こす。
    // force は TTL を無視するだけで、取得済み履歴と coveredFrom は残る（YC-05）。
    getCurves(opts?: { years?: TreasuryYears; force?: boolean }): Promise<TreasuryCurves>
    openWindow(): Promise<void>
  }
```

- [ ] **Step 6: `main/ipc.ts` にハンドラを 1 本足す**

`CH.economicIndicator` のハンドラの直後に追記する（`@shared/types` の type import に `TreasuryYears` を追加する）。

```ts
  ipcMain.handle(
    CH.treasuryCurves,
    (_e, opts?: { years?: TreasuryYears; force?: boolean }) => core.yieldCurve.getCurves(opts)
  )
```

- [ ] **Step 7: `main/index.ts` に窓ハンドラを足す**

`app.whenReady()` 内、`CH.economicIndicatorOpenWindow` のハンドラの直後に追記する。singleton なので既定のキー（`yieldCurve:1`）のままで `openHashWindow` が 2 回目以降はフォーカスするだけになる（経済カレンダーと同型）。

```ts
  ipcMain.handle(CH.yieldCurveOpenWindow, () => openHashWindow('yieldCurve', '1', 1000, 900))
```

`satelliteWindows` の冒頭コメントの列挙に「yield curve as a singleton（同じ理由）」を足す。

- [ ] **Step 8: preload に足す**

`src/preload/index.ts` の `economicIndicator: {...}` ブロックの直後に追記する。

```ts
  yieldCurve: {
    getCurves: (opts) => ipcRenderer.invoke(CH.treasuryCurves, opts),
    openWindow: () => ipcRenderer.invoke(CH.yieldCurveOpenWindow)
  },
```

- [ ] **Step 9: テストと型チェックを実行する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npm test && npm run typecheck
```

Expected: 全 PASS

- [ ] **Step 10: Commit**

```bash
cd "C:/Users/010230240/work/vibing-view"
git add src/shared/ipc.ts src/shared/windowHash.ts src/main/ipc.ts src/main/index.ts src/preload/index.ts tests/windowHash.test.ts
git commit -m "feat(yield-curve): IPC・preload・singleton 窓ハンドラ"
```

---

### Task 7: renderer の純関数（`treasuryCurve.ts`）

断面の切り出し、日付スナップ、系列化、スプレッド、表、書式。SVG と lightweight-charts の描画結果はテストしないので、意味のある判断は全部この 1 ファイルに集める。

**Files:**
- Create: `src/renderer/lib/treasuryCurve.ts`
- Test: `tests/renderer/treasuryCurve.test.ts`

**Interfaces:**
- Consumes: `MATURITIES` / `SPREADS`（Task 2）、`TreasuryCurvePoint` / `TreasuryMaturityKey` / `TreasuryYears`（Task 2）
- Produces:
  - `LinePoint = { time: string; value: number } | { time: string }`
  - `CurveDot = { key; label; index; value }`
  - `curveAt(points, date): TreasuryCurvePoint | null`
  - `snapToDate(points, date): string | null`
  - `curveSegments(curve): CurveDot[][]`
  - `seriesFor(points, key): LinePoint[]`
  - `spreadSeries(points, spreadKey): LinePoint[]`
  - `zeroLineSeries(points): LinePoint[]`
  - `sliceRange(points, years): TreasuryCurvePoint[]`
  - `TableCell = { value: number | null; delta: number | null }` / `TableRow = { key; label; latest; cells }`
  - `tableRows(latest, compares): TableRow[]`
  - `formatRate(v): string` / `formatRateDelta(v): string` / `maturityColor(index): string`

> 設計書のテスト表にある `tableColumns` はこの `tableRows` に相当する。行が満期で、列（比較日ごとの値と Δ の対）は 1 行の `cells` として出るので、返り値の形に合わせて `tableRows` と呼ぶ。

- [ ] **Step 1: 失敗するテストを書く**

`tests/renderer/treasuryCurve.test.ts` を新規作成する。

```ts
import { describe, it, expect } from 'vitest'
import {
  curveAt, curveSegments, formatRate, formatRateDelta, maturityColor, seriesFor, sliceRange,
  snapToDate, spreadSeries, tableRows, zeroLineSeries
} from '@/lib/treasuryCurve'
import { MATURITIES } from '@shared/treasury'
import type { TreasuryCurvePoint, TreasuryMaturityKey } from '@shared/types'

// 12 満期を持つ 1 日。over で個別の満期を上書き（null 含む）。
const curve = (
  date: string,
  over: Partial<Record<TreasuryMaturityKey, number | null>> = {}
): TreasuryCurvePoint => ({
  date,
  rates: {
    ...(Object.fromEntries(MATURITIES.map((m, i) => [m.key, 4 + i / 10])) as Record<TreasuryMaturityKey, number | null>),
    ...over
  }
})

// 営業日 3 日ぶん（土日を飛ばした並び）。
const POINTS: TreasuryCurvePoint[] = [
  curve('2026-07-24'),
  curve('2026-07-27'),
  curve('2026-07-28', { year10: 4.5, year2: 4.7 })
]

describe('curveAt', () => {
  it('returns the curve for an exact date', () => {
    expect(curveAt(POINTS, '2026-07-27')).toBe(POINTS[1])
  })

  it('returns null when the date is not in the cache', () => {
    expect(curveAt(POINTS, '2026-07-25')).toBeNull()
    expect(curveAt([], '2026-07-27')).toBeNull()
  })
})

describe('snapToDate — 休日は前営業日に戻す（YC-06）', () => {
  it('snaps a weekend pick back to the previous business day', () => {
    // 2026-07-25/26 は土日。データが無いので 07-24 に戻る。
    expect(snapToDate(POINTS, '2026-07-26')).toBe('2026-07-24')
  })

  it('returns the date itself when it has data', () => {
    expect(snapToDate(POINTS, '2026-07-27')).toBe('2026-07-27')
  })

  it('returns null before the oldest cached day (coveredFrom より前)', () => {
    expect(snapToDate(POINTS, '2026-07-23')).toBeNull()
    expect(snapToDate([], '2026-07-27')).toBeNull()
  })

  it('snaps a future pick to the newest day', () => {
    expect(snapToDate(POINTS, '2026-12-31')).toBe('2026-07-28')
  })
})

describe('curveSegments — null 満期で線を切る（YC-03）', () => {
  it('returns one segment with all 12 dots when nothing is missing', () => {
    const segments = curveSegments(curve('2026-07-28'))
    expect(segments).toHaveLength(1)
    expect(segments[0]).toHaveLength(12)
    // index は MATURITIES の位置 = 等間隔の横軸座標（YC-07）
    expect(segments[0].map((d) => d.index)).toEqual([...Array(12).keys()])
    expect(segments[0][0]).toEqual({ key: 'month1', label: '1M', index: 0, value: 4 })
  })

  it('splits into contiguous non-null segments', () => {
    // 20Y/30Y だけ欠測（発行が止まっていた期間）→ 末尾で切れる
    const segments = curveSegments(curve('2003-02-03', { year20: null, year30: null }))
    expect(segments).toHaveLength(1)
    expect(segments[0].map((d) => d.key)).not.toContain('year20')
    expect(segments[0]).toHaveLength(10)
  })

  it('splits in the middle when a maturity in the middle is missing', () => {
    const segments = curveSegments(curve('2026-07-28', { year2: null }))
    expect(segments).toHaveLength(2)
    expect(segments[0].map((d) => d.key)).toEqual(['month1', 'month2', 'month3', 'month6', 'year1'])
    expect(segments[1][0].key).toBe('year3')
    // 区間をまたいで線を引かない = 0 として繋がない（利回りが暴落したように見える）
    expect(segments[1][0].index).toBe(6)
  })

  it('returns no segments when every maturity is missing', () => {
    const empty = Object.fromEntries(MATURITIES.map((m) => [m.key, null])) as Record<TreasuryMaturityKey, null>
    expect(curveSegments({ date: '2026-07-28', rates: empty })).toEqual([])
  })
})

describe('seriesFor — 欠測日は whitespace（YC-03）', () => {
  it('maps each day to a value point', () => {
    expect(seriesFor(POINTS, 'year10')).toEqual([
      { time: '2026-07-24', value: 4.9 },
      { time: '2026-07-27', value: 4.9 },
      { time: '2026-07-28', value: 4.5 }
    ])
  })

  it('emits a time-only point for a missing day', () => {
    // 点そのものを省くと lightweight-charts が前後の値を直線で繋ぎ、欠測が無かったように見える。
    const points = [curve('2026-07-24'), curve('2026-07-27', { year30: null }), curve('2026-07-28')]
    expect(seriesFor(points, 'year30')[1]).toEqual({ time: '2026-07-27' })
    expect(seriesFor(points, 'year30')).toHaveLength(3)
  })

  it('handles an empty series', () => {
    expect(seriesFor([], 'year10')).toEqual([])
  })
})

describe('spreadSeries — 片側が null の日は計算しない', () => {
  it('computes long - short', () => {
    expect(spreadSeries(POINTS, '10y2y').at(-1)).toEqual({ time: '2026-07-28', value: 4.5 - 4.7 })
  })

  it('emits whitespace when either leg is missing (null - 4.2 = -4.2 を防ぐ)', () => {
    const points = [curve('2026-07-27', { year2: null }), curve('2026-07-28')]
    expect(spreadSeries(points, '10y2y')[0]).toEqual({ time: '2026-07-27' })
  })

  it('returns [] for an unknown spread key', () => {
    expect(spreadSeries(POINTS, 'nope')).toEqual([])
  })
})

describe('zeroLineSeries', () => {
  it('spans the whole visible range with two points', () => {
    expect(zeroLineSeries(POINTS)).toEqual([
      { time: '2026-07-24', value: 0 },
      { time: '2026-07-28', value: 0 }
    ])
  })

  it('handles an empty series', () => {
    expect(zeroLineSeries([])).toEqual([])
  })
})

describe('sliceRange — 基準は最新の観測日', () => {
  const YEARLY: TreasuryCurvePoint[] = Array.from({ length: 11 }, (_, i) => curve(`${2016 + i}-01-02`))

  it('1Y counts back from the newest observation, not from today', () => {
    expect(sliceRange(YEARLY, 1).map((p) => p.date)).toEqual(['2025-01-02', '2026-01-02'])
  })

  it('5Y slices from the newest observation', () => {
    expect(sliceRange(YEARLY, 5).map((p) => p.date)).toEqual([
      '2021-01-02', '2022-01-02', '2023-01-02', '2024-01-02', '2025-01-02', '2026-01-02'
    ])
  })

  it('handles an empty series and a single point', () => {
    expect(sliceRange([], 1)).toEqual([])
    expect(sliceRange([POINTS[0]], 1)).toEqual([POINTS[0]])
  })

  it('does not crash on a Feb 29 newest date', () => {
    // 文字列でカットオフを作るので、'2020-02-29' の 1 年前 '2019-02-29'（実在しない日付）でも
    // 境界として正しく働く。
    const leap = [curve('2019-01-02'), curve('2019-03-01'), curve('2020-02-29')]
    expect(sliceRange(leap, 1).map((p) => p.date)).toEqual(['2019-03-01', '2020-02-29'])
  })
})

describe('tableRows — 比較日ごとに値と Δ の 2 列', () => {
  const latest = curve('2026-07-28', { year10: 4.5 })
  const older = curve('2026-06-30', { year10: 4.2, year30: null })

  it('gives one row per maturity in registry order', () => {
    const rows = tableRows(latest, [])
    expect(rows).toHaveLength(12)
    expect(rows.map((r) => r.label)).toEqual(MATURITIES.map((m) => m.label))
    expect(rows.every((r) => r.cells.length === 0)).toBe(true) // 比較日 0 本なら Latest 列だけ
  })

  it('adds a value+delta cell per comparison date', () => {
    const rows = tableRows(latest, [older])
    const row10y = rows.find((r) => r.key === 'year10')!
    expect(row10y.latest).toBe(4.5)
    // Δ は「最新 − その比較日」。1 列にまとめると比較日が 2 本以上あるときどちらとの差か決まらない。
    expect(row10y.cells).toEqual([{ value: 4.2, delta: 4.5 - 4.2 }])
  })

  it('keeps the cell order aligned with the comparison dates', () => {
    const mid = curve('2026-07-15', { year10: 4.3 })
    const row10y = tableRows(latest, [mid, older]).find((r) => r.key === 'year10')!
    expect(row10y.cells.map((c) => c.value)).toEqual([4.3, 4.2])
  })

  it('leaves value and delta null when the maturity is missing', () => {
    const row30y = tableRows(latest, [older]).find((r) => r.key === 'year30')!
    expect(row30y.cells[0]).toEqual({ value: null, delta: null })
  })

  it('leaves every latest and delta null when there is no latest curve', () => {
    const rows = tableRows(null, [older])
    expect(rows[0].latest).toBeNull()
    expect(rows[0].cells[0].delta).toBeNull()
    expect(rows[0].cells[0].value).not.toBeNull() // 比較日の値そのものは出す
  })
})

describe('formatRate / formatRateDelta', () => {
  it('pins 2 decimals so 10bp differences line up', () => {
    expect(formatRate(4.3)).toBe('4.30')
    expect(formatRate(4.312)).toBe('4.31')
    expect(formatRate(0)).toBe('0.00')
  })

  it('dashes a missing maturity', () => {
    expect(formatRate(null)).toBe('—')
    expect(formatRateDelta(null)).toBe('—')
  })

  it('signs the delta in percentage points (bp に変換しない)', () => {
    expect(formatRateDelta(0.12)).toBe('+0.12')
    expect(formatRateDelta(-0.12)).toBe('-0.12')
    expect(formatRateDelta(0)).toBe('0.00')
  })
})

describe('maturityColor', () => {
  it('ramps from cool (short) to warm (long) with fixed lightness', () => {
    // 満期は順序尺度なので、凡例を見なくても長短が分かるランプにする。明度固定で
    // ライト/ダーク両方で読める。
    expect(maturityColor(0)).toBe('hsl(210 70% 55%)')
    expect(maturityColor(11)).toBe('hsl(45 70% 55%)')
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npx vitest run tests/renderer/treasuryCurve.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/treasuryCurve"`

- [ ] **Step 3: 実装する**

`src/renderer/lib/treasuryCurve.ts` を新規作成する。

```ts
// src/renderer/lib/treasuryCurve.ts
import { MATURITIES, SPREADS } from '@shared/treasury'
import type { TreasuryCurvePoint, TreasuryMaturityKey, TreasuryYears } from '@shared/types'

// lightweight-charts の Line 系列に渡す点。value を持たない点は whitespace で、そこで線が切れる。
// 点そのものを省くと前後が直線で繋がれて欠測が無かったように見えるので、欠測日も time だけ渡す（YC-03）。
export type LinePoint = { time: string; value: number } | { time: string }

// 断面図の 1 点。index は MATURITIES の位置 = 等間隔の横軸座標（YC-07: months の対数軸にしない。
// 等間隔のほうが短期側の 5 満期の形が読め、逆イールドの起点が分かる）。
export type CurveDot = { key: TreasuryMaturityKey; label: string; index: number; value: number }

// 指定日のカーブ（完全一致）。断面はキャッシュ済みの全 points から引くので、下段の折れ線の
// スライスより古い比較日でも出せる（YC-06）。
export function curveAt(points: TreasuryCurvePoint[], date: string): TreasuryCurvePoint | null {
  return points.find((p) => p.date === date) ?? null
}

// その日以前で最も近いデータのある日（YC-06）。土日祝と、財務省が公表を飛ばした日がこれに当たる。
// 遡ってもデータが無ければ null — 呼び出し側はチップを追加しない。
// points は date 昇順なので、後ろから最初に見つかったものが最も近い。
export function snapToDate(points: TreasuryCurvePoint[], date: string): string | null {
  for (let i = points.length - 1; i >= 0; i--) if (points[i].date <= date) return points[i].date
  return null
}

// 連続する非 null 満期ごとに区切った点列。区間をまたいで線を引かないので、欠測満期で線が切れる
// （0 として繋ぐと利回りが暴落したように見える、YC-03）。
export function curveSegments(curve: TreasuryCurvePoint): CurveDot[][] {
  const segments: CurveDot[][] = []
  let current: CurveDot[] = []
  MATURITIES.forEach((m, index) => {
    const value = curve.rates[m.key]
    if (value == null) {
      if (current.length > 0) segments.push(current)
      current = []
      return
    }
    current.push({ key: m.key, label: m.label, index, value })
  })
  if (current.length > 0) segments.push(current)
  return segments
}

// 満期 1 本の推移。
export function seriesFor(points: TreasuryCurvePoint[], key: TreasuryMaturityKey): LinePoint[] {
  return points.map((p) => {
    const v = p.rates[key]
    return v == null ? { time: p.date } : { time: p.date, value: v }
  })
}

// スプレッドの推移。片側が null の日は計算しない（null - 4.2 = -4.2 になる事故を防ぐ）。
export function spreadSeries(points: TreasuryCurvePoint[], spreadKey: string): LinePoint[] {
  const spread = SPREADS.find((s) => s.key === spreadKey)
  if (!spread) return []
  return points.map((p) => {
    const long = p.rates[spread.long]
    const short = p.rates[spread.short]
    return long == null || short == null ? { time: p.date } : { time: p.date, value: long - short }
  })
}

// ゼロライン。スプレッドを 1 つ以上選んでいる間だけ引く（利回りだけ見ているときは意味を持たない、
// YC-07）。端の 2 点だけで全幅に引ける。
export function zeroLineSeries(points: TreasuryCurvePoint[]): LinePoint[] {
  if (points.length === 0) return []
  return [{ time: points[0].date, value: 0 }, { time: points[points.length - 1].date, value: 0 }]
}

// 表示スライス。基準は最新の観測日（統計指標の sliceRange と同じ理由 — 今日から遡ると公表が
// 遅れている系列で空になる）。カットオフは Date を使わず文字列で作るので、年だけ引いた
// '2019-02-29' のような実在しない日付でも境界として正しく働く。
export function sliceRange(points: TreasuryCurvePoint[], years: TreasuryYears): TreasuryCurvePoint[] {
  if (points.length === 0) return points
  const last = points[points.length - 1].date
  const cutoff = `${Number(last.slice(0, 4)) - years}${last.slice(4)}`
  return points.filter((p) => p.date >= cutoff)
}

// 表は行が満期。cells は比較日ごとに「その日の値」と「最新との差」の対 — 差を 1 列にまとめると、
// 比較日が 2 本以上あるときどちらとの差なのかが決まらない。
export type TableCell = { value: number | null; delta: number | null }
export type TableRow = {
  key: TreasuryMaturityKey
  label: string
  latest: number | null
  cells: TableCell[]
}

export function tableRows(
  latest: TreasuryCurvePoint | null,
  compares: TreasuryCurvePoint[]
): TableRow[] {
  return MATURITIES.map((m) => {
    const latestValue = latest?.rates[m.key] ?? null
    return {
      key: m.key,
      label: m.label,
      latest: latestValue,
      cells: compares.map((c) => {
        const value = c.rates[m.key] ?? null
        // 差は「最新 − その比較日」。片側が欠測なら計算しない。
        return { value, delta: value == null || latestValue == null ? null : latestValue - value }
      })
    }
  })
}

// 利回りは全満期が同じ単位・同じ桁数なので 2 桁固定にする。統計指標の一律 toLocaleString
// （最大 2 桁）だと 4.3 と 4.31 が桁で揃わず、10bp の差が読み取りにくい。null 満期は '—'。
export const formatRate = (v: number | null): string => (v == null ? '—' : v.toFixed(2))

// 差も同じ % ポイント・2 桁固定に符号を付ける。bp 表記に変換しない — 断面図の縦軸・ツールチップ・
// 表で単位が 2 種類になると、0.12 と 12 のどちらが何なのか都度読み替えることになる。
export const formatRateDelta = (v: number | null): string =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`

// 満期はカテゴリではなく順序尺度なので、短期＝寒色 → 長期＝暖色のランプにすると凡例を見なくても
// 長短が分かる。明度を固定するのでライト/ダーク両方で読める（ローソク足の up/down 色と同じ判断）。
export const maturityColor = (index: number): string => `hsl(${210 - index * 15} 70% 55%)`
```

- [ ] **Step 4: テストと型チェックを実行する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npx vitest run tests/renderer/treasuryCurve.test.ts && npm run typecheck
```

Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/010230240/work/vibing-view"
git add src/renderer/lib/treasuryCurve.ts tests/renderer/treasuryCurve.test.ts
git commit -m "feat(yield-curve): 断面・系列・表・書式の純関数"
```

---

### Task 8: 断面（SVG）と推移（lightweight-charts）の 2 コンポーネント

**Files:**
- Create: `src/renderer/components/YieldCurveChart.tsx`
- Create: `src/renderer/components/TreasuryHistoryChart.tsx`

**Interfaces:**
- Consumes: `MATURITIES`（Task 2）、`curveSegments` / `formatRate` / `LinePoint`（Task 7）、`chartThemeOptions`（既存 `@/lib/chartTheme`）
- Produces:
  - `YieldCurveChart({ curves }: { curves: TreasuryCurvePoint[] })` — `curves[0]` が基準（最新）、以降が比較日（新しい順）
  - `HistorySeries = { id: string; color: string; points: LinePoint[]; dashed?: boolean; width?: 1 | 2 }`
  - `TreasuryHistoryChart({ series }: { series: HistorySeries[] })`

テストは書かない。座標計算は Task 7 の純関数側でテストし、`<svg>` の DOM と lightweight-charts の描画は見ない（設計書「テストしないもの」、既存の `Chart.tsx` / `EconomicIndicatorChart.tsx` と同じ扱い）。

- [ ] **Step 1: 断面図を実装する**

`src/renderer/components/YieldCurveChart.tsx` を新規作成する。

```tsx
// src/renderer/components/YieldCurveChart.tsx
import React from 'react'
import { MATURITIES } from '@shared/treasury'
import { curveSegments, formatRate } from '@/lib/treasuryCurve'
import type { TreasuryCurvePoint } from '@shared/types'

// 断面は自前 SVG。横軸が満期（等間隔、YC-07）なので lightweight-charts の時間軸に乗らない。
// 点は 12 個 × 最大 4 本なので DOM に直接置いても軽い。
// ponytail: viewBox 固定 + preserveAspectRatio 既定（meet）。コンテナを実測して座標を作らないので
// 極端に横長な窓では上下に余白が出る。気になったら ResizeObserver で幅を取る。
const W = 720
const H = 260
const PAD = { top: 14, right: 16, bottom: 26, left: 40 }

// 新しい順に実線 → 破線 → 点線 → 一点鎖線。色は --primary 1 色で不透明度を落とす（YC-06:
// 比較日は「最新 vs より古い」の順序尺度なので、カテゴリカルな色分けより順序が読める。
// テーマトークンを増やさずに済む）。
const DASHES = ['', '6 4', '2 3', '9 3 2 3']
const OPACITIES = [1, 0.75, 0.55, 0.4]

const TICKS = 4

export function YieldCurveChart({ curves }: { curves: TreasuryCurvePoint[] }): React.JSX.Element {
  const values = curves.flatMap((c) =>
    MATURITIES.map((m) => c.rates[m.key]).filter((v): v is number => v != null)
  )
  // 上下 0.1pt の余白。1 点しか無い（lo === hi）ときも高さが 0 にならない。
  const min = (values.length > 0 ? Math.min(...values) : 0) - 0.1
  const max = (values.length > 0 ? Math.max(...values) : 1) + 0.1

  const x = (i: number): number => PAD.left + (i * (W - PAD.left - PAD.right)) / (MATURITIES.length - 1)
  const y = (v: number): number => PAD.top + ((max - v) * (H - PAD.top - PAD.bottom)) / (max - min)
  const ticks = Array.from({ length: TICKS }, (_, i) => min + ((max - min) * i) / (TICKS - 1))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label="Treasury yield curve">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
          <text x={PAD.left - 5} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground text-[9px]">
            {formatRate(t)}
          </text>
        </g>
      ))}
      {MATURITIES.map((m, i) => (
        <text key={m.key} x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[9px]">
          {m.label}
        </text>
      ))}
      {curves.map((c, ci) => {
        const segments = curveSegments(c)
        const opacity = OPACITIES[ci] ?? 0.3
        return (
          <g key={c.date}>
            {segments.map((seg, si) => (
              <polyline
                key={si}
                points={seg.map((d) => `${x(d.index)},${y(d.value)}`).join(' ')}
                className="stroke-primary"
                fill="none"
                strokeWidth={2}
                strokeOpacity={opacity}
                strokeDasharray={DASHES[ci] ?? ''}
                strokeLinecap="round"
              />
            ))}
            {/* 点ごとの <title> = ブラウザネイティブのツールチップ。クロスヘアや hover 状態は
                入れない — 点が 12 個しかなく、正確な値は下の表で読める。 */}
            {segments.flat().map((d) => (
              <circle key={d.key} cx={x(d.index)} cy={y(d.value)} r={2.5} className="fill-primary" fillOpacity={opacity}>
                <title>{`${c.date} ${d.label} ${formatRate(d.value)}%`}</title>
              </circle>
            ))}
          </g>
        )
      })}
    </svg>
  )
}
```

- [ ] **Step 2: 推移チャートを実装する**

`src/renderer/components/TreasuryHistoryChart.tsx` を新規作成する。

```tsx
// src/renderer/components/TreasuryHistoryChart.tsx
import React, { useEffect, useRef } from 'react'
import {
  createChart, CrosshairMode, LineSeries, LineStyle, type IChartApi, type ISeriesApi
} from 'lightweight-charts'
import { chartThemeOptions } from '@/lib/chartTheme'
import type { LinePoint } from '@/lib/treasuryCurve'

export type HistorySeries = {
  id: string
  color: string
  points: LinePoint[]
  dashed?: boolean
  width?: 1 | 2
}

// 満期とスプレッドを 1 枚に重ねる（単位が全部 % なので同一の価格軸で成立し、縦を 2 分割しなくて
// 済む、YC-07）。time は 'YYYY-MM-DD' をそのまま渡せる（business-day 形式）。
// 系列の集合はトグルで変わるので、id → series の Map を持って差分だけ足し引きする。チャートを
// 作り直すとトグルのたびに表示範囲がリセットされる。
export function TreasuryHistoryChart({ series }: { series: HistorySeries[] }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map())
  // 表示期間が変わったときだけ fitContent する（トグルでは range を触らない）。
  const spanRef = useRef('')

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      autoSize: true,
      ...chartThemeOptions(),
      // Normal: 値のある点に吸着させず任意の位置で読める（EconomicIndicatorChart と同じ）
      crosshair: { mode: CrosshairMode.Normal }
    })
    chartRef.current = chart
    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current.clear()
      spanRef.current = ''
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const map = seriesRef.current

    const wanted = new Set(series.map((s) => s.id))
    for (const [id, api] of map) {
      if (!wanted.has(id)) {
        chart.removeSeries(api)
        map.delete(id)
      }
    }

    for (const s of series) {
      let api = map.get(s.id)
      if (!api) {
        api = chart.addSeries(LineSeries, {})
        map.set(s.id, api)
      }
      api.applyOptions({
        color: s.color,
        lineWidth: s.width ?? 2,
        lineStyle: s.dashed ? LineStyle.Dashed : LineStyle.Solid,
        // 右端のラベルと価格線は 3〜4 本重なると読めなくなる。値は下の表で読む。
        priceLineVisible: false,
        lastValueVisible: false
      })
      api.setData(s.points)
    }

    const first = series[0]?.points
    const span = first ? `${first[0]?.time ?? ''}|${first[first.length - 1]?.time ?? ''}` : ''
    if (span !== spanRef.current) {
      spanRef.current = span
      chart.timeScale().fitContent()
    }
  }, [series])

  return <div ref={containerRef} className="h-full w-full" />
}
```

- [ ] **Step 3: 型チェックと全テストを実行する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npm run typecheck && npm test
```

Expected: エラーなし、既存テストは全 PASS

> `addSeries(LineSeries, …)` と `lineWidth` の型は導入済みの lightweight-charts 5.2 に合わせている（`EconomicIndicatorChart.tsx:27` が同じ形）。`lineWidth` で型エラーが出る場合は `s.width ?? 2` に `as 1 | 2` を付ける（`LineWidth` は数値リテラルの union）。

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/010230240/work/vibing-view"
git add src/renderer/components/YieldCurveChart.tsx src/renderer/components/TreasuryHistoryChart.tsx
git commit -m "feat(yield-curve): 断面 SVG と推移チャートのコンポーネント"
```

---

### Task 9: YieldCurveWindow と入口、手動確認

**Files:**
- Create: `src/renderer/components/YieldCurveWindow.tsx`
- Modify: `src/renderer/api.ts`（`qk` に 1 行）
- Modify: `src/renderer/main.tsx`（ハッシュ分岐に 1 本）
- Modify: `src/renderer/App.tsx`（ヘッダーにボタン 1 つ）

**Interfaces:**
- Consumes: `api.yieldCurve.*`（Task 6）、`MATURITIES` / `SPREADS` / `TREASURY_YEARS`（Task 2）、`treasuryCurve.ts` の純関数（Task 7）、`YieldCurveChart` / `TreasuryHistoryChart`（Task 8）
- Produces: `YieldCurveWindow()`、`qk.treasuryCurves(years)`

- [ ] **Step 1: `qk` に query key を足す**

`src/renderer/api.ts` の `economicIndicator` の行の後に追記する（前の行の末尾にカンマを足す）。

```ts
  // years は key に入れる。地平ごとに取得の深さが違うので（1Y = 5 窓、5Y = 22 窓）、同じ key を
  // 使い回すと 5Y に広げても再取得が走らない。狭める方向（5Y → 1Y）は key が変わっても service が
  // 「カバー済み・TTL 内」と判定してネットワークに出ない。
  treasuryCurves: (years: number) => ['treasury-curves', years] as const
```

- [ ] **Step 2: ウィンドウを実装する**

`src/renderer/components/YieldCurveWindow.tsx` を新規作成する。

```tsx
// src/renderer/components/YieldCurveWindow.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { RefreshCw, X } from 'lucide-react'
import { api, qk } from '@/api'
import { cn } from '@/lib/utils'
import { applyTheme } from '@/lib/theme'
import { Button } from './ui/button'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { YieldCurveChart } from './YieldCurveChart'
import { TreasuryHistoryChart, type HistorySeries } from './TreasuryHistoryChart'
import { MATURITIES, SPREADS, TREASURY_YEARS } from '@shared/treasury'
import {
  curveAt, formatRate, formatRateDelta, maturityColor, seriesFor, sliceRange, snapToDate,
  spreadSeries, tableRows, zeroLineSeries
} from '@/lib/treasuryCurve'
import type { TreasuryCurves, TreasuryMaturityKey, TreasuryYears } from '@shared/types'

// 基準（最新）と合わせて 4 本。それ以上重ねると断面図が読めない（YC-06）。
const MAX_COMPARE = 3
// 初回に開いた画面で逆イールドが読める組み合わせ（YC-07）。
const DEFAULT_MATURITIES: TreasuryMaturityKey[] = ['month3', 'year2', 'year10']
const DEFAULT_SPREADS = ['10y2y']

// 統計指標窓と同じ分岐。IPC 越しの message から判定するので新しい型は増やさない。
function errorMessage(err: unknown): string {
  const m = String((err as Error)?.message ?? '')
  if (/NO_API_KEY/.test(m)) return 'Set your FMP API key in Settings.'
  if (/FMP HTTP 401/.test(m)) return 'Your FMP API key was rejected. Check it in Settings.'
  if (/FMP HTTP 429/.test(m)) return 'FMP request limit reached. Wait a moment and try again.'
  // parseOrThrowHttpError はスキーマ不一致もすべて FmpHttpError(200) にするので、この枝には
  // プラン拒否（200 + Error Message）と FMP 側のフィールド名変更の両方が入る。どちらでも成り立つ
  // 文言にする（意味コード化は YC-12）。
  if (/FMP HTTP (200|40[0-9])/.test(m)) {
    return 'Treasury rates aren’t available on your current FMP plan, or FMP returned an unexpected response.'
  }
  return 'Couldn’t load treasury rates. Check your connection.'
}

export function YieldCurveWindow(): React.JSX.Element {
  const [years, setYears] = useState<TreasuryYears>(TREASURY_YEARS[0])
  const [compareDates, setCompareDates] = useState<string[]>([])
  const [maturities, setMaturities] = useState<TreasuryMaturityKey[]>(DEFAULT_MATURITIES)
  const [spreads, setSpreads] = useState<string[]>(DEFAULT_SPREADS)
  // <input type="date"> を選び直せるように、追加したら空に戻す。
  const [picked, setPicked] = useState('')
  const qc = useQueryClient()

  // 折れ線と断面がテーマ CSS 変数から色を読むので、他の別ウィンドウと同じくテーマを適用する。
  useEffect(() => { void api.settings.getTheme().then(applyTheme) }, [])
  useEffect(() => { document.title = 'Yield Curve' }, [])

  const q = useQuery<TreasuryCurves>({
    queryKey: qk.treasuryCurves(years),
    queryFn: () => api.yieldCurve.getCurves({ years }),
    // 地平を広げる（1Y → 5Y）と query key が変わり、素の TanStack なら新 key に data が無いので
    // isLoading に戻って下の Fetching… ヒントが出せない。前の地平の画面を残しつつ isLoading を
    // 落とすことで、バックフィル中のヒントを表示可能にする。
    placeholderData: (prev) => prev
  })
  const reload = useMutation({
    mutationFn: () => api.yieldCurve.getCurves({ years, force: true }),
    onSuccess: (data) => qc.setQueryData(qk.treasuryCurves(years), data)
  })

  // 表示していない地平の snapshot は staleTime: Infinity で永久に残る。5Y を取ったあと 1Y に
  // 戻すと古い snapshot が出続け、日付ピッカーの下限もその coveredFrom に縛られたままになる。
  // invalidate 後の再取得は TTL 内ならネットワークに出ない（getCurves が行を返して終わる）。
  useEffect(() => {
    if (!q.data) return
    for (const y of TREASURY_YEARS) {
      if (y !== years) void qc.invalidateQueries({ queryKey: qk.treasuryCurves(y) })
    }
  }, [q.data, years, qc])

  const data = q.data
  // placeholder が無い＝表示できるものがない。
  const loading = !q.isError && !data
  const all = data?.points ?? []
  const latest = all.length > 0 ? all[all.length - 1] : null
  const visible = useMemo(() => sliceRange(all, years), [all, years])

  // 断面はキャッシュ済みの全 points から引くので、下段のスライス（1Y）より古い比較日でも出せる
  // （YC-06: 地平を狭めてもチップは消さない）。新しい順が実線 → 破線 → … の順序と一致する。
  const compares = useMemo(
    () => [...compareDates].sort((a, b) => b.localeCompare(a)).flatMap((d) => curveAt(all, d) ?? []),
    [compareDates, all]
  )
  const curves = useMemo(() => (latest ? [latest, ...compares] : []), [latest, compares])
  const rows = useMemo(() => tableRows(latest, compares), [latest, compares])

  const history = useMemo<HistorySeries[]>(() => [
    ...maturities.map((key) => ({
      id: key,
      color: maturityColor(MATURITIES.findIndex((m) => m.key === key)),
      points: seriesFor(visible, key)
    })),
    // スプレッドは利回りとは別の量なので、満期のランプの外（muted の破線）に置く。
    ...spreads.map((key) => ({
      id: key,
      color: 'hsl(var(--muted-foreground))',
      dashed: true,
      points: spreadSeries(visible, key)
    })),
    ...(spreads.length > 0
      ? [{ id: '__zero', color: 'hsl(var(--border))', width: 1 as const, points: zeroLineSeries(visible) }]
      : [])
  ], [maturities, spreads, visible])

  const addCompare = (date: string): void => {
    if (!date) return
    // 選んだ日にデータが無ければ、その日以前で最も近い営業日にスナップする（土日祝・公表を
    // 飛ばした日）。チップにはスナップ後の実際の日付を出す（黙って別の日を見せない）。
    const snapped = snapToDate(all, date)
    if (!snapped || snapped === latest?.date) return
    setCompareDates((prev) =>
      prev.includes(snapped) || prev.length >= MAX_COMPARE ? prev : [...prev, snapped]
    )
  }

  const asOfLabel = data
    ? `As of ${format(data.fetchedAt * 1000, 'yyyy-MM-dd HH:mm')}${data.stale ? ' (update failed)' : ''} · from ${data.coveredFrom}`
    : ''

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold">Yield Curve</span>

          {/* 範囲は表示スライスと取得地平を兼ねる。1Y → 5Y は 22 リクエストを直列に取るので
              十数秒かかる（下の Fetching… が出ているうち）。 */}
          <ToggleGroup
            type="single"
            value={String(years)}
            onValueChange={(v) => { if (v) setYears(Number(v) as TreasuryYears) }}
          >
            {TREASURY_YEARS.map((y) => (
              <ToggleGroupItem key={y} value={String(y)} size="sm" aria-label={`${y}Y`}>{y}Y</ToggleGroupItem>
            ))}
          </ToggleGroup>

          <span className="text-xs text-muted-foreground">Compare:</span>
          {compareDates.map((d) => (
            <span key={d} className="flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs tabular-nums">
              {d}
              <button
                type="button"
                aria-label={`Remove ${d}`}
                onClick={() => setCompareDates((prev) => prev.filter((x) => x !== d))}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          {/* ネイティブのピッカー（依存を増やさない）。min/max をキャッシュ範囲に縛る限り、
              追加フェッチも「まだ取得していない日」の分岐も発生しない（YC-06）。 */}
          <input
            type="date"
            value={picked}
            min={data?.coveredFrom}
            max={latest?.date}
            disabled={!latest || compareDates.length >= MAX_COMPARE}
            onChange={(e) => { setPicked(''); addCompare(e.target.value) }}
            aria-label="Add comparison date"
            className="h-7 rounded-md border border-border bg-background px-2 text-xs"
          />

          <span className="ml-auto text-xs text-muted-foreground">{asOfLabel}</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => reload.mutate()}
            disabled={reload.isPending || q.isFetching}
            aria-label="Reload treasury rates"
            title="Reload treasury rates"
          >
            <RefreshCw className={cn('size-4', reload.isPending && 'animate-spin')} />
          </Button>
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>US Treasury constant maturity · %</span>
          {/* 地平を広げる操作は 22 窓を直列に取るので待たされる。無言で固まらせない。 */}
          {q.isFetching && !loading && !q.isError && <span>Fetching {years}Y history…</span>}
        </div>
      </div>

      {loading && <div className="p-3 text-sm text-muted-foreground">Loading treasury rates…</div>}
      {q.isError && <div className="p-3 text-center text-sm text-muted-foreground">{errorMessage(q.error)}</div>}
      {!loading && !q.isError && all.length === 0 && (
        <div className="p-3 text-center text-sm text-muted-foreground">No treasury data available.</div>
      )}

      {!loading && !q.isError && all.length > 0 && (
        <>
          <div className="min-h-0 flex-1 px-2 py-1">
            <YieldCurveChart curves={curves} />
          </div>

          {/* 満期 12 個とスプレッド 2 個を同じトグル群に並べ、選んだものを 1 枚に重ねる（YC-07）。
              色の丸がそのまま凡例になる。 */}
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-1.5">
            <ToggleGroup
              type="multiple"
              value={maturities}
              onValueChange={(v) => setMaturities(v as TreasuryMaturityKey[])}
              className="flex-wrap justify-start"
            >
              {MATURITIES.map((m, i) => (
                <ToggleGroupItem key={m.key} value={m.key} size="sm" className="gap-1 text-[11px]">
                  <span className="size-2 rounded-full" style={{ background: maturityColor(i) }} />
                  {m.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <ToggleGroup
              type="multiple"
              value={spreads}
              onValueChange={setSpreads}
              className="flex-wrap justify-start border-l border-border pl-2"
            >
              {SPREADS.map((s) => (
                <ToggleGroupItem key={s.key} value={s.key} size="sm" className="text-[11px]">
                  {s.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="min-h-0 flex-1">
            <TreasuryHistoryChart series={history} />
          </div>

          <div className="max-h-[30%] shrink-0 overflow-auto border-t border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 text-left font-semibold">Maturity</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Latest</th>
                  {compares.map((c) => (
                    <React.Fragment key={c.date}>
                      <th className="px-3 py-1.5 text-right font-semibold tabular-nums">{c.date}</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Δ</th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-border/50">
                    <td className="px-3 py-1">{r.label}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{formatRate(r.latest)}</td>
                    {r.cells.map((cell, i) => (
                      <React.Fragment key={compares[i].date}>
                        <td className="px-3 py-1 text-right tabular-nums">{formatRate(cell.value)}</td>
                        <td className="px-3 py-1 text-right tabular-nums">{formatRateDelta(cell.delta)}</td>
                      </React.Fragment>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: `main.tsx` のハッシュ分岐に足す**

import を追加する。

```ts
import { YieldCurveWindow } from './components/YieldCurveWindow'
```

`economicIndicator` の宣言の下に追記する。

```ts
// イールドカーブ窓も 1 枚だけ。比較日もトグルも renderer の使い捨て state なので、ハッシュには
// 何も載せない（有無だけ見る）。
const isYieldCurve = parseHash('yieldCurve', window.location.hash) !== null
```

三項演算子のネストに 1 段足す（`economicIndicator` の分岐の後）。

```tsx
              : economicIndicator !== null
                ? <EconomicIndicatorWindow initialName={economicIndicator} />
                : isYieldCurve
                  ? <YieldCurveWindow />
                  : <App />}
```

- [ ] **Step 4: ヘッダーにボタンを足す**

`src/renderer/App.tsx` の 2 行目の lucide import に `TrendingUp` を追加する。

```ts
import { CalendarDays, ChartLine, PanelLeftClose, PanelLeftOpen, RefreshCw, Timer, TimerOff, TrendingUp } from 'lucide-react'
```

`ChartLine` ボタンの `</Tooltip>`（`api.economicIndicator.openWindow()` を呼んでいるブロックの直後）に、同じ形のボタンを追加する。

```tsx
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => void api.yieldCurve.openWindow()}
                  aria-label="Yield curve"
                  title="Yield curve"
                >
                  <TrendingUp className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Yield curve</TooltipContent>
            </Tooltip>
```

- [ ] **Step 5: 型チェックと全テストを実行する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npm run typecheck && npm test
```

Expected: エラーなし、全 PASS

- [ ] **Step 6: 手動確認**

```bash
cd "C:/Users/010230240/work/vibing-view" && npm run dev
```

**FMP API キーが Settings に設定されている必要がある。** DevTools の Network でリクエスト数を数えながら順に確認する。

1. ヘッダーの `TrendingUp` アイコン → イールドカーブ窓が開く。既定 `1Y` で、**5 リクエスト**のあと断面（実線 1 本）と下段の折れ線（3M / 2Y / 10Y ＋ 10Y-2Y の破線 ＋ ゼロライン）と表が出る
2. `As of …` の右に `from 2025-07-30` のようなカバー下限が出る
3. `Compare:` の日付ピッカーで**土曜日**を選ぶ → チップにはその前の金曜日（スナップ後の実際の日付）が出る。断面に破線が 1 本増え、表に「その日 + Δ」の 2 列が増える
4. さらに 2 つ日付を追加 → 合計 3 チップで止まり、ピッカーが disabled になる。断面は実線 + 破線 + 点線 + 一点鎖線の 4 本
5. 同じ日をもう一度選ぼうとしても増えない。チップの `×` で消える
6. **ここまでで追加の API リクエストが 0 件**であること（比較日はキャッシュ範囲内しか選べない）
7. 満期トグルで `30Y` を ON → 折れ線が 1 本増える。**リクエストは 0 件**
8. スプレッドを全部 OFF → ゼロラインが消える。1 つ ON に戻す → 戻る
9. `5Y` に切り替える → `Fetching 5Y history…` が出て、**十数秒かけて 18 リクエスト**（1Y ぶんは既にキャッシュ済みなので 22 本ではない）。下段の折れ線が 5 年ぶりに伸び、日付ピッカーの `min` が 5 年前まで広がる
10. `1Y` に戻す → **即座**に切り替わり、**追加の API リクエストが 0 件**。ピッカーの `min` は**5 年前のまま**（`coveredFrom` は狭まらない）。3 で追加したチップも残っている
11. 3 年前の日付を比較に追加 → 下段は 1Y スライスのままだが、**断面には 3 年前のカーブが出る**
12. リロードボタン → `As of` の時刻が更新される（1 リクエスト）。**5 年ぶんの履歴とピッカーの下限は残る**（`force` は TTL を無視するだけ）
13. 窓を閉じてもう一度開く → **1 リクエストも出ない**（TTL 12h 内）
14. アプリを再起動して開く → **1 リクエストも出ない**（永続キャッシュ）
15. Settings でテーマを Light に切り替えてから窓を開き直す → 断面の軸・グリッド・線とチャートの背景が明るいテーマで読める
16. Settings の API キーを空にする（or 無効な値にする）→ 窓を開くと `Set your FMP API key in Settings.` / `Your FMP API key was rejected…` が出る。**22 回の空撃ちが起きないこと**（Network が 1 件で止まる = YC-08 のラッチ）

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/010230240/work/vibing-view"
git add src/renderer/components/YieldCurveWindow.tsx src/renderer/api.ts src/renderer/main.tsx src/renderer/App.tsx
git commit -m "feat(yield-curve): イールドカーブ窓（断面の重ね描き＋推移＋表）とヘッダーの入口"
```

---

## 実装後の確認

すべてのタスクが終わったら、設計書の各項目に対応する実装があるか確認する。

| 設計項目 | 実装 |
|---|---|
| YC-01 1 リクエストで 12 満期 | Task 2（`getTreasuryRates` は 1 窓 1 リクエスト） |
| YC-02 窓上限を定数に依存させない | Task 1（実測）、Task 4（`walk` が返却最古に追従、`STEP_DAYS` は最適化のみ） |
| YC-03 `null` 満期を落とさない | Task 2（schema の `num()`・行を落とさないマッピング・`isUtcDay`）、Task 7（`curveSegments` / `seriesFor` の whitespace / `spreadSeries`） |
| YC-04 `economic_indicators` に混ぜない | Task 3（別テーブル・別ストア） |
| YC-05 サービスを共通化しない | Task 4（空応答＝失敗、`force` は TTL 無視のみ） |
| YC-06 比較日の選択（上限 3・キャッシュ範囲・スナップ・重複禁止） | Task 7（`snapToDate` / `curveAt`）、Task 9（`MAX_COMPARE` / `min`-`max` / チップ） |
| YC-07 下段の重ね方・等間隔軸・ゼロライン | Task 7（`zeroLineSeries` / `maturityColor`）、Task 8（等間隔の `x()`）、Task 9（トグル群） |
| YC-08 プラン外の空撃ち対策 | Task 5（`treasuryOutOfPlan`、`apikey.set`/`clear` で解除） |
| YC-09 MCP ツール | 非スコープ（将来枠） |
| YC-10 断面のアニメーション | 非スコープ（将来枠） |
| YC-11 他国の国債 | Task 3（`id` 列） |
| YC-12 プロバイダ層の 2 件 | 非スコープ（`ProviderLike` に 1 メソッド追加・200 の文言で吸収） |
| TTL 12h は直近窓の取り直しにだけ掛かる | Task 4 |
| 書き込みは `date` キーの union・書く直前に読み直す | Task 4 |
| 途中で落ちたら 1 バイトも書かない（`stale` で返す） | Task 4 |
| 空応答も「落ちた」に含める | Task 4 |
| 地平を狭めても `covered_from` は狭めない | Task 4、Task 9（ピッカーの `min`） |
| TTL 更新の起点は `min(fetched_at, now)` の日 | Task 4 |
| リクエスト数 1Y = 5 / 5Y = 22 | Task 4（テストが固定クロックと `STEP_DAYS` から計算） |
| タイムゾーン問題は無い（`date` 文字列のまま） | Task 2（provider）、Task 8（`time: p.date`） |
| 満期レジストリ（`key`/`label`/`months`・スプレッド 2 本） | Task 2 |
| 窓は singleton、選択状態は永続化しない | Task 6（`openHashWindow`）、Task 9（renderer state） |
| 表は `Maturity | Latest` ＋ 比較日ごとに値と Δ | Task 7（`tableRows`）、Task 9 |
| 値は 2 桁固定、Δ は % ポイントで符号付き | Task 7（`formatRate` / `formatRateDelta`） |
| 0 件のとき / 地平を広げている間 | Task 9（`No treasury data available.` / `Fetching {years}Y history…`） |
| 非表示地平の query key を invalidate | Task 9 |
| エラー処理の分岐（200 は両義的な文言） | Task 9（`errorMessage`） |
