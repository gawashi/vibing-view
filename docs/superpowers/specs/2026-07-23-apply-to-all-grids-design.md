# Apply timeframe / indicator to all grids

## 目的

表示中の全グリッド(セル)に、同じ **タイムフレーム** または同じ **インジケーター** を
一括適用するツールバー機能を追加する。現状はセルごとに `TimeframeRow` /
`AddIndicatorMenu` を操作する必要があり、3x3 などでは手数が多い。

## スコープ

対象は「表示中のセル」= `cells.slice(0, cellCount(shape))`。非表示セルは変更しない。

- **タイムフレーム全適用**: 表示中の全セルの `timeframe` を選んだ値に更新する。
  空セルにも適用してよい(害なし。後で銘柄を入れたときに効く)。gated な tf を選んでも
  クラッシュしない — `requires-plan` の tf は各セルの per-cell gating が 1d へスナップし、
  `rate-limited` の tf はキャッシュ済みバーを表示する(いずれも既存挙動、追加ガード不要)。
- **インジケーター全適用**: 追加前に params を設定したうえで、各表示セルに1本追加する。
  **`type` が一致し、かつ `params` が等価なインスタンスが既にあるセルはスキップ**する
  (重複回避)。同 type でも params が異なる場合は追加する。色はダイアログでは指定せず、
  各セルで従来どおり自動パレット割り当てに任せる。

非対象(YAGNI):
- 「全グリッドからインジケーターを一括削除/リセット」
- 一括追加時の色指定
- 更新/スキップ件数のトースト通知(必要になれば後で追加)

## 設計

### ストア (`src/renderer/store.ts`)

純粋アクション(IPC なし・ユニットテスト可)を2つ追加する。

- `setAllTimeframes(tf: Timeframe)` — 表示中の全セルの `timeframe` を `tf` に更新。
- `addIndicatorToAll(type: string, params: Params)` — 各表示セルについて、`type` が一致し
  `params` が等価なインスタンスが既にあればスキップ、無ければ1本追加。色は各セルの
  現在の指標数を `base` にした従来パレット割り当て。`registry[type]` が無い(不正 type)
  場合は `addIndicator` と同様に no-op。

既存 `addIndicator` の「色決定 + `IndicatorInstance` 生成」ロジックを内部ヘルパ
`makeInstance(type, params, base)` に切り出し、`addIndicator` と `addIndicatorToAll` で
共有する(重複回避)。id は従来どおり `String(nextId++)` で採番するので一意。

params 等価判定: 「同 `type` かつ params のシャロー等価(同一キー集合・同一値)」。追加する
params はダイアログ由来(`registry[type].defaults` ベース)で整形済み。既存インスタンスが
`{}` 等の異なるキー集合でもシャロー比較で非一致 → 追加され、破綻しない。defaults への
正規化は行わない(生比較で予測可能)。

### コンポーネント

- **`ParamFields`**(新規・純粋、`src/renderer/components/`)
  `IndicatorEditForm` の number / select / source フィールド描画を抽出。
  props は `(module, params, onChange(patch), onCommit?)`。**color フィールドは対象外**
  (color は `setColor` 経由の特殊処理のため `IndicatorEditForm` 側に残す)。number フィールドの
  Enter キーは `onCommit?.()` を呼ぶ(呼び出し側が「ダイアログを閉じる」/「適用する」を注入)。

- **`IndicatorEditForm`**(リファクタ)
  非 color 部分を `ParamFields` に置き換え、`onCommit={() => onOpenChange(false)}` を渡す
  (現在の Enter で閉じる挙動を保持)。表示・挙動は不変。

- **`TimeframeRow`**(小さく一般化)
  `value?: Timeframe`(現在値ハイライト用。省略時はどの項目もハイライトしない)と
  `label?: string`(trigger 文言。省略時は従来どおり `TF_LABELS[value]`)を任意追加。
  gating(`requires-plan`/`rate-limited` の項目 disable)ロジックは不変。既存の per-cell
  呼び出しは `value` 必須のまま影響なし。

- **`ApplyToAllToolbar`**(新規、`src/renderer/components/`)
  ヘッダーの `GridShapePicker` の隣に配置。
  - 「TF (all)」ドロップダウン: `TimeframeRow` を `value` 無し・`label="TF"` の静的ラベルで
    流用(表示中セルの tf が混在しても集約表示しない)。選択で `setAllTimeframes(tf)`。
  - 「Indicator (all)」ボタン → ダイアログ。種類一覧は `AddIndicatorMenu` と同じ
    `type !== 'volume'` フィルタ(固定の Volume は除外)。種類選択 + `ParamFields` で
    ローカル state を編集(初期値は `registry[type].defaults`。**種類変更時は
    `registry[newType].defaults` に即リセット**)。「Apply to all」で
    `addIndicatorToAll(type, localParams)` を呼び、閉じる(`onCommit` にも同ハンドラ)。

`App.tsx` の header に `ApplyToAllToolbar` を1つ追加する。

### データフロー

ツールバー操作 → ストアアクション → `cells` 更新 → 既存の per-cell 描画・gating・
永続化(`useWorkspaceSync` の debounced save)がそのまま乗る。新規の永続化経路・IPC は不要。

## テスト

`store` の2アクションに対する assert ベースのユニットテスト:
- `setAllTimeframes` が表示中セルのみ更新し、非表示セルを変更しないこと
- `addIndicatorToAll` が表示中セルのみ対象で、同 type + 同 params をスキップし、
  別 params は追加すること
- `addIndicatorToAll` が採番する id が一意であること
- 不正 type では no-op であること

パレット base(セルごとの指標数起点の色割り当て)は `makeInstance` 共有により既存の
`addIndicator` テストでカバーされるため、専用テストは追加しない。
