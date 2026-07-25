# ワークスペース統合 設計

## 背景と問題

現状、ウォッチリストとレイアウトは独立した2系統として存在する。

- **レイアウト（コード上の `Workspace` 型）**: グリッドの各セルが `symbol / timeframe / indicators` を持つ。ヘッダーの LayoutMenu で名前付き保存・切替。
- **ウォッチリスト**: `WatchlistCollection`（`{ version, active, lists[] }`）。サイドバーの WatchlistSwitcher で名前付きリストを切替。

この2つは連動しない。ウォッチリストを切り替えてもグリッドは変わらず、行クリックはアクティブセル1つの銘柄を差し替えるだけ。ユーザーは次の2点を不便として挙げた。

- リスト切替がチャートに無関係
- リストとレイアウトが別世界（本来ひとつの作業コンテキストなのに二重管理）

## 方針

ウォッチリストとレイアウトを、ひとつの名前付き **Workspace**（作業コンテキスト）に統合する。切替器はひとつだけにし、切り替えるとサイドバーの銘柄リストとグリッドが同時に変わる。1 Workspace = 1リスト + 1グリッドの固定対応とする。

グリッド内の使い方（行クリックでアクティブセルを差し替える、指標を追加する等）は現状のまま変えない。今回変えるのは「リストとグリッドが同じ Workspace に属し、一緒に切り替わる」という構造だけ。銘柄の全セルへのブロードキャストや、リストのグリッドへの一括流し込み、セルのピン留めは対象外（将来の追加余地は残す）。

「リストがレイアウトを内包する」構成を採る。既存のウォッチリスト側は複数名前付き・active 必須・最低1件保証・作成/リネーム/削除/並べ替え/切替を既に備えており、この機構を生かして layout を畳み込む。レイアウト側の「無名の current + 任意の名前付き保存」という二重性（`activeLayoutName` が null になりうる）は廃し、「常にどれかの Workspace の中にいる」モデルに一本化する。

## データモデル

コード上の `Workspace` 型（グリッド設定）は `Layout` に改名し、統合後の器を新 `Workspace` とする。

```ts
type Layout = {
  schemaVersion: number
  cells: Cell[]
  shape: GridShape
  activeCellId: string
}

type Workspace = {
  name: string
  items: WatchlistItem[]
  layout: Layout
}

type WorkspaceCollection = {
  version: 3
  active: string          // アクティブ Workspace 名
  workspaces: Workspace[] // 最低1件を保証
}
```

永続化は1本の `workspaces.json`（`WorkspaceCollection`）に統合する。現状の `watchlist.json` と layout（current/named）を置き換える。settings.json（サイドバー幅・テーマ）と SQLite（OHLCV キャッシュ）は無関係で従来どおり。

### 既定 Layout

```
1x1、単一セル、symbol は null（空チャート）、timeframe は '1d'、
indicators は常時表示の固定 Volume 1件のみ。
```

従来の AAPL 初期値は廃止する。空セルは既存の clearCell 後の状態と同一で、描画は既にサポート済み。

## 状態と挙動

ライブ編集中のグリッドは従来どおり store 直下の `cells / shape / activeCellId` にホットに保持する（描画・編集が高頻度なため）。これがアクティブ Workspace の layout の実体。銘柄リストは `workspaces[active].items` を参照する（現行 `selectActiveItems` と同じ発想）。

### 切替 `switchWorkspace(name)`

1. 現在のホットなグリッドを `workspaces[active].layout` にスナップショット。
2. `active` を `name` に更新。
3. 対象 Workspace の layout を `cells / shape / activeCellId` に hydrate。

items は参照先が切り替わるので自動的に追従する。切替は無確認オートセーブ（現行 D-58 を踏襲）。対象の layout が破損して `parseLayout` が null を返す場合は、その Workspace の layout を既定にフォールバックし、コレクション全体は壊さない。

### Workspace CRUD

既存のウォッチリスト CRUD を流用する。

- `createWorkspace(name)`: 既定 Layout + 空 items で作成し、アクティブにする。
- `renameWorkspace(from, to)`: アクティブを rename した場合は `active` ポインタも追従。
- `deleteWorkspace(name)`: 最低1件を保証し、最後の1件は削除不可。
- `reorderWorkspaces(from, to)`。
- `duplicateWorkspace(name)`: 現グリッドと現リストをコピーして新名で作成（旧「レイアウトを別名保存」に相当）。

### 銘柄リスト操作

`addToWatchlist / removeFromWatchlist / reorderWatchlist` はアクティブ Workspace の `items` を対象とする。挙動は現状と同じ。

### グリッド操作

`setActiveSymbol / setShape / addIndicator / removeIndicator / updateParams` などはホットな `cells` を対象とする。行クリックでアクティブセルの銘柄を差し替える挙動を含め、現状のまま。

### 永続化

`[cells, shape, activeCellId, workspaces, active]` を監視する debounced subscriber 1本で、アクティブの layout を反映した `WorkspaceCollection` を `workspaces.json` に書き出す。現行の2本（layout current / watchlist）を1本に集約する。

### 起動時

`api.workspaces.get()` で `WorkspaceCollection` を取得し hydrate する。現行の `layout.getCurrent` + `watchlist.get` の2系統を1系統にする。

## UI

ヘッダーの LayoutMenu とサイドバーの WatchlistSwitcher を、ひとつの **WorkspaceSwitcher** に統合し、ヘッダー（旧 LayoutMenu の位置）に置く。サイドバーを閉じていても Workspace を切り替えられる。GridShapeRow（グリッド形状）は layout 編集なのでヘッダーに残す。

サイドバーは銘柄リスト部分だけを残す。リスト自体の表示・ドラッグ並べ替え・行クリックの挙動は変えない。

## 移行

新バージョンの初回起動時、`workspaces.json` が存在しなければ旧データから一度だけ合成する。旧ファイルは削除せず残す。

- 旧 `watchlist.json`（v2, `lists[]` + `active`）の各リストを1つの Workspace に昇格する。
  - `active` だったリスト: 現在のライブ layout（旧 `layout.getCurrent`）を担わせる。
  - それ以外のリスト: 既定 Layout。
- `active` は旧アクティブリスト名を引き継ぐ。
- 旧・名前付きレイアウトは取り込まない。

初回起動（旧データも無い）の既定 Workspace は、名前 `Workspace 1`・既定 Layout・空 items の1件とする。

## テスト

- **store 単体**: `switchWorkspace` のスナップショット + hydrate、CRUD、item 操作がアクティブ Workspace を対象とすること、最後の1件削除ガード。
- **移行単体**: 旧 `watchlist.json` + 旧ライブ layout → 期待どおりの `WorkspaceCollection`。
- **パーサ**: `parseLayout` / `parseWorkspaceCollection` の前方互換と破損フォールバック。
- 既存の `store.test` / `layoutStore.test` / `watchlistStore.test` を workspace ベースに再編する。

## 影響範囲

- `src/shared/types.ts`: `Workspace` → `Layout` に改名、新 `Workspace` / `WorkspaceCollection` を追加。
- `src/renderer/workspace.ts`: `parseWorkspace` → `parseLayout` 等に改名、`WorkspaceCollection` パーサを追加。
- `src/renderer/store.ts`: layout 系と watchlist 系のアクションを workspace 系に統合。
- `src/renderer/App.tsx`: 起動 hydrate と persist subscriber を1系統化、ヘッダーに切替器を配置。
- `src/renderer/components/`: `LayoutMenu` + `WatchlistSwitcher` → `WorkspaceSwitcher`（ヘッダー）。`Watchlist` は銘柄リスト部のみ残す。
- `src/preload` / `src/main/ipc.ts` / `src/main/{layoutStore,watchlistStore}.ts`: `api.workspaces.get/set` に集約、移行関数を main に追加。

## スコープ外（将来余地）

- 選んだ銘柄の全セルへのブロードキャスト。
- リストの銘柄をグリッドへ一括流し込み。
- セルのピン留め（特定セルだけ固定銘柄）。
