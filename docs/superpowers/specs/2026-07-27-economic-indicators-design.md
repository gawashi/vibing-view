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

### 着手前に確定させること（EI-01）

以下は FMP のドキュメント由来で、実 API で検証していない。実 API を 1 回叩いて
`tests/fixtures/fmp-economic-indicators.json` として保存し、fixture 上で 5 点を確定させてから永続化
コードを書く。

1. 受け付ける `name` の実際の集合（下の 23 本と一致するか）
2. `from`/`to` を省略したとき全履歴が返るか、既定の窓に切られるか（キャッシュ方式の前提そのもの）
3. レスポンスのフィールド（`{ name, date, value }` 以外に `unit` 等が付くか。付くなら
   `EconomicIndicatorMeta.unit` のハードコードは不要になる）
4. プラン拒否の**HTTP status と body 形状**。`403` + `{ "Error Message": ... }` なのか、`200` +
   エラー body なのか。EI-04 の latch 判定がこれに依存する。判定が状況に依らないよう `classify()` を
   使う設計にしてあるが、実測した status と body は
   `tests/fixtures/fmp-economic-indicators-denied.json` に保存し、`classify` がそれを
   `'requires-plan'` に落とすことをテストで固定する
5. `name` に無効な値を渡したときの応答（`200` + `[]` なのか、エラーなのか）。EI-10 の空レスポンス
   ガードがこれに依存する

2 が「既定の窓に切られる」だった場合は、`from` に固定の古い日付（`1950-01-01`）を渡す。それでも
全履歴が来ないなら方式の再検討が必要なので、実装前に確定させる。

### タイムゾーン問題は無い

カレンダーで確定に手間を要した `date` の基準問題（EC-02）は、この機能には存在しない。`date` は
`"2026-06-01"` の日付のみで時刻を持たないため、UTC/ET のどちらで解釈しても同じ日を指す。
したがって epoch への変換をせず、`date` 文字列をそのまま保持して SQLite に入れ、そのまま
lightweight-charts に渡す。変換コードがどこにも入らない。

## アーキテクチャ

Company info の経路をなぞる。カレンダーの `EconomicCalendarService` にある確定判定と欠け範囲の算出は
持たない（理由は下記「なぜ確定判定を持たないか」）。

```
FmpProvider.getEconomicIndicator(name)           ← /economic-indicators?name= + zod
        ↓
EconomicIndicatorService                         ← TTL 12h read-through（CompanyInfoService と同型）
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
| `src/main/economic/EconomicIndicatorService.ts` | TTL 12h read-through |
| `src/renderer/components/EconomicIndicatorWindow.tsx` | ウィンドウ本体 |
| `src/renderer/components/EconomicIndicatorChart.tsx` | 折れ線 1 本 |
| `src/renderer/lib/economicIndicatorSeries.ts` | 範囲スライスと Δ の純関数 |

### 変更ファイル

| ファイル | 変更 |
|---|---|
| `src/shared/types.ts` | `EconomicIndicatorPoint` / `EconomicIndicatorSeries` |
| `src/shared/ipc.ts` | `CH` に `economicIndicator` / `economicIndicatorOpenWindow` / `economicIndicatorSelected` / `economicIndicatorSelect`、`Api.economicIndicator`（`getSeries` / `openWindow` / `getSelected` / `onSelect`） |
| `src/shared/windowHash.ts` | `WindowKind` に `'economicIndicator'` |
| `src/main/providers/fmp.schema.ts` | `fmpEconomicIndicatorResponse` |
| `src/main/providers/FmpProvider.ts` | `getEconomicIndicator(name)` |
| `src/main/db/schema.ts` | `economicIndicators` テーブル |
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
economic_indicators(name TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at INTEGER NOT NULL)
```

- `name` は FMP の系列名そのまま
- `data` はその系列の全履歴（`EconomicIndicatorPoint[]`）の JSON blob。`company_profiles` と同じ
  blob 方針で、フィールド追加時のマイグレーションを不要にする
- `fetched_at` は epoch 秒。TTL は 12 時間（43200 秒）

`from`/`to` を付けずに 1 リクエストで全期間を取り、1 行に入れる。月次・四半期系列なので全履歴でも
数百〜千観測、数十 KB。表示範囲（1Y/5Y/10Y/Max）は取得済みデータのクライアント側スライスで、
リクエストは増えない。API リクエストは 1 指標あたり 12 時間に 1 回で、23 本すべて見ても半日で 23
リクエストに収まる。

### なぜ確定判定を持たないか（EI-02）

カレンダーは「その日の翌 00:00 UTC 以降に取得した行は確定」として以後フェッチしない（EC-06）。
指標にはこれを適用しない。FRED 由来の系列は改訂されるため（GDP は速報・改定・確定で 3 回変わる）、
過去分を確定として固定すると古い速報値が残り続ける。全履歴を TTL で取り直すことが改訂を吸収する
方法であり、同時に一番短いコードでもある。

### 却下した方式

- **表示範囲ごとのキャッシュ**（`bars` / `coverage` と同じ range 管理）: 改訂があるため「取得済み
  範囲は再取得しない」が成立せず、範囲管理と改訂対応の両方を書くことになる。節約できるのは
  1 リクエストあたり数十 KB
- **日単位キャッシュ**（`economic_days` と同形）: 指標は月次・四半期発表なので、日単位のキーは
  ほぼ空行になる

### 空レスポンスで既存履歴を上書きしない（EI-10）

フェッチが成功して `points` が空だったとき、**既存行が空でなければ `data` を上書きしない**。古い
`points` を `stale: true` で返す。`fetched_at` は進める。

`fetched_at` を進めるのは API 節約のため。進めないと TTL が切れたままなので、窓を開くたびに空応答を
取りに行く。進めておけば 12 時間は静かになり、その間も古い `points` は残る。一時的な空応答から
すぐ復帰したいときはリロードボタン（`force`）がある。守るのは履歴データであって鮮度ではない。

素朴に書くと毎回のフェッチ結果でまるごと上書きするので、一時的な空応答・FMP 側の仕様変更・
`name` の打ち間違いのどれでも、埋まっていたキャッシュが `'[]'` に置き換わり、12 時間「データが
ありません」と表示される。例外が飛んでいないので `stale` フォールバックは効かない。カレンダーで
同じ形の欠陥を EC-07 のレビューで指摘されて直したのと同じ話で、TTL があるぶん永久ではないという
点だけが違う。

引き換えに、本当に廃止された系列は空にならず、古い履歴を stale 表示し続ける。23 本のハードコード
系列が廃止されるのは稀で、そのとき失うのは「(更新に失敗)」というラベルの正確さだけであり、守るのは
履歴データである。`force` も同じガードを通す（`force` は TTL を無視するだけで、空上書きは許さない）。

### force

リロードボタンは `{ force: true }` で TTL を無視して取り直す（`company.info` と同じ）。

## 型

```ts
export type EconomicIndicatorPoint = { date: string; value: number } // date は 'YYYY-MM-DD'

// fetchedAt は行の取得時刻。stale は「古い行を返した、再取得は失敗した」
// — fetchedAt だけでは区別できない（CompanyInfo と同じ理由）。
export type EconomicIndicatorSeries = {
  name: string
  points: EconomicIndicatorPoint[] // date 昇順
  fetchedAt: number
  stale?: boolean
}
```

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
let selectedIndicator = 'CPI'

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
│ [ Consumer Price Index ▾ ]  [1Y][5Y][10Y][Max]  As of 09:12 ⟳ │
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

1Y/5Y/10Y は**最新観測の日付**から遡る。今日から遡ると、四半期系列や発表が遅れている系列で
1Y ビューが空になる。`Max` は全件。

### 折れ線

`Chart.tsx` は使わない。`Bar[]` と指標インスタンス群に結びついた大きなコンポーネントで、単純な
折れ線を通すには改造が要る。`EconomicIndicatorChart.tsx` を新規に置く（`createChart` +
`addSeries(LineSeries)` + `setData` + `fitContent` + クロスヘア読み取り）。`time` は `'2026-06-01'`
文字列をそのまま渡せる。

### 永続化しない（EI-03）

選択中の指標も表示範囲も `settings.json` に保存しない。アプリを起動し直せば既定（`CPI` / `5Y`）に
戻る。カレンダーから飛ぶ場合は指標がクリック側から来るので、保存しても効かない。ヘッダーから開く
用途で前回の指標をアプリ再起動後も覚えていてほしくなったら、`economicFilter` と同じ形で settings に
1 エントリを足し、EI-06 の `selectedIndicator` の初期値をそこから読む。

### 0 件のとき

`points` が空なら「この指標のデータがありません」と出す。EI-10 のガードにより、この状態になるのは
**その指標を一度も取得できていない**場合に限られる（キャッシュが埋まっていれば空応答では上書き
されない）。したがって「一度は取れていたのに空になった」という紛らわしい状態は表示に出てこない。

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
| フェッチ失敗 + 行あり | 古い行を返し（`stale: true`）、ヘッダーに `As of …（更新に失敗）` |
| フェッチ失敗 + 行なし | throw。上の通信エラー / HTTP エラー表示に落ちる |
| フェッチ成功で空 + 埋まった行あり | 上書きせず古い行を `stale: true` で返す（EI-10） |
| フェッチ成功で空 + 行なし | 空を返す。UI は「この指標のデータがありません」 |

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

fixture は `tests/fixtures/fmp-economic-indicators.json`（EI-01 で保存したもの）。

**`tests/main/economic/EconomicIndicatorService.test.ts`**

- TTL 12h 内はネットワークに出ない
- TTL 超過で再取得し、行を上書きする
- `force: true` で TTL を無視して取り直す
- フェッチ失敗 + 行あり → `stale: true` で古い行を返す
- フェッチ失敗 + 行なし → throw
- **EI-10**: フェッチが空を返し、埋まった行がある → `data` を上書きせず `stale: true` で古い
  `points` を返す。`fetched_at` は進むので、直後にもう一度呼んでもネットワークに出ない
- **EI-10**: フェッチが空を返し、行が無い → 空の `points` を返す。行は書く（毎回の空撃ちを防ぐ）
- **EI-10**: `force: true` でも空上書きは起きない

**`tests/main/providers/`**（既存の FmpProvider テストに追加）

- fixture の zod パース
- `value: null` の観測が落ちる
- `date` が `'YYYY-MM-DD'` のまま通る（epoch 変換をしない）
- `points` が date 昇順
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

- 範囲スライス（1Y / 5Y / 10Y / Max）が最新観測日から遡る（EI-08）
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
