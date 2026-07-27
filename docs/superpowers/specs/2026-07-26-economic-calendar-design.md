# 経済カレンダー（`/economic-calendar`） — 設計

日付: 2026-07-26

## 目的とスコープ

FMP の `/stable/economic-calendar` を使い、マクロ経済指標の発表予定を**週単位の一覧**で見る。
「今週どんな発表があるか」を、チャートの横に並べて出しっぱなしにできる状態を作る。

対象は別ウィンドウ 1 枚（Company info と同じハッシュ方式）。週の前後移動、国と重要度の絞り込み、
ローカル時刻と ET の併記まで。

**非スコープ**:

- チャート上へのイベント線・マーカー描画（時間軸との対応付けは別件）
- 指標の過去推移（`/stable/economic-indicators`。別エンドポイント・別キャッシュ・グラフ描画が必要 → EC-16）
- MCP ツール化（`core.economicCalendar` を生やすので、後から `tools.ts` に 1 ツール足すだけで済む → EC-17）
- サプライズ（actual vs estimate）の色付け・可視化
- 月ビュー、日ビュー
- 個別銘柄の決算カレンダー（既存の Company info → Schedule タブが担当）

## エンドポイントが返すもの

`GET /stable/economic-calendar?from=YYYY-MM-DD&to=YYYY-MM-DD&apikey=…`

1 イベントあたり `date` / `country` / `currency` / `event` / `previous` / `estimate` / `actual` /
`change` / `changePercentage` / `impact`。`event` は指標名の文字列だけで、説明文は付かない。

したがって一覧に出せるのは「日時・国・指標名・重要度・前回/予想/実績」が上限である。
FOMC のように数値を持たないイベントは `previous`/`estimate`/`actual` がすべて `null` になり、
日時と名前と重要度だけの行になる。

`change` / `changePercentage` は `previous` と `actual` から導出できるので行には出さない（EC-01）。

### 着手前に確定させること（EC-02）

`date` は `"2026-07-27 12:30:00"` 形式でタイムゾーンマーカーを持たない。UTC 基準か ET 基準かで
epoch が 4〜5 時間ずれ、イベントの並び順・UTC 日キー・ローカル週に入るかの判定・ET 表記の
すべてが変わる。**暫定 UTC で実装して後で差し替える、はやらない。** 変換コードは 1 行で直るが、
誤った基準で書かれた `economic_days` の行はキー自体が間違っているので直らない。

したがって基準の確定を実装の前段に置く。永続化コードを書く前に、実 API を 1 回叩いて
`tests/fixtures/fmp-economic-calendar.json` として保存し、次の 2 点を fixture 上で確定させる。

- **`date` の基準**: 米 CPI（08:30 ET 発表）を含む週を取り、`date` が `13:30`（冬時間 = UTC）か
  `08:30`（= ET）かを見る。UTC なら `dateToEpochSeconds` 相当、ET なら `nyDateTimeToEpochSeconds`
- **`from`/`to` の基準**: 要求した範囲の端の日が返ってくるか。ET 基準なら UTC 日の端が欠けるので、
  `EconomicCalendarService` が要求する範囲を 1 日広げる必要がある

**確定した基準（2026-07-26 実測）**: `date` は **UTC** 基準。米 CPI（08:30 ET）の行は
夏週 `tests/fixtures/fmp-economic-calendar.json` で `"2026-07-14 12:30:00"`、冬週
`tests/fixtures/fmp-economic-calendar-winter.json` で `"2026-01-13 13:30:00"`。`from`/`to` は要求した端の日が
`返る`。`FmpProvider` は要求範囲を両端 1 日広げる（基準に依らず安全で、リクエスト数は
変わらない）。変換関数の直上に同じ内容をコメントで残す。

将来 FMP 側が基準を変えた場合は、既存行のキーが無効になるので `client.ts` で
`DROP TABLE economic_days` する（1 週あたり 1 リクエストの再取得で済む安いキャッシュなので、
列にバージョンを持たせるより捨てるほうが小さい）。

`impact` は `High` / `Medium` / `Low` に正規化し、それ以外の値（空文字、`None`、休場表記など）は
`Low` に落とす（EC-03）。既定のフィルタが High + Medium なので、正体不明の値が既定で紛れ込むことはない。
zod は `z.string()` で受けてから正規化するので、未知の値でパースが落ちない。

## 時刻の扱い

`FmpProvider` で UTC epoch 秒に正規化する（`Bar.time` と同じ規約）。SQLite のキーはその epoch から
導いた UTC 日。ローカル時刻と ET への変換は renderer の表示時だけで行う（EC-04）。

## アーキテクチャ

Company info の経路をそのままなぞる。

```
FmpProvider.getEconomicCalendar(from, to)        ← /stable/economic-calendar + zod + epoch 正規化
        ↓
EconomicCalendarService                          ← 日単位 read-through、確定判定、欠け範囲の算出
        ↓  db/economicDayStore (getDays / upsertDays)
core.economicCalendar.getRange(from, to, opts)   ← electron 非依存、Vitest から直接叩ける
        ↓  ipc.ts（チャンネル名 → コアのメソッドの対応表）
renderer: EconomicCalendarWindow                 ← 週ナビ、フィルタ、時刻表示
```

### 新規ファイル

| ファイル | 役割 |
|---|---|
| `src/shared/economicWindow.ts` | `buildEconomicHash()` → `'economic=1'`、`parseEconomicWindow(hash)` → `boolean`。`companyWindow.ts` の双子 |
| `src/main/db/economicDayStore.ts` | `economic_days` の read/write（純粋な blob 出し入れのみ） |
| `src/main/calendar/EconomicCalendarService.ts` | 日単位 read-through + 確定判定 + 欠け範囲 |
| `src/renderer/components/EconomicCalendarWindow.tsx` | ウィンドウ本体 |
| `src/renderer/lib/economicWeek.ts` | 週境界・必要 UTC 日リスト・フィルタの純関数 |

### 変更ファイル

| ファイル | 変更 |
|---|---|
| `src/shared/types.ts` | `EconomicEvent` / `EconomicImpact` / `EconomicRange` |
| `src/shared/ipc.ts` | `CH` に `economicCalendar` / `economicOpenWindow` / `settingsGetEconomicFilter` / `settingsSetEconomicFilter`、`Api.economic`（`getRange` / `openWindow`）と `Api.settings` の 2 メソッド |
| `src/main/providers/fmp.schema.ts` | `fmpEconomicCalendarResponse` |
| `src/main/providers/FmpProvider.ts` | `getEconomicCalendar(from, to)` |
| `src/main/db/schema.ts` | `economicDays` テーブル |
| `src/main/core.ts` | `economicCalendar.getRange`、`economicOutOfPlan` フラグ、`ProviderLike` に 1 メソッド追加 |
| `src/main/settings.ts` | `getEconomicFilter` / `setEconomicFilter` |
| `src/main/ipc.ts` | チャンネル 4 本 |
| `src/main/index.ts` | `economicWindows` Map + `CH.economicOpenWindow` ハンドラ |
| `src/preload/index.ts` | `api.economic` / `api.settings.*EconomicFilter` |
| `src/renderer/main.tsx` | ハッシュ分岐に 1 本追加 |
| `src/renderer/api.ts` | `qk.economicCalendar(from, to)` |
| `src/renderer/App.tsx` | ヘッダーに `CalendarDays` ボタン（`SearchBar` と `SettingsDialog` の間） |

## データモデルとキャッシュ

```
economic_days(date TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at INTEGER NOT NULL)
```

- `date` は UTC 日の `'YYYY-MM-DD'`
- `data` はその日のイベント配列の JSON。`company_profiles.data` と同じ blob 方針で、
  フィールド追加時のマイグレーションを不要にする
- `fetched_at` は epoch 秒

### なぜ日単位か（EC-05）

週単位の blob にするとキーと中身の基準が混ざる。表示はローカル週なので週キーは「ローカル月曜」に
なるのに、中身は provider 基準の日付を持つイベントである。日単位ならキーは FMP が返した日付
そのもので、キャッシュ層に基準の変換が入らない。

取得範囲をローカル週の前後 1 日ぶん広げる点はどちらの案でも同じで、日単位ではそれが「どの UTC 日を
要求するか」という表示側の計算に収まる（`economicWeek.ts`）。

確定判定が素直になるのも日単位の利点である。週 blob だと当週全体が短い TTL 扱いになり、月〜木の
確定済み `actual` も一緒に取り直す。さらに週という単位がキャッシュ層に焼き付かないので、将来
ローリング表示や月ビューを足してもキャッシュはそのまま使える。

API リクエスト数は週単位と変わらない。週をめくればその週の大半がミスになり、どちらも 1
リクエスト飛ぶ。

### 確定判定（EC-06）

「過去日は永続」では穴が空く。金曜 10:00 UTC に取得した金曜の行は、13:30 UTC 発表分の `actual` が
`null` のまま入っており、それが永続扱いで固定されてしまう。条件は取得時刻で切る。

```
fetched_at >= その日の翌 00:00 UTC   → 確定。以後フェッチしない
それ以外                              → TTL 3600 秒
```

### 欠け範囲の取得（EC-07）

必要日（ローカル週 ±1 日 = 最大 9 日）のうち fresh でない日（`missing`）を集め、その **min..max を
1 リクエスト**で取る。日付が飛んでいても 1 回で済む。

レスポンスは UTC 日で groupBy するが、**書き込むのは `missing` の日だけ**。min..max の範囲内に
混ざった fresh な確定済み日は書き換えない。当初は範囲内の全日を上書きしていたが、レビューで
恒久的なデータ損失を再現された: プロバイダのレスポンスが打ち切られて一部の日が欠けると、
その日は確定済みだったにもかかわらず `'[]'` かつ新しい `fetchedAt` で上書きされ、確定 = 再取得
しない扱いのまま空データが固定されてしまう（手動リロード以外に復旧手段が無い）。

`missing` の全日に行を書く。返ってこなかった日は `'[]'`（EC-08）。これを省くと土日祝が毎回ミス
判定になり、その週を開くたびに API を空撃ちする。「要求範囲の全日に行がある」という保証は
これでも成り立つ — `missing` でない日はすでに行を持っているため。

### フェッチ失敗時の stale（EC-18）

`stale: true` を返すのは **要求した全日に行がある**ときだけ。1 日でも行が無ければ throw する
（`'[]'` の行は「その日は発表なし」を意味するので、行があるとみなす）。

「行が 1 つでもあれば stale で返す」にすると穴が空く。9 日のうち月〜水がキャッシュ済み、木〜日は
未取得という状態でフェッチが失敗すると、月〜水だけのイベントが `stale: true` で返る。UI は
「更新に失敗」しか出さないので、木曜以降に発表が無いのか取れなかったのかが区別できない。
経済カレンダーは「その日に何も無い」ことが正常な状態なので、欠けが空に見えてしまう。

throw なら Company info と同じエラー表示に落ちるだけで、新しい型も UI もいらない。
週全体が 1 リクエストなので、混在状態は週をまたいだ直後などに限られ、捨てるコストは小さい。

### force

リロードボタンは `{ force: true }` で確定/TTL を無視して必要日を全部取り直す（`company.info` と同じ）。

## 型

```ts
export type EconomicImpact = 'High' | 'Medium' | 'Low'

export type EconomicEvent = {
  time: number            // UTC epoch 秒
  country: string         // 'US' など、FMP が返すコードそのまま
  currency: string | null
  event: string           // 指標名
  impact: EconomicImpact
  previous: number | null
  estimate: number | null
  actual: number | null
}

// getRange の戻り。fetchedAt は表示対象の日のうち最も古い取得時刻（一番古い情報がいつのものか）。
// stale は「古い行を返した、再取得は失敗した」— fetchedAt だけでは区別できない（CompanyInfo と同じ理由）。
// events は常に要求範囲の全日をカバーする（欠けがあれば throw、EC-18）。部分的な範囲は返らない。
export type EconomicRange = { events: EconomicEvent[]; fetchedAt: number; stale?: boolean }
```

`core.economicCalendar.getRange(from: string, to: string, opts?: { force?: boolean })` の
`from`/`to` は UTC 日の `'YYYY-MM-DD'`。どの日が必要かは呼び出し側（renderer の `economicWeek.ts`）が決める。

## UI

### 開き方

ヘッダー右、`SearchBar` と `SettingsDialog` の間に `CalendarDays` アイコンのボタン。
`#economic` ハッシュで別ウィンドウが開く。ウィンドウは 1 枚だけで、固定キー `'calendar'` の Map で
既存の `openHashWindow` を使い回す（EC-09）。週は renderer の state なので、週ごとにウィンドウを
増やす意味がない。2 度目のクリックは既存ウィンドウをフォーカスする。

### レイアウト

```
┌─ Economic calendar ───────────────────────────────────┐
│ ◀   Jul 27 – Aug 2, 2026   ▶  [Today]   As of 09:12 ⟳ │
│ Country: [ US only ▾ ]   Impact: [High][Med][Low]     │
│ Filter:  [ CPI                                     ]  │
├───────────────────────────────────────────────────────┤
│ Mon Jul 27                                            │
│  21:30  08:30 ET  ● US  CPI MoM                       │
│                      prev 0.2   est 0.3   act 0.3     │
│  23:00  10:00 ET  ● US  ISM Services PMI              │
│                      prev 52.1  est 52.5  act —       │
│ Tue Jul 28                                            │
│  03:00  14:00 ET  ● US  FOMC Rate Decision            │
└───────────────────────────────────────────────────────┘
```

主時刻はローカル、右に小さく ET。`●` は重要度（High = 赤 / Medium = 琥珀 / Low = 灰）。
今日の日付見出しをハイライトする。

過去と現在の区別は、境界に引く `now` ライン 1 本だけで示す。行の見た目は過去/未来で変えない
（当初は過去行を `opacity` で落としていたが、透明度は文字のコントラストごと下げるため、過去行で
いちばん見たい `act` が読みにくくなっていた）。リストは時系列順なので、線 1 本の上下がリスト全体で
過去/未来に一致する。線は今週を見ているときだけ出す — 他の週では上端か下端に張り付くだけで
情報にならない。週内の全イベントが終わっている場合は末尾に出す（消すと判断に迷う）。
`now` は 1 分ごとに進める。開いたままの窓で線と時刻表示が固まらないようにするため。

### 週

起点は月曜。`date-fns` の `startOfWeek(d, { weekStartsOn: 1 })`（既に依存にある）。
週の位置は永続化せず、開いたら常に今週（EC-10）。

`economicWeek.ts` が担う純関数:

- ローカル週の開始/終了 instant → 必要な UTC 日リスト（週 ±1 日）
- イベント配列 → ローカル週に入るものだけ、日付ごとにグループ化
- フィルタ適用
- グループ + 現在時刻 → `now` ラインを挿す位置（今週でなければ「出さない」）

### Country フィルタ（EC-11）

`US only` / `Major` / `All` の単一選択プルダウン。永続値は `'us' | 'major' | 'all'` の文字列 1 個。
`Major` は `US` / `EU` / `JP` / `UK` / `GB` / `CN` で、定数は `economicWeek.ts` に置く（フィルタ関数と同じ場所）。
FMP は英国を非 ISO の `UK` で返す（`GB` ではない）ため両方を含める。

その週のデータに実在する国からチェックボックスのリストを作る案は採らない。永続化される選択集合と
データ由来の動的リストが噛み合わないためである。選択中の国がイベントを持たない週ではリストから
消え、`All` の意味が週ごとに変わり（「その週に実在する国の全部」を settings に書くので翌週は前週の
国リストになる）、リストは fetch 完了後にしか作れないのでローディング中と失敗した週は操作不能になる。

`Major` のコードはハードコードする。全世界の国リスト（40 前後）はハードコードしない — 列挙を
誤ると選べない国が生まれ、それを埋めるメンテが要る。

### Impact フィルタ

`High` / `Medium` / `Low` の 3 つを既存の `toggle-group` でトグル。値が固定なので週依存の問題はない。
既定は High + Medium。

### テキストフィルタ（EC-12）

国コードと指標名の両方に部分一致（大文字小文字無視）。`All` + `JP` で日本だけ、`CPI` で全世界の
CPI が並ぶ。国プルダウンでは表現できない絞り込みをここで吸収する。

永続化しない（EC-13）。次に開いたときに前回の検索語が残っていると、イベントが少ないのが
データの都合なのか絞り込みの結果なのか分からなくなる。

### 永続化

`settings.json` に `economicFilter: { countries: 'us' | 'major' | 'all', impacts: EconomicImpact[] }`。
既定は `{ countries: 'us', impacts: ['High', 'Medium'] }`。`getAutoRefresh` などと同じパターン。

### 0 件のとき

フィルタ後 0 件なら「該当するイベントがありません」と、**フィルタ前の件数**（ローカル週に入る全
イベント数。国・重要度・テキストのどれも適用していない状態）を併記する（EC-14）。データが無いのか
フィルタで消えたのかを区別できるようにする。

## エラー処理

`company.info` の分岐を踏襲する。

| 状況 | 表示 |
|---|---|
| `NO_API_KEY` | Settings で FMP API キーを設定してください |
| `FmpHttpError` 401 | FMP API キーが拒否されました。Settings で確認してください |
| `FmpHttpError` 402 / 403 | 経済カレンダーは現在の FMP プランでは利用できません |
| 429 | FMP のリクエスト上限に達しました。しばらく待ってから再試行してください |
| 通信エラー | 接続を確認してください |
| フェッチ失敗 + 全日に行あり | 古い行を返し（`stale: true`）、ヘッダーに `As of …（更新に失敗）` |
| フェッチ失敗 + 行の無い日がある | throw。上の通信エラー/HTTP エラー表示に落ちる（EC-18） |

### プラン外の空撃ち対策（EC-15）

`/economic-calendar` が無料プランに含まれない可能性があり、TanStack Query の queryKey は週ごとに
違う。素朴に作ると週をめくるたびに 403 を 1 回踏む。既存の `dailyOutOfPlan` と同じパターンで、
core に in-memory の `economicOutOfPlan: boolean` を持ち、一度 402/403 を見たら以降はネットワークに
出ずに同じ `FmpHttpError` を投げる。`apikey.set` / `apikey.clear` でクリアする（`dailyOutOfPlan.clear()`
と同じ行）。

renderer 側は Company info が既に持つ `/FMP HTTP (200|40[0-9])/` の判定を使い回すので、
新しい型は増えない。

`capabilityCache` は timeframe キーなので触らない（Company info と同じ扱い）。

## テスト

既存の `tests/main` / `tests/renderer` 構成に追加する。fixture は `tests/fixtures/fmp-economic-calendar.json`。

**`tests/main/calendar/EconomicCalendarService.test.ts`**

- `fetched_at` がその日の翌 00:00 UTC 以降なら再取得しない / 未満なら TTL 3600 秒で再取得（EC-06）
- 欠け日が飛んでいても min..max の 1 リクエストに畳む（EC-07）
- 返ってこなかった日に `'[]'` の行を書く。同じ週を 2 度開いても 2 回目は fetch が走らない（EC-08）
- フェッチ失敗時、要求した全日に行があれば `stale: true` で返す
- フェッチ失敗 + 一部の日に行が無い（キャッシュ済みと未取得が混在）と throw する。1 日も無くても throw（EC-18）
- `force: true` で確定日も取り直す

**`tests/main/providers/`**（既存の FmpProvider テストに追加）

- zod パースと UTC epoch 正規化。確定した基準（EC-02）で既知イベントの epoch が合う
  — 米 CPI 08:30 ET の行、夏時間と冬時間の両方、`date` の時刻が UTC 日をまたぐ行（ET 20:00 以降）
- `actual: null`（未発表）、`previous`/`estimate`/`actual` すべて `null`（FOMC 型）
- `impact` の未知値が `Low` に落ちる（EC-03）
- エラー payload → `FmpHttpError`

**`tests/main/core/`**（既存の core テストに追加）

- 402/403 を一度見たら以降ネットワークに出ない
- `apikey.set` / `apikey.clear` でフラグが解除される

**`tests/renderer/economicWeek.test.ts`**

- ローカル週 → 必要 UTC 日リスト
- 時差で週の端に来るイベントが正しい週に入る（ここが一番壊れやすい）
- Country プリセット（`us` / `major` / `all`）の絞り込み
- Impact フィルタ
- テキストフィルタが国コードと指標名の両方に当たる

**`tests/economicWindow.test.ts`**（`companyWindow.test.ts` と同型）

- `buildEconomicHash` / `parseEconomicWindow` の往復

## 将来枠

- **EC-16**: 指標の過去推移（`/stable/economic-indicators?name=…`）。行をクリックして推移を出す。
  `event` の文字列と API の `name` が一致しないので、指標名のマッピングを持つ必要がある。
- **EC-17**: MCP ツール `economic_calendar(from, to, countries?, impacts?)`。
  `core.economicCalendar.getRange` を呼ぶだけで済む。
- チャート時間軸へのイベント線描画。
