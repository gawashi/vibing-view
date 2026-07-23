# 一括削除: 全チャート削除 / 全指標削除

- Date: 2026-07-23
- Status: Approved (design)

## 目的

ヘッダーの `ApplyToAllToolbar` は現在「TF を全チャートに適用」「指標を全チャートに追加」という
*正方向* の一括操作を提供している。その対称となる *削除方向* の一括操作を追加する:

- **全チャート削除** — 全セルを空(銘柄なし)に戻す
- **全指標削除** — 全セルからユーザー追加指標を除去する

## スコープ / 対象範囲

削除は **アクティブワークスペースの全セル(可視 + 非可視)** を対象にする。

- 適用系(`setAllTimeframes` / `addIndicatorToAll`)は visible slice のみだが、削除は文字通り
  「all」であるべき。可視のみ消すと、後でグリッドを広げた際に非可視セルに残っていた古い
  チャート/指標が復活し、「全部消したはず」という驚きを生む。
- **ワークスペース跨ぎはしない。** ミューテーションはホットグリッド(`state.cells` = アクティブ
  ワークスペースの layout)のみを対象にし、他のワークスペースは不変。「全削除」= アクティブ
  ワークスペース内の全セル、であってコレクション全体ではない。
- グリッド形状(shape)とセル数は変えない。空セルは残る(= まっさらなグリッド)。
- 固定指標 Volume(`fixed: true`, D-34)は削除しない。既存 `clearCell` / `removeIndicator` と同じ扱い。

## UI

`ApplyToAllToolbar` 内、TF / Indicator ボタンの右にゴミ箱アイコンの `DropdownMenu`
(既存 `components/ui/dropdown-menu.tsx`)を追加する。既存の一括操作と対称の位置に「全削除」を並べる。

```
[ Stamp TF ] [ +Indicator ] [ 🗑 ▾ ]
                            ├ Clear all charts       (全チャート削除)
                            └ Clear all indicators   (全指標削除)
```

各メニュー項目クリックで確認ダイアログ(既存 `components/ui/dialog.tsx`)を開く。

- ダイアログ: `DialogTitle` + `DialogDescription` + `Cancel` / `Delete` の2ボタン。
- `Delete` は `variant="destructive"`(破壊的操作)。
- Cancel でクローズ、Delete で対応するミューテーションを実行してクローズ。
- 画面表示テキスト(メニュー項目・ダイアログ・ボタン)はすべて英語。
- 確認文言は削除される内容を明示する(元に戻せないため):
  - **Clear all charts** — Title: "Clear all charts?" /
    Description: "This removes the symbol and all user-added indicators from every cell in this
    workspace, including hidden cells. This can't be undone."
  - **Clear all indicators** — Title: "Clear all indicators?" /
    Description: "This removes all user-added indicators from every cell in this workspace,
    including hidden cells. Symbols and volume are kept. This can't be undone."

## 挙動

### 全チャート削除

全セルに既存 `clearCell` 相当を適用:

- `symbol` を `null` に。
- ユーザー追加指標(非 `fixed`)を除去、Volume(`fixed`)は残す。
- 全セルの crosshair readout(`crosshairByCell`)を破棄。

### 全指標削除

全セルからユーザー追加指標(非 `fixed`)を除去:

- `symbol` / `timeframe` / Volume は維持。
- 既存 `removeIndicator` のフィルタ(`i.fixed` は残す)を全セルに適用。

## 実装

### store.ts

純粋ミューテーション2本を追加(IPC なし・単体テスト可)。適用系と違い `cellCount` でスライスせず
`cells` 全体を map する。

```ts
clearAllCells: () => set((state) => ({
  cells: state.cells.map((c) => ({ ...c, symbol: null, indicators: c.indicators.filter((i) => i.fixed) })),
  crosshairByCell: {}
})),
removeAllIndicators: () => set((state) => ({
  cells: state.cells.map((c) => ({ ...c, indicators: c.indicators.filter((i) => i.fixed) }))
})),
```

型定義(`AppState`)にも2メソッドを追加する。

### ui/dialog.tsx

Radix の `DialogDescription` を wrapper に追加でエクスポートする(現状 `DialogTitle` のみ)。
確認文言を `DialogDescription` で描画し、`aria-describedby` を自動配線 + Radix の
missing-description 警告を回避する。

### ApplyToAllToolbar.tsx

- `DropdownMenu` + トリガー(ゴミ箱アイコン)+ 2項目を追加。
- 確認ダイアログの開閉 state と「どちらの操作か」を持つ。
  1つの `Dialog` を使い回し、実行対象(`'charts' | 'indicators' | null`)で分岐する。
- 分岐は target → { タイトル文言 / 説明文言 / 呼ぶミューテーション } の対応表で持ち、
  取り違え(charts が指標削除を呼ぶ等)を構造的に防ぐ。

### 永続化

追加配線なし。既存の debounced auto-save(workspace collection snapshot)が状態変化を拾う。

## テスト

store の2ミューテーションに `assert` ベースの自己チェック1本:

- `clearAllCells`: 全セルの `symbol` が `null`、非 fixed 指標が消え、Volume(fixed)が残る、
  `crosshairByCell` が空。
- `removeAllIndicators`: 全セルの非 fixed 指標が消え、Volume と `symbol` が残る。

さらに UI ルーティングを1本:

- メニュー2項目が対応する確認ダイアログを開く。
- Cancel / ダイアログ外クリックで何も呼ばずクローズ。
- 各 Delete ボタンが **対応するミューテーションのみ** を呼ぶ(charts→`clearAllCells`,
  indicators→`removeAllIndicators`)。取り違えを検出する。

## スキップした選択肢

- **Undo トースト** — 削除前スナップショットの保持が必要で重い。確認ダイアログで誤操作は防ぐ。
- **可視セルのみ削除** — 適用系との整合性はあるが、「全削除」の直感に反する(上記スコープ参照)。
- **search/setting 間への単独ボタン配置** — 一括操作が2箇所に分散する。対称ペアとして
  `ApplyToAllToolbar` に集約する方が意味的に自然。
