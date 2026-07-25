# MCP サーバ導入 — 設計

日付: 2026-07-25

## 目的

Claude（Claude Desktop / Claude Code）から Vibing View の保持する情報を読めるようにする。
対象は 3 種類：

- SQLite にキャッシュ済みの OHLCV
- ユーザーの作業状態（ワークスペース = ウォッチリスト + グリッド構成）
- 企業情報（バリュエーション・財務・アナリスト・決算スケジュール）

未キャッシュのデータについては、Claude からの FMP 取得も許可する（M-03）。

## スコープ

v1 は読み取り 8 ツール。ワークスペースの編集（Claude から銘柄を追加する等）は将来実装とし、
今回はその追加が小さく収まる構造を用意するところまで。

**非スコープ**

- インジケータ計算のツール化。指標コードは `src/renderer/indicators` にあり、移設は別件。
  Claude は返された足から自前で計算できる。
- stdio ブリッジ（案 C）。Claude Desktop がローカル HTTP のカスタムコネクタを受けるか未確認で、
  繋がらなければ追加する。
- `market_status` ツール。`Quote`（`src/shared/types.ts`）に開場フラグは無く、市場状態は別
  エンドポイント・別型（`FmpProvider.getMarketStatus`）。ツール化は毎回 1 リクエストを足す一方、
  Claude 側の判断に要る場面が薄いため v1 では出さない。`core.market.status` は renderer が
  使うので残す。
- アプリ停止中の動作。MCP サーバは Electron main に同居するため、アプリ起動中のみ応答する。

## アーキテクチャ

### なぜコアを抽出するか

現状 `src/main/ipc.ts` の `registerIpc()` は、ipcMain へのバインドとドメインロジックを同じ
クロージャに抱えている。`withCapabilityTracking`、`dailyOutOfPlan` の短絡、`workspacesRev` の
採番とウィンドウ通知、`clipboard` の rev 管理がすべてその中にある。MCP から同じ挙動を得るには、
再実装するか ipcMain 経由で自分自身を呼ぶかしかない。

そこでトランスポート非依存の層を切り出す。

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

`core.ts` は Electron 依存を注入で受ける。ウィンドウへの送信は
`broadcast(channel, payload, exceptWebContentsId?)` として渡し、`core.ts` 自体は
`BrowserWindow` を import しない。これで Vitest から直接テストできる（`db/client.ts` の
lazy-require と同じ思想）。

`registerIpc()` は「チャンネル名 → コアのメソッド」の対応表になる。**既存の**チャンネル定義
（`src/shared/ipc.ts` の `CH` / `Api`）と renderer 側は変更しない。MCP の設定 UI 用に
チャンネルを新規追加する（「設定とセキュリティ」に列挙）。

### コアの戻り値 — `[]` の多重意味を解く

現状 `ohlcv:get` の `[]` は 3 つの異なる状況を指す。プラン外シンボルの短絡（`ipc.ts` の
`dailyOutOfPlan`）、未知シンボル（FMP が空配列を返し、そのまま `upsert` 無し → `getBars` が
`[]`）、指定範囲に足が無いだけ。renderer は「カバーされていません」の一言で済むので問題に
ならなかったが、MCP はこの 3 つを別のメッセージで返す必要がある（「エラー処理」の表）。

そこで `core.ohlcv.get` / `refresh` は素の `Bar[]` ではなく判別可能な結果を返す。

```ts
type OhlcvOutcome =
  | { kind: 'ok'; bars: Bar[]; fromCache: boolean }
  | { kind: 'out-of-plan' }        // dailyOutOfPlan の短絡、または 402/403
  | { kind: 'unknown-symbol' }     // プロバイダが空配列を返し、キャッシュも空
  | { kind: 'empty-range' }        // カバレッジはあるが指定範囲に足が無い
```

`ipc.ts` は従来の契約を保つため `kind` を見て `bars` か `[]` に畳んでから renderer に返す。
renderer と `Api` の型は変わらない。

### 同時アクセスと取得の重複排除

MCP が加わると、renderer と Claude が同時に同じ `symbol × timeframe` を要求しうる。
`CacheService` は in-flight の重複排除を持たず、renderer 側の dedup は TanStack Query の
キー単位なので MCP 経路には効かない。両方がミスすれば FMP を 2 回叩く。API 呼び出しの節約が
最優先の方針に直接反するため、`core.ts` に `symbol|timeframe|range` をキーにした in-flight
Promise マップを置き、完了時に破棄する。`refresh` も同じキー空間で直列化する。

### MCP サーバ

`@modelcontextprotocol/sdk` の Streamable HTTP トランスポートを `node:http` のサーバに載せる。
Express は追加しない。`127.0.0.1` にバインドし、パスは `/mcp`。

ライフサイクルは `app.whenReady()` 内で、設定が有効なときだけ起動する。設定トグルの
切り替えで起動／停止し、`before-quit` で停止する。

## MCP ツール

すべて `core.ts` 経由。UI から操作したときとキャッシュ判定・取得挙動が一致する。

| ツール | 引数 | 返すもの | API 消費 |
|---|---|---|---|
| `search_symbols` | `query` | symbol / name / exchange の配列 | あり（5 分メモリキャッシュ） |
| `get_ohlcv` | `symbol`, `timeframe`, `from?`, `to?`, `limit?`, `force?` | ローソク足（CSV） | キャッシュ次第。`force` は毎回 1 |
| `get_quote` | `symbol` | 現在値・前日比・日中高安 | 毎回あり |
| `get_company_info` | `symbol`, `force?` | バリュエーション/財務/アナリスト/決算 | TTL 内は 0、ミス時は 7 |
| `get_workspaces` | — | ワークスペース一覧（名前・アクティブか・銘柄数・グリッド形状） | なし |
| `get_active_workspace` | — | アクティブなワークスペース 1 件の詳細 | なし |
| `get_workspace` | `name` | 名前指定で 1 件の詳細 | なし |
| `get_cache_status` | `symbol?` | 銘柄×時間足の取得済み範囲・本数、timeframe ごとの capability | なし |

`get_cache_status` の `symbol` を省略した場合は、キャッシュを持つ全銘柄について
「銘柄 / 時間足 / 本数 / 期間」の一覧を返す。指定した場合はその銘柄の時間足別内訳のみ。
どちらの場合も timeframe ごとの capability（`available` / `requires-plan` / `rate-limited` /
`unknown`）を併せて返す。

この形は現状の `barStore` では引けない。あるのは `getCoverage`（銘柄×時間足の単点）と
`getBars` だけで、全銘柄の列挙も本数のカウントも無い。2 関数を足す。

```ts
// coverage 表の全行。SELECT symbol, timeframe, oldestTime, newestTime FROM coverage
listCoverage(): { symbol: string; timeframe: Timeframe; oldestTime: number; newestTime: number }[]
// 本数。足を全部読まずに数える。SELECT COUNT(*) ... WHERE symbol = ? AND timeframe = ?
countBars(symbol: string, tf: Timeframe): number
```

W/M（`1w` / `1M`）は `1d` から導出するだけで行を持たない（D-17）。したがって coverage 表には
現れず、`listCoverage` にも出てこない。ツールの出力では W/M を独立の時間足として並べず、
`1d` の行に `derived: ['1w', '1M']` を添える。本数を出すなら `deriveWeekly` /
`deriveMonthly` を実行して数えることになるが、それは全足の読み出しと集約を伴うので v1 では
出さない。「`1d` のカバレッジがそのまま W/M のカバレッジ」とツール説明に書く。

ワークスペース系を 3 つに分けたのは、全件の詳細（各セルの銘柄・時間足・インジケータ配列）を
返すと出力が肥大するため。`get_workspaces` は一覧に絞り、詳細は 1 件ずつ取らせる。
`get_workspace` で該当名が無い場合は、存在する名前の一覧を添えてエラーを返す。

ワークスペース詳細に含めるもの: 名前、ウォッチリスト（symbol / name / exchange）、
グリッド形状、各セルの id・銘柄・時間足・インジケータ（type と params）、アクティブセル id。

### get_ohlcv の出力

日足の全履歴は数千本あり、JSON でそのまま返すと 1 回で数万トークンを消費する。

- 既定 `limit = 300`（最新から）、上限 `2000`。超える指定はエラーにせず上限へ丸め、丸めたことを明記する。
- 本文は CSV の 1 ブロック。ヘッダ `time,open,high,low,close,volume` + 行。JSON のキー反復が消える。
- 先頭に要約行を置き、Claude が追加取得の要否を判断できるようにする。

```
NVDA 1d — 300 of 4812 cached bars, 2025-05-12 to 2026-07-24 (cache hit, no API call)
time,open,high,low,close,volume
2025-05-12,112.30,114.05,111.88,113.42,241830000
...
```

日時は内部（`Bar.time`）では UTC epoch 秒だが、MCP の入出力では ISO 文字列を使う。
`from` / `to` は `YYYY-MM-DD`（日足以上）または `YYYY-MM-DDTHH:mm:ssZ`（分足・時間足）を受け、
CSV の `time` 列も同じ形式で出す。epoch 秒はモデルにとって読み書きの誤りが起きやすいため。

`force: true` は `core.ohlcv.refresh`（右端差分）へ回す。既存の `refreshOHLCV` の契約どおり
キャッシュ最新〜now だけを取得するので、履歴の再取得は起きない。ただし**呼び出しごとに 1
リクエストを消費する**（キャッシュ最新の 1 本を含む右端を必ず取り直すため）。連打は
そのまま API 消費になるので、ツール説明に「`force` は毎回 FMP を叩く。最新の足が要るときだけ
使い、通常は省略する」と書く。取得後に `from`/`to`/`limit` を適用して返す。

`from` / `to` はどちらも省略可だが、`core.ohlcv.get` が受ける `DateRange` は `{from, to}` の対か
`undefined` しかない（`src/shared/types.ts`）。片側だけ与えられたときの埋め方を決める。

- 両方 → `{from, to}` をそのまま渡す
- `from` のみ → `{from, to: now}`。次節の `CacheService` 修正により、カバレッジが無くても
  この範囲がそのまま FMP に渡るので、要求どおり遡れる
- `to` のみ → `undefined` を渡し、返ってきた足に `to` を適用する。`from` に defensible な
  既定値が無いため（epoch 0 を入れると分足で数十年分を要求してしまう）。フィルタ後が空に
  なった場合は `empty-range` として扱い、メッセージにカバレッジと「`from` も指定せよ」を
  添える
- 両方省略 → `undefined`（キャッシュにある全期間）
- `from > to` → 引数エラー（zod の `refine`）
- 日足以上に `YYYY-MM-DD` を渡した場合は当日 00:00 UTC。分足・時間足に日付だけを渡した場合も
  同じく 00:00 UTC として扱い、要約行に解釈した時刻を明記する

いずれの場合も、返ってきた足に `from` / `to` を適用してから `limit` を適用する。`limit` は
出力を絞るだけで取得量には効かない。分足に何年も前の `from` を渡すと 1 リクエストの返却量が
膨らむが、これは既存のスクロールバック補充と同じ性質で、FMP のプラン上限が実質的な天井になる。

### 未キャッシュ intraday の範囲取得 — `CacheService` を 2 行直す

`CacheService.getOHLCV` の左端バックフィル（D-16）は `cov &&` で守られている。

```ts
const fetched =
  cov && range && range.from < cov.oldestTime
    ? await provider.getOHLCV(symbol, tf, { from: range.from, to: cov.oldestTime - 1 })
    : await provider.getOHLCV(symbol, tf, undefined)
```

カバレッジが 1 行も無い銘柄×時間足では条件が成立せず、範囲を指定しても
`provider.getOHLCV(symbol, tf, undefined)` に落ちる。intraday ではこれが
`intradayInitialRange` の直近窓しか取らないため、要求した過去には決して届かない。ガードを
広げる。

```ts
const fetched =
  range && (!cov || range.from < cov.oldestTime)
    ? await provider.getOHLCV(symbol, tf, { from: range.from, to: cov ? cov.oldestTime - 1 : range.to })
    : await provider.getOHLCV(symbol, tf, undefined)
```

renderer への影響は無い。範囲を渡す呼び出しは `Chart.tsx` のスクロールバック補充 1 箇所だけで、
`bars[0].time` を起点にするため必ずカバレッジがある状態で呼ばれる（`!cov` 側に入らない）。
他の呼び出し（`Chart` / `GridHost` / `Watchlist` の初回マウント、capability 探査）はすべて
`undefined` を渡すので分岐が変わらない。`1d` はプロバイダが範囲を無視して全履歴を返すので
（D-08）これも不変。

1 リクエストで済むので、ツール層で 2 段に分ける必要も無い。

要約行には**実際に返した範囲**とキャッシュのカバレッジ、消費した API 回数を出す。要求 `from` に
届かなかった場合（プランの intraday 履歴上限）は note を添える。

```
NVDA 5m — 300 of 1170 cached bars, 2026-07-18T13:30:00Z to 2026-07-24T20:00:00Z (1 API call)
note: requested from=2026-01-01 but the oldest bar returned is 2026-07-18 — the FMP plan may not carry intraday history that far back.
```

`to` のみを与えてフィルタ後が空になった場合は `empty-range` として扱い、メッセージに
カバレッジを添える（「エラー処理」の表）。空配列を「データが無い」と読ませない。

`get_cache_status` を置いたのは、取得を許可する以上、Claude が「これは未取得なので FMP を
叩くことになる」と判断できる材料が要るため。ツール説明にも未キャッシュ銘柄への `get_ohlcv` が
API を消費する旨を書き、無差別なスキャンを抑制する。

### get_company_info の鮮度と部分欠損

`CompanyInfoService` の TTL は 1 日。TTL 内はネットワークを触らないが、ミスすると
`getCompanyProfile` が **7 リクエスト**を撃つ（必須の `/profile` + 任意 6 本）。任意 6 本は
402 / 429 を含む一切の失敗を `null` に潰すので、有料プラン外や日次上限で「バリュエーションだけ
空」の応答が普通に起きる。さらに取得が失敗しキャッシュ行があれば `force` でも stale を返す。

このためツール出力に鮮度と欠損を明示する。

- `fetchedAt`（既に `CompanyInfo` にある）を `as of <ISO>` として先頭に出す
- `force` を付けたのに `fetchedAt` が更新されていなければ `stale: fetch failed, showing cached`
  を添える
- `null` のグループは省略せず `valuation: not available` として並べる。省略すると Claude が
  「そういう会社」と解釈しかねない

欠損が「プラン外」か「一時的な上限」かは現状の `opt()` が捨てているので区別できない。v1 は
区別せず `not available` に統一する。区別が必要になったら `opt()` に失敗理由を持たせる。

### ツール説明と文言

ツール説明、引数説明、エラーメッセージ、`get_ohlcv` の要約行は、いずれもモデルが読むため
英語で書く。Settings ダイアログの表示文言とトーストは既存どおり日本語。

## 設定とセキュリティ

既定は無効。設定は `settings.json` に置く（SQLite = OHLCV / JSON = 設定の分離を維持）。

```json
{ "mcp": { "enabled": false, "port": 39100, "token": "<random>" } }
```

### UI と IPC の追加

`SettingsDialog.tsx` は `<ThemeSetting />` と `<ApiKeySetting />` を直接並べたハードコードで、
レジストリ駆動ではない。「MCP サーバ」セクションは `settings/McpSetting.tsx` を新規に作り、
同じ並びに 1 行足す（レジストリ化は別件、ここではやらない）。

必要なチャンネルが既存の `CH` に無いので追加する。

| チャンネル | 用途 |
|---|---|
| `mcp:getConfig` | `{ enabled, port, token }` を返す。トークンはコピーボタン用に平文で渡す |
| `mcp:setEnabled` | トグル。true で起動、false で停止し、結果を返す |
| `mcp:setPort` | ポート変更。稼働中なら再起動 |
| `mcp:regenerateToken` | トークン再生成。稼働中なら再起動 |
| `mcp:getStatus` | `{ running, error? }`。ダイアログを開いたときの現在状態 |
| `mcp:statusChanged` | main → renderer。起動失敗（ポート衝突など）をトーストに出す |

`Api` にも `mcp` 名前空間を足す。既存のチャンネルと型は変更しない。

ローカルポートを開けるため、防御は 3 段構え。

1. `127.0.0.1` にのみバインドする（`0.0.0.0` にしない）。
2. Bearer トークンを必須にする。`crypto.randomBytes(32).toString('base64url')` を初回有効化時に
   生成して `settings.json` へ保存し、Settings 画面にコピーボタン付きで表示する。比較は
   `crypto.timingSafeEqual`。長さ不一致は先に弾く。
3. `Origin` ヘッダを検証する。MCP 仕様が DNS リバインディング対策として要求している項目で、
   ブラウザ由来のリクエストを弾く。**ヘッダ自体が無いリクエストは通す** — Claude Desktop /
   Claude Code は非ブラウザクライアントで `Origin` を付けない。値がある場合は
   `http://127.0.0.1:<port>` と `http://localhost:<port>` のみ許可し、それ以外は 403。

トークンは `settings.json` に平文で置く。`keystore.ts` は API キーの平文書き込みを拒否している
（D-05）が、そこと扱いを変える。API キーは課金される外部の資格情報で漏れれば請求に直結する一方、
このトークンは localhost に閉じたセッション資格情報で、失効はトグル 1 つ。加えて Settings 画面に
コピーボタンで平文表示する必要があり、`safeStorage` に入れても同じプロセスが復号して表示するので
守れる範囲が増えない。ローテーションは `mcp:regenerateToken` で任意に行える。

ポート使用中なら起動に失敗させ、トーストで通知する。別ポートへ自動的にずらすと設定ファイルと
実態が食い違うため、ずらさない。

Settings 画面には貼り付け用の JSON を表示する。

```json
{ "mcpServers": { "vibing-view": {
    "type": "http", "url": "http://127.0.0.1:39100/mcp",
    "headers": { "Authorization": "Bearer <token>" } } } }
```

Claude Code は `claude mcp add --transport http` でも登録できる。

## エラー処理

エラーは MCP の `isError: true` + 英語メッセージで返し、プロトコルエラーにしない。Claude が
状況を理解して次の手を選べるようにするため。

判別は `OhlcvOutcome` の `kind`（「コアの戻り値」）と `FmpHttpError.status` で行う。`[]` を
見て推測する経路は作らない。

| 状況 | 判別元 | メッセージ |
|---|---|---|
| `NO_API_KEY` | throw された `Error('NO_API_KEY')` | `FMP API key is not configured. Set it in Vibing View's settings dialog.` |
| 402/403（時間足がプラン外） | `FmpHttpError` かつ 分足・時間足 | `This timeframe is not available on the current FMP plan.` |
| 402/403（銘柄がプラン外） | `kind: 'out-of-plan'` | `No data available — the symbol may be outside the current plan's coverage.` |
| 429 | `FmpHttpError.status === 429` | `FMP daily request limit reached. Try again tomorrow.` |
| 不明なシンボル | `kind: 'unknown-symbol'` | `No results. Use search_symbols to find the correct ticker.` |
| 範囲に足が無い | `kind: 'empty-range'` | `No bars in that range. Cached coverage is <oldest> to <newest>.` |
| `get_workspace` の名前不一致 | — | `No workspace named "<name>". Available: <names>` |

`ipc.ts` の `dailyOutOfPlan` 短絡は現状 `[]` を返すが、コア化に伴い `kind: 'out-of-plan'` を
返すよう変える。`ipc.ts` は従来どおり `[]` に畳んで renderer へ返すので、renderer 側の挙動は
変わらない。

引数検証は既存依存の zod で行う。`timeframe` は 7 値の enum、`limit` は範囲外を丸める、
`from > to` は `refine` で弾く。

## テスト

`tests/main/` に追加する。既存どおり Electron をテストグラフに入れない。

- **`core.ts`** — ブロードキャスト関数・ストア・プロバイダをフェイクで注入し、capability 追跡、
  `dailyOutOfPlan` の短絡（`kind: 'out-of-plan'` を返すこと）、`OhlcvOutcome` の 4 分岐、
  workspaces の rev 採番と送信元除外を検証する。これまで `ipc.ts` のクロージャ内にあって
  テストできなかった部分にあたる。
- **in-flight 重複排除** — 同じ `symbol × timeframe` を解決前に 2 回要求し、プロバイダの
  呼び出しが 1 回で済むことを検証する。API 予算の要なのでここは必ず書く。
- **`ipc.ts` の畳み込み** — `kind` が `out-of-plan` / `unknown-symbol` / `empty-range` の
  いずれでも renderer には `[]` が返り、既存の契約が壊れていないことを検証する。
- **`barStore`** — `listCoverage` が全行を返すこと、`countBars` が足を読まずに数えること、
  W/M の行が現れないこと。
- **MCP ツール層** — フェイクの core を注入し、引数検証、`limit` の丸め、CSV 整形、`force` が
  refresh 経路へ回ること、エラー写像を検証する。`from`/`to` は 5 ケース（両方 / `from` のみ →
  `to = now` / `to` のみ → `undefined` + 出力フィルタ / 両方省略 / `from > to` はエラー）で
  コアに渡る `range` を検証し、`limit` が取得量ではなく出力にしか効かないことも見る。
- **`CacheService` の広げたガード** — カバレッジ無し + 範囲指定で、プロバイダに
  `{from: range.from, to: range.to}` がそのまま渡ること。カバレッジ有り + `from` がより古い
  場合は従来どおり `{from, to: cov.oldestTime - 1}` になること。範囲 `undefined` は
  `undefined` のままであること（既存の初回取得を壊していない回帰テスト）。
- **HTTP 層** — トークン無し・不正トークン・不正 Origin を弾き、`Origin` 無しは通すことを
  検証する。

手動確認: `claude mcp add` で登録し、`get_active_workspace` と `get_ohlcv` の結果がアプリの
表示と一致することを確認する。

## 決定事項

- **M-01** MCP サーバは Electron main に同居させる。API キーが `safeStorage` 暗号化で
  保存されており、外部プロセスからは復号できないため、取得を許可する以上この配置しかない。
- **M-02** トランスポートは localhost の Streamable HTTP。Claude Desktop / Claude Code の
  双方から同じ URL を指せる。
- **M-03** 未キャッシュデータについて Claude からの FMP 取得を許可する。`get_cache_status` と
  ツール説明で消費を可視化して抑制する。
- **M-04** `ipc.ts` からトランスポート非依存の `core.ts` を抽出する。抽出範囲は今回必要な
  ロジックの移動に限り、`ipc.ts` の全面書き直しはしない。
- **M-05** `get_ohlcv` は CSV + 既定 300 本で返す。出力トークン量が最大のリスクのため。
- **M-06** MCP は既定で無効。有効化は Settings のトグル。
- **M-07** ポート衝突時は自動フォールバックせず、起動失敗として通知する。
- **M-08** MCP の入出力の日時は ISO 文字列。内部の epoch 秒との変換はツール層が担う。
- **M-09** `core.ohlcv` は `Bar[]` ではなく判別可能な `OhlcvOutcome` を返す。現状 `[]` が
  「プラン外」「未知シンボル」「範囲に足が無い」の 3 つを兼ねており、MCP のエラーメッセージを
  選べないため。`ipc.ts` が `[]` に畳んで renderer の契約を保つ。
- **M-10** `core.ts` に in-flight の取得重複排除を置く。renderer と MCP が同時に同じ
  `symbol × timeframe` を要求すると FMP を 2 回叩くため。API 呼び出しの節約が最優先の方針に
  従う。
- **M-11** MCP トークンは `settings.json` に平文で置く。API キー（D-05 で平文を拒否）とは
  扱いを変える。localhost 限定のセッション資格情報であり、UI に平文表示する要件があるため
  `safeStorage` に入れても守れる範囲が増えない。
- **M-12** `Origin` ヘッダが無いリクエストは通す。Claude Desktop / Claude Code は非ブラウザ
  クライアントで `Origin` を付けない。必須にすると誰も繋がらない。
- **M-13** `get_cache_status` に W/M の本数・期間は出さない。`1d` から導出するだけで coverage
  行を持たず（D-17）、数えるには全足の集約が要る。`1d` の行に `derived` として添える。
- **M-14** `to` だけが与えられた場合、`from` を補わず `undefined` を渡して出力側で絞る。`from`
  に defensible な既定値が無く、epoch 0 を入れると分足で数十年分を要求するため。`from` だけの
  場合は `to = now` で補う（M-15 により実際に遡れるので嘘にならない）。
- **M-15** `CacheService` の範囲取得ガードを `cov &&` から `!cov ||` に広げる。カバレッジが
  無い状態で範囲を指定しても直近窓しか取れず、未キャッシュ intraday の過去に届かないため。
  renderer で範囲を渡すのは `Chart.tsx` のスクロールバック補充 1 箇所のみで、必ずカバレッジが
  ある状態で呼ばれるので影響しない。ツール層で 2 段取得を組む案は、1 リクエストで済む以上
  不要。

## 将来枠

- ワークスペース編集ツール（セルの銘柄変更、ウォッチリスト追加など）。`core.workspaces.set` を
  呼ぶだけで、既存の rev + `workspaces:changed` ブロードキャストに乗り、開いているウィンドウへ
  即座に反映される。
- stdio ブリッジ（案 C）。Claude Desktop がローカル HTTP を受けない場合に追加する。
- Settings ダイアログのレジストリ化。今回は `McpSetting` を 1 行足すだけに留める。
- `DataSourceAdapter` の抽出。CLAUDE.md はプロバイダ非依存の `DataSourceAdapter` を前提に
  書かれているが、実際には存在せず `CacheService` が `Pick<FmpProvider, ...>` を直接受けている。
  MCP は `core.ts` 経由で `CacheService` を使うだけなので今回この乖離は広がらないが、2 つ目の
  プロバイダを足す時点で解消が必要。CLAUDE.md 側の記述を実態に合わせるか、抽出するかの判断も
  そこで行う。
