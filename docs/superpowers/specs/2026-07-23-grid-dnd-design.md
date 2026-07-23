# グリッドのドラッグ&ドロップ設計

日付: 2026-07-23

## 目的

2つの操作をドラッグ&ドロップで可能にする。

1. **グリッド入替** — グリッドセルAをセルBにドロップすると、AとBの位置を入れ替える。
2. **ウォッチリスト→グリッド** — ウォッチリストの銘柄を特定のグリッドセルにドロップすると、そのセルの銘柄が差し替わる（空セルなら埋まる）。

## 方針

新規ライブラリは追加しない。既存のウォッチリスト並べ替え（`Watchlist.tsx` の `dataTransfer` を使った HTML5 ドラッグ&ドロップ）を踏襲する。

ドラッグ元の種別は**カスタム MIME タイプ**で区別する。`dragover` イベント中は `dataTransfer.getData()` は空を返すが `dataTransfer.types` は参照できるため、投下可否のハイライト判定に使える。

- `application/x-vv-cell` … グリッドセルのドラッグ。値 = `cellId`
- `application/x-vv-symbol` … ウォッチリスト銘柄のドラッグ。値 = `symbol`

ウォッチリスト行の `onDragStart` は、既存の `text/plain`（並べ替え用の index）に加えて `application/x-vv-symbol` も載せる（`setData` は複数タイプを持てる）。これで**行内並べ替えとグリッド投下が1回のドラッグで両立**する — 並べ替えのドロップ先は `text/plain` を読み、グリッドのドロップ先は `application/x-vv-symbol` を読む。

## 変更点

### 1. store アクション（`src/renderer/store.ts`）

既存の `setCellTimeframe` / `reorderWatchlist` と同じ、IPC を伴わない純粋なミューテーションを2つ追加する（ユニットテスト可能）。

- `swapCells(idA: string, idB: string)`
  - `cells` 配列内で id が `idA` と `idB` の2要素の位置を入れ替える。
  - `idA === idB`、または一方が存在しない場合は no-op（state 不変）。
  - `activeCellId` と `crosshairByCell` は `cell.id` を参照しているため、配列内で要素を動かしても中身は id に付いて追随し、整合は崩れない。

- `setCellSymbol(cellId: string, symbol: string)`
  - 対象セルの `symbol` のみ差し替える。`timeframe` と `indicators` は維持する。
  - `symbol` が `null` だった空セルを埋める用途も兼ねる。

`AppState` 型定義にも上記2つのシグネチャを追加する。

### 2. GridCell（`src/renderer/components/GridHost.tsx`）

**ドラッグ元**

- ヘッダーのツールバー `<div>`（`SymbolLabel` + `TimeframeRow` + 指標メニュー + × を含む行）に `draggable` を付与する。チャートの `<div>` は対象外とし、十字線などチャート操作を壊さない。
- `onDragStart` で `e.dataTransfer.setData('application/x-vv-cell', cell.id)` をセットする。掴めることを示すため `cursor-grab` を付ける。
- ツールバー内のボタン（timeframe / 指標 / ×）はクリック操作をそのまま維持する。クリックはドラッグを開始しないため衝突しない。

**ドロップ先**

- セルのルート `<div>`（空セルを含む）をドロップ先にする。
- `onDragOver`: `e.dataTransfer.types` に `application/x-vv-cell` か `application/x-vv-symbol` が含まれるときだけ `e.preventDefault()` して投下を受理し、リング表示でハイライトする。含まれないドラッグは無視する。
- `onDrop`:
  - `application/x-vv-cell` があれば → `swapCells(draggedCellId, cell.id)`。ただし同一セルへの投下は no-op。
  - `application/x-vv-symbol` があれば → `setCellSymbol(cell.id, symbol)` を実行し、そのセルを active にする（`setActiveCell`）。
- ドラッグ中のハイライトは既存の並べ替え（`isOver` のリング）と同様に、ローカル state で「ドラッグ被り中のセル」を持ち ring / opacity で表現する。

### 3. Watchlist（`src/renderer/components/Watchlist.tsx`）

- `Row` の `onDragStart` に `e.dataTransfer.setData('application/x-vv-symbol', item.symbol)` を1行追加する。既存の `text/plain`（並べ替え）はそのまま残す。

## テスト

- `src/renderer/store.test.ts` に assert ベースのチェックを追加する。
  - `swapCells`: 2セルの位置が入れ替わること／同一 id・不明 id が no-op であること／`activeCellId` が壊れないこと。
  - `setCellSymbol`: 対象セルの `symbol` のみ差し替わり `timeframe`・`indicators` が保たれること／空セル(null)が埋まること。
- DnD の DOM 挙動（`dragover`/`drop`）はライブラリ不使用のため、アプリ上で手動確認する。

## スコープ外（YAGNI）

- グリッド↔グリッドの「入替」ではなく「複製/コピー」。
- カスタムのドラッグゴースト画像。
- 並べ替え時のアニメーション。
