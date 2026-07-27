# 統計指標（`/economic-indicators`）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** FMP の `/stable/economic-indicators` から US マクロ指標の全履歴を取り、別ウィンドウで折れ線＋表として表示し、経済カレンダーの行クリックから飛べるようにする。

**Architecture:** `FmpProvider.getEconomicIndicator(name)` → `EconomicIndicatorService`（TTL 12h の read-through、指標ごとに全履歴を 1 行の blob）→ `core.economicIndicator.getSeries` → IPC → `EconomicIndicatorWindow`。表示範囲（1Y/5Y/10Y/Max）は取得済みデータのクライアント側スライスなので追加リクエストは発生しない。窓は singleton で、選択中の指標は main が持ち renderer がマウント時に pull する。

**Tech Stack:** TypeScript / React 19 / Electron 43 / better-sqlite3 + drizzle-orm / zod 3 / TanStack Query 5 / lightweight-charts 5 / Vitest 3 / date-fns 4

**設計書:** `docs/superpowers/specs/2026-07-27-economic-indicators-design.md`（EI-01〜EI-10 の番号はこの計画中で参照する）

## Global Constraints

- Vite は `^7` に固定（electron-vite@5 が Vite 8 を peer に持たない）。依存を追加しない — この機能に必要なライブラリはすべて導入済み。
- `better-sqlite3` は Electron の Node ABI にリビルドされている前提。`src/main/db/client.ts` の `getDb()` は遅延 `require` なので、**新しいストアモジュールでも `electron` / `better-sqlite3` を静的 import してはいけない**（Vitest が plain Node で読めなくなる）。
- SQLite = OHLCV / API キャッシュ、JSON（`settings.json`） = ユーザー設定。この機能は SQLite のみ使う（EI-03 により設定を保存しない）。
- API リクエストの節約が最優先。TTL は 12 時間（`43200` 秒）。表示範囲の切替でリクエストを発生させてはいけない。
- テストコマンドは `npm test`（`vitest run`）。型チェックは `npm run typecheck`。
- Vitest の alias は `@` → `src/renderer`、`@shared` → `src/shared`。`src/main` は相対パスで import する（既存テストに倣う）。
- コメントは日本語・英語どちらでもよいが、既存ファイルの言語に合わせる。`src/main/economic/` と `src/shared/economicIndicators.ts` は日本語（カレンダー実装と同じ）。
- 現在のブランチは `develop`。各タスクの最後にコミットする。

---

### Task 1: EI-01 — 実 API の実測と fixture 保存（ゲート）

このタスクは**人間の操作が必要**で、以降のすべてのタスクをブロックする。設計書は FMP のドキュメントを根拠にしているが実 API で検証していない。永続化コードを書く前に確定させる。

**Files:**
- Create: `tests/fixtures/fmp-economic-indicators.json`
- Create: `tests/fixtures/fmp-economic-indicators-denied.json`
- Modify: `docs/superpowers/specs/2026-07-27-economic-indicators-design.md`（実測と差があった箇所）

**Interfaces:**
- Consumes: なし
- Produces: 後続の全タスクが参照する fixture 2 本と、確定した `name` の一覧

- [ ] **Step 1: 実 API を叩いて全履歴が返るか確認する**

ユーザーに FMP API キーで以下を実行してもらう（`!` プレフィックスでこのセッションから実行できる）。`<KEY>` は本物のキーに置き換える。**キーそのものをコミットしないよう注意する。**

```bash
curl -s "https://financialmodelingprep.com/stable/economic-indicators?name=CPI&apikey=<KEY>" > /tmp/cpi.json
head -c 400 /tmp/cpi.json; echo; echo "rows: $(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/cpi.json','utf8')).length)")"
```

確認する 5 点（EI-01）:

1. レスポンスのフィールド。`{ name, date, value }` 以外に `unit` 等が付くか
2. `from`/`to` なしで全履歴が返るか（CPI は 1913 年以降の月次なので 1300 行以上あれば全履歴）。既定の窓で切られていたら Step 2 へ
3. `date` が `"2026-06-01"` の日付のみか（時刻が付いていたら設計の「タイムゾーン問題は無い」が崩れるので即報告）
4. `value` に `null` が含まれるか
5. 無料プランで通るか

- [ ] **Step 2: 全履歴が返らなかった場合のみ `from` を付けて再確認**

Step 1 で行数が明らかに少なかった（例: 直近数年ぶんだけ）場合のみ実行する。

```bash
curl -s "https://financialmodelingprep.com/stable/economic-indicators?name=CPI&from=1950-01-01&apikey=<KEY>" > /tmp/cpi2.json
node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/cpi2.json','utf8')).length)"
```

これでも全履歴が来ないなら**このタスクで止めて報告する**。「指標ごとに全履歴を 1 行」というキャッシュ方式の前提が崩れるので、設計のやり直しが必要になる。

- [ ] **Step 3: 受け付ける `name` の集合を確認する**

設計書の 23 本すべてを 1 本ずつ叩くのは API を無駄に使う。代表 5 本と、拒否されそうな長い名前 2 本だけ確認する。

```bash
for n in CPI unemploymentRate federalFunds GDP consumerSentiment 30YearFixedRateMortgageAverage smoothedUSRecessionProbabilities; do
  echo -n "$n: "
  curl -s "https://financialmodelingprep.com/stable/economic-indicators?name=$n&apikey=<KEY>" | head -c 120
  echo
done
```

7 本すべてが観測配列を返せば、残りの 16 本も同じ命名規則なので受け付けると判断する。1 本でもエラー body を返したら、その名前を設計書の表から外し、報告する。

- [ ] **Step 4: プラン拒否の status と body を記録する**

無効なキーで叩き、`classify()` が `'requires-plan'` に落とせる body 形状か確認する。

```bash
curl -s -o /tmp/denied.json -w "status: %{http_code}\n" "https://financialmodelingprep.com/stable/economic-indicators?name=CPI&apikey=INVALID_KEY_FOR_TESTING"
cat /tmp/denied.json
```

`status` と body を記録する。body を `tests/fixtures/fmp-economic-indicators-denied.json` として保存する。`{ "Error Message": "Invalid API KEY. ..." }` なら `src/main/capabilityClassifier.ts:25` の `/premium|exclusive|legacy|invalid api key/` に当たるので `classify` は `'requires-plan'` を返す。**当たらない文言だった場合は、その文言を報告する**（`capabilityClassifier.ts` の正規表現に足す判断が必要になる）。

- [ ] **Step 5: fixture を保存する**

`/tmp/cpi.json` の**先頭 30 観測だけ**を切り出して保存する。全履歴 1300 行を fixture にすると diff が読めない。

```bash
cd "C:/Users/010230240/work/vibing-view"
node -e "
const all = JSON.parse(require('fs').readFileSync('/tmp/cpi.json','utf8'));
require('fs').writeFileSync('tests/fixtures/fmp-economic-indicators.json', JSON.stringify(all.slice(0, 30), null, 2) + '\n');
console.log('saved', Math.min(30, all.length), 'of', all.length);
"
```

- [ ] **Step 6: 実測と設計書の差分を反映する**

Step 1〜4 で設計書と違った点があれば設計書を直す。具体的には:

- `unit` がレスポンスに含まれていた → 指標レジストリの `unit` 列を「API から取る」に変更する旨を追記
- `name` が 1 本でも拒否された → 23 件の表からその行を削除
- プラン拒否の文言が `classify` に当たらない → EI-04 の節にその文言と、`capabilityClassifier.ts` へ追加する必要があることを追記

差分が無ければ設計書は変更しない。

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/010230240/work/vibing-view"
git add tests/fixtures/fmp-economic-indicators.json tests/fixtures/fmp-economic-indicators-denied.json docs/superpowers/specs/2026-07-27-economic-indicators-design.md
git commit -m "test(economic-indicators): EI-01 実 API 実測の fixture を保存"
```

---

### Task 2: 型定義と FmpProvider

**Files:**
- Modify: `src/shared/types.ts`（末尾に追記）
- Modify: `src/main/providers/fmp.schema.ts`（末尾に追記）
- Modify: `src/main/providers/FmpProvider.ts`（末尾のクラス内に 1 メソッド追加）
- Test: `tests/main/providers/economicIndicator.test.ts`（新規）

**Interfaces:**
- Consumes: `tests/fixtures/fmp-economic-indicators.json`（Task 1）
- Produces:
  - `EconomicIndicatorPoint = { date: string; value: number }`
  - `EconomicIndicatorSeries = { name: string; points: EconomicIndicatorPoint[]; fetchedAt: number; stale?: boolean }`
  - `fmpEconomicIndicatorResponse`（zod schema）
  - `FmpProvider.getEconomicIndicator(name: string): Promise<EconomicIndicatorPoint[]>`

- [ ] **Step 1: 型を追加する**

`src/shared/types.ts` の末尾に追記する。

```ts
// 統計指標（/economic-indicators）。date は 'YYYY-MM-DD' の日付のみで、epoch に変換しない —
// API が時刻を返さないので、UTC/ET のどちらで解釈しても同じ日を指す（economic-calendar とは異なる）。
export type EconomicIndicatorPoint = { date: string; value: number }

// fetchedAt は返した points の取得時刻（データの古さ）。stale は「古い points を返した、更新は
// できなかった」— fetchedAt だけでは区別できない（CompanyInfo と同じ理由）。
export type EconomicIndicatorSeries = {
  name: string
  points: EconomicIndicatorPoint[] // date 昇順
  fetchedAt: number
  stale?: boolean
}
```

- [ ] **Step 2: zod schema を追加する**

`src/main/providers/fmp.schema.ts` の末尾（`fmpEconomicCalendarResponse` の後）に追記する。`num()` は同ファイル 79 行目で定義済みの `z.coerce.number().nullable().optional().catch(null)`。

```ts
// /stable/economic-indicators は 1 系列の観測を平坦な配列で返す。value は FRED の欠測で null に
// なりうるので num() で受け、FmpProvider が落とす。date は日付のみ（'2026-06-01'）。
export const fmpEconomicIndicatorResponse = z.array(z.object({
  name: z.string(),
  date: z.string(),
  value: num()
}).passthrough())
```

- [ ] **Step 3: 失敗するテストを書く**

`tests/main/providers/economicIndicator.test.ts` を新規作成する。

```ts
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { FmpProvider, FmpHttpError } from '../../../src/main/providers/FmpProvider'

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(`tests/fixtures/${name}.json`), 'utf8'))

const provider = (httpGetJson: ReturnType<typeof vi.fn>): FmpProvider =>
  new FmpProvider({ apiKey: 'KEY', httpGetJson })

describe('FmpProvider.getEconomicIndicator', () => {
  it('parses the fixture into date-ascending points without epoch conversion', async () => {
    const httpGetJson = vi.fn(async () => fixture('fmp-economic-indicators'))
    const points = await provider(httpGetJson).getEconomicIndicator('CPI')

    expect(points.length).toBeGreaterThan(0)
    for (const p of points) {
      expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(typeof p.value).toBe('number')
    }
    const dates = points.map((p) => p.date)
    expect([...dates].sort()).toEqual(dates) // 昇順
  })

  it('requests the name-scoped endpoint with no from/to (全履歴を 1 リクエストで)', async () => {
    const httpGetJson = vi.fn(async () => [])
    await provider(httpGetJson).getEconomicIndicator('unemploymentRate')
    const url = httpGetJson.mock.calls[0][0] as string
    expect(url).toContain('/economic-indicators?name=unemploymentRate')
    expect(url).not.toContain('from=')
    expect(url).not.toContain('to=')
  })

  it('drops observations whose value is null (FRED の欠測)', async () => {
    const httpGetJson = vi.fn(async () => [
      { name: 'CPI', date: '2026-04-01', value: 320.5 },
      { name: 'CPI', date: '2026-05-01', value: null },
      { name: 'CPI', date: '2026-06-01', value: 322.1 }
    ])
    const points = await provider(httpGetJson).getEconomicIndicator('CPI')
    expect(points).toEqual([
      { date: '2026-04-01', value: 320.5 },
      { date: '2026-06-01', value: 322.1 }
    ])
  })

  it('drops observations whose date is not YYYY-MM-DD (キーが壊れるので通さない)', async () => {
    const httpGetJson = vi.fn(async () => [
      { name: 'CPI', date: '2026-6-1', value: 1 },
      { name: 'CPI', date: '2026-06-01', value: 2 }
    ])
    const points = await provider(httpGetJson).getEconomicIndicator('CPI')
    expect(points).toEqual([{ date: '2026-06-01', value: 2 }])
  })

  it('sorts an out-of-order response ascending', async () => {
    const httpGetJson = vi.fn(async () => [
      { name: 'CPI', date: '2026-06-01', value: 3 },
      { name: 'CPI', date: '2026-04-01', value: 1 },
      { name: 'CPI', date: '2026-05-01', value: 2 }
    ])
    const points = await provider(httpGetJson).getEconomicIndicator('CPI')
    expect(points.map((p) => p.value)).toEqual([1, 2, 3])
  })

  it('wraps an error payload as FmpHttpError(200)', async () => {
    const httpGetJson = vi.fn(async () => fixture('fmp-error'))
    await expect(provider(httpGetJson).getEconomicIndicator('CPI')).rejects.toBeInstanceOf(FmpHttpError)
    await expect(provider(httpGetJson).getEconomicIndicator('CPI')).rejects.toMatchObject({ status: 200 })
  })

  it('url-encodes the name', async () => {
    const httpGetJson = vi.fn(async () => [])
    await provider(httpGetJson).getEconomicIndicator('3MonthOr90DayRatesAndYieldsCertificatesOfDeposit')
    expect(httpGetJson.mock.calls[0][0]).toContain('name=3MonthOr90DayRatesAndYieldsCertificatesOfDeposit')
  })
})
```

- [ ] **Step 4: テストを実行して失敗を確認する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npx vitest run tests/main/providers/economicIndicator.test.ts
```

Expected: FAIL — `getEconomicIndicator is not a function`

- [ ] **Step 5: provider にメソッドを実装する**

`src/main/providers/FmpProvider.ts` の `getEconomicCalendar` の直後（クラスの閉じ括弧の前）に追記する。`fmpEconomicIndicatorResponse` を同ファイル冒頭の `fmp.schema` からの import に追加し、`EconomicIndicatorPoint` を `@shared/types` の type import に追加する。

```ts
  // /economic-indicators は 1 系列の全履歴を 1 リクエストで返す（from/to を付けない — EI-01 で確認済み）。
  // date は 'YYYY-MM-DD' の日付のみなので epoch に変換しない。value が null の観測（FRED の欠測）と
  // 形式が違う date は落とす: 前者は折れ線と Δ 計算が null を持ち回ることになり、後者は
  // economic_indicators の blob に読めない日付が混ざる。
  async getEconomicIndicator(name: string): Promise<EconomicIndicatorPoint[]> {
    const url = `${BASE}/economic-indicators?name=${encodeURIComponent(name)}&apikey=${this.apiKey}`
    const rows = this.parseOrThrowHttpError(fmpEconomicIndicatorResponse, await this.httpGetJson(url))
    return rows
      .flatMap((r) =>
        r.value == null || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) ? [] : [{ date: r.date, value: r.value }]
      )
      .sort((a, b) => a.date.localeCompare(b.date))
  }
```

- [ ] **Step 6: テストと型チェックを実行する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npx vitest run tests/main/providers/economicIndicator.test.ts && npm run typecheck
```

Expected: PASS（7 テスト）、typecheck エラーなし

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/010230240/work/vibing-view"
git add src/shared/types.ts src/main/providers/fmp.schema.ts src/main/providers/FmpProvider.ts tests/main/providers/economicIndicator.test.ts
git commit -m "feat(economic-indicators): FmpProvider.getEconomicIndicator と型"
```

---

### Task 3: `src/main/calendar/` → `src/main/economic/` へ移動

Task 5 が `src/main/economic/EconomicIndicatorService.ts` を作るので、その前にフォルダ名を実体に合わせる。純粋に機械的な移動で、振る舞いは変えない。

**Files:**
- Move: `src/main/calendar/EconomicCalendarService.ts` → `src/main/economic/EconomicCalendarService.ts`
- Move: `tests/main/calendar/EconomicCalendarService.test.ts` → `tests/main/economic/EconomicCalendarService.test.ts`
- Modify: `src/main/core.ts:23`（import パス）

**Interfaces:**
- Consumes: なし
- Produces: `src/main/economic/` ディレクトリ。Task 5 がここにファイルを追加する

- [ ] **Step 1: 移動前にテストが green であることを確認する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npx vitest run tests/main/calendar
```

Expected: PASS。ここが赤いなら移動と混ざるので、先に報告する。

- [ ] **Step 2: `git mv` で移動する**

```bash
cd "C:/Users/010230240/work/vibing-view"
mkdir -p src/main/economic tests/main/economic
git mv src/main/calendar/EconomicCalendarService.ts src/main/economic/EconomicCalendarService.ts
git mv tests/main/calendar/EconomicCalendarService.test.ts tests/main/economic/EconomicCalendarService.test.ts
```

- [ ] **Step 3: import パスを 2 箇所直す**

`src/main/core.ts` の 23 行目:

```ts
import { createEconomicCalendarService } from './economic/EconomicCalendarService'
```

`tests/main/economic/EconomicCalendarService.test.ts` の 2 行目（相対パスの深さは変わらないのでフォルダ名だけ差し替える）:

```ts
import { createEconomicCalendarService } from '../../../src/main/economic/EconomicCalendarService'
```

- [ ] **Step 4: 残った参照が無いか確認する**

```bash
cd "C:/Users/010230240/work/vibing-view" && grep -rn "main/calendar" src tests --include=*.ts --include=*.tsx
```

Expected: 出力なし

- [ ] **Step 5: 全テストと型チェックを実行する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npm test && npm run typecheck
```

Expected: 移動前と同じ結果（すべて PASS）

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/010230240/work/vibing-view"
git add -A src/main tests/main
git commit -m "refactor(economic): calendar/ を economic/ に改名（指標サービスと同居させる）"
```

---

### Task 4: `economic_indicators` テーブルとストア

**Files:**
- Modify: `src/main/db/schema.ts`（末尾に追記）
- Modify: `src/main/db/client.ts`（`CREATE TABLE IF NOT EXISTS` を 1 本追加）
- Create: `src/main/db/economicIndicatorStore.ts`

**Interfaces:**
- Consumes: `EconomicIndicatorPoint`（Task 2）
- Produces:
  - `EconomicIndicatorRow = { points: EconomicIndicatorPoint[]; fetchedAt: number }`
  - `getIndicator(name: string): EconomicIndicatorRow | null`
  - `upsertIndicator(name: string, points: EconomicIndicatorPoint[], fetchedAt: number): void`

テストは書かない。このモジュールは `companyProfileStore` と同型の純粋な blob 出し入れで、意味のあるテストには実 SQLite が必要になる（既存の `companyProfileStore` / `economicDayStore` にもテストは無く、ロジックは Service 側でテストされている）。

- [ ] **Step 1: drizzle のテーブル定義を追加する**

`src/main/db/schema.ts` の末尾（`economicDays` の後）に追記する。

```ts
// 統計指標のキャッシュ。name は FMP の系列名、data はその系列の全履歴（EconomicIndicatorPoint[]）の
// JSON blob。TTL 12h のみで判定し確定判定は持たない（EI-02: FRED 系列は改訂されるので、
// 過去分を固定すると古い速報値が残る）。
export const economicIndicators = sqliteTable('economic_indicators', {
  name: text('name').primaryKey(),
  data: text('data').notNull(),
  fetchedAt: integer('fetched_at').notNull()
})
```

- [ ] **Step 2: `CREATE TABLE` を追加する**

`src/main/db/client.ts` の `sqlite.exec` テンプレート内、`economic_days` の直後に追記する。

```sql
    CREATE TABLE IF NOT EXISTS economic_indicators (
      name TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at INTEGER NOT NULL
    );
```

- [ ] **Step 3: ストアを実装する**

`src/main/db/economicIndicatorStore.ts` を新規作成する。**`electron` / `better-sqlite3` を静的 import してはいけない** — `getDb()` の遅延 require 経由でのみ触る（`companyProfileStore.ts` と同じ形）。

```ts
import { eq } from 'drizzle-orm'
import type { EconomicIndicatorPoint } from '@shared/types'
import { getDb } from './client'
import { economicIndicators } from './schema'

// data 列は EconomicIndicatorPoint[] の JSON blob。TTL 判定と空応答ガードは
// EconomicIndicatorService の責務で、ここは純粋な blob の read/write のみ（companyProfileStore と同じ）。
export type EconomicIndicatorRow = { points: EconomicIndicatorPoint[]; fetchedAt: number }

export function getIndicator(name: string): EconomicIndicatorRow | null {
  const row = getDb().select().from(economicIndicators)
    .where(eq(economicIndicators.name, name)).get()
  return row ? { points: JSON.parse(row.data) as EconomicIndicatorPoint[], fetchedAt: row.fetchedAt } : null
}

export function upsertIndicator(name: string, points: EconomicIndicatorPoint[], fetchedAt: number): void {
  const blob = JSON.stringify(points)
  getDb().insert(economicIndicators)
    .values({ name, data: blob, fetchedAt })
    .onConflictDoUpdate({
      target: economicIndicators.name,
      set: { data: blob, fetchedAt }
    })
    .run()
}
```

- [ ] **Step 4: 型チェックを実行する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npm run typecheck && npm test
```

Expected: エラーなし、既存テストは全 PASS

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/010230240/work/vibing-view"
git add src/main/db/schema.ts src/main/db/client.ts src/main/db/economicIndicatorStore.ts
git commit -m "feat(economic-indicators): economic_indicators テーブルとストア"
```

---

### Task 5: EconomicIndicatorService（TTL 12h + EI-10 空応答ガード）

**Files:**
- Create: `src/main/economic/EconomicIndicatorService.ts`
- Test: `tests/main/economic/EconomicIndicatorService.test.ts`

**Interfaces:**
- Consumes: `EconomicIndicatorRow`（Task 4）、`EconomicIndicatorPoint` / `EconomicIndicatorSeries`（Task 2）
- Produces: `createEconomicIndicatorService(deps)` → `{ getSeries(name: string, opts?: { force?: boolean }): Promise<EconomicIndicatorSeries> }`。`deps` は `{ store: { getIndicator, upsertIndicator }, fetch: (name: string) => Promise<EconomicIndicatorPoint[]>, now?: () => number }`

- [ ] **Step 1: 失敗するテストを書く**

`tests/main/economic/EconomicIndicatorService.test.ts` を新規作成する。

```ts
import { describe, it, expect, vi } from 'vitest'
import { createEconomicIndicatorService } from '../../../src/main/economic/EconomicIndicatorService'
import type { EconomicIndicatorPoint } from '@shared/types'

const T0 = 1_800_000_000 // 任意の基準 epoch 秒
const TTL = 43200        // 12h

const PTS: EconomicIndicatorPoint[] = [
  { date: '2026-04-01', value: 320.5 },
  { date: '2026-05-01', value: 321.4 },
  { date: '2026-06-01', value: 322.1 }
]

type Row = { points: EconomicIndicatorPoint[]; fetchedAt: number }

function fakeStore(initial: Record<string, Row> = {}) {
  const rows = new Map(Object.entries(initial))
  return {
    rows,
    getIndicator: vi.fn((name: string) => rows.get(name) ?? null),
    upsertIndicator: vi.fn((name: string, points: EconomicIndicatorPoint[], fetchedAt: number) => {
      rows.set(name, { points, fetchedAt })
    })
  }
}

describe('EconomicIndicatorService.getSeries — TTL', () => {
  it('serves from cache inside the 12h TTL without touching the network', async () => {
    const store = fakeStore({ CPI: { points: PTS, fetchedAt: T0 } })
    const fetch = vi.fn()
    const svc = createEconomicIndicatorService({ store, fetch, now: () => T0 + TTL - 1 })

    const r = await svc.getSeries('CPI')
    expect(fetch).not.toHaveBeenCalled()
    expect(r).toEqual({ name: 'CPI', points: PTS, fetchedAt: T0 })
    expect(r.stale).toBeUndefined()
  })

  it('refetches and overwrites once the TTL has elapsed', async () => {
    const store = fakeStore({ CPI: { points: PTS, fetchedAt: T0 } })
    const next = [...PTS, { date: '2026-07-01', value: 323.0 }]
    const fetch = vi.fn(async () => next)
    const svc = createEconomicIndicatorService({ store, fetch, now: () => T0 + TTL })

    const r = await svc.getSeries('CPI')
    expect(fetch).toHaveBeenCalledExactlyOnceWith('CPI')
    expect(r).toEqual({ name: 'CPI', points: next, fetchedAt: T0 + TTL })
    expect(store.rows.get('CPI')).toEqual({ points: next, fetchedAt: T0 + TTL })
  })

  it('fetches when nothing is cached', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => PTS)
    const svc = createEconomicIndicatorService({ store, fetch, now: () => T0 })

    const r = await svc.getSeries('CPI')
    expect(r).toEqual({ name: 'CPI', points: PTS, fetchedAt: T0 })
    expect(store.upsertIndicator).toHaveBeenCalledExactlyOnceWith('CPI', PTS, T0)
  })

  it('keys the cache per indicator (CPI の行が GDP に効かない)', async () => {
    const store = fakeStore({ CPI: { points: PTS, fetchedAt: T0 } })
    const fetch = vi.fn(async () => [{ date: '2026-01-01', value: 30_000 }])
    const svc = createEconomicIndicatorService({ store, fetch, now: () => T0 })

    await svc.getSeries('GDP')
    expect(fetch).toHaveBeenCalledExactlyOnceWith('GDP')
  })
})

describe('EconomicIndicatorService.getSeries — force', () => {
  it('ignores a fresh row and refetches', async () => {
    const store = fakeStore({ CPI: { points: PTS, fetchedAt: T0 } })
    const next = [{ date: '2026-06-01', value: 999 }]
    const fetch = vi.fn(async () => next)
    const svc = createEconomicIndicatorService({ store, fetch, now: () => T0 + 1 })

    const r = await svc.getSeries('CPI', { force: true })
    expect(fetch).toHaveBeenCalledOnce()
    expect(r).toEqual({ name: 'CPI', points: next, fetchedAt: T0 + 1 })
  })
})

describe('EconomicIndicatorService.getSeries — フェッチ失敗', () => {
  it('returns the cached row with stale: true', async () => {
    const store = fakeStore({ CPI: { points: PTS, fetchedAt: T0 } })
    const fetch = vi.fn(async () => { throw new Error('down') })
    const svc = createEconomicIndicatorService({ store, fetch, now: () => T0 + TTL })

    const r = await svc.getSeries('CPI')
    expect(r).toEqual({ name: 'CPI', points: PTS, fetchedAt: T0, stale: true })
    expect(store.upsertIndicator).not.toHaveBeenCalled()
  })

  it('rethrows when nothing is cached', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => { throw new Error('down') })
    const svc = createEconomicIndicatorService({ store, fetch, now: () => T0 })

    await expect(svc.getSeries('CPI')).rejects.toThrow('down')
    expect(store.upsertIndicator).not.toHaveBeenCalled()
  })
})

describe('EconomicIndicatorService.getSeries — 空応答ガード (EI-10)', () => {
  it('does not overwrite a populated row with an empty response', async () => {
    const store = fakeStore({ CPI: { points: PTS, fetchedAt: T0 } })
    const fetch = vi.fn(async () => [])
    const svc = createEconomicIndicatorService({ store, fetch, now: () => T0 + TTL })

    const r = await svc.getSeries('CPI')
    // 返すのは古い points。fetchedAt は「そのデータがいつのものか」なので古い値のまま。
    expect(r).toEqual({ name: 'CPI', points: PTS, fetchedAt: T0, stale: true })
    // DB の fetchedAt は進める（次に開いたとき 12h は静かになる）。
    expect(store.rows.get('CPI')).toEqual({ points: PTS, fetchedAt: T0 + TTL })
  })

  it('goes quiet for the TTL after an empty response (API 節約)', async () => {
    const store = fakeStore({ CPI: { points: PTS, fetchedAt: T0 } })
    const fetch = vi.fn(async () => [])
    let now = T0 + TTL
    const svc = createEconomicIndicatorService({ store, fetch, now: () => now })

    await svc.getSeries('CPI')
    now += 1
    const second = await svc.getSeries('CPI')
    expect(fetch).toHaveBeenCalledOnce() // 2 度目はネットワークに出ない
    expect(second.points).toEqual(PTS)
  })

  it('writes an empty row when nothing was cached (毎回の空撃ちを防ぐ)', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => [])
    const svc = createEconomicIndicatorService({ store, fetch, now: () => T0 })

    const r = await svc.getSeries('retired')
    expect(r).toEqual({ name: 'retired', points: [], fetchedAt: T0 })
    expect(store.rows.get('retired')).toEqual({ points: [], fetchedAt: T0 })
  })

  it('does not let force overwrite a populated row with an empty response', async () => {
    const store = fakeStore({ CPI: { points: PTS, fetchedAt: T0 } })
    const fetch = vi.fn(async () => [])
    const svc = createEconomicIndicatorService({ store, fetch, now: () => T0 + 1 })

    const r = await svc.getSeries('CPI', { force: true })
    expect(r.points).toEqual(PTS)
    expect(r.stale).toBe(true)
    expect(store.rows.get('CPI')!.points).toEqual(PTS)
  })

  it('replaces an empty cached row with a non-empty response', async () => {
    const store = fakeStore({ CPI: { points: [], fetchedAt: T0 } })
    const fetch = vi.fn(async () => PTS)
    const svc = createEconomicIndicatorService({ store, fetch, now: () => T0 + TTL })

    const r = await svc.getSeries('CPI')
    expect(r).toEqual({ name: 'CPI', points: PTS, fetchedAt: T0 + TTL })
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npx vitest run tests/main/economic/EconomicIndicatorService.test.ts
```

Expected: FAIL — `Failed to resolve import ".../EconomicIndicatorService"`

- [ ] **Step 3: サービスを実装する**

`src/main/economic/EconomicIndicatorService.ts` を新規作成する。

```ts
import type { EconomicIndicatorPoint, EconomicIndicatorSeries } from '@shared/types'
// 型だけ（`import type` は消えるので sqlite は読み込まれない — core.ts と同じ扱い）。
import type { EconomicIndicatorRow } from '../db/economicIndicatorStore'

// TTL のみ。確定判定は持たない（EI-02）— FRED 系列は改訂されるので「過去は永続」が成立せず、
// 全履歴を取り直すことが改訂を吸収する。12h = 発表が月次/四半期なのでこれで足りる。
const TTL_SECONDS = 43200

export function createEconomicIndicatorService(deps: {
  store: {
    getIndicator(name: string): EconomicIndicatorRow | null
    upsertIndicator(name: string, points: EconomicIndicatorPoint[], fetchedAt: number): void
  }
  fetch: (name: string) => Promise<EconomicIndicatorPoint[]>
  now?: () => number // epoch seconds — injectable for tests
}) {
  const { store, fetch } = deps
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000))

  return {
    async getSeries(name: string, opts?: { force?: boolean }): Promise<EconomicIndicatorSeries> {
      const cached = store.getIndicator(name)
      if (!opts?.force && cached && now() - cached.fetchedAt < TTL_SECONDS) {
        return { name, points: cached.points, fetchedAt: cached.fetchedAt }
      }

      let points: EconomicIndicatorPoint[]
      try {
        points = await fetch(name)
      } catch (err) {
        if (cached) return { name, points: cached.points, fetchedAt: cached.fetchedAt, stale: true }
        throw err
      }

      const fetchedAt = now()
      // EI-10: 埋まった行を空応答で潰さない。一時的な空応答・仕様変更・無効な name のどれでも、
      // 素朴に上書きすると履歴が消えて 12h「データがありません」になる。例外が飛んでいないので
      // 上の stale フォールバックは効かない。
      // DB の fetchedAt は進めて 12h 静かにする（API 節約）が、返す fetchedAt は元の行の値
      // — 返しているのは古い points なので、データの古さは古い取得時刻である。
      if (points.length === 0 && cached && cached.points.length > 0) {
        store.upsertIndicator(name, cached.points, fetchedAt)
        return { name, points: cached.points, fetchedAt: cached.fetchedAt, stale: true }
      }

      store.upsertIndicator(name, points, fetchedAt)
      return { name, points, fetchedAt }
    }
  }
}
```

- [ ] **Step 4: テストと型チェックを実行する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npx vitest run tests/main/economic/EconomicIndicatorService.test.ts && npm run typecheck
```

Expected: PASS（13 テスト）

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/010230240/work/vibing-view"
git add src/main/economic/EconomicIndicatorService.ts tests/main/economic/EconomicIndicatorService.test.ts
git commit -m "feat(economic-indicators): EconomicIndicatorService（TTL 12h と空応答ガード EI-10）"
```

---

### Task 6: core 配線と `classify` ベースの latch（EI-04）

`economicIndicatorOutOfPlan` を足すのと同時に、既存の `economicOutOfPlan` が持つ同じ穴（HTTP 200 のプラン拒否をすり抜ける）も塞ぐ。

**Files:**
- Modify: `src/main/core.ts`
- Modify: `src/main/index.ts`（`buildCore` に `economicIndicatorStore` を渡す）
- Test: `tests/main/core/economicIndicator.test.ts`（新規）
- Test: `tests/main/core/economic.test.ts`（既存に 1 テスト追加 + `deps` に 1 行）

**Interfaces:**
- Consumes: `createEconomicIndicatorService`（Task 5）、`getIndicator` / `upsertIndicator`（Task 4）、`classify`（既存 `src/main/capabilityClassifier.ts`）
- Produces: `core.economicIndicator.getSeries(name, opts?)`。`CoreDeps` に `economicIndicatorStore: Pick<typeof economicIndicatorStoreModule, 'getIndicator' | 'upsertIndicator'>` が追加される（既存の core テストの `deps()` ヘルパーはすべて更新が必要）。`ProviderLike` に `'getEconomicIndicator'` が追加される

- [ ] **Step 1: 失敗するテストを書く**

`tests/main/core/economicIndicator.test.ts` を新規作成する。`deps` ヘルパーは `tests/main/core/economic.test.ts` の形をなぞる。

```ts
import { describe, it, expect, vi } from 'vitest'
import { createCore, type CoreDeps } from '../../../src/main/core'
import { FmpHttpError } from '../../../src/main/providers/FmpProvider'
import type { WorkspaceCollection } from '@shared/types'

const collection = (name: string): WorkspaceCollection => ({
  version: 3,
  active: name,
  workspaces: [{ name, items: [], layout: { schemaVersion: 1, cells: [], shape: { rows: 1, cols: 1 }, activeCellId: '1' } }]
})

// プラン拒否は HTTP 200 + Error Message でも来る（EI-01 実測）。classify がこれを
// 'requires-plan' に落とすことが latch の前提。
const DENIED_BODY = { 'Error Message': 'Invalid API KEY. Please retry or visit our documentation' }

function deps(getEconomicIndicator: ReturnType<typeof vi.fn>, over: Partial<CoreDeps> = {}): CoreDeps {
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
      getEconomicIndicator
    })),
    nowSec: () => 1_000
  }
  return { ...base, ...over }
}

describe('core.economicIndicator.getSeries', () => {
  it('reaches the provider and returns the series', async () => {
    const getEconomicIndicator = vi.fn(async () => [{ date: '2026-06-01', value: 322.1 }])
    const d = deps(getEconomicIndicator)
    const r = await createCore(d).economicIndicator.getSeries('CPI')

    expect(getEconomicIndicator).toHaveBeenCalledExactlyOnceWith('CPI')
    expect(r.points).toEqual([{ date: '2026-06-01', value: 322.1 }])
    expect(d.economicIndicatorStore.getIndicator).toHaveBeenCalledWith('CPI')
  })

  it('throws NO_API_KEY without a key, without building a provider', async () => {
    const getEconomicIndicator = vi.fn()
    const d = deps(getEconomicIndicator)
    d.keystore.getApiKey = vi.fn(() => null)

    await expect(createCore(d).economicIndicator.getSeries('CPI')).rejects.toThrow('NO_API_KEY')
    expect(getEconomicIndicator).not.toHaveBeenCalled()
    expect(d.makeProvider).not.toHaveBeenCalled()
  })
})

describe('core.economicIndicator — off-plan short-circuit (EI-04)', () => {
  it.each([402, 403])('stops hitting the network after a %i and rethrows the same error', async (status) => {
    const err = new FmpHttpError(status, DENIED_BODY)
    const getEconomicIndicator = vi.fn(async () => { throw err })
    const d = deps(getEconomicIndicator)
    const core = createCore(d)

    await expect(core.economicIndicator.getSeries('CPI')).rejects.toBe(err)
    await expect(core.economicIndicator.getSeries('GDP')).rejects.toBe(err)
    expect(getEconomicIndicator).toHaveBeenCalledOnce() // 別の name でもネットワークに出ない
    expect(d.makeProvider).toHaveBeenCalledOnce()
  })

  // ここが status 判定では抜ける穴。parseOrThrowHttpError はスキーマ外の body を
  // FmpHttpError(200) で投げるので、プラン拒否が 200 で来ると latch が効かず 23 本空撃ちする。
  it('latches on an HTTP 200 plan-denial payload', async () => {
    const err = new FmpHttpError(200, DENIED_BODY)
    const getEconomicIndicator = vi.fn(async () => { throw err })
    const core = createCore(deps(getEconomicIndicator))

    await expect(core.economicIndicator.getSeries('CPI')).rejects.toBe(err)
    await expect(core.economicIndicator.getSeries('unemploymentRate')).rejects.toBe(err)
    expect(getEconomicIndicator).toHaveBeenCalledOnce()
  })

  // 逆方向の保護: 純粋なスキーマ不一致で 23 本すべてを止めてはいけない。
  it('does NOT latch on a schema mismatch that carries no Error Message', async () => {
    const err = new FmpHttpError(200, [{ bogus: 1 }])
    const getEconomicIndicator = vi.fn(async () => { throw err })
    const core = createCore(deps(getEconomicIndicator))

    await expect(core.economicIndicator.getSeries('CPI')).rejects.toBe(err)
    await expect(core.economicIndicator.getSeries('GDP')).rejects.toBe(err)
    expect(getEconomicIndicator).toHaveBeenCalledTimes(2) // 他の指標は取得を試みられる
  })

  it('does not latch on a 429 (transient)', async () => {
    const getEconomicIndicator = vi.fn(async () => { throw new FmpHttpError(429, null) })
    const core = createCore(deps(getEconomicIndicator))

    await expect(core.economicIndicator.getSeries('CPI')).rejects.toBeInstanceOf(FmpHttpError)
    await expect(core.economicIndicator.getSeries('CPI')).rejects.toBeInstanceOf(FmpHttpError)
    expect(getEconomicIndicator).toHaveBeenCalledTimes(2)
  })

  it.each(['set', 'clear'] as const)('apikey.%s clears the latch', async (action) => {
    const err = new FmpHttpError(403, DENIED_BODY)
    const getEconomicIndicator = vi.fn(async () => { throw err })
    const core = createCore(deps(getEconomicIndicator))

    await expect(core.economicIndicator.getSeries('CPI')).rejects.toBe(err)
    if (action === 'set') core.apikey.set('NEW'); else core.apikey.clear()
    await expect(core.economicIndicator.getSeries('CPI')).rejects.toBe(err)
    expect(getEconomicIndicator).toHaveBeenCalledTimes(2)
  })

  it('is independent of the calendar latch', async () => {
    const err = new FmpHttpError(403, DENIED_BODY)
    const getEconomicCalendar = vi.fn(async () => { throw err })
    const getEconomicIndicator = vi.fn(async () => [{ date: '2026-06-01', value: 1 }])
    const d = deps(getEconomicIndicator)
    d.makeProvider = vi.fn(() => ({
      getOHLCV: vi.fn(async () => []),
      searchSymbols: vi.fn(async () => []),
      getQuote: vi.fn(),
      getMarketStatus: vi.fn(),
      getCompanyProfile: vi.fn(),
      getEconomicCalendar,
      getEconomicIndicator
    }))
    const core = createCore(d)

    await expect(core.economicCalendar.getRange('2026-07-27', '2026-07-27')).rejects.toBe(err)
    // カレンダーが latch されても指標は取れる
    const r = await core.economicIndicator.getSeries('CPI')
    expect(r.points).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 既存の core テストに `economicIndicatorStore` を足し、カレンダーの回帰テストを追加する**

`CoreDeps` に必須プロパティが増えるので、`tests/main/core/` 配下すべての `deps()` ヘルパーに 1 行足す必要がある。まず該当箇所を洗い出す。

```bash
cd "C:/Users/010230240/work/vibing-view" && grep -rn "economicDayStore:" tests/
```

出力された各行の直後に以下を挿入する。

```ts
    economicIndicatorStore: { getIndicator: vi.fn(() => null), upsertIndicator: vi.fn() },
```

`makeProvider` のスタブにも `getEconomicIndicator` が必要なので、`getEconomicCalendar` を書いている行の隣に足す。

```bash
cd "C:/Users/010230240/work/vibing-view" && grep -rn "getEconomicCalendar" tests/
```

```ts
      getEconomicIndicator: vi.fn(async () => []),
```

続いて `tests/main/core/economic.test.ts` の `describe('core.economicCalendar — off-plan short-circuit (EC-15)')` の中に、カレンダー側の同じ穴を塞いだ回帰テストを追加する。

```ts
  // EI-04 でカレンダー側も classify 判定に寄せた。200 のプラン拒否で latch すること。
  it('latches on an HTTP 200 plan-denial payload', async () => {
    const err = new FmpHttpError(200, { 'Error Message': 'Invalid API KEY. Please retry or visit our documentation' })
    const getEconomicCalendar = vi.fn(async () => { throw err })
    const core = createCore(deps(getEconomicCalendar))

    await expect(core.economicCalendar.getRange(FROM, TO)).rejects.toBe(err)
    await expect(core.economicCalendar.getRange('2026-08-03', '2026-08-03')).rejects.toBe(err)
    expect(getEconomicCalendar).toHaveBeenCalledOnce()
  })
```

- [ ] **Step 3: テストを実行して失敗を確認する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npx vitest run tests/main/core
```

Expected: FAIL — `core.economicIndicator` が undefined、および新しいカレンダー回帰テストが「2 回呼ばれた」で落ちる

- [ ] **Step 4: core.ts を実装する**

4 箇所を変更する。

(a) import を追加する（`economicDayStoreModule` の隣、および `createEconomicCalendarService` の隣）:

```ts
import type * as economicIndicatorStoreModule from './db/economicIndicatorStore'
import { createEconomicIndicatorService } from './economic/EconomicIndicatorService'
```

(b) `ProviderLike` に 1 メソッド追加する:

```ts
export type ProviderLike = Pick<
  FmpProvider,
  'getOHLCV' | 'searchSymbols' | 'getQuote' | 'getMarketStatus' | 'getCompanyProfile'
  | 'getEconomicCalendar' | 'getEconomicIndicator'
>
```

(c) `CoreDeps` に 1 行追加する（`economicDayStore` の直後）:

```ts
  economicIndicatorStore: Pick<typeof economicIndicatorStoreModule, 'getIndicator' | 'upsertIndicator'>
```

(d) `economicOutOfPlan` の宣言の隣にフラグを足し、latch 判定を `classify` に寄せる。`classify` は同ファイル 19 行目で既に import 済み。

既存の `economicOutOfPlan` の宣言（`core.ts:78` 付近）の直後に追記する:

```ts
  // EI-04: /economic-indicators も別プラン階層の可能性があり、queryKey は指標ごとに違う。
  // カレンダーとフラグを共用すると、片方の拒否でもう片方が使えなくなる。
  let economicIndicatorOutOfPlan: FmpHttpError | null = null

  // プラン拒否は status だけでは判定できない。parseOrThrowHttpError はスキーマ外の body を
  // FmpHttpError(200) にして投げるので、FMP が 200 + { "Error Message": ... } で拒否を返すと
  // status 判定（402/403）では抜ける。classify は Error Message を持たない純粋なスキーマ不一致には
  // 'available' を返すので、仕様変更で全指標を無効化してしまう誤検知も起きない。
  const isPlanDenial = (err: unknown): err is FmpHttpError =>
    err instanceof FmpHttpError && classify(err.status, err.body) === 'requires-plan'
```

`economicCalendarService` の `fetch` の catch を差し替える（`core.ts:145`）:

```ts
        if (isPlanDenial(err)) economicOutOfPlan = err
```

`economicCalendarService` の直後にサービスを足す:

```ts
  // 指標ごとに全履歴を 1 行の blob（EI-02: 確定判定なし、TTL のみ）。表示範囲のスライスは
  // renderer 側なので、範囲を変えてもここには来ない。
  const economicIndicatorService = createEconomicIndicatorService({
    store: deps.economicIndicatorStore,
    fetch: async (name) => {
      if (economicIndicatorOutOfPlan) throw economicIndicatorOutOfPlan
      try {
        return await providerFor().getEconomicIndicator(name)
      } catch (err) {
        if (isPlanDenial(err)) economicIndicatorOutOfPlan = err
        throw err
      }
    }
  })
```

返り値オブジェクトの `economicCalendar: economicCalendarService,` の直後に追記する:

```ts
    // name は FMP の系列名。表示範囲は renderer が取得済みデータをスライスするので引数にない。
    economicIndicator: economicIndicatorService,
```

`apikey.set` / `apikey.clear` の両方で `economicOutOfPlan = null` を書いている行（`core.ts:222` と `230` 付近）の隣に追記する:

```ts
        economicIndicatorOutOfPlan = null
```

- [ ] **Step 5: main/index.ts でストアを注入する**

`src/main/index.ts` の import に追加する:

```ts
import * as economicIndicatorStore from './db/economicIndicatorStore'
```

`buildCore()` の `createCore({...})` に追加する（`economicDayStore,` の直後）:

```ts
    economicIndicatorStore,
```

- [ ] **Step 6: テストと型チェックを実行する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npm test && npm run typecheck
```

Expected: 全 PASS。`CoreDeps` に必須プロパティを足したので、Step 2 で拾い漏れた `deps()` があれば typecheck が指摘する。

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/010230240/work/vibing-view"
git add src/main/core.ts src/main/index.ts tests/main/core
git commit -m "feat(economic-indicators): core 配線と classify ベースの plan 拒否 latch（EI-04）"
```

---

### Task 7: IPC・preload・窓ハンドラ（EI-06）

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/windowHash.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Test: `tests/windowHash.test.ts`（既存に追加）

**Interfaces:**
- Consumes: `core.economicIndicator.getSeries`（Task 6）
- Produces:
  - `CH.economicIndicator` / `CH.economicIndicatorOpenWindow` / `CH.economicIndicatorSelected` / `CH.economicIndicatorSelect`
  - `Api['economicIndicator'] = { getSeries(name, opts?), openWindow(name), getSelected(): Promise<string | null>, onSelect(cb) }`
  - `WindowKind` に `'economicIndicator'`

このタスクは Task 8 の指標レジストリに依存しない。既定の指標名は main に持たせず renderer 側の `useState` 初期値に置くので、`@shared/economicIndicators` を import する箇所はここには無い。

- [ ] **Step 1: windowHash の失敗するテストを書く**

`tests/windowHash.test.ts` に追記する。既存テストの書き方に合わせる（まずファイルを読んで `import` と `describe` の形を確認する）。

```ts
describe('windowHash — economicIndicator', () => {
  it('round-trips the singleton marker', () => {
    const hash = buildHash('economicIndicator', '1')
    expect(parseHash('economicIndicator', hash)).toBe('1')
  })

  it('does not parse as another kind', () => {
    const hash = buildHash('economicIndicator', '1')
    expect(parseHash('economic', hash)).toBeNull()
    expect(parseHash('company', hash)).toBeNull()
    expect(parseHash('chart', hash)).toBeNull()
    expect(parseHash('symbolChart', hash)).toBeNull()
  })

  it('is not matched by the economic calendar hash', () => {
    expect(parseHash('economicIndicator', buildHash('economic', '1'))).toBeNull()
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npx vitest run tests/windowHash.test.ts
```

Expected: FAIL — `'economicIndicator'` は `WindowKind` に無いので型エラー、または `parseHash` が `null` を返す

- [ ] **Step 3: `WindowKind` を拡張する**

`src/shared/windowHash.ts` の `WindowKind` と冒頭コメントを更新する。

```ts
// Satellite windows (company info / enlarge-chart / watchlist symbol / economic calendar /
// economic indicator) all reuse the main renderer bundle; the target rides in the URL hash
// (#company=AAPL, #chart=CELLID, #symbolChart=AAPL, #economic=1, #economicIndicator=1).
// main-process index.ts builds it, main.tsx branches on it. Shared so both sides agree on the
// format, and one kind's hash never parses as another's.
// 'economic' and 'economicIndicator' are singleton windows, so their value is a fixed '1' —
// callers only check presence. 選択中の指標はハッシュに載せない: main が持ち renderer が
// マウント時に pull する（EI-06 — 窓のロード中に push が落ちる競合を避けるため）。
export type WindowKind = 'company' | 'chart' | 'symbolChart' | 'economic' | 'economicIndicator'
```

`'economic'` の hash が `'economicIndicator'` として parse されない点は `URLSearchParams` のキー完全一致で保証される（`parseHash` の実装は変更不要）。

- [ ] **Step 4: テストが通ることを確認する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npx vitest run tests/windowHash.test.ts
```

Expected: PASS

- [ ] **Step 5: `shared/ipc.ts` にチャンネルと型を足す**

`CH` の `economicOpenWindow: 'economic:openWindow',` の直後に追記する。

```ts
  economicIndicator: 'economicIndicator:series',
  economicIndicatorOpenWindow: 'economicIndicator:openWindow',
  economicIndicatorSelected: 'economicIndicator:selected',
  economicIndicatorSelect: 'economicIndicator:select',
```

`import type` に `EconomicIndicatorSeries` を追加し、`Api` の `economic: {...}` ブロックの直後に追記する。

```ts
  // 統計指標。窓は 1 枚で、選択中の指標は main が持つ（EI-06）。openWindow は「この指標を出せ」の
  // 意味で、既存窓があればフォーカスして選択を差し替える。renderer はマウント時に getSelected で
  // 初期値を取り、onSelect で以降の差し替えを受ける（push が落ちても getSelected が最新を返す）。
  economicIndicator: {
    getSeries(name: string, opts?: { force?: boolean }): Promise<EconomicIndicatorSeries>
    openWindow(name: string): Promise<void>
    // まだ一度も openWindow が呼ばれていなければ null。既定値は renderer 側が持つので、
    // main は「誰も指定していない」を表現するだけでよい。
    getSelected(): Promise<string | null>
    onSelect(cb: (name: string) => void): () => void
  }
```

- [ ] **Step 6: `main/ipc.ts` に 1 本足す**

`CH.economicCalendar` のハンドラの直後に追記する。

```ts
  ipcMain.handle(CH.economicIndicator, (_e, name: string, opts?: { force?: boolean }) =>
    core.economicIndicator.getSeries(name, opts)
  )
```

- [ ] **Step 7: `main/index.ts` に窓ハンドラを足す（EI-06）**

`satelliteWindows` の宣言の後、`openHashWindow` の定義より下、`app.whenReady()` より上に state を置く。

```ts
// 統計指標ウィンドウの選択中の指標。main が真実の置き場で、renderer はマウント時に pull する
// （EI-06）。openHashWindow は satelliteWindows.set を loadRenderer より先に実行するので、
// 窓が「存在する」と判定できてから renderer が onSelect を張るまでに隙間がある。push だけに
// すると、その隙間に来た 2 度目のクリックが黙って捨てられ、最初の指標が表示されたまま残る。
// did-finish-load を待っても直らない（React のマウント前に発火する）。
// プロセス内 state で永続化しない（EI-03）。既定の指標名はここに持たない — renderer 側の
// useState 初期値が唯一の既定なので、main は「誰も指定していない」を null で表すだけでよい。
let selectedIndicator: string | null = null
```

`app.whenReady()` 内、`CH.economicOpenWindow` のハンドラの直後に追記する。

```ts
  ipcMain.handle(CH.economicIndicatorOpenWindow, (_e, name: string) => {
    selectedIndicator = name // 窓の状態より先に更新する（renderer が pull で必ず最新を得る）
    const existing = satelliteWindows.get('economicIndicator:1')
    if (existing) {
      existing.focus()
      existing.webContents.send(CH.economicIndicatorSelect, name)
      return
    }
    openHashWindow('economicIndicator', '1', 900, 760)
  })
  ipcMain.handle(CH.economicIndicatorSelected, () => selectedIndicator)
```

`satelliteWindows` の冒頭コメントに指標窓を追記する（`economic calendar as a singleton` の列挙に並べる）。

- [ ] **Step 8: preload に足す**

`src/preload/index.ts` の `economic: {...}` ブロックの直後に追記する。

```ts
  economicIndicator: {
    getSeries: (name, opts) => ipcRenderer.invoke(CH.economicIndicator, name, opts),
    openWindow: (name) => ipcRenderer.invoke(CH.economicIndicatorOpenWindow, name),
    getSelected: () => ipcRenderer.invoke(CH.economicIndicatorSelected),
    onSelect: (cb) => {
      const listener = (_e: unknown, name: string): void => cb(name)
      ipcRenderer.on(CH.economicIndicatorSelect, listener)
      return () => ipcRenderer.removeListener(CH.economicIndicatorSelect, listener)
    }
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
git commit -m "feat(economic-indicators): IPC と窓ハンドラ（EI-06 の pull 方式）"
```

---

### Task 8: 指標レジストリと `resolveIndicator`（EI-05）

**Files:**
- Create: `src/shared/economicIndicators.ts`
- Test: `tests/shared/economicIndicators.test.ts`

**Interfaces:**
- Consumes: なし（純粋なデータと関数）
- Produces:
  - `EconomicIndicatorCategory = 'Growth' | 'Inflation' | 'Labor' | 'Rates' | 'Consumer' | 'Housing'`
  - `EconomicIndicatorMeta = { name: string; label: string; category: EconomicIndicatorCategory; unit: string }`
  - `ECONOMIC_INDICATORS: EconomicIndicatorMeta[]`（23 件）
  - `ECONOMIC_INDICATOR_CATEGORIES: EconomicIndicatorCategory[]`
  - `DEFAULT_ECONOMIC_INDICATOR = 'CPI'`
  - `indicatorMeta(name: string): EconomicIndicatorMeta | null`
  - `resolveIndicator(event: string, country: string): string | null`

- [ ] **Step 1: 失敗するテストを書く**

`tests/shared/economicIndicators.test.ts` を新規作成する。

```ts
import { describe, it, expect } from 'vitest'
import {
  ECONOMIC_INDICATORS, ECONOMIC_INDICATOR_CATEGORIES, DEFAULT_ECONOMIC_INDICATOR,
  indicatorMeta, resolveIndicator
} from '@shared/economicIndicators'

describe('ECONOMIC_INDICATORS', () => {
  it('has 23 entries with unique names', () => {
    expect(ECONOMIC_INDICATORS).toHaveLength(23)
    expect(new Set(ECONOMIC_INDICATORS.map((m) => m.name)).size).toBe(23)
  })

  it('gives every entry a label, a unit, and a known category', () => {
    for (const m of ECONOMIC_INDICATORS) {
      expect(m.label.length).toBeGreaterThan(0)
      expect(m.unit.length).toBeGreaterThan(0) // API が単位を返さないので必須
      expect(ECONOMIC_INDICATOR_CATEGORIES).toContain(m.category)
    }
  })

  it('covers every category with at least one indicator (空グループを出さない)', () => {
    for (const c of ECONOMIC_INDICATOR_CATEGORIES) {
      expect(ECONOMIC_INDICATORS.some((m) => m.category === c)).toBe(true)
    }
  })

  it('has the default indicator in the registry', () => {
    expect(indicatorMeta(DEFAULT_ECONOMIC_INDICATOR)).not.toBeNull()
  })

  it('returns null for an unknown name', () => {
    expect(indicatorMeta('nope')).toBeNull()
  })
})

describe('resolveIndicator — 当たる例', () => {
  it.each([
    ['CPI MoM', 'CPI'],
    ['CPI YoY', 'CPI'],
    ['Inflation Rate YoY', 'inflationRate'],
    ['Initial Jobless Claims', 'initialClaims'],
    ['Nonfarm Payrolls', 'totalNonfarmPayroll'],
    ['Unemployment Rate', 'unemploymentRate'],
    ['Fed Interest Rate Decision', 'federalFunds'],
    ['GDP Growth Rate QoQ Adv', 'GDP'],
    ['Retail Sales MoM', 'retailSales'],
    ['Michigan Consumer Sentiment Prel', 'consumerSentiment'],
    ['Durable Goods Orders MoM', 'durableGoods'],
    ['Industrial Production MoM', 'industrialProductionTotalIndex'],
    ['Housing Starts', 'newPrivatelyOwnedHousingUnitsStartedTotalUnits'],
    ['Total Vehicle Sales', 'totalVehicleSales']
  ])('%s → %s', (event, expected) => {
    expect(resolveIndicator(event, 'US')).toBe(expected)
  })

  it('ignores case', () => {
    expect(resolveIndicator('cpi mom', 'US')).toBe('CPI')
    expect(resolveIndicator('INITIAL JOBLESS CLAIMS', 'US')).toBe('initialClaims')
  })
})

describe('resolveIndicator — core の除外が先に効く', () => {
  // FMP はコア系列を持たない。ヘッドラインに飛ばすと別の指標を見せるので、リンクを張らない。
  it.each([
    'Core Inflation Rate YoY',
    'Core CPI MoM',
    'Core PCE Price Index MoM',
    'core retail sales mom'
  ])('%s → null', (event) => {
    expect(resolveIndicator(event, 'US')).toBeNull()
  })
})

describe('resolveIndicator — 当たらない例', () => {
  it.each([
    'FOMC Press Conference',
    'Fed Chair Powell Speech',
    'Thanksgiving Day',
    '10-Year Note Auction'
  ])('%s → null', (event) => {
    expect(resolveIndicator(event, 'US')).toBeNull()
  })
})

describe('resolveIndicator — 国の絞り込み', () => {
  it.each(['JP', 'EU', 'UK', 'CN', ''])('%s は常に null', (country) => {
    expect(resolveIndicator('CPI MoM', country)).toBeNull()
  })
})

describe('resolveIndicator — レジストリとの整合', () => {
  // 対応表がレジストリに無い名前を返すと、窓が「未知の指標」を開いてラベルも単位も出ない。
  it('only ever returns a name that exists in the registry', () => {
    const events = [
      'CPI MoM', 'Inflation Rate YoY', 'Initial Jobless Claims', 'Nonfarm Payrolls',
      'Unemployment Rate', 'Fed Interest Rate Decision', 'GDP Growth Rate QoQ',
      'Retail Sales MoM', 'Michigan Consumer Sentiment', 'Durable Goods Orders MoM',
      'Industrial Production MoM', 'Housing Starts', 'Total Vehicle Sales'
    ]
    for (const e of events) {
      const name = resolveIndicator(e, 'US')
      expect(name).not.toBeNull()
      expect(indicatorMeta(name!)).not.toBeNull()
    }
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npx vitest run tests/shared/economicIndicators.test.ts
```

Expected: FAIL — `Failed to resolve import "@shared/economicIndicators"`

- [ ] **Step 3: レジストリと解決関数を実装する**

`src/shared/economicIndicators.ts` を新規作成する。

```ts
// FMP の /stable/economic-indicators が受け付ける系列は固定で、API は単位も国も返さない。
// renderer（プルダウンとラベル）とカレンダー連携（キーワード表）が同じ表を見るので shared に置く。
// 全系列 US（FRED 由来）。EI-01 の実測で差があればここを直す。
export type EconomicIndicatorCategory =
  'Growth' | 'Inflation' | 'Labor' | 'Rates' | 'Consumer' | 'Housing'

export type EconomicIndicatorMeta = {
  name: string
  label: string
  category: EconomicIndicatorCategory
  unit: string
}

export const ECONOMIC_INDICATOR_CATEGORIES: EconomicIndicatorCategory[] =
  ['Growth', 'Inflation', 'Labor', 'Rates', 'Consumer', 'Housing']

export const DEFAULT_ECONOMIC_INDICATOR = 'CPI'

// unit は必須。API が単位を返さないので、これが無いと CPI の 322.1 と unemploymentRate の 4.2 が
// 同じ「数」に見える。同時にこれが水準値と変化率のミスマッチへの答えになる（カレンダーの
// 'CPI MoM' は前月比 % だが、CPI 系列は指数の水準値）。桁数は持たない — toLocaleString の
// 一律ルールで GDP(30000台) も unemploymentRate(4.2) も recession probability(0.03) も読める。
export const ECONOMIC_INDICATORS: EconomicIndicatorMeta[] = [
  { name: 'GDP', label: 'Gross Domestic Product', category: 'Growth', unit: 'Bil. $ (SAAR)' },
  { name: 'realGDP', label: 'Real GDP', category: 'Growth', unit: 'Bil. chained 2017 $' },
  { name: 'nominalPotentialGDP', label: 'Nominal Potential GDP', category: 'Growth', unit: 'Bil. $' },
  { name: 'realGDPPerCapita', label: 'Real GDP per Capita', category: 'Growth', unit: 'Chained 2017 $' },
  { name: 'industrialProductionTotalIndex', label: 'Industrial Production', category: 'Growth', unit: 'Index 2017=100' },
  { name: 'durableGoods', label: 'Durable Goods Orders', category: 'Growth', unit: 'Mil. $' },
  { name: 'totalVehicleSales', label: 'Total Vehicle Sales', category: 'Growth', unit: 'Mil. units (SAAR)' },
  { name: 'CPI', label: 'Consumer Price Index', category: 'Inflation', unit: 'Index 1982-84=100' },
  { name: 'inflationRate', label: 'Inflation Rate', category: 'Inflation', unit: '% YoY' },
  { name: 'inflation', label: 'Inflation', category: 'Inflation', unit: '%' },
  { name: 'unemploymentRate', label: 'Unemployment Rate', category: 'Labor', unit: '%' },
  { name: 'totalNonfarmPayroll', label: 'Nonfarm Payroll', category: 'Labor', unit: 'Thousands of persons' },
  { name: 'initialClaims', label: 'Initial Jobless Claims', category: 'Labor', unit: 'Claims' },
  { name: 'federalFunds', label: 'Federal Funds Rate', category: 'Rates', unit: '%' },
  { name: '3MonthOr90DayRatesAndYieldsCertificatesOfDeposit', label: '3-Month CD Rate', category: 'Rates', unit: '%' },
  { name: 'commercialBankInterestRateOnCreditCardPlansAllAccounts', label: 'Credit Card Interest Rate', category: 'Rates', unit: '%' },
  { name: '30YearFixedRateMortgageAverage', label: '30-Year Mortgage Rate', category: 'Rates', unit: '%' },
  { name: '15YearFixedRateMortgageAverage', label: '15-Year Mortgage Rate', category: 'Rates', unit: '%' },
  { name: 'consumerSentiment', label: 'Consumer Sentiment', category: 'Consumer', unit: 'Index 1966Q1=100' },
  { name: 'retailSales', label: 'Retail Sales', category: 'Consumer', unit: 'Mil. $' },
  { name: 'retailMoneyFunds', label: 'Retail Money Funds', category: 'Consumer', unit: 'Bil. $' },
  { name: 'smoothedUSRecessionProbabilities', label: 'Recession Probability', category: 'Consumer', unit: '%' },
  { name: 'newPrivatelyOwnedHousingUnitsStartedTotalUnits', label: 'Housing Starts', category: 'Housing', unit: 'Thousands of units (SAAR)' }
]

export function indicatorMeta(name: string): EconomicIndicatorMeta | null {
  return ECONOMIC_INDICATORS.find((m) => m.name === name) ?? null
}

// カレンダーの event 文字列 → 系列名（EI-05）。上から順に最初に当たったものを返す。
// 'core' の除外を先頭に置くのが重要: FMP はコア系列（食品・エネルギーを除く）を持たないので、
// 'Core CPI' や 'Core Inflation Rate' をヘッドライン系列に飛ばすと別の指標を見せてしまう。
// 除外しないと下の cpi / inflation rate のルールに当たる。
// 完全一致テーブルにしないのは、実測できる event 文字列を網羅できず、FMP 側の表記が変わると
// 黙ってリンクが消えるため。部分一致なら 'CPI MoM' / 'CPI YoY' / 'CPI s.a' がまとめて当たる。
const RULES: { match: RegExp; name: string | null }[] = [
  { match: /core/, name: null },
  { match: /jobless claims|initial claims/, name: 'initialClaims' },
  { match: /nonfarm payroll/, name: 'totalNonfarmPayroll' },
  { match: /unemployment rate/, name: 'unemploymentRate' },
  { match: /cpi/, name: 'CPI' },
  { match: /inflation rate/, name: 'inflationRate' },
  { match: /interest rate decision|fed interest rate/, name: 'federalFunds' },
  { match: /gdp/, name: 'GDP' },
  { match: /retail sales/, name: 'retailSales' },
  { match: /consumer sentiment|michigan/, name: 'consumerSentiment' },
  { match: /durable goods/, name: 'durableGoods' },
  { match: /industrial production/, name: 'industrialProductionTotalIndex' },
  { match: /housing starts/, name: 'newPrivatelyOwnedHousingUnitsStartedTotalUnits' },
  { match: /total vehicle sales|car sales/, name: 'totalVehicleSales' }
]

// /economic-indicators は US 系列しか持たないので、US 以外の行にリンクは張れない。
export function resolveIndicator(event: string, country: string): string | null {
  if (country !== 'US') return null
  const e = event.toLowerCase()
  return RULES.find((r) => r.match.test(e))?.name ?? null
}
```

- [ ] **Step 4: テストと型チェックを実行する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npx vitest run tests/shared/economicIndicators.test.ts && npm run typecheck
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/010230240/work/vibing-view"
git add src/shared/economicIndicators.ts tests/shared/economicIndicators.test.ts
git commit -m "feat(economic-indicators): 指標レジストリと resolveIndicator（EI-05）"
```

---

### Task 9: 範囲スライスと Δ の純関数

**Files:**
- Create: `src/renderer/lib/economicIndicatorSeries.ts`
- Test: `tests/renderer/economicIndicatorSeries.test.ts`

**Interfaces:**
- Consumes: `EconomicIndicatorPoint`（Task 2）
- Produces:
  - `IndicatorRange = '1Y' | '5Y' | '10Y' | 'Max'`
  - `INDICATOR_RANGES: IndicatorRange[]`
  - `DEFAULT_INDICATOR_RANGE: IndicatorRange`（`'5Y'`）
  - `IndicatorRow = { date: string; value: number; delta: number | null }`
  - `sliceRange(points, range): EconomicIndicatorPoint[]`
  - `tableRows(all, visible, limit?): IndicatorRow[]`
  - `latestRow(all): IndicatorRow | null`
  - `formatValue(n: number): string`
  - `formatDelta(n: number | null): string`

- [ ] **Step 1: 失敗するテストを書く**

`tests/renderer/economicIndicatorSeries.test.ts` を新規作成する。

```ts
import { describe, it, expect } from 'vitest'
import {
  sliceRange, tableRows, latestRow, formatValue, formatDelta,
  INDICATOR_RANGES, DEFAULT_INDICATOR_RANGE
} from '@/lib/economicIndicatorSeries'
import type { EconomicIndicatorPoint } from '@shared/types'

// 2016-01-01 から 2026-01-01 まで毎年 1 点（value は年の下 2 桁）。
const YEARLY: EconomicIndicatorPoint[] = Array.from({ length: 11 }, (_, i) => ({
  date: `${2016 + i}-01-01`,
  value: 16 + i
}))

describe('INDICATOR_RANGES', () => {
  it('offers 1Y / 5Y / 10Y / Max with 5Y as the default', () => {
    expect(INDICATOR_RANGES).toEqual(['1Y', '5Y', '10Y', 'Max'])
    expect(INDICATOR_RANGES).toContain(DEFAULT_INDICATOR_RANGE)
    expect(DEFAULT_INDICATOR_RANGE).toBe('5Y')
  })
})

describe('sliceRange — 基準は最新観測日 (EI-08)', () => {
  it('Max returns everything', () => {
    expect(sliceRange(YEARLY, 'Max')).toEqual(YEARLY)
  })

  it('1Y counts back from the newest observation, not from today', () => {
    // 最新は 2026-01-01。今日（2026-07-27 以降）から 1 年遡ると 1 点も残らないが、
    // 最新観測から遡れば 2025-01-01 と 2026-01-01 が残る。
    expect(sliceRange(YEARLY, '1Y').map((p) => p.date)).toEqual(['2025-01-01', '2026-01-01'])
  })

  it('5Y and 10Y slice from the newest observation', () => {
    expect(sliceRange(YEARLY, '5Y').map((p) => p.date)).toEqual([
      '2021-01-01', '2022-01-01', '2023-01-01', '2024-01-01', '2025-01-01', '2026-01-01'
    ])
    expect(sliceRange(YEARLY, '10Y')).toHaveLength(11)
  })

  it('keeps a lagging series non-empty (四半期系列で発表が遅れているケース)', () => {
    // 最新観測が 2 年前でも 1Y ビューは空にならない。
    const lagging: EconomicIndicatorPoint[] = [
      { date: '2023-07-01', value: 1 },
      { date: '2023-10-01', value: 2 },
      { date: '2024-01-01', value: 3 }
    ]
    expect(sliceRange(lagging, '1Y').map((p) => p.date)).toEqual(['2023-07-01', '2023-10-01', '2024-01-01'])
  })

  it('handles an empty series', () => {
    expect(sliceRange([], '1Y')).toEqual([])
    expect(sliceRange([], 'Max')).toEqual([])
  })

  it('handles a single point', () => {
    const one = [{ date: '2026-06-01', value: 1 }]
    expect(sliceRange(one, '1Y')).toEqual(one)
  })

  it('does not crash on a Feb 29 newest date', () => {
    // 文字列比較でカットオフを作るので、'2020-02-29' の 1 年前 '2019-02-29'（実在しない日付）でも
    // 境界として正しく働く。
    const leap: EconomicIndicatorPoint[] = [
      { date: '2019-01-01', value: 1 },
      { date: '2019-03-01', value: 2 },
      { date: '2020-02-29', value: 3 }
    ]
    expect(sliceRange(leap, '1Y').map((p) => p.date)).toEqual(['2019-03-01', '2020-02-29'])
  })
})

describe('tableRows — 新しい順、Δ は絶対差 (EI-07)', () => {
  it('reverses the visible slice and computes deltas', () => {
    const visible = sliceRange(YEARLY, '1Y')
    expect(tableRows(YEARLY, visible)).toEqual([
      { date: '2026-01-01', value: 26, delta: 1 },
      { date: '2025-01-01', value: 25, delta: 1 }
    ])
  })

  it('uses the observation before the slice for the oldest visible row (境界で空欄にしない)', () => {
    const visible = sliceRange(YEARLY, '1Y')
    const oldest = tableRows(YEARLY, visible).at(-1)!
    expect(oldest.date).toBe('2025-01-01')
    expect(oldest.delta).toBe(1) // 2024 の 24 との差。スライス外を参照している
  })

  it('leaves delta null for the very first observation of the whole series', () => {
    const rows = tableRows(YEARLY, YEARLY)
    expect(rows.at(-1)).toEqual({ date: '2016-01-01', value: 16, delta: null })
  })

  it('caps the row count at the limit', () => {
    expect(tableRows(YEARLY, YEARLY, 3).map((r) => r.date)).toEqual([
      '2026-01-01', '2025-01-01', '2024-01-01'
    ])
  })

  it('defaults the limit to 20', () => {
    const many: EconomicIndicatorPoint[] = Array.from({ length: 50 }, (_, i) => ({
      date: `2020-01-${String(i + 1).padStart(2, '0')}`, value: i
    }))
    expect(tableRows(many, many)).toHaveLength(20)
  })

  it('handles an empty series', () => {
    expect(tableRows([], [])).toEqual([])
  })
})

describe('latestRow', () => {
  it('returns the newest observation with its delta', () => {
    expect(latestRow(YEARLY)).toEqual({ date: '2026-01-01', value: 26, delta: 1 })
  })

  it('returns a null delta for a single-point series', () => {
    expect(latestRow([{ date: '2026-06-01', value: 5 }])).toEqual({ date: '2026-06-01', value: 5, delta: null })
  })

  it('returns null for an empty series', () => {
    expect(latestRow([])).toBeNull()
  })
})

describe('formatValue / formatDelta', () => {
  it('caps fraction digits at 2 for every magnitude', () => {
    expect(formatValue(0.0312)).toBe('0.03')
    expect(formatValue(4.2)).toBe('4.2')
    expect(formatValue(322.1)).toBe('322.1')
  })

  it('groups large numbers', () => {
    expect(formatValue(30331.117)).toBe('30,331.12')
  })

  it('signs the delta and dashes null', () => {
    expect(formatDelta(0.7)).toBe('+0.7')
    expect(formatDelta(-0.7)).toBe('-0.7')
    expect(formatDelta(0)).toBe('0')
    expect(formatDelta(null)).toBe('—')
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npx vitest run tests/renderer/economicIndicatorSeries.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/economicIndicatorSeries"`

- [ ] **Step 3: 実装する**

`src/renderer/lib/economicIndicatorSeries.ts` を新規作成する。

```ts
// src/renderer/lib/economicIndicatorSeries.ts
import type { EconomicIndicatorPoint } from '@shared/types'

export type IndicatorRange = '1Y' | '5Y' | '10Y' | 'Max'
export const INDICATOR_RANGES: IndicatorRange[] = ['1Y', '5Y', '10Y', 'Max']
export const DEFAULT_INDICATOR_RANGE: IndicatorRange = '5Y'

const YEARS: Record<Exclude<IndicatorRange, 'Max'>, number> = { '1Y': 1, '5Y': 5, '10Y': 10 }

// 基準は最新観測日（EI-08）。今日から遡ると、四半期系列や発表が遅れている系列で 1Y が空になる。
// カットオフは Date を使わず文字列で作る: 'YYYY-MM-DD' は辞書順が日付順と一致するので、
// 年だけ引いた '2019-02-29' のような実在しない日付でも境界として正しく働く。
export function sliceRange(points: EconomicIndicatorPoint[], range: IndicatorRange): EconomicIndicatorPoint[] {
  if (range === 'Max' || points.length === 0) return points
  const last = points[points.length - 1].date
  const cutoff = `${Number(last.slice(0, 4)) - YEARS[range]}${last.slice(4)}`
  return points.filter((p) => p.date >= cutoff)
}

export type IndicatorRow = { date: string; value: number; delta: number | null }

// delta は直前の観測との絶対差（EI-07）。% 変化にすると unemploymentRate のように値そのものが %
// の系列で「% の %」になり、4.2 → 4.3 が +2.4% と表示されて誤読を招く。前月比 % はカレンダー側の
// 'CPI MoM' 行が担当する。
function rowAt(all: EconomicIndicatorPoint[], i: number): IndicatorRow {
  const p = all[i]
  return { date: p.date, value: p.value, delta: i > 0 ? p.value - all[i - 1].value : null }
}

// 表の行（新しい順）。visible はスライス後、all は全履歴。delta は all の中の 1 つ前を使うので、
// スライス境界の行でも空欄にならない。
export function tableRows(
  all: EconomicIndicatorPoint[],
  visible: EconomicIndicatorPoint[],
  limit = 20
): IndicatorRow[] {
  const indexByDate = new Map(all.map((p, i) => [p.date, i]))
  return visible
    .slice(Math.max(0, visible.length - limit))
    .reverse()
    .map((p) => rowAt(all, indexByDate.get(p.date)!))
}

export function latestRow(all: EconomicIndicatorPoint[]): IndicatorRow | null {
  return all.length === 0 ? null : rowAt(all, all.length - 1)
}

// 桁数は系列ごとに持たない。この一律ルールで GDP(30000台) も unemploymentRate(4.2) も
// recession probability(0.03) も読める。
export const formatValue = (n: number): string =>
  n.toLocaleString(undefined, { maximumFractionDigits: 2 })

export const formatDelta = (n: number | null): string =>
  n == null ? '—' : `${n > 0 ? '+' : ''}${formatValue(n)}`
```

- [ ] **Step 4: テストと型チェックを実行する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npx vitest run tests/renderer/economicIndicatorSeries.test.ts && npm run typecheck
```

Expected: PASS

> `formatValue` のグループ区切りは実行環境のロケールに依存する。`30,331.12` で落ちる場合は Node のデフォルトロケールが `en-US` ではない。その場合はテストを `expect(formatValue(30331.117)).toMatch(/30.331[.,]12/)` に緩める（表示は環境のロケールに従うのが正しい挙動なので、実装は変えない）。

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/010230240/work/vibing-view"
git add src/renderer/lib/economicIndicatorSeries.ts tests/renderer/economicIndicatorSeries.test.ts
git commit -m "feat(economic-indicators): 範囲スライスと Δ の純関数（EI-07/EI-08）"
```

---

### Task 10: chartTheme の抽出と折れ線コンポーネント

`Chart.tsx` の `cssHsl` / `chartThemeOptions` はモジュール内に閉じている。折れ線側で同じテーマ色が必要なので、共有ライブラリに出す。`Chart.tsx` 全体を触るリファクタはしない — 関数 2 つを移すだけ。

**Files:**
- Create: `src/renderer/lib/chartTheme.ts`
- Modify: `src/renderer/components/Chart.tsx`（関数 2 つを削除し import に置き換える）
- Create: `src/renderer/components/EconomicIndicatorChart.tsx`

**Interfaces:**
- Consumes: `EconomicIndicatorPoint`（Task 2）、`formatValue`（Task 9）
- Produces:
  - `cssHsl(name: string, alpha?: number): string`
  - `chartThemeOptions()`（戻り値の型は `Chart.tsx` の既存の型注釈をそのまま移す）
  - `EconomicIndicatorChart({ points }: { points: EconomicIndicatorPoint[] })`

テストは書かない。両方とも `getComputedStyle` / `createChart` に依存する描画コードで、意味のあるテストには実 DOM とキャンバスが必要になる（既存の `Chart.tsx` にもテストは無い）。

- [ ] **Step 1: `chartTheme.ts` を作る**

`src/renderer/components/Chart.tsx` の `cssHsl`（30-36 行目付近）と `chartThemeOptions`（38-58 行目付近）を**コメントごとそのまま**新ファイルへ移し、`export` を付ける。

```ts
// src/renderer/lib/chartTheme.ts
// ローソク足チャートと統計指標の折れ線が同じテーマ色を使うので、Chart.tsx から出した。

// Read a theme CSS var (e.g. "210 24% 6%") and return a usable CSS color string. Lets the chart
// track the light/dark palette instead of the old hardcoded dark hexes (#0B0E11 / #151920).
export function cssHsl(name: string, alpha?: number): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!v) return ''
  return alpha === undefined ? `hsl(${v})` : `hsl(${v} / ${alpha})`
}

// Chart layout/grid/border colors derived from the current theme. Re-read on theme change so a
// Light/Dark toggle recolors the canvas. Candle up/down colors stay fixed (readable on both).
export function chartThemeOptions(): {
  layout: { background: { color: string }; textColor: string; panes: { separatorColor: string; separatorHoverColor: string } }
  grid: { vertLines: { color: string }; horzLines: { color: string } }
  timeScale: { borderColor: string }
  rightPriceScale: { borderColor: string }
} {
  const grid = cssHsl('--border')
  return {
    layout: {
      background: { color: cssHsl('--background') },
      textColor: cssHsl('--muted-foreground'),
      panes: { separatorColor: cssHsl('--muted-foreground', 0.25), separatorHoverColor: cssHsl('--muted-foreground', 0.2) }
    },
    grid: { vertLines: { color: grid }, horzLines: { color: grid } },
    timeScale: { borderColor: grid },
    rightPriceScale: { borderColor: grid }
  }
}
```

- [ ] **Step 2: `Chart.tsx` から 2 関数を削除して import に置き換える**

削除した位置の代わりに import を足す（他の `@/lib/...` の import の隣）。

```ts
import { chartThemeOptions, cssHsl } from '@/lib/chartTheme'
```

`Chart.tsx` 内の `cssHsl` / `chartThemeOptions` の呼び出し箇所は名前が同じなので変更不要。

- [ ] **Step 3: 既存の全テストと型チェックで回帰が無いことを確認する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npm test && npm run typecheck
```

Expected: 全 PASS。`cssHsl` が `Chart.tsx` 内で未使用になっていれば typecheck が未使用 import を指摘するので、その場合は import から外す。

- [ ] **Step 4: 折れ線コンポーネントを実装する**

`src/renderer/components/EconomicIndicatorChart.tsx` を新規作成する。

```tsx
// src/renderer/components/EconomicIndicatorChart.tsx
import React, { useEffect, useRef } from 'react'
import { createChart, CrosshairMode, LineSeries, type IChartApi, type ISeriesApi } from 'lightweight-charts'
import { chartThemeOptions, cssHsl } from '@/lib/chartTheme'
import { formatValue } from '@/lib/economicIndicatorSeries'
import type { EconomicIndicatorPoint } from '@shared/types'

// 統計指標の折れ線 1 本。Chart.tsx は Bar[] と指標インスタンス群に結びついた大きなコンポーネントで、
// 単純な折れ線を通すには改造が要るので分けた。
// time は 'YYYY-MM-DD' をそのまま渡せる（lightweight-charts の business-day 形式）。epoch への
// 変換が不要なので、API の date をそのまま流せる。
export function EconomicIndicatorChart({ points }: { points: EconomicIndicatorPoint[] }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const readoutRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      autoSize: true,
      ...chartThemeOptions(),
      // Normal: 値のある点に吸着させず、任意の位置で読める（月次系列は点が疎なので Magnet だと飛ぶ）
      crosshair: { mode: CrosshairMode.Normal }
    })
    chartRef.current = chart
    seriesRef.current = chart.addSeries(LineSeries, { color: cssHsl('--primary'), lineWidth: 2 })

    // クロスヘアの読み取り。React state にすると 1 ピクセル動くたび再レンダーするので DOM を直接書く。
    chart.subscribeCrosshairMove((param) => {
      const el = readoutRef.current
      if (!el) return
      const series = seriesRef.current
      const d = series && param.time ? param.seriesData.get(series) : undefined
      el.textContent = d && 'value' in d ? `${String(param.time)}  ${formatValue(d.value as number)}` : ''
    })

    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!seriesRef.current) return
    seriesRef.current.setData(points.map((p) => ({ time: p.date, value: p.value })))
    chartRef.current?.timeScale().fitContent()
  }, [points])

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <div
        ref={readoutRef}
        className="pointer-events-none absolute left-2 top-2 text-xs tabular-nums text-muted-foreground"
      />
    </div>
  )
}
```

- [ ] **Step 5: 型チェックを実行する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npm run typecheck && npm test
```

Expected: エラーなし、既存テストは全 PASS

> `chart.addSeries(LineSeries, ...)` と `crosshair: { mode: 0 }` の型は導入済みの lightweight-charts 5.2 の typings に合わせている（`Chart.tsx:144` が同じ `addSeries` 形式を使っている）。型エラーが出た場合は `Chart.tsx` の該当箇所の書き方に合わせる。

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/010230240/work/vibing-view"
git add src/renderer/lib/chartTheme.ts src/renderer/components/Chart.tsx src/renderer/components/EconomicIndicatorChart.tsx
git commit -m "feat(economic-indicators): chartTheme を共有し折れ線コンポーネントを追加"
```

---

### Task 11: EconomicIndicatorWindow

**Files:**
- Create: `src/renderer/components/EconomicIndicatorWindow.tsx`
- Modify: `src/renderer/api.ts`（`qk` に 1 行）
- Modify: `src/renderer/main.tsx`（ハッシュ分岐に 1 本）

**Interfaces:**
- Consumes: `api.economicIndicator.*`（Task 7）、`ECONOMIC_INDICATORS` / `ECONOMIC_INDICATOR_CATEGORIES` / `DEFAULT_ECONOMIC_INDICATOR` / `indicatorMeta`（Task 8）、`sliceRange` / `tableRows` / `latestRow` / `formatValue` / `formatDelta` / `INDICATOR_RANGES` / `DEFAULT_INDICATOR_RANGE`（Task 9）、`EconomicIndicatorChart`（Task 10）
- Produces: `EconomicIndicatorWindow()`、`qk.economicIndicator(name)`

- [ ] **Step 1: `qk` に query key を足す**

`src/renderer/api.ts` の `economicCalendar` の行の後に追記する（末尾のカンマに注意）。

```ts
  economicCalendar: (from: string, to: string) => ['economic-calendar', from, to] as const,
  // 表示範囲はクライアント側スライスなので key に入れない — 範囲を変えても再フェッチしない。
  economicIndicator: (name: string) => ['economic-indicator', name] as const
```

- [ ] **Step 2: ウィンドウを実装する**

`src/renderer/components/EconomicIndicatorWindow.tsx` を新規作成する。エラー文言は `EconomicCalendarWindow.tsx` の `errorMessage` と同じ分岐（`/FMP HTTP (200|40[0-9])/` の判定を使い回す）。

```tsx
// src/renderer/components/EconomicIndicatorWindow.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, RefreshCw } from 'lucide-react'
import { api, qk } from '@/api'
import { cn } from '@/lib/utils'
import { applyTheme } from '@/lib/theme'
import { Button } from './ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from './ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { EconomicIndicatorChart } from './EconomicIndicatorChart'
import {
  DEFAULT_INDICATOR_RANGE, INDICATOR_RANGES, formatDelta, formatValue, latestRow,
  sliceRange, tableRows, type IndicatorRange
} from '@/lib/economicIndicatorSeries'
import {
  DEFAULT_ECONOMIC_INDICATOR, ECONOMIC_INDICATORS, ECONOMIC_INDICATOR_CATEGORIES, indicatorMeta
} from '@shared/economicIndicators'
import type { EconomicIndicatorSeries } from '@shared/types'

// company.info / 経済カレンダーと同じ分岐。IPC 越しの message から判定するので新しい型は増やさない。
function errorMessage(err: unknown): string {
  const m = String((err as Error)?.message ?? '')
  if (/NO_API_KEY/.test(m)) return 'Set your FMP API key in Settings.'
  if (/FMP HTTP 401/.test(m)) return 'Your FMP API key was rejected. Check it in Settings.'
  if (/FMP HTTP 429/.test(m)) return 'FMP request limit reached. Wait a moment and try again.'
  if (/FMP HTTP (200|40[0-9])/.test(m)) return 'Economic indicators aren’t available on your current FMP plan.'
  return 'Couldn’t load this indicator. Check your connection.'
}

export function EconomicIndicatorWindow(): React.JSX.Element {
  // 選択中の指標は main が持つ（EI-06）。マウント時に pull し、以降は onSelect で受ける。
  // 初期値をハッシュに載せない理由: 窓のロード中に来た 2 度目のクリックの push が落ちるため。
  const [name, setName] = useState(DEFAULT_ECONOMIC_INDICATOR)
  const [range, setRange] = useState<IndicatorRange>(DEFAULT_INDICATOR_RANGE)
  const qc = useQueryClient()

  // 折れ線がテーマ CSS 変数から色を読むので、Chart 窓と同じくテーマを適用する。
  useEffect(() => { void api.settings.getTheme().then(applyTheme) }, [])

  useEffect(() => {
    // main が持つ選択を pull。null なら誰もまだ指定していないので useState の既定のまま。
    void api.economicIndicator.getSelected().then((n) => { if (n) setName(n) })
    return api.economicIndicator.onSelect(setName)
  }, [])

  const meta = indicatorMeta(name)
  useEffect(() => { document.title = meta ? meta.label : name }, [meta, name])

  const q = useQuery<EconomicIndicatorSeries>({
    queryKey: qk.economicIndicator(name),
    queryFn: () => api.economicIndicator.getSeries(name)
  })
  const reload = useMutation({
    mutationFn: () => api.economicIndicator.getSeries(name, { force: true }),
    onSuccess: (data) => qc.setQueryData(qk.economicIndicator(name), data)
  })

  const all = q.data?.points ?? []
  const visible = useMemo(() => sliceRange(all, range), [all, range])
  const rows = useMemo(() => tableRows(all, visible), [all, visible])
  const latest = useMemo(() => latestRow(all), [all])

  const asOf = q.data ? new Date(q.data.fetchedAt * 1000) : null
  const asOfLabel = asOf
    ? `As of ${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, '0')}-${String(asOf.getDate()).padStart(2, '0')} ${String(asOf.getHours()).padStart(2, '0')}:${String(asOf.getMinutes()).padStart(2, '0')}${q.data.stale ? ' (update failed)' : ''}`
    : ''

  const grouped = ECONOMIC_INDICATOR_CATEGORIES.map((c) => ({
    category: c,
    items: ECONOMIC_INDICATORS.filter((m) => m.category === c)
  }))

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="gap-1.5">
                {meta ? meta.label : name}
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            {/* 23 件を平坦に並べると探せないので category で区切る */}
            <DropdownMenuContent align="start" className="max-h-[70vh] overflow-auto">
              {grouped.map((g) => (
                <React.Fragment key={g.category}>
                  <div className="px-2 py-1 text-[11px] font-semibold uppercase text-muted-foreground">
                    {g.category}
                  </div>
                  {g.items.map((m) => (
                    <DropdownMenuItem
                      key={m.name}
                      className={m.name === name ? 'bg-accent text-accent-foreground' : ''}
                      onClick={() => setName(m.name)}
                    >
                      {m.label}
                    </DropdownMenuItem>
                  ))}
                </React.Fragment>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <ToggleGroup
            type="single"
            value={range}
            onValueChange={(v) => { if (v) setRange(v as IndicatorRange) }}
          >
            {INDICATOR_RANGES.map((r) => (
              <ToggleGroupItem key={r} value={r} size="sm" aria-label={r}>{r}</ToggleGroupItem>
            ))}
          </ToggleGroup>

          <span className="ml-auto text-xs text-muted-foreground">{asOfLabel}</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => reload.mutate()}
            disabled={reload.isPending}
            aria-label="Reload indicator"
            title="Reload indicator"
          >
            <RefreshCw className={cn('size-4', reload.isPending && 'animate-spin')} />
          </Button>
        </div>

        {/* unit がここに出ることが、水準値と前月比 % の誤読を防ぐ（カレンダーの 'CPI MoM' から来た場合） */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>{meta?.unit ?? ''}</span>
          {latest && (
            <>
              <span className="tabular-nums">
                Latest {formatValue(latest.value)} ({latest.date})
              </span>
              <span className="tabular-nums">Δ {formatDelta(latest.delta)}</span>
            </>
          )}
        </div>
      </div>

      {q.isLoading && <div className="p-3 text-sm text-muted-foreground">Loading indicator…</div>}
      {q.isError && <div className="p-3 text-center text-sm text-muted-foreground">{errorMessage(q.error)}</div>}
      {!q.isLoading && !q.isError && all.length === 0 && (
        <div className="p-3 text-center text-sm text-muted-foreground">No data for this indicator.</div>
      )}

      {!q.isLoading && !q.isError && all.length > 0 && (
        <>
          <div className="min-h-0 flex-1">
            <EconomicIndicatorChart points={visible} />
          </div>
          <div className="max-h-[40%] shrink-0 overflow-auto border-t border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 text-left font-semibold">Date</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Value</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Δ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.date} className="border-t border-border/50">
                    <td className="px-3 py-1 tabular-nums">{r.date}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{formatValue(r.value)}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{formatDelta(r.delta)}</td>
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
import { EconomicIndicatorWindow } from './components/EconomicIndicatorWindow'
```

`isEconomic` の宣言の下に追記する。

```ts
// 統計指標窓も 1 枚だけ。選択中の指標は main が持つので、ハッシュには載せない（EI-06）。
const isEconomicIndicator = parseHash('economicIndicator', window.location.hash) !== null
```

三項演算子のネストに 1 段足す（`isEconomic` の分岐の後）。

```tsx
            : isEconomic
              ? <EconomicCalendarWindow />
              : isEconomicIndicator
                ? <EconomicIndicatorWindow />
                : <App />}
```

- [ ] **Step 4: 型チェックと全テストを実行する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npm run typecheck && npm test
```

Expected: エラーなし、全 PASS

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/010230240/work/vibing-view"
git add src/renderer/components/EconomicIndicatorWindow.tsx src/renderer/api.ts src/renderer/main.tsx
git commit -m "feat(economic-indicators): 指標ウィンドウ（折れ線＋表、プルダウン、範囲ボタン）"
```

---

### Task 12: 入口 2 つ（ヘッダーボタン・カレンダー行）と手動確認

**Files:**
- Modify: `src/renderer/App.tsx`（ヘッダーにボタン 1 つ）
- Modify: `src/renderer/components/EconomicCalendarWindow.tsx`（`EventRow` をクリック可能にする）

**Interfaces:**
- Consumes: `api.economicIndicator.openWindow`（Task 7）、`resolveIndicator` / `DEFAULT_ECONOMIC_INDICATOR`（Task 8）
- Produces: なし（最終タスク）

- [ ] **Step 1: ヘッダーにボタンを足す**

`src/renderer/App.tsx` の 2 行目の lucide import に `ChartLine` を追加する。

```ts
import { CalendarDays, ChartLine, PanelLeftClose, PanelLeftOpen, RefreshCw, Timer, TimerOff } from 'lucide-react'
```

`DEFAULT_ECONOMIC_INDICATOR` を import する。

```ts
import { DEFAULT_ECONOMIC_INDICATOR } from '@shared/economicIndicators'
```

`CalendarDays` ボタン（291-305 行目付近の `api.economic.openWindow()` を呼んでいるブロック）の直後に、同じ形のボタンを追加する。既存ボタンが `Tooltip` で包まれているならその構造をそのままなぞる。

```tsx
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => void api.economicIndicator.openWindow(DEFAULT_ECONOMIC_INDICATOR)}
                  aria-label="Economic indicators"
                  title="Economic indicators"
                >
                  <ChartLine className="size-4" />
                </Button>
```

- [ ] **Step 2: カレンダーの行をクリック可能にする**

`src/renderer/components/EconomicCalendarWindow.tsx` の import に追加する。

```ts
import { ChartLine, ChevronDown, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { resolveIndicator } from '@shared/economicIndicators'
```

`EventRow` を書き換える。行の見た目（過去/未来で変えない、`opacity` を使わない）は維持したまま、対応が付いた行だけをボタンにする。

```tsx
// 主時刻はローカル、右に小さく ET（EC-04: 変換は表示時だけ）。
// 過去/未来で行の見た目は変えない — 透明度は act（実績値）まで読みにくくする。区別は NowMarker に任せる。
// resolveIndicator が名前を返した行（US の主要指標）だけクリックで指標ウィンドウを開く。返さない行
// （US 以外、対応表に無い指標、FOMC のようなイベント）は静的なまま — /economic-indicators は
// US 系列しか持たないので、リンクを張れない行が必ず残る（EI-05）。
function EventRow({ e }: { e: EconomicEvent }): React.JSX.Element {
  const d = new Date(e.time * 1000)
  const hasValues = e.previous != null || e.estimate != null || e.actual != null
  const indicator = resolveIndicator(e.event, e.country)

  const body = (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2 text-sm">
        <span className="w-11 shrink-0 tabular-nums">{format(d, 'HH:mm')}</span>
        <span className="w-16 shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatInTimeZone(d, 'America/New_York', 'HH:mm')} ET
        </span>
        <span className={cn('size-2 shrink-0 rounded-full', IMPACT_DOT[e.impact])} title={e.impact} />
        <span className="w-8 shrink-0 text-xs text-muted-foreground">{e.country}</span>
        <span className="truncate" title={e.event}>{e.event}</span>
        {indicator && <ChartLine className="size-3 shrink-0 text-muted-foreground" />}
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

  if (!indicator) return <div className="px-3 py-1.5">{body}</div>

  return (
    <button
      type="button"
      className="w-full px-3 py-1.5 text-left hover:bg-accent/50"
      onClick={() => void api.economicIndicator.openWindow(indicator)}
      title={`Show ${e.event} history`}
    >
      {body}
    </button>
  )
}
```

- [ ] **Step 3: 型チェックと全テストを実行する**

```bash
cd "C:/Users/010230240/work/vibing-view" && npm run typecheck && npm test
```

Expected: エラーなし、全 PASS

- [ ] **Step 4: 手動確認**

`npm run dev` で起動し、以下を順に確認する。**FMP API キーが Settings に設定されている必要がある。**

```bash
cd "C:/Users/010230240/work/vibing-view" && npm run dev
```

1. ヘッダーの折れ線アイコンをクリック → 指標ウィンドウが開き、CPI の折れ線と表が出る
2. 範囲ボタンで 1Y / 5Y / 10Y / Max を切り替える → グラフと表が変わり、**追加の API リクエストが発生しない**（DevTools の Network か、切替が即座に反映されることで確認）
3. プルダウンで `Unemployment Rate` を選ぶ → 単位が `%` に、値が 4 前後になる
4. リロードボタン → `As of` の時刻が更新される
5. ヘッダーのカレンダーアイコン → 経済カレンダーを開く。`CPI` を含む US の行に折れ線アイコンが付き、`FOMC` や US 以外の行には付かない
6. カレンダーの `CPI` の行をクリック → 指標ウィンドウが CPI に切り替わる（既に開いていればフォーカスされて切り替わる）
7. **EI-06 の競合確認**: 指標ウィンドウを閉じ、カレンダーで `CPI` の行と `Unemployment Rate` の行を **1 秒以内に連続クリック**する → 開いた窓には**後にクリックした指標**（Unemployment Rate）が表示される。CPI が表示されたら pull 方式が効いていないので報告する
8. 窓を閉じて再度ヘッダーから開く → 既定の CPI ではなく、直前に選んでいた指標が出る（main の `selectedIndicator` はプロセス内に残る。これは想定どおりの挙動）

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/010230240/work/vibing-view"
git add src/renderer/App.tsx src/renderer/components/EconomicCalendarWindow.tsx
git commit -m "feat(economic-indicators): ヘッダーボタンとカレンダー行からの遷移"
```

---

## 実装後の確認

すべてのタスクが終わったら、設計書の各項目に対応する実装があるか確認する。

| 設計項目 | 実装 |
|---|---|
| EI-01 API 実測ゲート | Task 1 |
| EI-02 確定判定を持たない（TTL のみ） | Task 5 |
| EI-03 永続化しない | Task 7（`selectedIndicator` はプロセス内 state）、Task 11（範囲は renderer state） |
| EI-04 classify ベースの plan 拒否 latch | Task 6 |
| EI-05 キーワード表 | Task 8 |
| EI-06 窓の同一性と pull 方式 | Task 7、Task 11 |
| EI-07 Δ は絶対差 | Task 9 |
| EI-08 範囲スライスは最新観測日から | Task 9 |
| EI-09 MCP ツール | 非スコープ（将来枠） |
| EI-10 空応答ガード | Task 5 |
| タイムゾーン問題は無い（date 文字列のまま） | Task 2（provider）、Task 10（`time: p.date`） |
| `src/main/calendar/` → `src/main/economic/` | Task 3 |
| 指標レジストリ 23 件 + unit | Task 8 |
| 桁数の指定を持たない | Task 9（`formatValue`） |
| 折れ線は Chart.tsx を使わない | Task 10 |
| 表は範囲スライス後の直近 20 件 | Task 9（`tableRows`）、Task 11 |
| 0 件のとき | Task 11 |
| エラー処理の分岐 | Task 11（`errorMessage`） |
