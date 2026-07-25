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
- `market_status` ツール。`get_quote` で足りる。
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

`registerIpc()` は「チャンネル名 → コアのメソッド」の対応表になる。チャンネル定義
（`src/shared/ipc.ts` の `CH` / `Api`）と renderer 側は変更しない。

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
| `get_ohlcv` | `symbol`, `timeframe`, `from?`, `to?`, `limit?`, `force?` | ローソク足（CSV） | キャッシュ次第 |
| `get_quote` | `symbol` | 現在値・前日比・日中高安 | 毎回あり |
| `get_company_info` | `symbol`, `force?` | バリュエーション/財務/アナリスト/決算 | TTL 次第 |
| `get_workspaces` | — | ワークスペース一覧（名前・アクティブか・銘柄数・グリッド形状） | なし |
| `get_active_workspace` | — | アクティブなワークスペース 1 件の詳細 | なし |
| `get_workspace` | `name` | 名前指定で 1 件の詳細 | なし |
| `get_cache_status` | `symbol?` | 銘柄×時間足の取得済み範囲・本数、timeframe ごとの capability | なし |

`get_cache_status` の `symbol` を省略した場合は、キャッシュを持つ全銘柄について
「銘柄 / 時間足 / 本数 / 期間」の一覧を返す。指定した場合はその銘柄の時間足別内訳のみ。
どちらの場合も timeframe ごとの capability（`available` / `requires-plan` / `rate-limited` /
`unknown`）を併せて返す。

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
キャッシュ最新〜now だけを取得するため、連打されても 1 銘柄あたり 1 呼び出しに収まる。
取得後に `from`/`to`/`limit` を適用して返す。

`get_cache_status` を置いたのは、取得を許可する以上、Claude が「これは未取得なので FMP を
叩くことになる」と判断できる材料が要るため。ツール説明にも未キャッシュ銘柄への `get_ohlcv` が
API を消費する旨を書き、無差別なスキャンを抑制する。

### ツール説明と文言

ツール説明、引数説明、エラーメッセージ、`get_ohlcv` の要約行は、いずれもモデルが読むため
英語で書く。Settings ダイアログの表示文言とトーストは既存どおり日本語。

## 設定とセキュリティ

既定は無効。Settings ダイアログ（レジストリ駆動の既存構造）に「MCP サーバ」セクションを追加し、
トグルで起動／停止する。設定は `settings.json` に置く（SQLite = OHLCV / JSON = 設定の分離を維持）。

```json
{ "mcp": { "enabled": false, "port": 39100, "token": "<random>" } }
```

ローカルポートを開けるため、防御は 3 段構え。

1. `127.0.0.1` にのみバインドする（`0.0.0.0` にしない）。
2. Bearer トークンを必須にする。初回有効化時にランダム生成して `settings.json` へ保存し、
   Settings 画面にコピーボタン付きで表示する。
3. `Origin` ヘッダを検証する。MCP 仕様が DNS リバインディング対策として要求している項目で、
   ブラウザ由来のリクエストを弾く。

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

| 状況 | メッセージ |
|---|---|
| `NO_API_KEY` | `FMP API key is not configured. Set it in Vibing View's settings dialog.` |
| 402/403（時間足がプラン外） | `This timeframe is not available on the current FMP plan.` |
| 402/403（銘柄がプラン外、コアは `[]` を返す） | `No data available — the symbol may be outside the current plan's coverage.` |
| 429 | `FMP daily request limit reached. Try again tomorrow.` |
| 不明なシンボル | `No results. Use search_symbols to find the correct ticker.` |
| `get_workspace` の名前不一致 | `No workspace named "<name>". Available: <names>` |

引数検証は既存依存の zod で行う。`timeframe` は 7 値の enum、`limit` は範囲外を丸める。

## テスト

`tests/main/` に追加する。既存どおり Electron をテストグラフに入れない。

- **`core.ts`** — ブロードキャスト関数・ストア・プロバイダをフェイクで注入し、capability 追跡、
  `dailyOutOfPlan` の短絡、workspaces の rev 採番と送信元除外を検証する。これまで `ipc.ts` の
  クロージャ内にあってテストできなかった部分にあたる。
- **MCP ツール層** — フェイクの core を注入し、引数検証、`limit` の丸め、CSV 整形、`force` が
  refresh 経路へ回ること、エラー写像を検証する。
- **HTTP 層** — トークン無し・不正トークン・不正 Origin を弾くことを検証する。

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

## 将来枠

- ワークスペース編集ツール（セルの銘柄変更、ウォッチリスト追加など）。`core.workspaces.set` を
  呼ぶだけで、既存の rev + `workspaces:changed` ブロードキャストに乗り、開いているウィンドウへ
  即座に反映される。
- stdio ブリッジ（案 C）。Claude Desktop がローカル HTTP を受けない場合に追加する。
