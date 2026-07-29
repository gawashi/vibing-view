# 統計指標（`/economic-indicators`） — 設計

日付: 2026-07-27

経済カレンダー（`2026-07-26-economic-calendar-design.md`）が EC-16 として残した将来枠の実装。

## 目的とスコープ

FMP の `/stable/economic-indicators` を使い、マクロ経済指標の過去推移を折れ線で見る。対象は別ウィンドウ
1 枚で、経済カレンダーの行をクリックするとその指標の推移が出る。

**非スコープ**:

- 価格チャートの時間軸への重ね描き（時間軸の対応付けとペイン管理が別問題）
- US 以外の国の指標（API が US 系列しか持たない。FRED 直や別プロバイダを足すときの話）
- MCP ツール `economic_indicator(name)`（`core.economicIndicator.getSeries` を呼ぶだけなので、後から
  `tools.ts` に 1 ツール足せば済む → EI-09）
- 複数指標の重ね表示・比較（単位が系列ごとに違うので、意味のある重ね方には正規化の設計が必要）
- 選択中の指標と表示範囲の永続化（EI-03）

## エンドポイントが返すもの

`GET /stable/economic-indicators?name=CPI&from=YYYY-MM-DD&to=YYYY-MM-DD&apikey=…`

1 観測あたり `name` / `date` / `value` の 3 フィールドだけ。単位も国も返らない。`name` は FMP が
定義した固定の系列名しか受け付けず、任意の指標を要求できない。

### 実測結果（EI-01 — 2026-07-27 に確定）

実 API で確認済み。**当初の「全履歴が 1 リクエストで返る」という前提は誤りだった**ため、
下記「データモデルとキャッシュ」を書き換えてある。以下は実測値。

| 確認項目 | 実測 |
|---|---|
| フィールド | `{ name, date, value }` の 3 つのみ。`unit` は**返らない** → レジストリの `unit` ハードコードは必要 |
| `date` の形 | `"2025-09-01"` の日付のみ。時刻なし → 「タイムゾーン問題は無い」は成立 |
| 返る範囲 | **`to` から遡って 90 日ちょうどの窓のみ**。`from` では窓を広げられない |
| `name` の集合 | 代表 7 本（CPI / unemploymentRate / federalFunds / GDP / consumerSentiment / 30YearFixedRateMortgageAverage / smoothedUSRecessionProbabilities）すべて観測配列を返す → 23 本の表は維持 |
| 無効なキー | HTTP `401` + `{ "Error Message": "Invalid API KEY. Feel free to create a Free API Key..." }`。`classify()` は小文字化して `/invalid api key/` に当たるので `'requires-plan'` を返す → EI-04 の前提は成立 |

窓が 90 日である証拠（週次系列で計測）:

```
name=30YearFixedRateMortgageAverage&to=2025-12-31 → 14 行 [2025-10-02 .. 2025-12-31]  span 90d
name=30YearFixedRateMortgageAverage&to=2025-06-30 → 13 行 [2025-04-03 .. 2025-06-26]
name=CPI&from=1900-01-01                          →  0 行（from は窓を広げない）
name=CPI&from=2015-01-01&to=2025-12-31            →  2 行 [2025-11-01 .. 2025-12-01]
name=GDP&from=2015-01-01&to=2025-12-31            →  0 行（四半期系列は窓に観測が無いと空）
```

ここから確定した 3 点:

1. **窓は `[to - 90日, to]` の閉区間で、境界に隙間が無い。** `to` を 90 日ずつ後ろへずらせば連続に
   遡れる（実装では 85 日ステップにして 5 日重ね、date でデデュープする）。
2. **四半期系列は合法的に空を返す。** 窓にたまたま観測が無いだけで、廃止でも障害でもない。
   EI-10 の空応答ガードは「空 = 異常」と決め打ちしてはいけない（下記）。
3. **実データに欠測日がある。** CPI の `2025-10-01` は存在しない（窓の継ぎ目の取りこぼしではなく、
   FMP 側にその観測が無い）。欠測を前提に、日付の連続性でキャッシュ充足を判定してはいけない。

全履歴を取るなら CPI で約 450 リクエスト、10 年 × 23 本で約 920 リクエストになり、
「API リクエストの節約が最優先」と正面から衝突する。したがって**取得地平を 1Y / 5Y に絞り、
必要になった時だけ遡る**（下記）。

### タイムゾーン問題は無い

カレンダーで確定に手間を要した `date` の基準問題（EC-02）は、この機能には存在しない。`date` は
`"2026-06-01"` の日付のみで時刻を持たないため、UTC/ET のどちらで解釈しても同じ日を指す。
したがって epoch への変換をせず、`date` 文字列をそのまま保持して SQLite に入れ、そのまま
lightweight-charts に渡す。変換コードがどこにも入らない。

## アーキテクチャ

Company info の経路をなぞる。カレンダーの `EconomicCalendarService` にある確定判定と欠け範囲の算出は
持たない（理由は下記「なぜ確定判定を持たないか」）。

```
FmpProvider.getEconomicIndicator(name, to)       ← /economic-indicators?name=&to= （90 日窓）+ zod
        ↓
EconomicIndicatorService                         ← TTL 12h read-through ＋ 地平に足りない分の遡り
        ↓  db/economicIndicatorStore (get / upsert)
core.economicIndicator.getSeries(name, opts)     ← electron 非依存、Vitest から直接叩ける
        ↓  ipc.ts
renderer: EconomicIndicatorWindow                ← プルダウン、範囲ボタン、折れ線＋表
```

### 新規ファイル

| ファイル | 役割 |
|---|---|
| `src/shared/economicIndicators.ts` | 23 件のレジストリ + カレンダー `event` → `name` のキーワード表と `resolveIndicator` |
| `src/main/db/economicIndicatorStore.ts` | `economic_indicators` の read/write（純粋な blob 出し入れのみ） |
| `src/main/economic/EconomicIndicatorService.ts` | TTL 12h read-through ＋ 90 日窓の遡りと date マージ |
| `src/renderer/components/EconomicIndicatorWindow.tsx` | ウィンドウ本体 |
| `src/renderer/components/EconomicIndicatorChart.tsx` | 折れ線 1 本 |
| `src/renderer/lib/economicIndicatorSeries.ts` | 範囲スライスと Δ の純関数 |
| `src/renderer/lib/chartTheme.ts` | `Chart.tsx` に閉じている `cssHsl` / `chartThemeOptions` を出して折れ線と共有する |

### 変更ファイル

| ファイル | 変更 |
|---|---|
| `src/shared/types.ts` | `EconomicIndicatorPoint` / `EconomicIndicatorSeries` |
| `src/shared/ipc.ts` | `CH` に `economicIndicator` / `economicIndicatorOpenWindow` / `economicIndicatorSelected` / `economicIndicatorSelect`、`Api.economicIndicator`（`getSeries` / `openWindow` / `getSelected` / `onSelect`） |
| `src/shared/windowHash.ts` | `WindowKind` に `'economicIndicator'` |
| `src/main/providers/fmp.schema.ts` | `fmpEconomicIndicatorResponse` |
| `src/main/providers/FmpProvider.ts` | `getEconomicIndicator(name, to)`（90 日窓 1 本） |
| `src/main/db/schema.ts` | `economicIndicators` テーブル（`covered_from` を含む） |
| `src/main/db/client.ts` | `economic_indicators` の `CREATE TABLE IF NOT EXISTS` |
| `src/renderer/components/Chart.tsx` | `cssHsl` / `chartThemeOptions` を `lib/chartTheme.ts` へ移して import に置き換える |
| `src/main/core.ts` | `economicIndicator.getSeries`、`economicIndicatorOutOfPlan` フラグ（`classify` を import）、`economicOutOfPlan` の latch 条件を `classify` に変更、`ProviderLike` に 1 メソッド追加 |
| `src/main/ipc.ts` | チャンネル 1 本（`economicIndicator`） |
| `src/main/index.ts` | `selectedIndicator` の state、`CH.economicIndicatorOpenWindow` / `CH.economicIndicatorSelected` ハンドラ |
| `src/preload/index.ts` | `api.economicIndicator` |
| `src/renderer/main.tsx` | ハッシュ分岐に 1 本追加 |
| `src/renderer/api.ts` | `qk.economicIndicator(name)` |
| `src/renderer/App.tsx` | ヘッダーに `ChartLine` ボタン（`CalendarDays` の隣） |
| `src/renderer/components/EconomicCalendarWindow.tsx` | 行クリックで指標ウィンドウを開く |

### 移動

`src/main/calendar/` → `src/main/economic/`（`tests/main/calendar/` も同様）。指標サービスは経済
ドメインの 2 本目で、`calendar/` に置くと名前が実体と合わず、隣に新フォルダを作ると 1 ドメインが
2 箇所に散る。移動は 1 ファイルと import 2 箇所（`core.ts` とそのテスト）。

## データモデルとキャッシュ

```
economic_indicators(
  name TEXT PRIMARY KEY, data TEXT NOT NULL, covered_from TEXT NOT NULL, fetched_at INTEGER NOT NULL
)
```

- `name` は FMP の系列名そのまま
- `data` は取得済み観測（`EconomicIndicatorPoint[]`、date 昇順）の JSON blob。`company_profiles` と
  同じ blob 方針で、フィールド追加時のマイグレーションを不要にする
- `covered_from` は**どこまで遡って取得済みか**の `'YYYY-MM-DD'`。窓を 90 日ずつ連続に遡るので、
  カバー範囲は常に `[covered_from, 最新]` の 1 区間で表せる。`bars` のような区間リストは要らない
- `fetched_at` は epoch 秒。TTL 12 時間（43200 秒）は**直近窓の取り直しにだけ**掛かる

### 取得地平を絞って必要な時だけ遡る

エンドポイントが 90 日窓しか返さない（EI-01）ため、全履歴は現実的な回数で取れない。代わりに
**表示できる地平を 1Y / 5Y に限定**し、その地平に足りない分だけ遡る。

`getSeries(name, { years, force })` の手順:

1. `wantFrom = 今日 - years`（文字列で計算）
2. `needBackfill = 行が無い || covered_from > wantFrom`
3. `needRefresh = force || 行が無い || now - fetched_at >= TTL`
4. どちらも false ならキャッシュをそのまま返す（ネットワークに出ない）
5. 取りに行く窓:
   - `needRefresh` なら最新窓（`to = 今日`）を 1 本
   - `needBackfill` なら `to` を `covered_from` から **85 日ずつ**後ろへずらして `wantFrom` を
     下回るまで。90 日窓に対し 5 日重ねるのは、境界の inclusive/exclusive の取り違えと
     月末日のずれを吸収するため
6. 取得した観測を既存 `data` に**date キーでマージ**する（後から取った値が勝つ）
7. `covered_from = min(wantFrom, 旧 covered_from)`、`fetched_at = now` で書き戻す

リクエスト数は 1Y の初回で約 5、5Y へ広げる時に追加で約 17。以後その指標は 12 時間ごとに
最新窓 1 本だけ。永続キャッシュなので遡りは一度きり。

### なぜ確定判定を持たないか（EI-02 — 改訂）

カレンダーは「その日の翌 00:00 UTC 以降に取得した行は確定」として以後フェッチしない（EC-06）。
指標にはこれを適用しない。FRED 由来の系列は改訂されるため（GDP は速報・改定・確定で 3 回変わる）、
過去分を確定として固定すると古い速報値が残り続ける。

ただし当初案の「全履歴を TTL で取り直して改訂を吸収する」は 90 日窓では成立しない。
**改訂を吸収できるのは直近 90 日窓の範囲だけ**で、それより古い観測の改訂は取り込まれない。
これは地平を絞るコストとして受け入れる。古い改訂まで反映したい時はリロードボタン（`force`）が
その指標の行を捨てて現在の地平を取り直す。

### 却下した方式

- **全履歴の一括バックフィル**: CPI で約 450 リクエスト、10 年 × 23 本で約 920。
  「API リクエストの節約が最優先」と衝突する
- **日単位キャッシュ**（`economic_days` と同形）: 指標は月次・四半期発表なので、日単位のキーは
  ほぼ空行になる
- **`bars` と同じ区間リスト管理**: 遡りが常に連続なのでカバー範囲は 1 区間で足り、区間の
  マージ・分割は不要

### 空レスポンスで既存履歴を上書きしない（EI-10 — 改訂）

**マージ方式にしたことで、当初の「空なら上書きしない」ガードは不要になった。** 書き込みは
既存 `data` への date キーでの union であり、フェッチ結果でまるごと置き換えないので、空応答は
単に「何も足さない」で終わる。一時的な空応答も、FMP 側の仕様変更も、`name` の打ち間違いも、
既存履歴を壊せない。

これは重要で、**四半期系列は合法的に空窓を返す**（EI-01 実測: `GDP` の 90 日窓に観測が無い）。
当初案の「空 = 異常なので `stale: true`」という決め打ちは、GDP を毎回 stale 表示にしてしまう。

残る 1 ケースだけ明示的に扱う: **行が無く、遡った窓がすべて空だった場合**は、`points: []` と
`covered_from = wantFrom` を持つ行を書く。書かないと窓を開くたびに空撃ちを繰り返す。

### force

リロードボタンは `{ force: true }` で、その指標の行を捨てて現在の地平ぶんを取り直す
（1Y なら約 5 リクエスト）。TTL を無視するだけの `company.info` とは違い、遡り分も取り直すので
古い観測の改訂も反映される。押した時だけコストが出る、明示的な操作。

## 型

```ts
export type EconomicIndicatorPoint = { date: string; value: number } // date は 'YYYY-MM-DD'

// fetchedAt は行の取得時刻。stale は「古い行を返した、再取得は失敗した」
// — fetchedAt だけでは区別できない（CompanyInfo と同じ理由）。
// coveredFrom は遡って取得済みの下限 'YYYY-MM-DD'。renderer が「この地平はもう出せる」を
// 判断するのではなく、表示中の地平が実際にどこまで埋まっているかを As of 行に出すために持つ。
export type EconomicIndicatorSeries = {
  name: string
  points: EconomicIndicatorPoint[] // date 昇順
  coveredFrom: string
  fetchedAt: number
  stale?: boolean
}
```

取得地平は `1Y | 5Y` の 2 つだけ（EI-01 の 90 日窓により 10Y / Max は落とした）。既定は `1Y`
— 初回に開いた指標で約 5 リクエストに収まる方を既定にする。

`value` が `null` の観測（FRED の欠測）は provider で落とす。折れ線に穴を開ける表現は要らないし、
表の Δ 計算が `null` を持ち回らずに済む。

## 指標レジストリ（`src/shared/economicIndicators.ts`）

```ts
export type EconomicIndicatorCategory =
  'Growth' | 'Inflation' | 'Labor' | 'Rates' | 'Consumer' | 'Housing'

export type EconomicIndicatorMeta = {
  name: string
  label: string
  category: EconomicIndicatorCategory
  unit: string
}
```

`shared` に置くのは、renderer（プルダウンとラベル）とカレンダー連携（キーワード表）が同じ表を
見るため。

| name | label | category | unit |
|---|---|---|---|
| `GDP` | Gross Domestic Product | Growth | Bil. $ (SAAR) |
| `realGDP` | Real GDP | Growth | Bil. chained 2017 $ |
| `nominalPotentialGDP` | Nominal Potential GDP | Growth | Bil. $ |
| `realGDPPerCapita` | Real GDP per Capita | Growth | Chained 2017 $ |
| `industrialProductionTotalIndex` | Industrial Production | Growth | Index 2017=100 |
| `durableGoods` | Durable Goods Orders | Growth | Mil. $ |
| `totalVehicleSales` | Total Vehicle Sales | Growth | Mil. units (SAAR) |
| `CPI` | Consumer Price Index | Inflation | Index 1982-84=100 |
| `inflationRate` | Inflation Rate | Inflation | % YoY |
| `inflation` | Inflation | Inflation | % |
| `unemploymentRate` | Unemployment Rate | Labor | % |
| `totalNonfarmPayroll` | Nonfarm Payroll | Labor | Thousands of persons |
| `initialClaims` | Initial Jobless Claims | Labor | Claims |
| `federalFunds` | Federal Funds Rate | Rates | % |
| `3MonthOr90DayRatesAndYieldsCertificatesOfDeposit` | 3-Month CD Rate | Rates | % |
| `commercialBankInterestRateOnCreditCardPlansAllAccounts` | Credit Card Interest Rate | Rates | % |
| `30YearFixedRateMortgageAverage` | 30-Year Mortgage Rate | Rates | % |
| `15YearFixedRateMortgageAverage` | 15-Year Mortgage Rate | Rates | % |
| `consumerSentiment` | Consumer Sentiment | Consumer | Index 1966Q1=100 |
| `retailSales` | Retail Sales | Consumer | Mil. $ |
| `retailMoneyFunds` | Retail Money Funds | Consumer | Bil. $ |
| `smoothedUSRecessionProbabilities` | Recession Probability | Consumer | % |
| `newPrivatelyOwnedHousingUnitsStartedTotalUnits` | Housing Starts | Housing | Thousands of units (SAAR) |

EI-01 の実測でこの一覧と差があれば、実 API に合わせて修正する。`unit` の文言は FRED の系列単位に
合わせる。

### 桁数の指定は持たない

`decimals` 列は置かない。`toLocaleString(undefined, { maximumFractionDigits: 2 })` の一律ルールで
GDP（30000 台）も `unemploymentRate`（4.2）も `smoothedUSRecessionProbabilities`（0.03）も読める。

### `unit` を持つ理由

API が単位を返さないため、これが無いと CPI の `322.1` と `unemploymentRate` の `4.2` が同じ「数」に
見える。同時にこれが水準値と変化率のミスマッチへの答えになる。カレンダーの `CPI MoM` 行の
prev/est/act は前月比 % だが、`CPI` 系列が返すのは指数の水準値である。ヘッダーに
`Consumer Price Index — Index (1982-84=100)` と出ていれば、カレンダーから飛んできたユーザーが
これを MoM % と誤読しない。カレンダーのイベント値をウィンドウ間で受け渡す仕組みは要らない。

## カレンダー連携

### キーワード表（EI-05）

`resolveIndicator(event: string, country: string): string | null`。`country !== 'US'` なら常に `null`。
判定は小文字化した `event` に対する部分一致で、上から順に最初に当たったものを返す。

| 条件 | 結果 |
|---|---|
| `core` を含む | `null` |
| `jobless claims` / `initial claims` | `initialClaims` |
| `nonfarm payroll` | `totalNonfarmPayroll` |
| `unemployment rate` | `unemploymentRate` |
| `cpi` | `CPI` |
| `inflation rate` | `inflationRate` |
| `interest rate decision` / `fed interest rate` | `federalFunds` |
| `gdp` | `GDP` |
| `retail sales` | `retailSales` |
| `consumer sentiment` / `michigan` | `consumerSentiment` |
| `durable goods` | `durableGoods` |
| `industrial production` | `industrialProductionTotalIndex` |
| `housing starts` | `newPrivatelyOwnedHousingUnitsStartedTotalUnits` |
| `total vehicle sales` / `car sales` | `totalVehicleSales` |

`core` の除外を先頭に置く。FMP はコア系列（食品・エネルギーを除く）を持たないため、
`Core Inflation Rate MoM` や `Core CPI` をヘッドライン系列に飛ばすと別の指標を見せることになる。
除外しないと `inflation rate` と `cpi` のルールに当たってしまうので、順序が意味を持つ。

完全一致テーブルを採らない理由は、実測できる `event` 文字列を網羅できず、FMP 側の表記が変わると
黙ってリンクが消えるため。部分一致なら `CPI MoM` / `CPI YoY` / `CPI s.a` がまとめて当たる。

### 窓の同一性と選択の受け渡し（EI-06）

窓は 1 枚。選択中の指標は **main が持ち、renderer がマウント時に取りに行く**。ハッシュは
`#economicIndicator=1` の singleton マーカーだけで、指標名を載せない（`#economic=1` と同形）。

```ts
let selectedIndicator: string | null = null

ipcMain.handle(CH.economicIndicatorOpenWindow, (_e, name: string) => {
  selectedIndicator = name                     // 窓の状態より先に更新する
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

renderer はマウント時に `api.economicIndicator.getSelected()` で初期値を取り、
`api.economicIndicator.onSelect(cb)` を購読して以降の差し替えを受ける。

指標名をハッシュに載せて push だけで差し替える案は採らない。`openHashWindow` は
`satelliteWindows.set(key, win)` を `loadRenderer` より先に実行する（`index.ts:104` と `107`）ので、
窓が「存在する」と判定できてから renderer が `onSelect` を張るまでに隙間がある。1 秒以内に別の行を
クリックすると送信が捨てられ、最初の指標が表示されたまま、エラーも出ずに残る。

`did-finish-load` を待つ案も直らない。あれは React のマウント前に発火するので、`onSelect` はまだ
張られていない。main を真実の置き場にして renderer が pull すれば、送信が落ちてもマウント時の
`getSelected()` が最新値を返すので、競合が原理的に消える。`value` が固定 `'1'` になるので、
`openHashWindow` のシグネチャも変えずに済む。

窓を `loadURL` で再読込して指標を差し替える案も採らない。範囲選択と TanStack Query のキャッシュを
まとめて捨てることになる。

`selectedIndicator` の初期値は `null`（誰もまだ指定していない）で、既定の指標名は main に持たせない。
renderer の `useState` 初期値が唯一の既定なので、`getSelected()` が `null` を返したら renderer は
そのまま既定を使う。main に既定を置くと同じ値が 2 箇所に散る。

`selectedIndicator` は main のプロセス内 state で永続化しない（EI-03）。窓を閉じても値は残るが、
次に開いたとき同じ指標が出るだけで害はない。

## UI

### 開き方

- ヘッダー: `CalendarDays` の隣に `ChartLine` アイコンのボタン。既定は `CPI`
- カレンダー行: `resolveIndicator` が `name` を返した行だけクリック可能にし、行末に小さく
  `ChartLine` を出す。返さない行（US 以外、対応表に無い指標、FOMC のようなイベント）は従来どおり
  静的な行

### レイアウト

```
┌─ Economic indicators ─────────────────────────────────────────┐
│ [ Consumer Price Index ▾ ]  [1Y][5Y]  As of 09:12 ⟳           │
│ Index (1982-84=100)    Latest 322.1 (2026-06-01)    Δ +0.7    │
├───────────────────────────────────────────────────────────────┤
│      ╱╲          ╱─────                                       │
│    ╱   ╲───────╱                                              │
├───────────────────────────────────────────────────────────────┤
│ Date         Value      Δ                                     │
│ 2026-06-01   322.1    +0.7                                    │
│ 2026-05-01   321.4    +0.9                                    │
└───────────────────────────────────────────────────────────────┘
```

プルダウンは 23 件を `category` で区切る。平坦に 23 行並べると目的の指標を探せない。

表は範囲スライス後の直近 20 件を新しい順に並べる。折れ線と表が同じ範囲を見るので、グラフで
気になった箇所の数値を表で確認できる。`Δ` はスライスの外にある観測も参照する（範囲の先頭行でも
Δ が空欄にならない）。

### Δ を絶対差にする理由（EI-07）

`Δ` は直前の観測との絶対差にする。% 変化にすると、`unemploymentRate` のように値そのものが % の
系列で「% の %」になり、`4.2 → 4.3` が `+2.4%` と表示されて誤読を招く。前月比 % はカレンダー側の
`CPI MoM` 行が担当するので、2 つの窓で役割が分かれる。

### 範囲スライスの基準日（EI-08）

表示上のスライスは**最新観測の日付**から遡る。今日から遡ると、四半期系列や発表が遅れている
系列で 1Y ビューが空になる。

取得地平（どこまで遡って API を叩くか）と表示スライス（取得済みのどこを見せるか）は別物。
地平を 1Y → 5Y に広げた時だけバックフィルが走り、同じ地平内での再描画はネットワークに出ない。

### 折れ線

`Chart.tsx` は使わない。`Bar[]` と指標インスタンス群に結びついた大きなコンポーネントで、単純な
折れ線を通すには改造が要る。`EconomicIndicatorChart.tsx` を新規に置く（`createChart` +
`addSeries(LineSeries)` + `setData` + `fitContent` + クロスヘア読み取り）。`time` は `'2026-06-01'`
文字列をそのまま渡せる。

### 永続化しない（EI-03）

選択中の指標も表示範囲も `settings.json` に保存しない。アプリを起動し直せば既定（`CPI` / `1Y`）に
戻る。取得済みデータは SQLite に残るので、再起動後に `1Y` を開いてもリクエストは出ない（TTL 内なら
最新窓も取り直さない）。カレンダーから飛ぶ場合は指標がクリック側から来るので、保存しても効かない。ヘッダーから開く
用途で前回の指標をアプリ再起動後も覚えていてほしくなったら、`economicFilter` と同じ形で settings に
1 エントリを足し、EI-06 の `selectedIndicator` の初期値をそこから読む。

### 0 件のとき

`points` が空なら「この指標のデータがありません」と出す。書き込みが date キーの union である以上
（EI-10）、この状態になるのは**地平ぶんの窓すべてが空だった**場合に限られる。一度でも観測が入った
指標が空表示に戻ることはない。

四半期系列でも、地平が 1Y なら 5 窓のうち少なくとも 1 つは観測を含むので空にはならない。本当に
空になるのは廃止された系列か `name` の打ち間違いで、どちらも「データがありません」で正しい。

### 地平を広げている間の表示

`1Y` → `5Y` は 90 日窓を約 17 本直列に取るので十数秒かかる。無言で固まらせず、ヘッダーに
`Fetching 5Y history…` を出す（TanStack Query の `isFetching` で足りる）。狭める方向と、
一度広げた地平への再切替はキャッシュで即座に返る。

## エラー処理

`company.info` と経済カレンダーの分岐を踏襲する。renderer 側は既存の `/FMP HTTP (200|40[0-9])/`
判定を使い回すので新しい型は増えない。

| 状況 | 表示 |
|---|---|
| `NO_API_KEY` | Settings で FMP API キーを設定してください |
| `FmpHttpError` 401 | FMP API キーが拒否されました。Settings で確認してください |
| `classify` が `'requires-plan'`（402 / 403、または 200 + プラン拒否 body） | 経済指標は現在の FMP プランでは利用できません |
| 429 | FMP のリクエスト上限に達しました。しばらく待ってから再試行してください |
| 通信エラー | 接続を確認してください |
| どれかの窓でフェッチ失敗 + 行あり | 行を**書かずに**古い行を返し（`stale: true`）、ヘッダーに `As of …（更新に失敗）` |
| どれかの窓でフェッチ失敗 + 行なし | throw。上の通信エラー / HTTP エラー表示に落ちる |
| フェッチ成功で空窓 + 埋まった行あり | union なので何も足さない。`stale` は付けない（空窓は異常ではない） |
| 地平ぶんの全窓が空 + 行なし | 空を返し、空の行を書く。UI は「この指標のデータがありません」 |

途中の窓で失敗したときに **`covered_from` を進めないことが重要**。部分的に取れた分を書いて
`covered_from` だけ地平まで進めると、埋まっていない範囲を「取得済み」と記録することになり、
その穴は以後どのリクエストでも埋まらない。取れた分を捨てるほうが安い（次回また取り直せる）。

### プラン外の空撃ち対策（EI-04）

`economicOutOfPlan` とは別のフラグ `economicIndicatorOutOfPlan` を core に持つ。別エンドポイントなので
同じプラン階層とは限らず、共用すると片方の 403 でもう片方が使えなくなるか、逆に空撃ちが漏れる。

対策が無いと、queryKey が指標ごとに違うためプルダウンを 23 本たどるだけで 403 を 23 回踏む。
`apikey.set` / `apikey.clear` でクリアする（既存の `economicOutOfPlan = null` の隣に 1 行）。

latch の条件は status ではなく `capabilityClassifier.classify(err.status, err.body)` の結果で切る。

```ts
if (err instanceof FmpHttpError && classify(err.status, err.body) === 'requires-plan')
  economicIndicatorOutOfPlan = err
```

`economicCalendar`（EC-15）と `dailyOutOfPlan` は `status === 402 || status === 403` で判定している
が、これでは HTTP 200 のプラン拒否をすり抜ける。`FmpProvider.parseOrThrowHttpError` はスキーマに
合わない body を `FmpHttpError(200, rawBody)` にして投げるので、FMP がプラン拒否を 200 +
`{ "Error Message": ... }` で返す場合、latch が効かず 23 本ぶん空撃ちする。EI-04 が防ぐと言っている
挙動そのものである。

status を無条件に 200 まで広げるのは採らない。純粋なスキーマ不一致（FMP の仕様変更）でも latch が
かかり、23 本すべてが無効化されて復旧手段が API キーの再設定だけになる。`classify` は
`Error Message` を持たない body には `'available'` を返すので、この誤検知が起きない。

`economicOutOfPlan` にも同じ穴があるので、同じ 1 行で同時に直す。`dailyOutOfPlan` は触らない —
`core.ts` のコメントにあるとおり、`'1d'` の 402/403 は「その銘柄がプラン外」を意味するので
status 駆動が意図的であり、`classify` に寄せると D グレー化バグが戻る。

## テスト

fixture は EI-01 で保存した 3 本: `tests/fixtures/fmp-economic-indicators.json`（CPI の 90 日窓、
3 観測）、`-weekly.json`（週次系列の 90 日窓ちょうど、14 観測）、`-denied.json`（拒否 body）。

**`tests/main/economic/EconomicIndicatorService.test.ts`**

ここが一番厚い。90 日窓から地平ぶんを組み立てる計算がすべてここにある。

- 遡り: `to` が 85 日ステップで並び、最後の窓の下端が地平を下回る。1Y で 5 リクエスト、5Y で 22
- 窓が必ず重なる（連続する `to` の差が 90 日未満 = 継ぎ目で観測を落とさない）
- マージ: 窓をまたいだ観測が date キーで union され、date 昇順で返る
- マージ: 同じ date は後から取った窓の値が勝つ（改訂の取り込み）
- マージ: 新しい窓に含まれないキャッシュ済み観測が消えない
- 地平がカバー済みかつ TTL 内はネットワークに出ない
- TTL 超過 + カバー済み → 最新窓 1 本だけ取り、`covered_from` は動かない
- カバー不足 + TTL 内 → 最新窓を取り直さず、遡りだけ走る
- 地平を狭める（5Y → 1Y）→ 1 本も取らず、`covered_from` も狭めない
- `force: true` → 行を捨てて現在の地平ぶんを取り直す（TTL とカバー範囲の両方を無視）
- フェッチ失敗 + 行あり → 行を書かず `stale: true` で古い行を返す
- **途中の窓で失敗 → `upsert` を一度も呼ばない**（`covered_from` を進めて穴を恒久化させない）
- フェッチ失敗 + 行なし → throw
- **EI-10**: 全窓が空 + 行なし → 空の `points` と `covered_from = 地平` の行を書く（毎回の空撃ちを
  防ぐ）。直後にもう一度呼んでもネットワークに出ない
- **EI-10**: 空窓に `stale` を付けない（四半期系列を毎回 stale 表示にしない）

**`tests/main/providers/economicIndicator.test.ts`**

- fixture の zod パース（通常・週次の 2 本）
- `to` を送り、`from` を送らない（EI-01: `from` は窓を広げない）
- `value: null` の観測が落ちる
- `date` が `'YYYY-MM-DD'` のまま通る（epoch 変換をしない）。形式違いは落とす
- 応答は date 降順で来るので昇順に直る
- 空窓 → `[]`（例外にしない）
- エラー payload → `FmpHttpError`

**`tests/main/core/`**（既存の core テストに追加）

- 402/403 を一度見たら以降ネットワークに出ない
- **EI-04**: HTTP 200 + プラン拒否 body（`tests/fixtures/fmp-economic-indicators-denied.json`）でも
  latch が効き、別の `name` を要求してもネットワークに出ない
- **EI-04**: `Error Message` を持たない純粋なスキーマ不一致（`FmpHttpError(200, [{ bogus: 1 }])`）では
  latch しない。その指標だけエラーになり、他の 22 本は取得できる
- **EI-04**: `economicCalendar` も HTTP 200 のプラン拒否で latch する（EC-15 の穴を塞いだ回帰テスト）
- `apikey.set` / `apikey.clear` でフラグが解除される
- `economicOutOfPlan` と独立に動く（カレンダーの拒否が指標を止めない、逆も同じ）

**`tests/shared/economicIndicators.test.ts`**

ここが一番重要。壊れるとクラッシュせずにリンクが黙って消えるので、対応表を触るたびに落ちる
テストを置く。

- 当たる例: `'CPI MoM'` → `CPI`、`'Initial Jobless Claims'` → `initialClaims`、
  `'Fed Interest Rate Decision'` → `federalFunds`
- `core` の除外が `inflation rate` / `cpi` のルールより先に効く:
  `'Core Inflation Rate YoY'` → `null`、`'Core CPI MoM'` → `null`
- 当たらない例: `'FOMC Press Conference'` → `null`
- `country !== 'US'` は常に `null`（`'CPI MoM'` + `'JP'` → `null`）
- 大文字小文字を無視する
- 表の全 `name` がレジストリに存在する（対応表とレジストリのずれを検出）

**`tests/renderer/economicIndicatorSeries.test.ts`**

- 範囲は `1Y` / `5Y` の 2 つだけ、既定は `1Y`。`rangeYears` が `1` / `5` に写す
- 範囲スライス（1Y / 5Y）が最新観測日から遡る（EI-08）
- 発表が遅れている系列でも 1Y が空にならない
- `Δ` の計算。範囲の先頭行の `Δ` がスライス外の 1 つ前の観測を使う
- 1 点のみ、空配列

**`tests/windowHash.test.ts`**（既存）

- `buildHash('economicIndicator', '1')` / `parseHash` の往復
- 他の窓のハッシュで開かないこと

### テストしないもの

EI-06 の競合（窓のロード中に 2 回目のクリックが来る）は自動テストを書かない。`BrowserWindow` と
`webContents` のライフサイクルをモックする必要があり、テスト自体が Electron の内部挙動に依存する。
pull 方式は「送信が落ちても `getSelected()` が最新値を返す」構造なので、競合が起きても壊れない。
手動確認だけ実装計画に入れる: カレンダーで 2 つの異なる行を 1 秒以内に連続クリックし、後にクリック
した指標が表示されること。

## 将来枠

- **EI-09**: MCP ツール `economic_indicator(name)`。`core.economicIndicator.getSeries` を呼ぶだけ
- 価格チャートの時間軸への重ね描き
- 選択指標と表示範囲の永続化（EI-03）
- コア系列（Core CPI 等）。FMP に無いので別プロバイダか FRED 直が必要
