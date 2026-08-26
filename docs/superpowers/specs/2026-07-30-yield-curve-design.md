# イールドカーブ（`/treasury-rates`） — 設計

日付: 2026-07-30

経済カレンダー（`2026-07-26-economic-calendar-design.md`）・統計指標（`2026-07-27-economic-indicators-design.md`）に続く
経済データ 3 本目。既存 2 本のキャッシュ機構をなぞるが、データの形が「1 日 × 複数満期」なので
テーブルとサービスは別に持つ。

## 目的とスコープ

米国債の満期別利回りを 1 枚の別ウィンドウで見る。

- **上段: カーブ断面** — 横軸が満期（1M〜30Y）、縦軸が利回り。日付を選んで複数のカーブを重ね、
  形の変化（スティープ化・フラット化・逆イールド）を読む。
- **下段: 時間軸の推移** — 満期別の利回りとスプレッド（10Y-2Y / 10Y-3M）を同じトグル群から選び、
  1 枚の折れ線に重ねる。

**非スコープ**:

- 3D サーフェス（時間 × 満期 × 利回り）。読み取りが難しく、断面の重ね描きで同じことが分かる
- フォワードレート・ゼロクーポン曲線・ブートストラップ（補間モデルの設計が別問題）
- 米国以外の国債（エンドポイントが米国債専用。他国は別プロバイダを足すときの話）
- 価格チャートの時間軸への重ね描き（統計指標と同じ理由 — 時間軸の対応付けとペイン管理が別問題）
- MCP ツール `yield_curve()`（`core.yieldCurve.getCurves` を呼ぶだけなので、後から `tools.ts` に
  1 ツール足せば済む → YC-09）
- 選択中の比較日・トグル状態の永続化（統計指標 EI-03 と同じ判断 — 使い捨ての閲覧状態）

## エンドポイントが返すもの

```
GET /stable/treasury-rates?from=YYYY-MM-DD&to=YYYY-MM-DD&apikey=…
```

1 行 = 1 営業日で、`date` と 12 満期のフィールドを持つ。

| フィールド | 満期 |
|---|---|
| `month1` / `month2` / `month3` / `month6` | 1 / 2 / 3 / 6 ヶ月 |
| `year1` / `year2` / `year3` / `year5` / `year7` / `year10` / `year20` / `year30` | 1 / 2 / 3 / 5 / 7 / 10 / 20 / 30 年 |

値は % 表記（`4.25` = 4.25%）。ドキュメント上、`from` / `to` は両方 `YYYY-MM-DD` で機能する
（統計指標の `/economic-indicators` は `from` が効かず `to` からの固定窓しか返さなかった — ここは違う）。

### 1 リクエストで 12 満期が入るのが選定理由（YC-01）

満期別利回りは `/economic-indicators` 経由でも一部取れるが、系列ごとに 1 リクエストかかる。
`/treasury-rates` は **1 リクエストで 1 窓ぶんの 12 満期すべて**を返すので、同じ地平を統計指標の
やり方で組むのに比べて約 1/12 のリクエスト数で済む。「API リクエストの節約が最優先」という
プロジェクト制約に対して、この機能を成立させている唯一の前提。

### 窓上限は定数に依存させない（YC-02）

旧ドキュメントに「`from`/`to` の範囲は 3 ヶ月程度が上限」との記述があり、実測前の想定値は
統計指標と同じ 90 日。ただし**この定数が間違っていても穴が空かない**バックフィルにする（下記
「窓の遡り方」）。応答が要求窓より狭ければ、返ってきた最古の `date` を次の窓の起点にするため、
定数の役割は「1 回で何日ぶん取りにいくか」の最適化だけになる。

実装 1 手目で実測して定数を確定させる（`STEP_DAYS`）。実測項目:

| 確認項目 | 実装前の想定 |
|---|---|
| `from`/`to` で返る最大範囲 | 未実測（想定 90 日） |
| フィールド名と単位 | 上表・% 表記 |
| 行の順序 | 未実測（想定：昇順に直して保持） |
| 一部満期が `null` で返る日 | 未実測（想定：存在する） |
| 現行プランに含まれるか | 未実測（想定：プランに含まれる） |

### タイムゾーン問題は無い

`date` は `"2026-07-29"` の日付のみで時刻を持たないため、UTC/ET のどちらで解釈しても同じ日を指す。
統計指標（EI）と同じく epoch へ変換せず、`date` 文字列をそのまま SQLite に入れ、そのまま
lightweight-charts に渡す（business-day 形式として受け付けられる）。変換コードがどこにも入らない。

## アーキテクチャ

```
FmpProvider.getTreasuryRates(from, to)      ← /treasury-rates?from=&to= + zod
        ↓
TreasuryCurveService                        ← TTL 12h read-through ＋ 地平に足りない分の遡り
        ↓  db/treasuryCurveStore (get / upsert)
core.yieldCurve.getCurves(opts)             ← electron 非依存、Vitest から直接叩ける
        ↓  ipc.ts
renderer: YieldCurveWindow                  ← 断面（SVG）＋ 推移（lightweight-charts）＋ 表
```

名前が 2 系統あるのは意図的。**窓と機能は `yieldCurve`**（ユーザーが見るもの）、**データとテーブルは
`treasuryCurve(s)`**（エンドポイントが返すもの）。断面図を出さない用途でデータだけ使うことがあり得る
（MCP ツール YC-09）ので、データ側の名前を UI の名前に寄せない。

### 新規ファイル

| ファイル | 役割 |
|---|---|
| `src/shared/treasury.ts` | 満期レジストリ（`key` / `label` / `months`）、スプレッド定義、`TREASURY_YEARS` |
| `src/main/db/treasuryCurveStore.ts` | `treasury_curves` の read/write（純粋な blob 出し入れのみ） |
| `src/main/economic/TreasuryCurveService.ts` | TTL 12h read-through ＋ 窓の遡りと date マージ |
| `src/renderer/components/YieldCurveWindow.tsx` | ウィンドウ本体 |
| `src/renderer/components/YieldCurveChart.tsx` | 満期軸の断面（自前 SVG） |
| `src/renderer/components/TreasuryHistoryChart.tsx` | 時間軸の折れ線（lightweight-charts、複数系列） |
| `src/renderer/lib/treasuryCurve.ts` | 断面切り出し・スナップ・系列化・スプレッド・書式の純関数 |
| `tests/fixtures/fmp-treasury-rates.json` | provider テスト用の応答 fixture（`null` 満期を含む） |

### 変更ファイル

| ファイル | 変更 |
|---|---|
| `src/shared/types.ts` | `TreasuryMaturityKey` / `TreasuryCurvePoint` / `TreasuryCurves` / `TreasuryYears` |
| `src/shared/ipc.ts` | `CH` に `treasuryCurves` / `yieldCurveOpenWindow`、`Api.yieldCurve` |
| `src/shared/windowHash.ts` | `WindowKind` に `'yieldCurve'`（singleton、値は固定 `'1'`） |
| `src/main/providers/fmp.schema.ts` | `fmpTreasuryRatesResponse` |
| `src/main/providers/FmpProvider.ts` | `getTreasuryRates(from, to)`（1 窓 1 リクエスト） |
| `src/main/db/schema.ts` | `treasuryCurves` テーブル |
| `src/main/db/client.ts` | `treasury_curves` の `CREATE TABLE IF NOT EXISTS` |
| `src/main/core.ts` | `yieldCurve.getCurves`、`treasuryOutOfPlan` ラッチ、`ProviderLike` に 1 メソッド、`apikey.set` / `apikey.clear` でラッチ解除 |
| `src/main/ipc.ts` | チャンネル 1 本（`treasuryCurves`） |
| `src/main/index.ts` | `CH.yieldCurveOpenWindow` ハンドラ（`economicOpenWindow` と同型の singleton） |
| `src/preload/index.ts` | `api.yieldCurve` |
| `src/renderer/main.tsx` | ハッシュ分岐に 1 本追加 |
| `src/renderer/api.ts` | `qk.treasuryCurves(years)` |
| `src/renderer/App.tsx` | ヘッダーに `TrendingUp` ボタン（`ChartLine` の隣） |

## データモデルとキャッシュ

```
treasury_curves(
  id TEXT PRIMARY KEY, data TEXT NOT NULL, covered_from TEXT NOT NULL, fetched_at INTEGER NOT NULL
)
```

- `id` は固定 `'us'`。行は 1 本しかない。米国債専用のエンドポイントなので現状キーに意味は無いが、
  他国の国債を足すときに `'us'` / `'jp'` で分かれるので、単一行テーブルに PK を無くすより素直
- `data` は取得済みカーブ（`TreasuryCurvePoint[]`、`date` 昇順）の JSON blob。`company_profiles` /
  `economic_indicators` と同じ blob 方針で、満期フィールドの増減にマイグレーションが要らない
- `covered_from` は「どこまで遡って取得済みか」の `'YYYY-MM-DD'`。窓を連続に遡るのでカバー範囲は
  常に `[covered_from, 最新]` の 1 区間で表せ、`bars` のような区間リストは要らない
- `fetched_at` は TTL 判定用（epoch 秒）

5Y 地平の `data` は約 1250 営業日 × 12 値で、JSON にして 250KB 程度。1 窓の取得ごとに読み書きする
コストとしては許容範囲（`economic_indicators` と同じ扱い）。

### 契約は統計指標と同じ（EI-02 / EI-10 を踏襲）

- **TTL 12h は直近窓の取り直しにだけ掛かる。確定判定は持たない** — 財務省の公表値は基本的に改訂
  されないが、確定判定を入れる利益（リクエスト 0 本ぶん）が、入れる複雑さに見合わない
- **書き込みは `date` キーの union** — フェッチ結果で丸ごと置き換えないので、仕様変更で満期が
  増減しても既存履歴を壊せない。書く直前にストアを読み直して union する（別の地平要求との競合対策）
- **途中で落ちたら 1 バイトも書かない** — `covered_from` だけ進めると埋まっていない範囲を
  「取得済み」と記録し、その穴は以後どのリクエストでも埋まらない。既存行があれば `stale: true` で返す
- **空応答も「落ちた」に含める** — 統計指標は四半期系列が合法的に空窓を返すので空を異常扱いしないが、
  85 日窓に営業日が 1 日も無いことはないので、こちらでは空応答は取得失敗（200 + 空配列のプラン拒否、
  仕様変更）でしかありえない。前進させると `covered_from` が穴を跨いで「取得済み」になる
- **地平を狭めても `covered_from` は狭めない** — 5Y を取ったあと 1Y に戻して再取得しない
- **`force` は TTL を無視するだけ**（`company.info` と同じ）。統計指標の `force` は行を捨てるが、
  それは FRED 系列の改訂を古い窓まで取り込むため。財務省の公表値は改訂されないので捨てる利益が無く、
  捨てると 5Y のあと 1Y で `force` した瞬間に 4 年ぶんが消え、次の 5Y 表示で 22 リクエストかかる。
  取り直した窓は同じ `date` を上書きし、`covered_from` と窓の外の履歴はそのまま残す

### 窓の遡り方（YC-02 の続き）

`[wantFrom, today]` を窓に割って新しい側から取る。`from` が効くので、統計指標と違って窓の両端を
指定できる（無駄な行を受け取らない）。

```
let t = to
while (t >= wantFrom) {
  const rows = await fetch(shiftUtcDay(t, -STEP_DAYS), t)
  // 空応答は取得失敗として扱い、既存行を stale で返してここで抜ける（上記の契約）。
  if (rows.length === 0) return staleOrThrow()
  merge(rows)
  const oldest = rows[0].date   // 昇順なので先頭が最古
  // 応答が要求窓より狭い＝API 上限が STEP_DAYS 未満。返ってきた最古の 1 日前を次の窓の終端に
  // すれば、上限が何日でも隙間なく遡れる。
  t = oldest > shiftUtcDay(t, -STEP_DAYS) ? shiftUtcDay(oldest, -1) : shiftUtcDay(t, -STEP_DAYS)
}
```

前進量は必ず 1 日以上あるので無限ループしない（`oldest <= t` なので `oldest - 1 < t`）。空応答で
抜けるので、`oldest` が無いまま前進できずに回り続ける経路も無い。
`STEP_DAYS` は実測上限より 5 日小さく取り、境界の inclusive/exclusive の取り違えを吸収する
（統計指標の 85 日ステップと同じ手）。

リクエスト数は 85 日ステップで **1Y = 5 本 / 5Y = 22 本**（`ceil(1826 / 85)`）。これで 12 満期すべてが
揃う。テストの期待値は固定クロックと `STEP_DAYS` から計算して書く（この本数を定数として埋めない）。

TTL 更新のときの起点は `min(fetched_at, now)` の日（クロック後退の保護）。前回取得から `STEP_DAYS` 以上
開いた行を 1 窓だけで更新すると、その間が誰にも取得されない穴として残る。

### `null` 満期を落とさない（YC-03）

一部の満期だけが `null` で返る日は実在する。20 年債・30 年債はどちらも過去に発行と公表が
止まっていた期間があり（30 年債は 2002〜2006 が代表例）、その期間の行は他の満期だけが埋まる。
1 日の中で 11 満期が有効・1 満期だけ欠測というのが普通の状態。5Y 地平では該当しない可能性が高いが、
`null` を許容しない実装にすると、地平を広げた瞬間に日が消える。

統計指標（EI）は `value == null` の観測を provider で落としているが、あれは 1 系列なので落とせば
済む。こちらで同じことをすると**行ごと落ちて日が消える**。したがって:

- schema は 12 満期すべて `null` 許容で受ける
- `TreasuryCurvePoint.rates` は `Record<TreasuryMaturityKey, number | null>` として `null` を保持する
- 断面図はその満期の点を打たず、線を**そこで切る**（0 として繋ぐと利回りが暴落したように見える）。
  連続する非 `null` 区間ごとに `polyline` を分ける
- 推移チャートは `null` の日を **whitespace（`{ time }` だけの点）** として渡す。点を省くだけでは
  lightweight-charts が前後の値を直線で繋ぎ、欠測が無かったように見える
- スプレッドは片側が `null` の日を計算しない（`null` - 4.2 = -4.2 になる事故を防ぐ）

`date` が UTC 日として往復しない行だけは落とす（`shiftUtcDay(date, 0) === date`）。正規表現の形だけ
見ると `'2026-99-99'` が通り、それが窓の最古になった瞬間 `shiftUtcDay` が `Invalid Date` の
`toISOString()` で throw してバックフィルが止まる。往復判定は既存関数 1 回で済む。

### なぜ `economic_indicators` に混ぜないか（YC-04）

`economic_indicators` は `name` PK で `data` が `{date, value}[]`。ここに `name='treasuryRates'` で
`{date, rates}[]` を入れると、同じ列に 2 種類の blob が入る。読む側はどちらか分からないまま
`JSON.parse` するので、型の取り違えが実行時まで出ない。テーブルを分ければ store の戻り型で分かれる。

### なぜサービスを共通化しないか（YC-05）

`TreasuryCurveService` と `EconomicIndicatorService` は TTL・union マージ・stale フォールバックの
構造がよく似ている。それでも共通化しない:

- 窓の刻み方が違う（あちらは `to` だけを刻む固定 90 日窓、こちらは `from`/`to` のペアで応答幅に追従）
- マージの単位が違う（`value: number` vs `rates: Record<key, number|null>`）
- 空応答と `force` の扱いが逆（あちらは空を正常・`force` で行を捨てる、こちらは空を失敗・`force` で
  履歴を残す）。系列が改訂されるかどうかと、空窓が合法かどうかで分岐が反転する
- 共通化して残るのは日付算術だけで、それは既に `src/shared/utcDay.ts` にある

ジェネリックなキャッシュサービスに寄せると、両方の呼び出し側が型パラメータ越しに読むことになり、
どちらも読みにくくなる。3 本目の経済データが同じ構造で来たら、その時点で 3 本を見て抽出する。

## 型

```ts
// src/shared/types.ts
export type TreasuryMaturityKey =
  | 'month1' | 'month2' | 'month3' | 'month6'
  | 'year1' | 'year2' | 'year3' | 'year5' | 'year7' | 'year10' | 'year20' | 'year30'

// 1 営業日ぶんのカーブ。null は「その満期の債券がその日に存在しない/未公表」（YC-03）。
export type TreasuryCurvePoint = {
  date: string // 'YYYY-MM-DD'
  rates: Record<TreasuryMaturityKey, number | null>
}

// 取得地平。85 日ステップで 1Y = 5 リクエスト / 5Y = 22 リクエスト。
export type TreasuryYears = 1 | 5

export type TreasuryCurves = {
  points: TreasuryCurvePoint[] // date 昇順
  coveredFrom: string
  fetchedAt: number // epoch 秒
  stale?: boolean   // 更新に失敗して既存行を返した
}
```

## 満期レジストリ（`src/shared/treasury.ts`）

満期のキー・ラベル・月数を 1 箇所に置く。schema のフィールド名と renderer のラベル・軸の並びが
同じ表を見るので shared（`economicIndicators.ts` と同じ判断）。

```ts
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

export const TREASURY_YEARS: TreasuryYears[] = [1, 5]
```

`months` を持つのは表示順の根拠を 1 箇所にするためで、横軸の座標には使わない（下記 YC-07）。
既定は先頭の `1` — 初回に開いたときのリクエストが 5 本で済むほうを選ぶ（統計指標と同じ判断）。

## UI

### 開き方

`App.tsx` のヘッダーに `TrendingUp` ボタンを 1 つ足す（経済カレンダーの `CalendarDays`、統計指標の
`ChartLine` の隣）。窓は singleton で、2 回目以降の呼び出しは既存窓にフォーカスするだけ
（`#yieldCurve=1`、経済カレンダー窓 EC-09 と同型）。統計指標窓と違い main が選択状態を持つ必要が
ないので、`onSelect` に相当する経路は無い。

### レイアウト

```
┌──────────────────────────────────────────────────────────────┐
│ Yield Curve   [1Y][5Y]   Compare: [2026-06-30 ×][2025-07-31 ×] [+ 日付]  As of … ↻ │
│ US Treasury constant maturity · %                            │
├──────────────────────────────────────────────────────────────┤
│  4.9 ┤ ●──●                                                  │
│      │      ╲●──●                          ← 実線 = 最新       │
│  4.3 ┤            ╲●──●───●───●───●          破線 = 比較日      │
│      └──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──                │
│        1M 2M 3M 6M 1Y 2Y 3Y 5Y 7Y 10Y 20Y 30Y                │
├──────────────────────────────────────────────────────────────┤
│ ☐1M ☐2M ☑3M ☐6M ☐1Y ☑2Y ☐3Y ☐5Y ☐7Y ☑10Y ☐20Y ☐30Y │ ☑10Y-2Y ☐10Y-3M │
│  5% ┤    ──────────────  10Y                                 │
│  4% ┤╱‾‾╲___╱‾‾‾‾‾‾‾‾   2Y                                   │
│  0% ┼───────────────────  10Y-2Y（ゼロライン）                  │
├──────────────────────────────────────────────────────────────┤
│ Maturity │ Latest │ 2026-06-30 │ Δ │ 2025-07-31 │ Δ          │
└──────────────────────────────────────────────────────────────┘
```

上段の断面と下段の推移が縦を分け合い、最下部に表。比率は断面 40% / 推移 40% / 表 20% 程度で、
表は `overflow-auto`（統計指標窓と同じ構成）。テーマは `api.settings.getTheme()` → `applyTheme` を
マウント時に 1 回（他の別ウィンドウと同じ）。

### 比較日の選択（YC-06）

基準は常に**最新の営業日**で、削除できない。比較日は `<input type="date">` で追加する
（ネイティブのピッカーなので依存を増やさない）。追加した日はチップとして並び、`×` で削除。

- **上限 3 本**（基準と合わせて 4 本）。それ以上重ねると断面図が読めない
- **ピッカーの `min` / `max` はキャッシュ範囲**（`coveredFrom` 〜 最新）に縛る。範囲外を選ばせない
  限り、追加フェッチも「まだ取得していない日」の分岐も発生しない。1Y で足りなければ 5Y に広げる。
  `coveredFrom` は狭まらないので、一度 5Y を取れば 1Y に戻しても選べる範囲は 5 年ぶんのまま
- **地平を狭めても追加済みのチップは消さない**。断面図はキャッシュ済みの全 `points` から日付を
  引くので、下段の折れ線のスライス（1Y）より古い比較日でも断面には出せる
- **選んだ日にデータが無ければ、その日以前で最も近い営業日にスナップ**する。土日祝と、財務省が
  公表を飛ばした日がこれに当たる。チップにはスナップ後の実際の日付を出す（黙って別の日を見せない）。
  遡ってもデータが無い場合（`coveredFrom` より前）はチップを追加しない
- 同じ日が既にあれば追加しない（重複チップで色を消費しない）

色は `--primary` 1 色で、**新しい順に不透明度を落として破線パターンを変える**（実線 → 破線 →
点線 → 一点鎖線）。比較日は「最新 vs より古い」の順序尺度なので、カテゴリカルな色分けより
順序が読める。テーマトークンを増やさずに済むのも大きい。

満期ごとの点には `<title>` を付ける（ブラウザネイティブのツールチップ）。クロスヘアや hover 状態の
実装は入れない — 点が 12 個しかなく、正確な値は下の表で読める。

### 下段の重ね方（YC-07 / トグル）

満期 12 個とスプレッド 2 個を同じトグル群に並べ、選んだものを 1 枚の折れ線に重ねる。単位が全部 %
なので同一の価格軸で成立し、縦を 2 分割しなくて済む。**スプレッドを 1 つ以上選んでいる間だけ
ゼロラインを引く**（利回りだけ見ているときにゼロラインは意味を持たない）。

既定 ON は `3M` / `2Y` / `10Y` と `10Y-2Y`。初回に開いた画面で逆イールドが読める組み合わせ。

線の色は満期の**順序**から作る（`hsl(210 - i*15, 70%, 55%)` 相当の 1 行）。満期はカテゴリではなく
順序尺度なので、短期＝寒色 → 長期＝暖色のランプにすると凡例を見なくても長短が分かる。明度を
固定するのでライト/ダーク両方で読める（ローソク足の up/down 色を固定しているのと同じ判断）。
スプレッドは `--muted-foreground` の破線 — 利回りの線とは別の量なので、ランプの外に置く。

横軸の並びは `MATURITIES` の順（等間隔）。`months` に比例させた対数軸にはしない。等間隔のほうが
短期側（1M〜1Y に 5 満期ある）の形が読め、逆イールドの起点が分かる。

### 表

行が満期。列は `Maturity | Latest` に続いて、**比較日ごとに「その日の値」と「最新との差」の 2 列**
（`2026-06-30 | Δ`）を足す。差を 1 列にまとめると、比較日が 2 本以上あるときどちらとの差なのかが
決まらない。比較日が 0 本なら `Latest` 列だけになる。

値は 2 桁固定（`4.31`）。統計指標の一律 `toLocaleString`（最大 2 桁）だと `4.3` と `4.31` が桁で
揃わず、10bp の差が読み取りにくい。利回りは全系列が同じ単位・同じ桁数なので、固定してよい。
差も同じ % ポイント・2 桁固定に符号を付ける（`+0.12`）。bp 表記に変換しない — 断面図の縦軸・
ツールチップ・表で単位が 2 種類になると、`0.12` と `12` のどちらが何なのか都度読み替えることになる。
`null` 満期と、片側が `null` で計算できない差は `—`。

### 0 件のとき / 地平を広げている間

- 取得できたカーブが 0 件: `No treasury data available.`
- 1Y → 5Y は 22 リクエストを直列に取るので `Fetching 5Y history…` を出す。統計指標窓と同じく
  `placeholderData` で前の地平の画面を残しつつ `isLoading` を落として、無言で固まらせない
- **取得に成功したら、いま表示していない地平の query key を invalidate する**。`staleTime: Infinity`
  なので、しないと 5Y を取ったあと 1Y に戻したときに古い snapshot が出続け、日付ピッカーの下限も
  その snapshot の `coveredFrom` に縛られたままになる。invalidate 後の再取得は TTL 内ならネットワークに
  出ない（`getCurves` が行を返して終わる）ので、リクエストは増えない

## エラー処理

`errorMessage()` の分岐は統計指標窓からそのまま流用（`NO_API_KEY` / 401 / 429 / その他 4xx・200 /
ネットワーク）。200 の枝の文言は
`Treasury rates aren't available on your current FMP plan, or FMP returned an unexpected response.`
にする。`parseOrThrowHttpError` はスキーマ不一致もすべて `FmpHttpError(200)` にするので、この枝には
プラン拒否（200 + `{"Error Message": …}`）と FMP 側のフィールド名変更の両方が入る。統計指標窓の
「プラン外」断定はそこで嘘になるが、意味コード（`REQUIRES_PLAN` / `INVALID_PROVIDER_RESPONSE`）を
IPC に通すのは 3 窓ぶんの経路を巻き込むので別作業（YC-12）。ここでは文言をどちらでも成り立つ形にする。

### プラン外の空撃ち対策（YC-08）

`core.ts` に `treasuryOutOfPlan` ラッチを 1 本追加する。カレンダー（`economicOutOfPlan`）・統計指標
（`economicIndicatorOutOfPlan`）と**共用しない** — 片方の拒否でもう片方が使えなくなる。判定は既存の
`isPlanDenial`（`classify(status, body)` が `'requires-plan'`）で、200 + `{"Error Message": …}` の
拒否も拾える。

ラッチは `fetch` の先頭で見る。1 回の `getCurves` が最大 22 窓を直列に取るので、1 窓目で拒否されたら
残りを空撃ちしない。`apikey.set` / `apikey.clear` でクリアする（新しいキーが対応している可能性がある）。

## テスト

| ファイル | 内容 |
|---|---|
| `tests/main/providers/treasuryRates.test.ts` | fixture のパース、12 満期のマッピング、`null` 満期の保持、UTC 日として往復しない `date`（`'2026-99-99'`）の行だけ落ちる、昇順に直る、スキーマ外 body → `FmpHttpError(200)` |
| `tests/main/economic/TreasuryCurveService.test.ts` | 初回取得、TTL 内はネットワークに出ない、TTL 切れで直近窓だけ取り直す、1Y→5Y のバックフィル窓数（固定クロックと `STEP_DAYS` から計算した期待値）、**応答が要求窓より狭いとき次の窓が返却最古に追従する**、**空応答で `stale` を返し `coveredFrom` を進めない**、`date` union マージ、途中失敗で `stale` を返し 1 バイトも書かない、`coveredFrom` を狭めない、**`force` が TTL を無視しつつ窓の外の履歴と `coveredFrom` を残す**、`fetched_at` が未来のとき取り直す |
| `tests/main/core/yieldCurve.test.ts` | `treasuryOutOfPlan` ラッチ（1 窓目の拒否で以後ネットワークに出ない、カレンダー・指標のラッチと独立、`apikey.set` で解除） |
| `tests/renderer/treasuryCurve.test.ts` | `curveAt`、`snapToDate`（休日で前営業日に戻る / `coveredFrom` より前は `null`）、`seriesFor`（`null` の日が whitespace 点になる）、`curveSegments`（`null` 満期で区間が分かれる）、`spreadSeries`（片側 `null` の日を計算しない）、`sliceRange`、`formatRate`（2 桁固定・`null` → `—`）、`tableColumns`（比較日ごとに値と Δ の 2 列） |
| `tests/windowHash.test.ts` | `'yieldCurve'` の往復、他の kind の hash として解釈されない |

### テストしないもの

- SVG の描画結果（座標計算は `treasuryCurve.ts` の純関数側でテストし、`<svg>` の DOM は見ない）
- lightweight-charts の描画（既存のチャートコンポーネントと同じ扱い）
- ウィンドウの開閉（`main/index.ts` の singleton ロジックは既存 2 窓と同型）

## 将来枠

- **YC-09**: MCP ツール `yield_curve()` — `core.yieldCurve.getCurves` を呼ぶだけ
- **YC-10**: 断面のアニメーション再生（日付をスライダーで送る）。断面 4 本の重ねで足りているか
  使ってから判断する
- **YC-11**: 他国の国債。`treasury_curves.id` が `'us'` 固定なのは既にここへの入口
- **YC-12**: プロバイダ層の 2 件。(a) `ProviderLike` を `Pick<FmpProvider, …>` から独立した
  interface（CLAUDE.md の `DataSourceAdapter`）に切り出す、(b) プロバイダのエラーを意味コードに
  翻訳して `FmpHttpError(200)` の多義性を解く。どちらも既存 8 メソッド・3 窓を巻き込むので、
  この機能では既存の形に合わせる（1 メソッド追加・文言で吸収）
