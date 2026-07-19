# Phase 4: Pane Indicators, Crosshair & Correct Math - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-19
**Phase:** 4-Pane Indicators, Crosshair & Correct Math
**Areas discussed:** サブペインの構造・レイアウト, 十字カーソルの値表示UX, RSI/MACD/出来高の見た目・既定, 計算値検証（correctness gate）の基準, サブペイン指標の追加/削除UX, RSI/MACD のスケール・軸

---

## サブペインの構造・レイアウト

| Option | Description | Selected |
|--------|-------------|----------|
| ドラッグでリサイズ可 | ペイン間の区切りをドラッグして高さ調整。TV に近い | ✓ |
| 固定高（均等分割など） | 固定比率で自動配分。単純だが調整不可 | |

**User's choice:** ドラッグでリサイズ可（D-32）

| Option | Description | Selected |
|--------|-------------|----------|
| 1インスタンス=1ペイン | 追加ごとに新ペインが下に増える。単純・予測可能 | ✓ |
| 同種は1ペインに重ねる | RSI 複数を同ペインに重ねる。TV 手動統合に近いが複雑 | |

**User's choice:** 1インスタンス=1ペイン（D-33）

| Option | Description | Selected |
|--------|-------------|----------|
| 他と同じ追加型指標 | 「＋指標」から Volume を追加/削除。既定非表示 | |
| 常時表示（価格ペイン下に固定） | 出来高は常に下部に固定表示 | ✓ |

**User's choice:** 常時表示の固定ペイン（D-34）

---

## 十字カーソルの値表示UX

| Option | Description | Selected |
|--------|-------------|----------|
| 各ペインの凡例に生値を差し込む | 既存の左上凡例を拡張し各ペインに値表示（TV 風） | ✓ |
| 別のデータウィンドウ（固定パネル） | 角に全値パネルを常駐。一覧性高いが面積を奪う | |

**User's choice:** 各ペイン凡例に生値（D-38）

| Option | Description | Selected |
|--------|-------------|----------|
| OHLC 四値 | 始値/高値/安値/終値。TV 既定 | ✓ |
| 終値のみ | 終値だけ。簡潔だが情報量減 | |

**User's choice:** OHLC 四値（D-39）

| Option | Description | Selected |
|--------|-------------|----------|
| 最新バーの値を表示 | 非ホバー時は右端の値に戻る（TV 挙動） | ✓ |
| ラベルのみ（値は非表示） | 非ホバー時は指標名だけ | |

**User's choice:** 非ホバー時は最新バー値（D-40）

---

## RSI/MACD/出来高の見た目・既定

| Option | Description | Selected |
|--------|-------------|----------|
| ガイド線＋帯を藄塗り | 70/30 に線＋間を半透明塗り（BandPrimitive 流用） | ✓ |
| ガイド線のみ | 70/30 に破線だけ | |

**User's choice:** ガイド線＋帯藄塗り（D-41）

| Option | Description | Selected |
|--------|-------------|----------|
| 4色（正負×増減） | 0以上/以下×前足比で4色。TV 既定 | ✓ |
| 2色（正負のみ） | 0以上=緑/以下=赤の2色 | |

**User's choice:** MACD ヒスト 4色（D-42）

| Option | Description | Selected |
|--------|-------------|----------|
| 陰陽で色分け | 陽線=緑/陰線=赤。ローソク色と揃える | ✓ |
| 単一色 | グレー系一色 | |

**User's choice:** 出来高 陰陽色分け（D-43）

| Option | Description | Selected |
|--------|-------------|----------|
| 要件通りで確定 | RSI 14/70/30、MACD 12/26/9 | ✓ |
| 別の値にしたい | 既定値を変更 | |

**User's choice:** 既定値は要件通り確定（D-44）

---

## 計算値検証（correctness gate）の基準

| Option | Description | Selected |
|--------|-------------|----------|
| ユーザーが TradingView から手採取 | TV 実値を数点拾って期待値にハードコード | ✓ |
| trading-signals を基準にクロスチェック | lib 出力を基準。TV 実値とはずれる可能性 | |
| 両方（TV手採取＋lib照合） | 少数の TV ゴールデン＋広域 lib 照合 | |

**User's choice:** ユーザーが TV から手採取（D-48）

| Option | Description | Selected |
|--------|-------------|----------|
| ユーザーが指定（例：AAPL 日足） | 固定銘柄・期間をユーザーが指定 | ✓ |
| Claude 裁量（代表銘柄） | planner/researcher が代表銘柄を選ぶ | |

**User's choice:** ユーザーが指定、AAPL 日足を作業既定に（D-49）

---

## サブペイン指標の追加/削除UX

| Option | Description | Selected |
|--------|-------------|----------|
| 既存の「＋指標」メニューを拡張 | MA/BB と同じメニューに RSI/MACD を並べる。出力種別で振り分け | ✓ |
| オーバーレイとサブペインでメニューを分ける | 系統別にグループ分け。選びやすいが UI 複雑 | |

**User's choice:** 「＋指標」メニュー拡張（D-35）

| Option | Description | Selected |
|--------|-------------|----------|
| ペインが消えて下が詰まる | 最後の1つを削除するとペインごと消える | ✓ |
| 空のペインを残す | 枠は残る。安定だが空白 | |

**User's choice:** ペイン消えて詰まる（D-36）

| Option | Description | Selected |
|--------|-------------|----------|
| 価格ペインの凡例と同じ作法 | 各サブペイン左上に目/歯車/×の凡例行 | ✓ |
| 価格ペインの凡例に集約 | 全指標を左上1凡例にまとめる | |

**User's choice:** サブペイン凡例＝価格ペインと同じ作法（D-37）

---

## RSI/MACD のスケール・軸

| Option | Description | Selected |
|--------|-------------|----------|
| 0-100 固定 | RSI 縦軸を 0-100 に固定。70/30 位置が一定 | ✓ |
| 自動スケール | 実値範囲に自動伸縮 | |

**User's choice:** RSI 0-100 固定（D-45）

| Option | Description | Selected |
|--------|-------------|----------|
| ゼロ線を表示 | 0 に水平線。クロス・正負が見やすい | ✓ |
| ゼロ線なし | 描かない | |

**User's choice:** MACD ゼロ線表示（D-46）

| Option | Description | Selected |
|--------|-------------|----------|
| D-30 パレット自動割当 | 追加順パレットで自動割当（オーバーレイと同じ） | ✓ |
| 指標ごとの固定既定色 | RSI=紫、MACD線=青/シグナル=オレンジ 等の固定色 | |

**User's choice:** D-30 パレット自動割当（D-47）

---

## Claude's Discretion

- サブペイン用モジュール契約拡張（`OutputMeta` の出力種別追加、Chart reconcile への組込み）
- lightweight-charts v5.2 マルチペイン API の具体的使い方（paneIndex / moveToPane / HistogramSeries）
- 十字カーソル実装詳細（subscribeCrosshairMove、凡例配信、マグネットモード、ラベル表示）
- MACD 4色・出来高陰陽色の実装手段、RSI ガイド線＋帯の実装
- 前足比変化％表示の有無、即時再計算の debounce
- 出来高常設ペインの状態管理の置き場
- ゴールデン値テストの許容誤差・フィクスチャ形式

## Deferred Ideas

- ペイン高さ/指標セットのシリアライズ永続・複数チャートグリッド → Phase 5
- 複数チャート間の十字カーソル連動 → Out of Scope（v1）/ v1.x
- 出来高移動平均オーバーレイ・指標プリセット → v2（IND2-01/02）
- ユーザー記述の指標スクリプト（Pine Script 相当） → Out of Scope
