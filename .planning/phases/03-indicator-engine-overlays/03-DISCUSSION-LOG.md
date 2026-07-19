# Phase 3: Indicator Engine & Overlays - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-19
**Phase:** 3-Indicator Engine & Overlays
**Areas discussed:** 指標の追加・管理UX, パラメータのライブ編集UX, オーバーレイの描画と既定値, 銘柄/足切替時の指標の挙動

---

## 指標の追加・管理UX

### 追加コントロールの形
| Option | Description | Selected |
|--------|-------------|----------|
| ツールバーの「＋指標」ボタン→メニュー | TimeframeRow 隣のツールバーに「＋ Indicator」→ MA/BB 選択メニュー | ✓ |
| チャート左上凡例の「＋」 | チャート内左上凡例に＋ボタンを埋め込み、一覧と追加を同じ場所に集約 | |

### 追加済みインスタンス一覧（凡例）の場所
| Option | Description | Selected |
|--------|-------------|----------|
| チャート左上オーバーレイ凡例 | TradingView 風、チャート内左上に縦並び＋各行に操作アイコン | ✓ |
| チャート下/横のパネルに一覧 | チャート外の専用パネル | |

**User's choice:** 追加＝ツールバー「＋指標」メニュー、一覧＝チャート左上オーバーレイ凡例
**Notes:** 表示切替・編集・削除は凡例各行から。個数上限なし。

---

## パラメータのライブ編集UX

### 編集フォームの生成方式
| Option | Description | Selected |
|--------|-------------|----------|
| パラメータスキーマから自動生成 | 各指標モジュールのスキーマから編集UIを自動生成。IND-01 の契約をUI層まで徹底 | ✓ |
| 指標ごとに手作りフォーム | MA/BB 個別に手でフォームを書く | |

### 反映タイミング
| Option | Description | Selected |
|--------|-------------|----------|
| 即時（キーストロークごとに再計算） | 変更した瞬間に再計算・再描画。キャッシュ済みバーからのクライアント計算で軽い | ✓ |
| 軽いデバウンス（数十ms） | 連続入力での過剰再計算を抑える | |

### 移動平均のソース
| Option | Description | Selected |
|--------|-------------|----------|
| 既定 close、close/open/high/low/hl2/hlc3 を選択可 | TradingView 標準。IND-08 のソース編集を満たす | ✓ |
| close 固定 | v1 はソース選択なし（非推奨） | |

**User's choice:** スキーマ駆動自動生成 / 即時再計算 / ソース既定 close ＋選択可
**Notes:** 連続入力で重ければ短デバウンスは planner 裁量。

---

## オーバーレイの描画と既定値

### 新規 MA インスタンスの既定
| Option | Description | Selected |
|--------|-------------|----------|
| SMA 期間20 | 既定で SMA(20) を即追加、後で編集 | ✓ |
| 追加時に期間を聞く | MA 選択後に期間入力を促す | |

### ボリンジャーバンドの描画
| Option | Description | Selected |
|--------|-------------|----------|
| 上/中/下3本＋帯を薄く塗る | TradingView 同様、上下バンド間を半透明で塗る | ✓ |
| 上/中/下3本の線のみ | 帯塗りなし、実装最小 | |

### 新規インスタンスの色
| Option | Description | Selected |
|--------|-------------|----------|
| パレットから自動割当（後で変更可） | 追加順に見分けやすい色を自動割当、編集で変更可 | ✓ |
| 常に同じ既定色（手動で変更） | 新規は固定色、重なりは手で変更 | |

**User's choice:** MA 既定 SMA(20) / BB 既定 20・2σ で3本＋帯薄塗り / 色はパレット自動割当
**Notes:** 凡例ラベルは `MA 20`・`BB 20,2` 形式。

---

## 銘柄/足切替時の指標の挙動

| Option | Description | Selected |
|--------|-------------|----------|
| 全チャート共通で残り、新データで再計算 | 指標セットはチャート属性として保持、銘柄/足を変えても消えず新データで再計算 | ✓ |
| 銘柄ごとに独立した指標セット | 銘柄を変えるとその銘柄に紐づく指標セットに切替 | |

**User's choice:** 全チャート共通で残り、新データで再計算
**Notes:** この Phase 3 ではメモリ内保持のみ。ディスク永続は P5。P5 レイアウト保存への土台。

---

## Claude's Discretion

- 指標インスタンス state の置き場（Zustand store 拡張 / チャートローカル state）。
- pluggable 指標モジュールの内部アーキ（レジストリの具体形、計算関数シグネチャ、スキーマ表現＝zod か独自型、描画メタデータ構造）。
- スキーマ駆動フォームの具体レンダリング（どの shadcn/ui 部品で組むか）。
- SMA/EMA 計算実装（手書き TS ＋ `trading-signals` クロスチェック、EMA シード）。
- パレットの具体色・凡例の細かな見た目・BB 帯塗りの実装手段・即時再計算の debounce 有無。

## Deferred Ideas

- 出来高/RSI/MACD サブペイン・十字カーソル同期・計算値検証 → Phase 4。
- 名前付きレイアウトのディスク保存/復元・指標シリアライズ永続 → Phase 5。
- 複数チャートグリッドで各セル独立の指標セット → Phase 5。
- 出来高移動平均・指標プリセット/テンプレート → v2（IND2-01 / IND2-02）。
- ユーザー記述の指標スクリプト（Pine Script 相当） → Out of Scope。
