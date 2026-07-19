# Phase 4 — 実装詳細デザイン（Claude's Discretion の確定）

**作成:** 2026-07-19
**ステータス:** 承認済み（ユーザー確認）
**位置づけ:** `04-CONTEXT.md`（D-32→D-50）と承認済み `04-UI-SPEC.md` はそのまま。本書はそれらが planner 裁量に残した**内部実装の形**だけを確定する。ユーザー可視の挙動は一切変更しない。

## 確定した設計判断（本フェーズで新規）

- **DD-1:** golden フィクスチャは**自己完結**。入力 OHLC と期待値の**両方を同一 TradingView チャートから採取**し、テストは FMP に一切触れない。不一致＝我々の計算が誤り、と断定できる（データソース差分＝split/調整ズレを排除）。
- **DD-2:** 一致許容誤差は **`|actual − expected| < 0.01`**（TV の 2 桁表示精度）。TV 画面から読める粒度に一致させ、表示されない下位桁の丸めで誤 fail しない。
- **DD-3:** 価格ペインのカーソル読み取りは **OHLC 四値のみ**。前足比変化％は**付けない**（UI-SPEC 既定＝omit、YAGNI）。後で必要になれば追加。

---

## 1. モジュール契約の拡張（`src/renderer/indicators/types.ts`）

`ma`/`bb` と後方互換な**加算のみ**の変更。

```ts
// MACD ヒストグラム + 出来高バー用。per-bar 色を許す新しい点型。
export type HistPoint = { time: number; value: number; color?: string }

export type OutputMeta =
  | { key: string; kind: 'line'; defaultWidth?: number }
  | { key: string; kind: 'band'; between: [string, string] }
  | { key: string; kind: 'histogram' }                       // NEW

export type IndicatorModule = {
  // ...existing (type / label / defaults / params / outputs)...
  pane?: 'overlay' | 'separate'                    // NEW, 既定 'overlay'。RSI/MACD/Volume = 'separate'
  scale?: { min: number; max: number }             // NEW, 固定スケール。RSI = {0,100}（D-45）
  guides?: { value: number; color?: string }[]     // NEW, 水平ガイド線。RSI 70/30・MACD 0 線（D-41/46）
  band?: { from: number; to: number; color: string } // NEW, ゾーン塗り。RSI 70/30（D-41）
  compute: (bars: Bar[], p: Params) => Record<string, LineData[] | HistPoint[]>
}
```

**根拠:**
- `pane` は**モジュールレベルで明示**。出力種別からは推論しない（RSI は line 出力のみだが独立ペインが要る）。D-35 の「出力種別で振り分け」が扱えない唯一のケースをここで明示的に埋める。D-33「1 インスタンス=1 ペイン」なので per-output でなくモジュール単位が正しい粒度。
- `guides`/`band`/`scale` は**宣言的メタデータ**。RSI の 70/30 線＋ゾーン塗り＋0-100 固定、MACD の 0 線を Chart が汎用処理で描く。Chart に指標種別ごとの分岐を書かない。

## 2. Chart reconcile — サブペイン系列（`src/renderer/components/Chart.tsx`）

既存の reconcile effect（`Chart.tsx:168`）を**拡張**する。書き換えない。

- `separate` 各インスタンスは生成時に **paneIndex** を割り当て。`Map<instanceId, paneIndex>` を `indicatorSeriesRef` と並置して保持。ペインは追加順に下へ積む（D-33）。出来高は常に paneIndex 1。
- `line` 出力 → `addSeries(LineSeries, {...}, paneIndex)`。`histogram` 出力 → `addSeries(HistogramSeries, {...}, paneIndex)`。per-bar `color` は **module.compute が返す**（MACD 4 色 D-42・出来高陰陽 D-43 は Chart でなくモジュール側で決定）。
- `guides` → native `series.createPriceLine({ price, color })`。`band` → 既存 `BandPrimitive` を**定数値 2 系列**（バー範囲全域）で駆動して流用（D-41、実績コード）。`scale` → `priceScale.applyOptions({ autoScale:false })` ＋固定範囲を返す `autoscaleInfoProvider`。
- **削除時の詰め（D-36）:** ペインの全系列を `removeSeries`。空になったペインは lightweight-charts が自動除去し下のペインが繰り上がる。除去後に paneIndex マップを再導出。

## 3. 出来高＝固定ペイン（D-34）

`volume` を**通常のモジュールとして登録**（`pane:'separate'`、`histogram` 出力 1 本、per-bar 色は close≥open で決定）。store に **`fixed: true` の常設インスタンス**として seed する。

- `AddIndicatorMenu` から除外（D-34、ユーザー追加不可）
- 当該ペイン凡例はラベル＋カーソル値のみ。目/歯車/× は出さない（UI-SPEC）
- `removeIndicator` は fixed インスタンスを無視

→ 出来高専用の別経路を書かず、reconcile＋compute＋凡例の**全パイプラインを再利用**。フラグ 1 個で済む。

## 4. 十字カーソル＋ペイン別凡例（CHART-04, D-38/39/40）

- **`subscribeCrosshairMove` は create-once effect 内に 1 本**。移動時に各系列値を `param.seriesData.get(series)` で `param.time` の値として読む → 全ペインが**同一タイムスタンプ**を読む保証（同期の要）。
- 値は小さな Zustand スライス `crosshair: Record<instanceId, values>` ＋価格ペイン OHLC エントリへ流す。**`requestAnimationFrame` でスロットル**（mousemove は描画より遥かに高頻度）。
- **非ホバー（D-40）:** `param.time` が undefined のとき最新（右端）バー値で埋める。データ変更時に 1 回算出し既定値として使う。
- **ペイン別凡例の配置:** 凡例は HTML オーバーレイ。ペインごとに 1 つの凡例 div を、各ペイン左上に `chart.paneSize(i)` の累積高さで絶対配置。データ変更時とペインリサイズ時に再計算（chart の size/resize シグナルを購読）。`IndicatorLegend` は行描画コンポーネントのまま、ペインごとに当該ペインのインスタンス＋カーソル値で複数インスタンス化する。

> ⚠️ **本フェーズ最難関。** ドラッグでリサイズ可能な canvas ペイン上への per-pane HTML 配置。planner は lightweight-charts 5.2 の実際のペイン幾何 API に対して**早期に spike** すること。他項目は低リスク。

## 5. 計算の追加（`src/renderer/indicators/math.ts`, IND-09）

- `rsi(values, period)` — **Wilder 平滑（最初の `period` 本の gain/loss の SMA でシード）**、以降 Wilder の再帰平均。既存 `sma`/`ema` と同じく leading gap 付きの整列配列。
- `macd(values, fast, slow, signal)` — MACD 線 = `ema(fast) − ema(slow)`、シグナル = `ema(macdLine, signal)`（SMA でなく MACD 線の EMA）、ヒスト = macd − signal。既存 `ema` を再利用。
- 出来高は math 不要。compute が bars→`{ time, value: volume, color }` を写すだけ。

## 6. correctness gate（IND-09, D-48/49/50, DD-1/2/3）

- `tests/indicators/fixtures/golden.ts` — **自己完結**（DD-1）: 小さな AAPL 日足 OHLC 入力と期待値を同一 TV チャートから採取。現状はプレースホルダで `// TODO: fill from TradingView`。テストは FMP 非依存。
- `math.golden.test.ts` 1 本で**全 5 指標**（SMA/EMA/BB/RSI/MACD）を数点のチェックポイント日付で検証。
- アサーション: `expect(Math.abs(actual - expected)).toBeLessThan(0.01)`（DD-2、TV 2 桁精度）。
- プレースホルダの間は `test.todo`/skip で**空通過**。ユーザーが TV 実値を流し込むと gate が enforce へ切り替わる。→ ハーネスは本フェーズで着地し、gate はユーザーの値投入で「完全通過」する形。

---

## スコープ確認

D-32→D-50 と UI-SPEC は**不変**。本書は内部の型・データフローの形を固定するのみ。触れる既存コード: `indicators/types.ts`（契約拡張）・`Chart.tsx`（reconcile 拡張・crosshair 購読）・`store.ts`（crosshair スライス・volume 常設インスタンス）・`math.ts`（rsi/macd 追加）・`IndicatorLegend.tsx`（ペイン別化）・新規 `indicators/rsi.ts`/`macd.ts`/`volume.ts`・`registry.ts` 追記・`tests/indicators/`。
