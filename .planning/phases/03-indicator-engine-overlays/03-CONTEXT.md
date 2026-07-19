# Phase 3: Indicator Engine & Overlays - Context

**Gathered:** 2026-07-19
**Status:** Ready for planning

<domain>
## Phase Boundary

価格チャートに、移動平均（SMA/EMA 選択可）とボリンジャーバンドを **オーバーレイ**（価格ペイン上）として、個数無制限・複数インスタンスで重ねる。各インスタンスをライブ編集（期間・ソース・色・σ倍率）・表示切替・削除でき、**再フェッチなし**でキャッシュ済みバーから即時再計算して反映する。新指標を「計算関数＋パラメータスキーマ＋描画メタデータ」の自己完結モジュールとして登録でき、チャート描画コードを触らずに追加できる pluggable な仕組み（IND-01）を立てる。

このフェーズは価格ペイン上の**オーバーレイ（MA / BB）に限定**。出来高・RSI・MACD などの**サブペイン指標**、十字カーソル同期、TradingView 一致の計算値検証は **Phase 4**（IND-04/05/06/09, CHART-04）。名前付きレイアウトのディスク保存/復元・ウォッチリストは **Phase 5**。

**Covers:** IND-01, IND-02, IND-03, IND-07, IND-08
</domain>

<decisions>
## Implementation Decisions

### 指標の追加・管理UX（IND-02, IND-03, IND-07）
- **D-22:** 追加コントロールはチャート上部ツールバーの「＋指標」ボタン → 選択メニュー（MA / BB）。TimeframeRow の近傍（`App` のヘッダー/チャート上部）に置く。TradingView 上部バーに近い形。現状の dropdown/dialog 部品を流用。
- **D-23:** 追加済みインスタンスの一覧は**チャート左上のオーバーレイ凡例**（TradingView 風）。`MA 20`・`BB 20,2` を縦に並べ、各行から表示切替（目）・編集（歯車/クリック）・削除（×）を出す。チャート外の常駐パネルは作らず、描画面積を犠牲にしない。
- **D-24:** 表示切替・削除・編集はすべて凡例の各行から操作する。個数上限は設けない（IND-07）。

### パラメータのライブ編集UX（IND-01, IND-08）
- **D-25:** パラメータ編集フォームは**各指標モジュールが宣言するパラメータスキーマから自動生成**する。新指標をモジュール登録するだけで編集UIが出る（IND-01 の「チャートコードを触らずに追加」を UI 層まで徹底）。MA/BB 個別の手作りフォームは作らない。
- **D-26:** 反映は**即時（キーストロークごとに再計算）**。計算はキャッシュ済みバーからのクライアント計算で軽いので、再フェッチせず即オーバーレイ更新（IND-08）。※連続入力で体感が重ければ短デバウンスを足すのは planner 裁量。
- **D-27:** MA のソース（計算元）は既定 `close`、`close / open / high / low / hl2 / hlc3` を選択可。IND-08 の「ソースを編集」を満たす。

### オーバーレイの描画と既定値（IND-02, IND-03）
- **D-28:** 新規 MA インスタンスの既定は **SMA・期間20**。追加後に期間・SMA/EMA・ソース・色を編集する（TradingView 同様、既定値で即追加 → 後編集）。
- **D-29:** ボリンジャーバンドは既定 **20期間・2σ**（IND-03）、**上/中/下の3本＋上下バンド間を薄く半透明で塗る**。lightweight-charts の帯塗りは工夫が要るが見映え優先。
- **D-30:** 新規インスタンスの色は**パレットから自動割当（後で変更可）**。追加順に見分けやすい色を割り当て、MA を3本重ねても同色にならない。ダークテーマに合うパレットを使う。凡例ラベルは `MA 20`・`BB 20,2` 形式。

### 銘柄/足切替時の指標の挙動（IND-07, IND-08）
- **D-31:** 指標セットは**全チャート共通で残り、切替後の新データで再計算**する。銘柄や時間軸を切り替えても追加済み指標は消えず、同じ指標が新しいバーで再計算される。指標セットはチャート（アプリ）レベルの属性として保持し、P5 のレイアウト保存への自然な土台になる（この Phase 3 ではメモリ内保持のみ、ディスク永続は P5）。

### Claude's Discretion
- 指標インスタンスの状態管理の置き場（Zustand store 拡張 / チャートローカル state）。現状 store は `activeSymbol` のみ・timeframe は `App` ローカル state なので、指標インスタンス配列をどちらに持たせるかは planner 裁量（D-31 の「全チャート共通で保持」を満たせる場所）。
- pluggable 指標モジュールの内部アーキ（登録レジストリの具体形、計算関数のシグネチャ、パラメータスキーマの表現＝zod か独自型か、描画メタデータの構造）。ユーザー可視の契約は D-25（スキーマ→UI 自動生成）で固定、内部実装は planner/researcher 裁量。
- スキーマ駆動フォームの具体レンダリング（数値入力・SMA/EMA トグル・ソースセレクタ・色ピッカー・σ入力を、どの shadcn/ui 部品で組むか）。
- SMA/EMA の計算実装（CLAUDE.md 方針で手書き TS モジュール、`trading-signals` でクロスチェック）。EMA シードや TradingView 一致の厳密検証は P4 の correctness gate が主管だが、P3 の MA/BB も同じ計算基盤を使うため無理のない範囲で正しく書く。
- パレットの具体色（D-30）とオーバーレイ凡例の細かな見た目（P1/P2 のダークテーマ・shadcn/ui に合わせる）。
- BB 帯塗り（D-29）の実装手段（lightweight-charts の area/baseline 系 or カスタム）。
- 即時再計算の debounce 有無・閾値（D-26）。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### プロジェクト定義・要件
- `.claude/CLAUDE.md` — 技術スタック確定と制約。特に **`<indicator-computation-decision>`** 方針（SMA/EMA/BB/RSI/MACD は手書き TS モジュールで所有し、`trading-signals`@7.4.3 でクロスチェック。`technicalindicators` npm は使わない）、lightweight-charts 5.2 を React 非依存で `useEffect` 内 DOM マウントして使う指針、Zustand をウィジェット横断 UI 状態に使う指針が P3 に直結。
- `.planning/REQUIREMENTS.md` — IND-01/02/03/07/08 の原文と、Out of Scope（ユーザー記述の指標スクリプト＝Pine Script 相当は範囲外＝開発者がコードで指標を足す設計で足りる、が IND-01 の pluggable 契約の狙いを規定）。
- `.planning/ROADMAP.md` §Phase 3 — ゴール・成功基準4項目（MA/BB 追加 / 複数インスタンス無制限＋トグル・削除 / パラメータをライブ編集し再フェッチなしで即反映 / 新指標を自己完結モジュールで登録しチャートコードを変えず追加）。

### 前フェーズの決定（この上に乗る）
- `.planning/phases/01-core-pipeline-slice/01-CONTEXT.md` — read-through キャッシュ・main/renderer 分離・API 節約最優先。P3 の「再フェッチなし＝キャッシュ済みバーから計算」の前提。
- `.planning/phases/02-timeframes-free-tier-resilience/02-CONTEXT.md` — 時間軸切替・W/M 日足導出・gated/レート制限 UX。D-31（足切替後も指標は残り再計算）は P2 の足切替挙動（`App` の timeframe state、Chart の setData 再描画）の上に乗る。

### 実装が触れる既存コード（P1/P2 成果物）
- `src/renderer/components/Chart.tsx` — 「1回だけ chart 生成 → candlestick 1本 → `q.data`/`barsRef` を setData」構造。指標オーバーレイは同じ chart インスタンスに `addSeries(LineSeries, …)` を足して重ねる（P4 のサブペイン=別ペインとは別。P3 は価格ペイン上）。`barsRef.current` に全バーがあるので指標計算の入力に使える。gap-fetch マージ後も同じ key の `q.data` 更新で再計算が走る形にする。
- `src/renderer/store.ts` — 現状 `activeSymbol` のみの最小 Zustand。指標インスタンス配列の置き場候補（D-31 の全チャート共通保持）。
- `src/renderer/App.tsx` — ヘッダー＋TimeframeRow＋Chart の構成。「＋指標」ツールバー（D-22）の差し込み先。timeframe は App ローカル state。
- `src/renderer/api.ts` / `qk` — TanStack Query キー。指標は追加フェッチ不要なので新 IPC/クエリは原則不要（クライアント計算）。
- `src/renderer/components/ui/*` — shadcn/ui 部品（button / dialog / toggle-group / tooltip / input など）。追加メニュー・凡例・編集フォームの部品源。
- `src/shared/types.ts` — `Bar`（time/open/high/low/close/volume）。指標計算関数の入力型。指標インスタンス型（種別・パラメータ・可視・色）を追加する起点。

外部 ADR/spec は未作成。要件は上記ファイルと本 decisions に集約。

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Chart.tsx` の create-once chart インスタンス＋`barsRef`：指標系列は同一 chart に `addSeries(LineSeries)` で追加し、`barsRef.current`（全バー）を計算入力に使える。setData 再描画パスも既存。
- `store.ts`（Zustand）：指標インスタンス state をここに足せば全チャート共通保持（D-31）が自然。
- `src/renderer/components/ui/*`（shadcn/ui）：追加メニュー・凡例行・スキーマ駆動フォームの部品がほぼ揃っている（button/dialog/toggle-group/tooltip/input）。新規依存は不要。
- P2 で確立した TanStack Query の read-through：指標は再フェッチ不要なので、既存キャッシュ済みバーを読むだけで済む。

### Established Patterns
- lightweight-charts は React ラッパを使わず `useEffect` 内で DOM マウント（Chart.tsx の既存流儀）。指標系列の add/remove も同じ effect 管理下に置く。
- 計算は main ではなく **renderer（クライアント）側**で行う想定（API 非発生・キー非関与）。P1/P2 の「main は取得、renderer は表示」に対し、指標は純粋計算なので renderer 完結。
- ダークテーマ・色は CSS 変数/既存パレットに合わせる（P1 の `#0B0E11` 系）。

### Integration Points
- Chart：指標インスタンス配列を購読 → 各インスタンスの LineSeries を add/update/remove、パラメータ変更で即時再計算 → setData。
- 状態層（Zustand 想定）：指標インスタンスの CRUD（追加・可視トグル・パラメータ編集・削除）。
- pluggable レジストリ：`{ compute, paramSchema, renderMeta }` を持つ指標モジュールの登録口。「＋指標」メニューと編集フォームはレジストリから駆動（D-25）。
- UI：ツールバー「＋指標」メニュー（D-22）、左上オーバーレイ凡例（D-23/24）、スキーマ駆動編集フォーム（D-25）。

</code_context>

<specifics>
## Specific Ideas

- TradingView 風を UI の基準にする：上部バーの「＋指標」→メニュー（D-22）、チャート左上のオーバーレイ凡例に各インスタンス＋操作アイコン（D-23）、既定値で即追加→後編集（D-28）。
- コア価値「指標を制限なく好きなだけ重ねる」を UI に反映：個数上限を一切設けない（D-24）、追加順にパレット自動割当で見分けを担保（D-30）。
- IND-01 の pluggable 契約を UI 層まで貫く：パラメータスキーマ→編集UI 自動生成（D-25）。これが P4 で RSI/MACD/Volume を「モジュール登録だけ」で足せる土台になる。
- API 節約方針の継続：指標は一切フェッチせずキャッシュ済みバーからクライアント計算・即時再計算（D-26）。

</specifics>

<deferred>
## Deferred Ideas

- 出来高・RSI・MACD のサブペイン指標、十字カーソル同期、TradingView 一致の計算値検証（correctness gate） → **Phase 4**（IND-04/05/06/09, CHART-04）。P3 の pluggable レジストリ＋スキーマ駆動 UI がそのまま再利用される。
- 名前付きレイアウトのディスク保存/自動復元、指標インスタンスのシリアライズ永続 → **Phase 5**（LAYOUT-02/03/04）。P3 は指標セットをメモリ内保持（D-31）に留め、シリアライズ可能な形を意識しておく。
- 複数チャートグリッドで各セル独立の指標セット → **Phase 5**。P3 は単一チャート・全体共通の指標セット（D-31）で足りる。
- 出来高移動平均オーバーレイ・指標プリセット/テンプレート → **v2**（IND2-01 / IND2-02）。
- ユーザー記述の指標スクリプト（Pine Script 相当） → Out of Scope。開発者がコードで指標モジュールを足す設計（IND-01）で足りる。

None deferred outside the roadmap — discussion stayed within phase scope.

</deferred>

---

*Phase: 3-Indicator Engine & Overlays*
*Context gathered: 2026-07-19*
