# MCP 操作系ツール — 設計

日付: 2026-07-26

## 目的とスコープ

現在の MCP サーバは読み取り 7 ツールのみ（`search_symbols` / `get_ohlcv` / `get_quote` / `get_company_info` /
`get_workspaces` / `get_workspace` / `get_cache_status`）。Claude から Vibing View を**操作**できるようにする。

対象は次の 4 つ。

- ワークスペース / レイアウト編集（セルへの銘柄配置、グリッド形状、ワークスペースの作成・複製・改名・削除・切替）
- ウォッチリスト編集（銘柄の追加・削除）
- インジケータ操作（追加・削除・パラメータ / 表示 / 色の変更）
- 時間足操作（セル単位、表示中セル一括）

加えて、UI のリロードボタンと同じ強制更新を起こす `force_reload` を 1 本。

**非スコープ**: キャッシュ操作（キャッシュ済み OHLCV の削除など）／アプリ設定の変更（API キー、テーマ、MCP 設定自体）／
セル入替（`swap_cells`）・アクティブセル変更・ウォッチリストとワークスペースの並べ替え・クリップボード
（並び順は人間の趣味であり、クリップボードはウィンドウ間同期用の内部機構）／取り消し機能（下記）。

操作系ツールを成立させるために、既存コードにも次の変更が入る（詳細は各節）。

- `formatWorkspaceDetail` にインジケータ id を追加（MW-12）
- `ProfileService` が「一致なし」をキャッシュしないようにする（MW-13）
- `App.tsx` の `reload` に戻り値を追加し、実行中は `busy` を返す（MW-14）
- `src/renderer/indicators/` を `src/shared/indicators/` へ移動（MW-06）

**取り消しは実装しない。** MCP 専用の undo を作ると手動操作が巻き戻せず一貫しないため、アプリ全体の変更履歴として
別途設計する（将来枠）。したがって本設計では、MCP からの削除・上書きは UI 操作と同じく不可逆である。

## 前提（既存実装の確認結果）

- `core.workspaces.set(collection, fromWebContentsId?)` は永続化・`rev` 採番・全ウィンドウへの `workspaces:changed`
  ブロードキャストを既に行う。`fromWebContentsId` を渡さなければ全ウィンドウが対象になる。
- renderer の `useWorkspaceSync` は `rev` が新しい payload を受けると、**保留中のローカル保存をキャンセルしてから**
  `hydrateWorkspaces` する。MCP の書き込みは追加の調停なしにそのまま画面へ反映される。
- 自動 / 手動リフレッシュのスケジューラは renderer（`App.tsx` の `reload`）にある。市場状態の取得 →
  表示中セルの `ohlcv.refresh` → quote 取得 → 他ウィンドウへ配信 → トーストと ⏱ 表示の更新、までが一連。
- インジケータの型定義・デフォルト params・出力メタは `src/renderer/indicators/`、パレットとインスタンス生成は
  `src/renderer/store.ts` の `PALETTE` / `makeInstance` にあり、main プロセスからは見えない。
- `src/renderer/indicators/` は `bandPrimitive.ts` を除き lightweight-charts に依存せず、`@shared/types` のみを参照する。
- `Cell` 配列は `rows × cols` を超える分を非表示のまま保持する。グリッドを縮めてもセルは失われない。
- `ProfileService.getProfile` は `profileStore` ヒットなら 0 リクエスト、ミス時に `searchSymbols` を 1 回。
  一致が無い場合と通信失敗の場合の双方で `{ symbol, name: symbol, exchange: '' }` を返し、両者を区別しない。
  さらに一致が無かった場合はそのフォールバックを `upsertProfile` で**永続キャッシュ**する（通信失敗時はしない）。
- `App.tsx` のリフレッシュ関数は `reload({ source })` で、戻り値は `Promise<void>`。
  冒頭に `if (inFlight.current) return` の同期ガードがあり、実行中の要求は**黙って捨てられる**。

## アーキテクチャ

```
MCP tool (src/main/mcp/mutations.ts)   ← 薄い層。引数検証と文言のみ
   ↓ 銘柄解決が要るものは先に await core.symbols.profile()
core.workspaces.mutate(fn)             ← 新規。同期の read-modify-write
   ├─ workspaceStore.getWorkspaces()
   ├─ fn(collection) → 次の collection または Error   ← src/main/mcp/edits.ts の純粋関数
   └─ workspaces.set(next) → rev++ → 全ウィンドウへ broadcast
                                         ↓
                               useWorkspaceSync が hydrate（既存）
```

`mutate` は**同期の read-modify-write** にする。main はシングルスレッドなので、読み → 編集 → 書きを 1 つの同期関数に
閉じれば途中に他の書き込みが割り込めない。非同期の銘柄解決は `mutate` に入る前に完了させる。

編集ロジックは `src/main/mcp/edits.ts` に純粋関数（collection in → collection out）として置く。renderer へ委譲しない理由は
MW-01 を参照。ツール層（`mutations.ts`）は引数検証・銘柄解決・応答整形だけを持ち、既存の `tools.ts` と同じ
`ToolDef` の形で `buildTools` に合流する。

### id の採番

`collection` 内の全セル / インジケータ id のうち数値として解釈できるものの最大値 + 1 から振る。1 回の操作で複数の id が
要る場合はローカルにインクリメントする。renderer は `hydrate` で `nextId` をロード済み id の最大超に再シードするため、
これで両者の採番が衝突しない。`mcp-1` のような独自形式は使わない（`bumpId` が数値以外を無視するため、
renderer の採番がその id を追い越して衝突しうる）。

### UI 挙動のパリティ

`edits.ts` が次を保証する。テストで固定する（テスト節）。

- セルを空にする（`symbol: null`）とユーザーが追加したインジケータは消えるが、`fixed: true` の Volume は残る
  （既存 `clearCell` の挙動）
- `rows × cols` を減らしても `cells` 配列は切り詰めない（非表示で保持）。増やすときは `newCellSeed` で足す
- グリッドを縮めてアクティブセルが非表示側へ落ちたら、表示中セルの先頭へ移す（既存 `setShape` の挙動）
- ワークスペース名は一意。最後の 1 件は削除できない
- アクティブなワークスペースを削除したら残りの先頭がアクティブになる

### レース

renderer のデバウンス保存（500ms）が飛ぶ直前に MCP が書くと、broadcast を受けた側が保留中の保存をキャンセルして
hydrate するので MCP 側が勝つ。逆順ならユーザー操作が勝つ。どちらも UI 同士の 2 ウィンドウ編集と同じ扱いで、
追加の調停は入れない。

**受容するリスク**: MCP の書き込みが renderer の保存を追い越した場合、直前 500ms 以内のユーザー編集は失われる。
compare-and-set では防げない（main が読むのは永続済みの状態で、それ自体は常に最新。失われるのはまだ main に
届いていない編集）。全ミューテーションに flush 往復を足せば塞げるが、対価に合わない（MW-11）。

## インジケータ定義の共有

`add_indicator` を main 側で実装するには「有効な type」「デフォルト params」「パレット色の割り当て」が要る。

`src/renderer/indicators/` の `ma` / `bb` / `rsi` / `macd` / `volume` / `math` / `types` / `registry` を
**`src/shared/indicators/` へ移す**（`bandPrimitive.ts` は lightweight-charts に依存する描画専用なので renderer に残す）。
あわせて `store.ts` の `PALETTE` と `makeInstance` を `makeIndicatorInstance(type, params, base, id)` という
純粋関数として shared に切り出し、`store.ts` と MCP の双方がこれを呼ぶ。

- main が UI と同一ロジックで type 検証・デフォルト補完・色割り当てを行える
- ツール説明の「有効な type と params」を `registry` から機械生成でき、手書きの列挙（＝二重管理）が発生しない
- 移動は機械的（renderer 側の import 修正 8 箇所）。「`registry.ts` に足すだけで end-to-end」という既存の性質も保たれる

### params の検証

`FieldDesc`（`kind` と `min` / `options`）をそのまま検証に使う。未知のキーを弾くだけでは足りない —
`period: "abc"` や `kind: "WMA"` が通ると NaN や無描画になり、Claude は成功したと誤認する。

- `number` — 数値であること。`min` があれば `min` 以上
- `select` — `options` のいずれか
- `source` — `close` / `open` / `high` / `low` / `hl2` / `hlc3` のいずれか
- `step` は UI の入力刻みなので検証しない

違反時のエラーには許容値を列挙する（例: `kind must be one of SMA, EMA.`）。

**`kind: 'color'` の FieldDesc は `params` ではない。** 色は `IndicatorInstance.colors` に入り、`params` とは
別経路（`setColor`）で書かれる。`ma.defaults` にも `color` は含まれず、`ParamFields` も `case 'color': return null`
として描画をスキップし、呼び出し側が自前で出している。したがって MCP の `params` の有効キーは
`registry[type].params` のうち **`kind !== 'color'` のものだけ**とし、`params: { color: ... }` は
`color is not a parameter — use the color argument of update_indicator.` で弾く。

`add_indicator` は色引数を持たない。追加時はパレットが自動で割り当てる（UI と同じ）。変更は `update_indicator` の
`color` 引数で行い、こちらは `#rrggbb` 形式を検証したうえで**全 output キーに書く**（UI と同じ、MW-16）。

## ツール

応答は既存 `format.ts` と同じ plain text で、**変更後の状態**を返す（Claude が確認のために `get_workspace` を
呼び直さなくて済むようにする）。

**対象ワークスペースの指し方**は 2 系統ある。内容を編集する 6 本（`set_chart` / `set_grid_layout` /
`add_indicator` / `update_indicator` / `remove_indicator` / `edit_watchlist`）は任意引数 `workspace` で指定し、
省略時はアクティブなワークスペース（`get_workspace` と対称）。ワークスペース自体を操作する 4 本
（`create_workspace` / `rename_workspace` / `delete_workspace` / `activate_workspace`）は `name` / `from` で
対象を指し、`workspace` 引数は持たない。`force_reload` はどちらも持たない。

| ツール | 引数 | API 消費 |
|---|---|---|
| `set_chart` | `cell`（id または `"all"`）, `symbol?`（`null` で空に）, `timeframe?` | 未知の銘柄で 1 |
| `set_grid_layout` | `rows` 1-3, `cols` 1-3 | なし |
| `add_indicator` | `cell`（id または `"all"`）, `type`, `params?` | なし |
| `update_indicator` | `indicator`（id）, `params?`, `visible?`, `color?` | なし |
| `remove_indicator` | `indicator`（id）**または** `cell`（id または `"all"`） | なし |
| `edit_watchlist` | `add?: string[]`, `remove?: string[]` | 未知の銘柄ごとに 1 |
| `create_workspace` | `name`, `copyFrom?`, `activate?`（既定 true） | なし |
| `rename_workspace` | `from`, `to` | なし |
| `delete_workspace` | `name` | なし |
| `activate_workspace` | `name` | なし |
| `force_reload` | — | 表示中セル数 + quote 数 |

Claude は「`get_workspace` で読む → id を掴む → 操作する」の流れになる。既存の読み取りツールとはこれで繋がるが、
そのために `get_workspace` の出力を 1 箇所広げる必要がある（次節）。

### `get_workspace` に indicator id を出す（既存出力の変更）

`update_indicator` / `remove_indicator` は instance id で対象を指すが、現在の `formatWorkspaceDetail` は
`type(params)` しか出しておらず id が読めない（`format.ts` の `formatIndicator`）。このままでは操作系ツールが
成立しないので、セル行を次の形に変える。

```
- [3] NVDA 1d — [7] volume, [9] ma(period=20), [11] rsi(period=14, hidden)
```

- インジケータ id を `[9]` として前置する
- `visible: false` のときだけ `hidden` を付ける（既定が true なので通常は増えない）
- `colors` と `fixed` は**出さない**。色は `update_indicator` の応答でその 1 件だけ返せば足り、`fixed` は
  `remove_indicator` のエラー文で説明できる。全セル分の色を常時出すのは出力の無駄

既存の読み取りツールの出力変更なので、`tests/main/mcp/format.test.ts` の期待値も更新する。

### `"all"` の範囲

**表示中セル（`rows × cols`）に統一する。** UI は `setAllTimeframes` が表示中セル、`clearAllCells` が全セルと
ちぐはぐだが、MCP から見て非表示セルは存在しないも同然なので揃える。ツール説明に明記する。

### 各ツールの詳細

**`set_chart`** — `symbol` と `timeframe` の両方省略はエラー。`cell: "all"` に非 null の `symbol` は拒否（全セルを
同一銘柄にするのは無意味）、`symbol: null` は許可（＝表示中セルの全消し）。対象セルが表示範囲外なら応答に
`set_grid_layout` を促す注記を添える（非表示チャートを作ったまま気づかない事故を防ぐ）。銘柄は `core.symbols.profile()`
で解決し、`exchange === ''` なら未解決としてエラー（MW-13）。

**`set_grid_layout`** — 応答に新しい形状と表示されるセルの一覧を返す。

**`add_indicator`** — `params` 省略で `registry` の `defaults`。未知の `type` はエラーに有効な type 一覧を添える。
未知の param キーも、値が `FieldDesc` に反する場合もエラー（「params の検証」節）。`cell: "all"` のときだけ「同じ type かつ同じ params が
既にあるセルはスキップ」（既存 `addIndicatorToAll` の挙動）。単一セル指定時は重複チェックをしない（既存 `addIndicator` の挙動）。
色引数は持たず、パレットが自動割り当てする（UI と同じ）。応答に採番された instance id を返す。

**`update_indicator`** — `color` は `params` ではなく `colors` を書く別引数（`#rrggbb` 形式を検証）。UI の
`IndicatorEditForm` と同じく、その type の**全 output キーに同じ色を書く**（`for (const output of module.outputs)
setColor(...)`）。最初の output キーは UI が現在値を表示するために読むだけで、書き込み先ではない。
ただし書いた色が全部描画に効くわけではない。`Chart.tsx` が `inst.colors[output.key]` を読むのは
`kind: 'line'` の出力だけで、ヒストグラムは `compute` が返す per-bar の色（MACD の D-42 4 色、Volume の
陰陽色）で描かれる。MACD なら色変更で `macd` / `signal` の 2 本が同色に揃い、ヒストグラムの見た目は変わらない
（`colors.histogram` は書かれるが読まれない）。これは既存 UI の挙動そのままで、MCP でも同じにする。
`params` は既存値へのマージで、渡されたキーだけを更新する（値の検証は追加時と同じ）。
`fixed: true` の Volume も対象にできる（`visible` と `color` のみ。`params` は空なので指定すれば未知キーのエラーになる）。
`params` / `visible` / `color` の全省略はエラー。応答はその 1 件の全フィールド（id / type / params / visible / colors）。

**`remove_indicator`** — `indicator` と `cell` はどちらか一方を必須（両方指定・両方省略はエラー）。`fixed: true` の
Volume は消えない（UI 同様）。消せなかった旨を応答に含める。

**`edit_watchlist`** — `add` の銘柄が 1 つでも解決できなければ**何も変更せずエラー**（部分適用しない、MW-13）。
重複追加は無視（既存 `addToWatchlist` の挙動）。`add` と `remove` の両方省略はエラー。応答に更新後のウォッチリストを返す。

**`create_workspace`** — `copyFrom` 指定時は複製（セルとインジケータの id を再採番する）。名前重複はエラー。

**`delete_workspace`** — 応答に「消したもの」（セル数・配置されていた銘柄・ウォッチリスト件数）を書き、
Claude がユーザーに報告できるようにする。取り消しはできない。

**`force_reload`** — 引数なし。応答は `Refreshed 4 charts, 1 failed`（件数は OHLCV のみ。quote と市場状態は
`reload` の内部処理で、成否を分けて数える意味が薄い）。

## `force_reload` の委譲

チャネルを 2 本足す。既存の `refresh:broadcast`（renderer → 他ウィンドウ配信）には手を入れない。

| チャネル | 向き | 用途 |
|---|---|---|
| `refresh:request` | main → メインウィンドウ | `{ requestId }`。App が受けて既存の `reload({ source: 'manual' })` を実行 |
| `refresh:done` | メインウィンドウ → main | `{ requestId, refreshed, failed, busy }`。完了通知 |

main は `Map<requestId, resolve>` を持ち、`refresh:done` で解決する。`core.ts` は Electron を import しない方針なので、
送信は `requestRefresh(requestId)` として `main/index.ts` から注入する（`broadcast` と同じ扱い）。

`reload` のフェッチ処理は変えない。`source: 'manual'` をそのまま使うため、市場状態の取得・quote・他ウィンドウ配信・
トースト・⏱ の表示までリロードボタンと完全に同一になる。App 側の変更は次の 2 点だけ。

1. **戻り値を足す** — `Promise<void>` → `Promise<{ refreshed: number; failed: number; busy: boolean }>`。
   既に持っている `ohlcvResults` の fulfilled / rejected を数えるだけ。既存の呼び出し 3 箇所（リロードボタン・
   auto tick・`useGridShortcuts`）は戻り値を無視する。
2. **`refresh:request` の購読** — 受けたら `reload({ source: 'manual' })` を呼び、その戻り値を `refresh:done` に載せる。

**同時実行の調停**は renderer 側に一本化する。`reload` 冒頭の `if (inFlight.current) return` は現在**黙って捨てる**
ので、auto tick 中に `refresh:request` が届くと `refresh:done` が返らず MCP がタイムアウトまで待たされる。
この早期 return を `{ refreshed: 0, failed: 0, busy: true }` に変え、`busy` をそのまま `refresh:done` で返す。
MCP 側は `A refresh is already in progress in the app.` に写像する。main 側に二つ目のガードは置かない（MW-14）。

- メインウィンドウが無ければ `The app window is not available.`
- 60 秒でタイムアウトし `Refresh timed out — it may still be running in the app.` を返す（pending は破棄）

銘柄・時間足を指定した単一系列の更新は用意しない。`get_ohlcv(force: true)` が同じ役割を果たす。

## エラー処理

既存方針どおり全て `isError: true` + 英語メッセージで返し、プロトコルエラーにはしない。
**「何が間違っていたか」ではなく「次に何を打てばよいか」を書く**のを徹底する。

| 状況 | メッセージ |
|---|---|
| セル id 不明 | `No cell "9" in workspace "X". Cells: 1, 3, 5.` |
| indicator id 不明 | `No indicator "12". Use get_workspace to list indicator ids.` |
| 未知の indicator type | `Unknown indicator "sma". Available: ma, bb, rsi, macd, volume.` |
| 未知の param キー | `"length" is not a parameter of ma. Parameters: period, kind, source.` |
| param の値が不正 | `kind must be one of SMA, EMA.` / `period must be a number >= 1.` |
| `params` に `color` | `color is not a parameter — use the color argument of update_indicator.` |
| 銘柄未解決 | `Could not resolve "XYZ" — check the ticker with search_symbols, or confirm the FMP API key is set.` |
| ワークスペース名重複 | `A workspace named "X" already exists.` |
| 最後の 1 件を削除 | `Cannot delete the only workspace.` |
| `cell: "all"` に非 null symbol | `cell: "all" cannot set a symbol — pass a cell id, or symbol: null to clear every chart.` |
| リフレッシュ二重実行 | `A refresh is already in progress in the app.` |
| メインウィンドウ不在 | `The app window is not available.` |
| リフレッシュのタイムアウト | `Refresh timed out — it may still be running in the app.` |

ワークスペース名不一致は既存 `get_workspace` と同じ文言を使い回す。`NO_API_KEY` / 429 / 402 は既存の
`messageForError` をそのまま再利用する。ツール説明・引数説明・エラーメッセージはモデルが読むので英語。

## テスト

`tests/main/mcp/` に追加する。インジケータ関連は既存の `tests/indicators/` に置く（移設後も配置は変わらない）。
既存どおり Electron をテストグラフに入れない。

- **`edits.ts` の純粋関数** — `fixed: true` の Volume が消えないこと、`rows × cols` を縮めても `cells` が
  切り詰められないこと、広げると `newCellSeed` で足されること、**縮小でアクティブセルが隠れたら表示中の先頭へ移ること**、
  id が数値最大 + 1 から採番され既存 id と衝突しないこと、名前の一意性、最後の 1 件が削除できないこと、
  アクティブ削除時のアクティブ移動
- **`core.workspaces.mutate`** — 読み → 編集 → 書きが同期であること、`rev` が 1 だけ進むこと、
  `fromWebContentsId` 無しで全ウィンドウへ broadcast されること、`fn` が Error を返したら書き込みも
  `rev` 更新も broadcast も起きないこと
- **ツール層** — フェイク core で引数検証と上記エラー文言、`"all"` が表示中セルだけに効くこと、
  `set_chart` が未知銘柄で `profile` を 1 回だけ呼ぶこと、`edit_watchlist` が 1 件でも未解決なら
  collection を書き換えないこと、`FieldDesc` に反する params 値（型違い・`min` 未満・`options` 外）が弾かれること、
  `params: { color }` が `colors` に書かれず専用エラーになること、`update_indicator` の `color` が
  MACD の 3 出力すべて（ヒストグラムを含む）に書かれること
- **`formatWorkspaceDetail`** — インジケータ id が出ること、`visible: false` にだけ `hidden` が付くこと。
  既存 `tests/main/mcp/format.test.ts` の期待値更新
- **`ProfileService`** — 一致が無かったときに `upsertProfile` を呼ばないこと（既存テストがあれば更新）
- **`makeIndicatorInstance` の共有** — 同じ入力に対し store 経由と MCP 経由で同一の `colors` が付くこと
  （パレット割り当ての二重実装が復活したら落ちる）
- **indicators 移設の回帰** — 既存のインジケータテストが import パス変更だけで通ること
- **`force_reload`** — フェイクの `requestRefresh` で requestId の照合、`busy: true` が
  `A refresh is already in progress in the app.` に写像されること、タイムアウト
- **`reload` の戻り値** — 実行中の呼び出しが `busy: true` を返すこと（従来は `undefined` を返して黙って捨てていた）

手動確認: Claude から `set_chart` してメインウィンドウが即座に切り替わること、enlarge 窓も追随すること、
`force_reload` がリロードボタンと同じ結果になること。

## 決定事項

- **MW-01** 編集は main 側（`edits.ts` の純粋関数）で行い、renderer の store へ委譲しない。ワークスペースは main が
  持つ永続 JSON であり、store の各アクションは「アクティブなワークスペースのホットな grid」に対する操作なので
  非アクティブなワークスペースを編集できない。`force_reload` だけ委譲するのは、スケジューラが実際に renderer にあるため。
- **MW-02** ツールは意味のある単位で分ける（案A）。`apply_workspace_edit(operations[])` のような汎用 1 本は
  discriminated union のスキーマがモデルの誤生成を招き、部分適用の扱いも決める必要が出る。
  `set_workspace` による JSON 丸ごと置換は、セル id・インジケータ id・`fixed: true` の Volume・`colors` の
  整合をモデルに委ねることになるため採らない。
- **MW-03** 取り消し機能は本設計に含めない。MCP 専用の undo は手動操作と一貫しないため、アプリ全体の
  変更履歴として別途設計する。
- **MW-04** `core.workspaces.mutate` は同期の read-modify-write。非同期の銘柄解決はその外で済ませる。
- **MW-05** MCP が振る id は「数値 id の最大 + 1」。renderer の `hydrate` が `nextId` を再シードするため衝突しない。
- **MW-06** `src/renderer/indicators/` を `src/shared/indicators/` へ移し、`PALETTE` / `makeInstance` も
  `makeIndicatorInstance` として shared に出す。main が type 検証・デフォルト補完・色割り当てを UI と同一ロジックで
  行うため。型名だけの allowlist を main に置く案は、params を検証できず、ツール説明への手書き列挙という
  二重管理を生むため採らない。
- **MW-07** `set_chart` と `edit_watchlist` は `core.symbols.profile()` で銘柄を解決し、未解決ならエラーにする。
  UI では検索結果から選ぶので不正な銘柄が入らないが、MCP だけ素通しだとタイプミスで空のチャートが置かれ、
  Claude が成功したと誤認する。`profileStore` ヒットなら 0 リクエストで、コストはほぼない。
  「該当なし」と「通信失敗」は `ProfileService` が区別しないため、エラー文は両方を含む形にする。
- **MW-08** `"all"` は表示中セル（`rows × cols`）のみを指す。UI の `clearAllCells`（全セル対象）とは挙動が異なるが、
  MCP から見て非表示セルは存在しないも同然のため揃える。
- **MW-09** グリッドの自動拡張はしない。`set_chart` の対象セルが表示範囲外なら注記を返すに留める。
  ユーザーの見ている画面が予告なく分割されるのは驚きが大きい。
- **MW-10** `force_reload` は引数を取らない。単一系列の更新は `get_ohlcv(force: true)` が担う。
- **MW-11** MCP の書き込みが renderer のデバウンス保存を追い越したときのユーザー編集喪失（最大 500ms 分）は受容する。
  compare-and-set では防げず（失われるのはまだ main に届いていない編集）、flush 往復を全ミューテーションに
  足すのは対価に合わない。UI 2 窓の同時編集と同じ性質。
- **MW-12** `get_workspace` の出力にインジケータ id を足す。既存の読み取りツールの出力変更になるが、
  id を指定する操作系ツールの前提であり、これ無しでは `update_indicator` / `remove_indicator` が使えない。
  `colors` / `fixed` は足さない（出力の無駄。色は `update_indicator` の応答、`fixed` はエラー文で伝わる）。
- **MW-13** `ProfileService` は「検索成功・一致なし」のフォールバックをキャッシュしない。現状は永続キャッシュするため、
  一度弾かれた銘柄が以後ずっと 0 リクエストで弾かれ続け、FMP の検索が実在銘柄を返さないケースで詰む。
  未知銘柄の再問い合わせが毎回 1 リクエストになるが、探索は `search_symbols` の役割なので許容する。
- **MW-14** リフレッシュの同時実行ガードは renderer の `inFlight` に一本化する。現在の「黙って早期 return」を
  `busy: true` の返却に変え、main 側に二つ目のガードを置かない。二重ガードだと auto tick 中の MCP 要求が
  応答を失い、60 秒のタイムアウトまで待たされる。
- **MW-15** `kind: 'color'` の `FieldDesc` は `params` の一員として扱わない。色は `IndicatorInstance.colors` に入り
  `params` とは別経路で書かれる（`ParamFields` も描画をスキップし、`defaults` にも含まれない）。
  `params: { color: ... }` を受理すると renderer が読まないキーを書き込むことになり、無反映のまま成功を返す。
- **MW-16** `update_indicator` の `color` は全 output キーに書く。`IndicatorEditForm` が
  `for (const output of module.outputs) setColor(...)` で全出力に流しており、最初の output キーは
  現在値の表示に読むだけ。1 キーだけ書くと MACD などで色が食い違い、UI での編集結果と一致しなくなる。
  描画に反映されるのは `kind: 'line'` の出力のみ（ヒストグラムは `compute` の per-bar 色で描かれ、
  `colors` を読まない）。データ上は全キーに書くのが UI パリティなので、この不一致もそのまま踏襲する。

## 将来枠

- アプリ全体の変更履歴（手動操作と MCP 操作の両方を巻き戻せる undo）。
- セル入替、アクティブセル変更、ウォッチリスト / ワークスペースの並べ替え。必要になれば同じ形で足せる。
- キャッシュ操作ツール（キャッシュ済み OHLCV の削除）。
- `bandPrimitive.ts` を含むインジケータ描画層の整理。今回は移動対象外。
- CLAUDE.md の `DataSourceAdapter` / 「SQLite = OHLCV のみ」と実装の乖離。前回の MCP 設計の将来枠に記載済みで、
  本設計は workspaces の JSON しか触らず FMP 結合を増やさないため、ここでは扱わない。
