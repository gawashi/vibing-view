# チャート右クリックメニューの拡充 — 設計

日付: 2026-07-23

## 目的

チャート（グリッドセル・拡大表示ウィンドウ）の右クリックメニューを拡充し、以下を可能にする:

- watchlist への追加 / 削除（トグル）
- チャートから削除（セルを空にする）
- チャート設定のコピー / カット / ペースト
- 拡大表示ウィンドウ（`ChartWindow`）でも同一のメニューを提供する

## 現状（調査結果）

- 右クリックメニューは Radix (`ContextMenu`) ベース。`src/renderer/components/ui/context-menu.tsx` は `Trigger` / `Content` / `Item` のみエクスポート（Separator 等は未エクスポート）。
- 既存メニューは2箇所、各1項目「Show company info」:
  - グリッドセル: `src/renderer/components/GridHost.tsx`（`GridCell` 内、`cell.symbol` がある時のみ表示）
  - watchlist 行: `src/renderer/components/Watchlist.tsx`
- `ChartPanel`（`GridHost.tsx`、export 済み）はグリッドセルと `ChartWindow` の**両方で共有**される描画本体。拡大ウィンドウは現在メニューを持たない。
- セル設定はシリアライズ可能な `Cell` 型（`src/shared/types.ts`）: `{ id, symbol, timeframe, indicators[] }`。`IndicatorInstance` は `id` を持ち、コレクション全体でユニークである必要がある（`dedupeCollectionIds` / `remintLayout` 参照）。`fixed` な Volume インジケーターは常時1つ維持される特別扱い（`clearCell` / `hydrate` で再シード）。
- 状態管理は zustand 単一ストア `src/renderer/store.ts`。watchlist は active workspace の `items`（`addToWatchlist` / `removeFromWatchlist` / `selectActiveItems`）。クロスウィンドウ同期は `useWorkspaceSync`。

## アーキテクチャ

**新規の再利用コンポーネント `ChartContextMenu`（`src/renderer/components/ChartContextMenu.tsx`）を作り、これで「セルの中身（`ChartPanel` でも空セルの placeholder でも）」を包む。**

- なぜ `ChartPanel` 集約ではダメか: `GridCell` は `cell.symbol` がある時しか `ChartPanel` を描画せず（`GridHost.tsx:291`）、`ChartWindow` は空セル時に placeholder を出す（`ChartWindow.tsx:23`）。`ChartPanel` にメニューを置くと**空セル／カット直後のセルでメニューが消え、ペーストで戻せない**。よってメニューはセルの中身より一段外側に置く必要がある。
- `ChartContextMenu` は `props: { cellId }` を受け取り、`ContextMenu` / `ContextMenuTrigger`（`children` を包む）/ `ContextMenuContent`（項目群）を描画する。中身（`ChartPanel` or placeholder）は `children` として渡す。
- 適用箇所:
  - `GridCell`（`GridHost.tsx`）: 既存の `ContextMenu`（Show company info 1項目）を撤去し、セル中身の描画（`ChartPanel` または空セル表示）を `ChartContextMenu` でラップ。symbol 有無に関わらずラップする。
  - `ChartWindow`（`ChartWindow.tsx`）: `ChartPanel` / placeholder の描画を `ChartContextMenu` でラップ。カット直後の空状態でもメニューが残り、ペーストで戻せる。
- `GridCell` のドラッグ/ダブルクリック等の既存イベントは据え置き（右クリックとは別イベント）。

却下案: 各所（グリッド・拡大ウィンドウ）に個別実装 → 同一コードが分散するため不採用。

## メニュー項目構成

`ChartPanel` 共通メニュー:

```
Show company info
─────────────────
Add to watchlist / Remove from watchlist   （トグル）
─────────────────
Copy chart
Cut chart
Paste chart
─────────────────
Remove from chart
```

有効/無効・表示条件:

| 項目 | 条件 |
|---|---|
| Show company info | `symbol` がある時のみ表示（現状維持） |
| Add / Remove watchlist | `symbol` がある時のみ表示。`selectActiveItems` に含まれるかでラベル切替。追加時は full `SymbolResult`（`{ symbol, name, exchange }`）を渡す — 既存 `FavoriteStar`（`GridHost.tsx:175`）と同じく profile メタデータ（TanStack Query の `qk.profile`）から `name`/`exchange` を取り、無ければ `name: symbol` / `exchange: ''` にフォールバックするロジックを再利用する。削除は `removeFromWatchlist(symbol)` |
| Copy chart | `symbol` がある時のみ有効 |
| Cut chart | `symbol` がある時のみ有効。コピー後に `clearCell` |
| Paste chart | `chartClipboard` が空でない時のみ有効。空セルにも適用可 |
| Remove from chart | `symbol` がある時のみ表示。`clearCell` |

補足: `Cut chart` と `Remove from chart` はどちらも元セルを空にするが、Cut はクリップボードへ退避する点が異なる。両方残す。

## データモデルとストア変更

### クリップボード型

```ts
// store.ts (AppState に追加)
type ClipboardCell = {
  symbol: string
  timeframe: Timeframe
  indicators: IndicatorInstance[]   // id 付きのまま保持。paste 時に再採番
}
chartClipboard: ClipboardCell | null
```

`chartClipboard` は workspace collection には含めない（永続化しない）。

### 新規アクション

- `copyCell(cellId)` — 対象セルから `{ symbol, timeframe, indicators }` を **deep clone**（`indicators` の各要素・`params`・`colors` まで新規オブジェクト。元セルへの参照エイリアスを残さない）して `chartClipboard` に格納。`symbol` が null なら no-op。
- `cutCell(cellId)` — `copyCell` してから `clearCell(cellId)`。
- `pasteCell(cellId)` — `chartClipboard` を対象セルへ適用。`chartClipboard` が null なら no-op。
  - `symbol` / `timeframe` を対象セルへ上書き。
  - indicator の `id` を必ず新規採番（`remintLayout` の採番パターンを流用）。コレクション全体でのユニーク性を守る。
  - **Volume 正規化ルール**（`hydrate` は「無い時だけ追加」であって重複除去・非 fixed 修復はしないため、paste では独自に正規化する）:
    1. クリップボードの `indicators` から `type === 'volume'` を全て抽出。
    2. 1つ以上あれば **最初の1つだけ**を残し `fixed: true` を強制、残りの Volume は破棄。
    3. 1つも無ければ標準の fixed Volume を新規シード（既存の Volume シード定義を流用）。
    4. 非 Volume インジケーターはそのまま（id 再採番のみ）。
    → 結果として `fixed` Volume はちょうど1つになる。
  - **`crosshairByCell[cellId]` を削除**する（`clearCell` と同様。前銘柄のクロスヘア読み取り値が残らないように）。
  - 空セルにも適用可。

### 全ウィンドウ共有（main 保持 + revision）

案A（ブロードキャストのみ）は「コピー後に新規に開いた `ChartWindow` が `chartClipboard: null` で始まる」問題があるため、`useWorkspaceSync` と同じ main-保持 + revision 方式にする。

- **main プロセスがクリップボードの source of truth**をメモリ保持（永続化しない）。owner は main。store アクションは純粋（IPC を直接叩かず、後述の同期フックが橋渡し）。
- IPC:
  - `clipboard:set` — renderer → main。`{ clipboard, revision }` を送る。main は revision を単調増加で採番/保持。
  - `clipboard:get` — renderer → main（起動時に現在値を取得）。新規ウィンドウはこれで初期化。
  - `clipboard:changed` — main → 全 renderer。更新をブロードキャスト。
- **同期フック `useClipboardSync`**（`useWorkspaceSync` に倣う）:
  - マウント時に `clipboard:get` で store の `chartClipboard` を初期化。
  - `clipboard:changed` を購読し、`revision` が手元より新しい時だけ store に反映（順序保証）。
  - store の `chartClipboard` 変化（copy/cut）を購読し `clipboard:set` で main へ送る。
  - 全ウィンドウ（グリッド・`ChartWindow`）でマウントする。
- 永続化はしない（アプリ終了で破棄されてよい）。
- OS クリップボード（`clipboard.writeText`）案は他アプリ競合・フォーカス時読取が必要なため不採用。

## UI 詳細

- `src/renderer/components/ui/context-menu.tsx` に `ContextMenuSeparator` を追加エクスポート（Radix に存在）。区切り線3本に使用。
- メニュー本体は新規 `ChartContextMenu`。`ContextMenuTrigger` がセル中身（`ChartPanel` or placeholder）を包む。`GridCell` の既存 `ContextMenu` は撤去。
- 空セルでもラップされるため Paste 可能（アーキテクチャ節参照）。
- 無効項目は Radix の `disabled` prop でグレーアウト。

## テスト

既存の Vitest スイート（`tests/renderer/store.test.ts`）にケースを追加する（プロジェクトの確立された流儀に合わせる。フレームワーク無しの自己チェックは採らない）:

- `copyCell` → clipboard に symbol/timeframe/indicators が入る。symbol=null は no-op。**deep clone 確認**（clipboard を書き換えても元セルに波及しない／元セル indicator を書き換えても clipboard に波及しない）
- `cutCell` → clipboard に入り、かつ元セルが空になる
- `pasteCell`:
  - 対象セルに symbol/timeframe/indicators が反映
  - indicator `id` が元（クリップボード）と異なる（再採番）
  - **Volume 正規化**: クリップボードの Volume が 0個 / 1個 / 複数個 の各入力で、結果の `fixed` Volume がちょうど1つ
  - **空セルへの paste** が成功する
  - paste 後に対象セルの `crosshairByCell[cellId]` が削除される
- watchlist トグル → add 後に含有、remove 後に非含有
- クリップボード同期 → 新規ウィンドウ相当（`chartClipboard: null` の store）が `clipboard:get` 取得値で初期化される、`revision` が古い `clipboard:changed` は無視される

UI（Radix メニュー描画）は手動確認。

## スコープ外

- watchlist 行の右クリックメニュー拡充（今回はチャート側のみ）
- コピペのクロスアプリ（OS クリップボード）連携
- クリップボードの永続化
