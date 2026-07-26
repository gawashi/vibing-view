# MCP サーバ導入 — 設計

日付: 2026-07-25

## 目的とスコープ

Claude（Desktop / Code）から Vibing View の情報を読む。対象は SQLite のキャッシュ済み OHLCV、
ワークスペース（ウォッチリスト + グリッド構成）、企業情報。未キャッシュ分の FMP 取得も許可する（M-03）。

v1 は読み取り 8 ツール。ワークスペース編集は将来枠（`core.workspaces.set` を呼ぶだけで済む構造にしておく）。

**非スコープ**: インジケータ計算のツール化（`src/renderer/indicators` にあり移設は別件。Claude は足から自前で計算できる）／
stdio ブリッジ（Claude Desktop がローカル HTTP を受けない場合に追加）／`market_status` ツール（`Quote` に開場フラグは無く
別エンドポイント・別型。1 リクエスト増やす割に Claude 側で要る場面が薄い。`core.market.status` は renderer 用に残す）／
アプリ停止中の動作（main に同居するため起動中のみ応答）。

## アーキテクチャ

`src/main/ipc.ts` の `registerIpc()` は ipcMain バインドとドメインロジックを同じクロージャに抱えている
（`withCapabilityTracking`、`dailyOutOfPlan` の短絡、`workspacesRev` の採番と通知、`clipboard` の rev 管理）。
MCP から同じ挙動を得るには再実装か自己 IPC しかないので、トランスポート非依存の層を切り出す。

```
src/main/core.ts              ← 新規。サービス構築 + 状態を所有
    ├─ ohlcv.get / ohlcv.refresh   （withCapabilityTracking 込み）
    ├─ symbols.search / symbols.profile
    ├─ quote.get / market.status
    ├─ company.info
    ├─ workspaces.get / workspaces.set   （rev 採番 + 全ウィンドウ通知）
    ├─ clipboard.get / clipboard.set
    └─ capabilities.get
         ↑                          ↑
   src/main/ipc.ts            src/main/mcp/server.ts   ← 新規
   （ipcMain.handle を並べる薄い層）    （MCP ツール定義）
```

`core.ts` は Electron 依存を注入で受ける。ウィンドウ送信は `broadcast(channel, payload, exceptWebContentsId?)` として渡し、
`BrowserWindow` を import しない（`db/client.ts` の lazy-require と同じ思想）。これで Vitest から直接テストできる。

`registerIpc()` は「チャンネル名 → コアのメソッド」の対応表になる。既存の `CH` / `Api`（`src/shared/ipc.ts`）と renderer は変更せず、
MCP 設定用チャンネルのみ追加する（「設定とセキュリティ」参照）。

### コアの戻り値 — `[]` の多重意味を解く

現状 `ohlcv:get` の `[]` は、プラン外シンボルの短絡（`dailyOutOfPlan`）、未知シンボル（FMP が空配列 → `upsert` 無し）、
指定範囲に足が無いだけ、の 3 つを兼ねる。renderer は一律「カバーされていません」で済むが、MCP は別のメッセージを返す必要がある。

```ts
type OhlcvOutcome =
  | { kind: 'ok'; bars: Bar[]; fromCache: boolean }
  | { kind: 'out-of-plan' }        // dailyOutOfPlan の短絡、または 402/403
  | { kind: 'unknown-symbol' }     // プロバイダが空配列を返し、キャッシュも空
  | { kind: 'empty-range' }        // カバレッジはあるが指定範囲に足が無い
```

`ipc.ts` は `kind` を見て `bars` か `[]` に畳んで renderer に返す。`Api` の型は変わらない。

### 同時アクセスと取得の重複排除

`CacheService` に in-flight の重複排除は無く、renderer 側の dedup は TanStack Query のキー単位なので MCP 経路に効かない。
renderer と Claude が同時に同じ `symbol × timeframe` を要求すると FMP を 2 回叩く。`core.ts` に
`symbol|timeframe|range` をキーにした in-flight Promise マップを置き、完了時に破棄する。`refresh` も同じキー空間で直列化する。

### MCP サーバ

`@modelcontextprotocol/sdk` の Streamable HTTP トランスポートを `node:http` に載せる（Express は追加しない）。
`127.0.0.1` にバインド、パスは `/mcp`。`app.whenReady()` 内で設定が有効なときだけ起動し、トグルで起動／停止、`before-quit` で停止。

## MCP ツール

すべて `core.ts` 経由なので、UI 操作時とキャッシュ判定・取得挙動が一致する。

| ツール | 引数 | 返すもの | API 消費 |
|---|---|---|---|
| `search_symbols` | `query` | symbol / name / exchange の配列 | あり（5 分メモリキャッシュ） |
| `get_ohlcv` | `symbol`, `timeframe`, `from?`, `to?`, `limit?`, `force?` | ローソク足（CSV） | キャッシュ次第。`force` は毎回 1 |
| `get_quote` | `symbol` | 現在値・前日比・日中高安 | 毎回あり |
| `get_company_info` | `symbol`, `force?` | バリュエーション/財務/アナリスト/決算 | TTL 内は 0、ミス時は 7 |
| `get_workspaces` | — | 一覧（名前・アクティブか・銘柄数・グリッド形状） | なし |
| `get_active_workspace` | — | アクティブなワークスペース 1 件の詳細 | なし |
| `get_workspace` | `name` | 名前指定で 1 件の詳細 | なし |
| `get_cache_status` | `symbol?` | 銘柄×時間足の取得済み範囲・本数、timeframe ごとの capability | なし |

ワークスペースを 3 ツールに分けたのは、全件の詳細（各セルの銘柄・時間足・インジケータ配列）で出力が肥大するため。
詳細に含めるもの: 名前、ウォッチリスト（symbol / name / exchange）、グリッド形状、各セルの id・銘柄・時間足・
インジケータ（type と params）、アクティブセル id。`get_workspace` で名前不一致なら存在する名前一覧を添えてエラー。

### get_cache_status

`symbol` 省略時は全銘柄の「銘柄 / 時間足 / 本数 / 期間」一覧、指定時はその銘柄の時間足別内訳。どちらも timeframe ごとの
capability（`available` / `requires-plan` / `rate-limited` / `unknown`）を併せて返す。

現状の `barStore` には `getCoverage`（単点）と `getBars` しかないので 1 関数を足す。集約 1 本で全銘柄が揃うので
列挙とカウントを分けない（`COUNT(*)` の N+1 を避ける）。

```ts
// SELECT symbol, timeframe, COUNT(*) n, MIN(time) oldest, MAX(time) newest
// FROM bars GROUP BY symbol, timeframe
summarizeBars(): { symbol: string; timeframe: Timeframe; count: number; oldestTime: number; newestTime: number }[]
```

`coverage` 表ではなく `bars` を集約する。カバレッジ窓は union で広がり実際の足より広くなりうるが、
このツールが答えるべきは「今そこに何本あるか」。

W/M（`1w` / `1M`）は `1d` からの導出で行を持たない（D-17）ので `summarizeBars` に出てこない。出力では独立の時間足として並べず、
`1d` の行に `derived: ['1w', '1M']` を添え、「`1d` のカバレッジがそのまま W/M のカバレッジ」とツール説明に書く（M-13）。

### get_ohlcv の出力

日足の全履歴は数千本あり、JSON では 1 回で数万トークンを消費する。

- 既定 `limit = 300`（最新から）、上限 `2000`。超える指定はエラーにせず丸め、丸めたことを明記する。
- 本文は CSV 1 ブロック。ヘッダ `time,open,high,low,close,volume` + 行。
- 先頭に要約行を置き、Claude が追加取得の要否を判断できるようにする。

```
NVDA 1d — 300 of 4812 cached bars, 2025-05-12 to 2026-07-24 (cache hit, no API call)
time,open,high,low,close,volume
2025-05-12,112.30,114.05,111.88,113.42,241830000
...
```

日時は内部（`Bar.time`）が UTC epoch 秒でも、MCP の入出力は ISO 文字列にする（epoch 秒はモデルが誤りやすい）。
`from` / `to` は `YYYY-MM-DD`（日足以上）または `YYYY-MM-DDTHH:mm:ssZ`（分足・時間足）を受け、CSV の `time` 列も同形式。
分足・時間足に日付だけを渡した場合も 00:00 UTC として扱い、解釈した時刻を要約行に明記する。

`force: true` は `core.ohlcv.refresh`（右端差分）へ回す。既存 `refreshOHLCV` の契約どおりキャッシュ最新〜now だけなので
履歴の再取得は起きないが、**呼び出しごとに 1 リクエストを消費する**。ツール説明に「`force` は毎回 FMP を叩く。
最新の足が要るときだけ使い、通常は省略する」と書く。取得後に `from`/`to`/`limit` を適用して返す。

`core.ohlcv.get` が受ける `DateRange` は `{from, to}` の対か `undefined` のみなので、片側指定の埋め方を決める。

- 両方 → そのまま渡す
- `from` のみ → `{from, to: now}`（次節の修正で、カバレッジが無くてもこの範囲が FMP に渡る）
- `to` のみ → `undefined` を渡し、返った足に `to` を適用（`from` に defensible な既定値が無い。epoch 0 は分足で数十年分になる）。
  フィルタ後が空なら `empty-range` として扱い、カバレッジと「`from` も指定せよ」を添える
- 両方省略 → `undefined`（キャッシュにある全期間）
- `from > to` → 引数エラー（zod の `refine`）

いずれも `from` / `to` を適用してから `limit` を適用する。`limit` は出力を絞るだけで取得量には効かない。
分足に古い `from` を渡すと返却量が膨らむが、既存のスクロールバック補充と同じ性質で FMP のプラン上限が天井になる。

### 未キャッシュ intraday の範囲取得 — `CacheService` を 2 行直す

`CacheService.getOHLCV` の左端バックフィル（D-16）は `cov &&` で守られており、カバレッジが 1 行も無い銘柄×時間足では
範囲を指定しても `provider.getOHLCV(symbol, tf, undefined)` に落ちる。intraday では `intradayInitialRange` の直近窓しか
取らないため、要求した過去に届かない。ガードを広げる。

```ts
// before: cov && range && range.from < cov.oldestTime
const fetched =
  range && (!cov || range.from < cov.oldestTime)
    ? await provider.getOHLCV(symbol, tf, { from: range.from, to: cov ? cov.oldestTime - 1 : range.to })
    : await provider.getOHLCV(symbol, tf, undefined)
```

renderer への影響は無い。範囲を渡すのは `Chart.tsx` のスクロールバック補充 1 箇所だけで、`bars[0].time` 起点なので
必ずカバレッジがある（`!cov` 側に入らない）。他の呼び出し（`Chart` / `GridHost` / `Watchlist` の初回マウント、capability 探査）は
すべて `undefined`。`1d` はプロバイダが範囲を無視して全履歴を返す（D-08）ので不変。1 リクエストで済むのでツール層で 2 段に分けない。

要求範囲を満たせない原因は履歴上限だけではない。`CacheService` が埋めるのは左端だけで、右端の欠け
（`range.to > cov.newestTime`）と窓の内側の穴は埋めない（後者は coverage が min/max しか持たず検出もできない）。
どちらも D-16 以来の挙動で、renderer は右端を `refresh` で埋めるため踏まないが、MCP は任意範囲を渡せるので踏む。

取得ロジックは変えず、**返した範囲が要求範囲を満たしたかを要約行で必ず明示する**。満たせていなければ理由を問わず note を出し、
`force` か範囲の絞り込みを促す。空配列も足りない範囲も、Claude に「これで全部」と読ませないことが要件。

```
NVDA 5m — 300 of 1170 cached bars, 2026-07-18T13:30:00Z to 2026-07-24T20:00:00Z (1 API call)
note: requested from=2026-01-01 but the oldest bar returned is 2026-07-18 — the FMP plan may not carry intraday history that far back.
```

`get_cache_status` を置いたのも、取得を許可する以上「これは未取得なので FMP を叩く」と Claude が判断できる材料が要るため。
ツール説明にも未キャッシュ銘柄への `get_ohlcv` が API を消費する旨を書き、無差別なスキャンを抑制する。

### get_company_info の鮮度と部分欠損

`CompanyInfoService` の TTL は 1 日。TTL 内はネットワークを触らないが、ミスすると `getCompanyProfile` が **7 リクエスト**
（必須の `/profile` + 任意 6 本）を撃つ。任意 6 本は 402 / 429 を含む失敗を `null` に潰すので「バリュエーションだけ空」が普通に起きる。
また取得が失敗しキャッシュ行があれば `force` でも stale を返す。出力に鮮度と欠損を明示する。

- `fetchedAt`（既に `CompanyInfo` にある）を `as of <ISO>` として先頭に出す
- `force` を付けても `fetchedAt` が更新されていなければ `stale: fetch failed, showing cached` を添える
- `null` のグループは省略せず `valuation: not available` として並べる（省略すると「そういう会社」と解釈されうる）

欠損が「プラン外」か「一時的な上限」かは `opt()` が理由を捨てるので区別できない。v1 は `not available` に統一し、
必要になったら `opt()` に失敗理由を持たせる。

### 文言

ツール説明、引数説明、エラーメッセージ、`get_ohlcv` の要約行は、モデルが読むので英語。
Settings ダイアログの表示文言とトーストは既存どおり日本語。

## 設定とセキュリティ

既定は無効。設定は `settings.json`（SQLite = OHLCV / JSON = 設定の分離を維持）。

```json
{ "mcp": { "enabled": false, "port": 39100, "token": "<random>" } }
```

`SettingsDialog.tsx` は `<ThemeSetting />` と `<ApiKeySetting />` を直接並べたハードコードなので、
`settings/McpSetting.tsx` を新規に作り同じ並びに 1 行足す（レジストリ化は別件）。チャンネルを追加する。

| チャンネル | 用途 |
|---|---|
| `mcp:getConfig` | `{ enabled, port, token }`。トークンはコピーボタン用に平文 |
| `mcp:setEnabled` | トグル。true で起動、false で停止し結果を返す |
| `mcp:setPort` | ポート変更。稼働中なら再起動 |
| `mcp:regenerateToken` | トークン再生成。稼働中なら再起動 |
| `mcp:getStatus` | `{ running, error? }`。ダイアログを開いたときの現在状態 |
| `mcp:statusChanged` | main → renderer。起動失敗（ポート衝突など）をトーストに出す |

`Api` にも `mcp` 名前空間を足す。既存のチャンネルと型は変更しない。防御は 3 段構え。

1. `127.0.0.1` にのみバインドする。
2. Bearer トークンを必須にする。`crypto.randomBytes(32).toString('base64url')` を初回有効化時に生成して
   `settings.json` へ保存し、Settings 画面にコピーボタン付きで表示する。比較は `crypto.timingSafeEqual`（長さ不一致は先に弾く）。
3. `Origin` を検証する（MCP 仕様の DNS リバインディング対策）。値がある場合は `http://127.0.0.1:<port>` と
   `http://localhost:<port>` のみ許可し、それ以外は 403。**ヘッダ自体が無いリクエストは通す**（M-12）。

トークンは平文で置く。`keystore.ts` が API キーの平文書き込みを拒否している（D-05）のと扱いを変える理由は M-11。
ポート使用中なら起動を失敗させトーストで通知する（自動でずらすと設定と実態が食い違う）。

Settings 画面には貼り付け用の JSON を表示する。Claude Code は `claude mcp add --transport http` でも登録できる。

```json
{ "mcpServers": { "vibing-view": {
    "type": "http", "url": "http://127.0.0.1:39100/mcp",
    "headers": { "Authorization": "Bearer <token>" } } } }
```

## エラー処理

エラーは MCP の `isError: true` + 英語メッセージで返し、プロトコルエラーにしない。判別は `OhlcvOutcome` の `kind` と
`FmpHttpError.status` で行い、`[]` から推測する経路は作らない。

| 状況 | 判別元 | メッセージ |
|---|---|---|
| `NO_API_KEY` | throw された `Error('NO_API_KEY')` | `FMP API key is not configured. Set it in Vibing View's settings dialog.` |
| 402/403（時間足がプラン外） | `FmpHttpError` かつ 分足・時間足 | `This timeframe is not available on the current FMP plan.` |
| 402/403（銘柄がプラン外） | `kind: 'out-of-plan'` | `No data available — the symbol may be outside the current plan's coverage.` |
| 429 | `FmpHttpError.status === 429` | `FMP daily request limit reached. Try again tomorrow.` |
| 不明なシンボル | `kind: 'unknown-symbol'` | `No results. Use search_symbols to find the correct ticker.` |
| 範囲に足が無い | `kind: 'empty-range'` | `No bars in that range. Cached coverage is <oldest> to <newest>.` |
| `get_workspace` の名前不一致 | — | `No workspace named "<name>". Available: <names>` |

`dailyOutOfPlan` の短絡は `kind: 'out-of-plan'` を返すよう変える（`ipc.ts` が `[]` に畳むので renderer の挙動は不変）。
引数検証は既存依存の zod。`timeframe` は 7 値の enum、`limit` は範囲外を丸め、`from > to` は `refine` で弾く。

## テスト

`tests/main/` に追加する。既存どおり Electron をテストグラフに入れない。

- **`core.ts`** — broadcast・ストア・プロバイダをフェイク注入し、capability 追跡、`dailyOutOfPlan` の短絡が
  `kind: 'out-of-plan'` を返すこと、`OhlcvOutcome` の 4 分岐、workspaces の rev 採番と送信元除外。
  これまで `ipc.ts` のクロージャ内にあってテストできなかった部分。
- **in-flight 重複排除** — 同じ `symbol × timeframe` を解決前に 2 回要求し、プロバイダ呼び出しが 1 回で済むこと。API 予算の要。
- **`ipc.ts` の畳み込み** — `out-of-plan` / `unknown-symbol` / `empty-range` のいずれでも renderer には `[]` が返ること。
- **`barStore`** — `summarizeBars` が全銘柄×時間足の本数と期間を 1 クエリで返し、W/M の行が現れないこと。
- **MCP ツール層** — フェイクの core を注入し、引数検証、`limit` の丸め、CSV 整形、`force` が refresh 経路へ回ること、エラー写像。
  `from`/`to` は 5 ケース（両方 / `from` のみ → `to = now` / `to` のみ → `undefined` + 出力フィルタ / 両方省略 / `from > to` はエラー）で
  コアに渡る `range` を検証し、`limit` が取得量に効かないことも見る。
- **`CacheService` の広げたガード** — カバレッジ無し + 範囲指定でプロバイダに `{from: range.from, to: range.to}` が渡ること。
  カバレッジ有り + より古い `from` は従来どおり `{from, to: cov.oldestTime - 1}`。範囲 `undefined` は `undefined` のまま（回帰テスト）。
- **HTTP 層** — トークン無し・不正トークン・不正 Origin を弾き、`Origin` 無しは通すこと。

手動確認: `claude mcp add` で登録し、`get_active_workspace` と `get_ohlcv` の結果がアプリの表示と一致すること。

## 決定事項

- **M-01** MCP サーバは Electron main に同居させる。API キーが `safeStorage` 暗号化で保存され外部プロセスから復号できないため、
  取得を許可する以上この配置しかない。
- **M-02** トランスポートは localhost の Streamable HTTP。Desktop / Code の双方から同じ URL を指せる。
- **M-03** 未キャッシュデータの FMP 取得を許可する。`get_cache_status` とツール説明で消費を可視化して抑制する。
- **M-04** `ipc.ts` からトランスポート非依存の `core.ts` を抽出する。今回必要なロジックの移動に限り、全面書き直しはしない。
- **M-05** `get_ohlcv` は CSV + 既定 300 本。出力トークン量が最大のリスクのため。
- **M-06** MCP は既定で無効。有効化は Settings のトグル。
- **M-07** ポート衝突時は自動フォールバックせず起動失敗として通知する。
- **M-08** MCP の入出力の日時は ISO 文字列。epoch 秒との変換はツール層が担う。
- **M-09** `core.ohlcv` は `Bar[]` ではなく `OhlcvOutcome` を返す。`[]` が 3 つの状況を兼ねエラーメッセージを選べないため。
  `ipc.ts` が `[]` に畳んで renderer の契約を保つ。
- **M-10** `core.ts` に in-flight の取得重複排除を置く。renderer と MCP の同時要求で FMP を 2 回叩くため。
- **M-11** MCP トークンは `settings.json` に平文で置く。API キー（D-05）は漏れれば請求に直結する外部資格情報だが、
  こちらは localhost 限定で `mcp:regenerateToken` で失効でき、UI に平文表示する要件がある以上 `safeStorage` でも守れる範囲が増えない。
  トグル off はサーバ停止のみで、トークンは残る。
- **M-12** `Origin` が無いリクエストは通す。Claude Desktop / Code は非ブラウザクライアントで付けないため、必須にすると誰も繋がらない。
- **M-13** `get_cache_status` に W/M の本数・期間は出さない。`1d` からの導出で行を持たず（D-17）、数えるには導出の実行が要る。
  `1d` の行に `derived` として添える。
- **M-14** `to` だけの場合は `from` を補わず `undefined` を渡して出力側で絞る（epoch 0 は分足で数十年分になる）。
  `from` だけの場合は `to = now` で補う（M-15 により実際に遡れる）。
- **M-15** `CacheService` の範囲取得ガードを `cov &&` から `!cov ||` に広げる。カバレッジが無いと直近窓しか取れず、
  未キャッシュ intraday の過去に届かないため。renderer は影響しない。

## 将来枠

- ワークスペース編集ツール。`core.workspaces.set` を呼ぶだけで既存の rev + `workspaces:changed` ブロードキャストに乗る。
- stdio ブリッジ。Claude Desktop がローカル HTTP を受けない場合に追加する。
- Settings ダイアログのレジストリ化。
- `DataSourceAdapter` の抽出。CLAUDE.md はこれを前提に書かれているが実際には存在せず、`CacheService` が
  `Pick<FmpProvider, ...>` を直接受けている。MCP は `core.ts` 経由で `CacheService` を使うだけなので乖離は広がらないが、
  2 つ目のプロバイダを足す時点で、記述を実態に合わせるか抽出するかを判断する。
