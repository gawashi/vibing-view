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

**`ContextMenu` を `ChartPanel` に一度だけ集約する。**

- 現在 `GridCell` にある `ContextMenu` を撤去し、`ChartPanel` の描画領域全体を `ContextMenuTrigger` でラップする。
- `ChartWindow` は `ChartPanel` を再利用しているため、追加実装なしで同一メニューを継承する。
- 空セルでもペースト先にできるよう、`symbol` が無い状態でも右クリックメニューを開けるようにする（各項目の有効/無効は下表で制御）。
- `GridCell` のドラッグ/ダブルクリック等の既存イベントは据え置き。

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
| Add / Remove watchlist | `symbol` がある時のみ表示。`selectActiveItems` に含まれるかでラベル切替。既存 `addToWatchlist` / `removeFromWatchlist` を呼ぶ |
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

- `copyCell(cellId)` — 対象セルから `{ symbol, timeframe, indicators }` を deep clone して `chartClipboard` に格納。`symbol` が null なら no-op。
- `cutCell(cellId)` — `copyCell` してから `clearCell(cellId)`。
- `pasteCell(cellId)` — `chartClipboard` を対象セルへ適用。
  - indicator の `id` を必ず新規採番（`remintLayout` の採番パターンを流用）。コレクション全体でのユニーク性を守る。
  - `fixed` な Volume インジケーターはちょうど1つ維持する（既存 `clearCell` / `hydrate` の再シードロジックに合わせる）。
  - 空セルにも適用可。

### 全ウィンドウ共有（案A）

- 既存の IPC 同期に `chartClipboard` 専用の軽量 channel（例: `clipboardSet`）を1本追加し、他ウィンドウのストア `chartClipboard` に反映する。
- 永続化はしない（アプリ終了で破棄されてよい）。
- OS クリップボード（`clipboard.writeText`）案は他アプリ競合・フォーカス時読取が必要なため不採用。

## UI 詳細

- `src/renderer/components/ui/context-menu.tsx` に `ContextMenuSeparator` を追加エクスポート（Radix に存在）。区切り線3本に使用。
- メニュー本体は `ChartPanel`（`GridHost.tsx`）内。`ContextMenuTrigger` が描画領域全体をラップ。`GridCell` の既存 `ContextMenu` は撤去。
- 空セル時のラッパもメニュー対応にする（Paste のため）。
- 無効項目は Radix の `disabled` prop でグレーアウト。

## テスト

`store.ts` にアサーションベースの自己チェックを1本（フレームワーク無し、既存の流儀に合わせる）:

- `copyCell` → clipboard に symbol/timeframe/indicators が入る。symbol=null は no-op
- `cutCell` → clipboard に入り、かつ元セルが空になる
- `pasteCell` → 対象セルに反映、indicator `id` が元と異なる（再採番）、`fixed` Volume がちょうど1つ
- watchlist トグル → add 後に含有、remove 後に非含有

UI（Radix メニュー描画）は手動確認。

## スコープ外

- watchlist 行の右クリックメニュー拡充（今回はチャート側のみ）
- コピペのクロスアプリ（OS クリップボード）連携
- クリップボードの永続化
