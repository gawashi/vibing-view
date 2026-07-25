# グリッドのドラッグ&ドロップ設計

日付: 2026-07-23
（2026-07-23 Codex レビュー反映: ドラッグハンドル方式・ウォッチリスト型分離・ハイライト寿命・防御的 no-op を追記）

## 目的

2つの操作をドラッグ&ドロップで可能にする。

1. **グリッド入替** — グリッドセルAをセルBにドロップすると、AとBの位置を入れ替える。
2. **ウォッチリスト→グリッド** — ウォッチリストの銘柄を特定のグリッドセルにドロップすると、そのセルの銘柄が差し替わる（空セルなら埋まる）。

## 方針

新規ライブラリは追加しない。既存のウォッチリスト並べ替え（`Watchlist.tsx` の `dataTransfer` を使った HTML5 ドラッグ&ドロップ）を踏襲する。

ドラッグ元の種別は**カスタム MIME タイプ**で区別する。`dragover` イベント中は `dataTransfer.getData()` は空を返すが `dataTransfer.types` は参照できるため、投下可否のハイライト判定に使える。

- `application/x-vv-cell` … グリッドセルのドラッグ。値 = `cellId`
- `application/x-vv-symbol` … ウォッチリスト銘柄のドラッグ。値 = `symbol`

ウォッチリスト行の `onDragStart` は、既存の `text/plain`（並べ替え用の index）に加えて `application/x-vv-symbol` も載せる（`setData` は複数タイプを持てる）。並べ替えのドロップ先は `text/plain` を、グリッドのドロップ先は `application/x-vv-symbol` を読む。

## 決定事項（Codex レビューで確定した設計選択）

- **ドラッグ開始点は専用グリップ**（ヘッダー全体ではない）。理由: (a) ツールバーのボタン（★お気に入り / timeframe / 指標メニュー / × 削除）上でもポインタ移動でネイティブ D&D が発火し得るため、ヘッダー全体を `draggable` にすると誤ドラッグする。(b) ツールバー行は `ChartPanel` にあり、これは拡大表示の `ChartWindow` と**共有**されている。`ChartPanel` を `draggable` にすると拡大ウィンドウまでドラッグ可能になってしまう。→ グリップはグリッド専用ラッパ `GridCell` 側に置く（`ChartPanel`/`ChartWindow` は不変）。既存ウォッチリストの `GripVertical` ハンドルと同じ流儀。
- **入替後のアクティブリング（`ring-primary`）はセル同一性（cell.id）に追従する。** `activeCellId` は id 参照で、swap は `cells` 配列内で `Cell` オブジェクトを id ごと動かすため、リングは中身（=同じ id のチャート）に付いて移動する。画面位置には固定しない。
- **`ChartWindow`（拡大ウィンドウ）はドラッグ元にもドロップ先にもしない。** グリッド内のみ対象。
- **空セルはドロップ先のみ**（ドラッグ元にはしない）。空セルは中身が無く入替の意味がないため。
- **同一銘柄のドロップは厳密に no-op。** 新しい `cells` 参照は workspace 永続化を誘発するため、無変化なら state を触らない。
- **キーボードによるセル移動/差し替えは今回スコープ外**（将来の a11y 拡張として保留）。

## 変更点

### 1. store アクション（`src/renderer/store.ts`）

既存の `setCellTimeframe` / `reorderWatchlist` と同じ、IPC を伴わない純粋なミューテーションを2つ追加する（`AppState` 型にもシグネチャ追加）。

- `swapCells(idA: string, idB: string)`
  - `cells` 配列内で id が `idA` と `idB` の2要素の位置を入れ替える。
  - **no-op 条件**（state 参照を変えない）: `idA === idB`、または一方でも `cells` に存在しない場合。
  - `activeCellId`・`crosshairByCell` は id 参照なので、要素が動いても中身が id に追随し整合は崩れない（→ アクティブリングは同一性に追従、上記決定どおり）。

- `setCellSymbol(cellId: string, symbol: string)`
  - 対象セルの `symbol` のみ差し替える。`timeframe`・`indicators` は維持する。空セル(null)を埋める用途も兼ねる。
  - **防御的 no-op**: `cellId` が存在しない、または対象セルの `symbol` が既に同値の場合は state を触らない。
  - `symbol` の妥当性（非空）は呼び出し側（drop ハンドラ）でも検証する。

### 2. Watchlist の型分離（`src/renderer/components/Watchlist.tsx`）— Codex Critical 修正

現状の並べ替えドロップは `const from = Number(e.dataTransfer.getData('text/plain'))` で、グリッドセルをウォッチリストに落とすと `text/plain` が空文字→`Number('') === 0`（NaN ではない）となり、**先頭項目が勝手に並べ替わる**。これを防ぐ:

- `Row` の `onDragStart` に `e.dataTransfer.setData('application/x-vv-symbol', item.symbol)` を1行追加（グリッド投下用。既存の `text/plain` 並べ替えは残す）。
- 行および末尾ドロップゾーンの `onDrop`/`onDragOver` を、**ウォッチリスト由来のドラッグに限定**する。判定は `text/plain` の生値が空でないこと（`raw === '' → return`）を先にチェックしてから `Number()` する。`application/x-vv-cell` のみを持つグリッドドラッグは `text/plain` が空なので受理しない。

### 3. GridCell / GridHost（`src/renderer/components/GridHost.tsx`）

`ChartPanel` は変更しない（`ChartWindow` と共有のため）。ドラッグ関連はすべてグリッド専用の `GridCell` と `GridHost` に置く。

**ドラッグ元（グリップ）**

- `GridCell` の（`cell.symbol` がある）セル内に、ホバーで現れる小さな `GripVertical` ハンドルを置く（ウォッチリストと同じ流儀、`cursor-grab`）。
- ハンドルに `draggable` を付け、`onDragStart` で `e.dataTransfer.setData('application/x-vv-cell', cell.id)`。ハンドル以外（チャート本体・ツールバーのボタン）はドラッグ開始点にしない。
- 既存の `onClick`（セル選択）・`onDoubleClick`（拡大ウィンドウ）とは別要素なので競合しない。

**ドロップ先**

- `GridCell` のルート `<div>`（空セルを含む）をドロップ先にする。
- `onDragOver`: `e.dataTransfer.types` に `application/x-vv-cell` か `application/x-vv-symbol` が含まれるときだけ `e.preventDefault()` して投下受理＋ドロップ先ハイライト。それ以外のドラッグは無視。
- `onDrop`（型を明示チェックしてから分岐）:
  - `application/x-vv-cell` を持つ → `draggedCellId = getData(...)`。`draggedCellId !== cell.id` のとき `swapCells(draggedCellId, cell.id)`。
  - `application/x-vv-symbol` を持つ → `symbol = getData(...)`。非空なら `setCellSymbol(cell.id, symbol)` を実行し、そのセルを `setActiveCell(cell.id)`。

**ハイライトの寿命（Codex High 修正）**

- ドロップ先ハイライトは `GridHost` のローカル state `dragOverCellId: string | null` で1つだけ持つ。
- セット: 各 `GridCell` の `onDragOver`（受理時）に `setDragOverCellId(cell.id)`。
- クリア: `onDrop` 実行後、`onDragEnd`（ドラッグ元）、および `GridHost` ルートの `onDragLeave`（`!e.currentTarget.contains(e.relatedTarget)` の外抜け時のみ）で `null` に戻す。キャンセル（Esc/枠外ドロップ）は `onDragEnd` が拾う。
- 表現とリング優先度: アクティブリング（`ring-primary`）は据え置き。ドロップ先ハイライトはそれと**視覚的に区別できる別表現**（例: `ring-2 ring-accent` の内側リング/破線）にし、ドラッグ中は同一セルで両方が出ても見分けられるようにする（アクティブ＝現在選択、ドロップ先＝これから落ちる先）。

## テスト

- `tests/renderer/store.test.ts` に assert ベースのチェックを追加する。
  - `swapCells`: 2セルの位置が入れ替わること／同一 id・不明 id が no-op（state 参照不変）／`activeCellId` が同一 id に追従すること。
  - `setCellSymbol`: 対象セルの `symbol` のみ差し替わり `timeframe`・`indicators` が保たれること／空セル(null)が埋まること／不明 id・同値 symbol が no-op であること。
- DnD の DOM 挙動（ライブラリ不使用）は手動確認。最低限のマトリクス:
  - グリッドセル同士の入替（隣接・対角）。入替後にアクティブリングが同じチャートに付いていること。
  - ウォッチリスト銘柄を空セル／既存セルへ投下（差し替え、timeframe/指標維持）。
  - **クロス型の誤爆確認**: グリッドセルをウォッチリスト上へ投下 → 並べ替えが**起きない**こと（先頭項目が動かない）。
  - ツールバーのボタン（★/timeframe/指標/×）上でドラッグ開始してもセルドラッグが始まらないこと。
  - 拡大ウィンドウ（`ChartWindow`）でツールバーがドラッグ不可のままであること。
  - ドラッグをキャンセル（Esc・枠外ドロップ）した後にハイライトが残らないこと。

## スコープ外（YAGNI）

- グリッド↔グリッドの「複製/コピー」（入替のみ）。
- カスタムのドラッグゴースト画像・並べ替えアニメーション。
- キーボード操作によるセル移動/差し替え（a11y、将来対応）。
- `ChartWindow` を跨ぐドラッグ。
