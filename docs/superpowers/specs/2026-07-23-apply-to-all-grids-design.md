# Apply timeframe / indicator to all grids

## 目的

表示中の全グリッド(セル)に、同じ **タイムフレーム** または同じ **インジケーター** を
一括適用するツールバー機能を追加する。現状はセルごとに `TimeframeRow` /
`AddIndicatorMenu` を操作する必要があり、3x3 などでは手数が多い。

## スコープ

対象は「表示中のセル」= `cells.slice(0, cellCount(shape))`。非表示セルは変更しない。

- **タイムフレーム全適用**: 表示中の全セルの `timeframe` を選んだ値に更新する。
  空セルにも適用してよい(害なし。後で銘柄を入れたときに効く)。銘柄が対応しない tf は
  既存の per-cell capability gating が日足へスナップするので、追加のガードは不要。
- **インジケーター全適用**: 追加前に params を設定したうえで、各表示セルに1本追加する。
  **`type` が一致し、かつ `params` が等価なインスタンスが既にあるセルはスキップ**する
  (重複回避)。同 type でも params が異なる場合は追加する。色はダイアログでは指定せず、
  各セルで従来どおり自動パレット割り当てに任せる。

非対象(YAGNI):
- 「全グリッドからインジケーターを一括削除/リセット」
- 一括追加時の色指定

## 設計

### ストア (`src/renderer/store.ts`)

純粋アクション(IPC なし・ユニットテスト可)を2つ追加する。

- `setAllTimeframes(tf: Timeframe)` — 表示中の全セルの `timeframe` を `tf` に更新。
- `addIndicatorToAll(type: string, params: Params)` — 各表示セルについて、`type` が一致し
  `params` が等価なインスタンスが既にあればスキップ、無ければ1本追加。色は各セルの
  現在の指標数を `base` にした従来パレット割り当て。

既存 `addIndicator` の「色決定 + `IndicatorInstance` 生成」ロジックを内部ヘルパ
`makeInstance(type, params, base)` に切り出し、`addIndicator` と `addIndicatorToAll` で
共有する(重複回避)。

params 等価判定: 同 `type` ならキー集合が同じなので、値のシャロー比較で足りる。

### コンポーネント

- **`ParamFields`**(新規・純粋、`src/renderer/components/`)
  `IndicatorEditForm` の number / select / source フィールド描画を抽出。
  props は `(module, params, onChange(patch))`。**color フィールドは対象外**
  (color は `setColor` 経由の特殊処理のため `IndicatorEditForm` 側に残す)。

- **`IndicatorEditForm`**(リファクタ)
  非 color 部分を `ParamFields` に置き換える。表示・挙動は不変。

- **`ApplyToAllToolbar`**(新規、`src/renderer/components/`)
  ヘッダーの `GridShapePicker` の隣に配置。
  - 「TF (all)」ドロップダウン: `TimeframeRow` を流用。選択で `setAllTimeframes(tf)`。
  - 「Indicator (all)」ボタン → ダイアログ。ダイアログ内で種類選択 + `ParamFields` で
    ローカル state を編集(初期値は `registry[type].defaults`)。「Apply to all」で
    `addIndicatorToAll(type, localParams)` を呼び、閉じる。

`App.tsx` の header に `ApplyToAllToolbar` を1つ追加する。

### データフロー

ツールバー操作 → ストアアクション → `cells` 更新 → 既存の per-cell 描画・gating・
永続化(`useWorkspaceSync` の debounced save)がそのまま乗る。新規の永続化経路・IPC は不要。

## テスト

`store` の2アクションに対する assert ベースのユニットテスト:
- `setAllTimeframes` が表示中セルのみ更新し、非表示セルを変更しないこと
- `addIndicatorToAll` が同 type + 同 params をスキップし、別 params は追加すること
