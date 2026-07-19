# Phase 4: Pane Indicators, Crosshair & Correct Math - Context

**Gathered:** 2026-07-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 3 の pluggable 指標システム（レジストリ＋モジュール契約 `compute`/`params`/`outputs`）の上に、**サブペイン指標（出来高 / RSI / MACD）**を価格ペイン下の同期したサブペインとして足す。**十字カーソル**で価格ペインと全サブペインの値を同一タイムスタンプで同時に読み取れるようにし、全指標（SMA/EMA/BB/RSI/MACD）の計算値を **TradingView 慣行に一致**させる（RSI=Wilder 平滑・SMA シード、MACD=EMA シグナル、BB=母集団標準偏差、正しい EMA シード）。一致は **reference-value テストスイート**で検証する correctness gate を立てる。

**このフェーズの範囲:** サブペイン指標（IND-04 出来高 / IND-05 RSI / IND-06 MACD）、十字カーソル同期（CHART-04）、計算値検証（IND-09）。オーバーレイ（MA/BB）の追加 UX は Phase 3 で確定済み。名前付きレイアウトのディスク保存/復元・複数チャートグリッド・ウォッチリストは **Phase 5**。

**Covers:** IND-04, IND-05, IND-06, IND-09, CHART-04
</domain>

<decisions>
## Implementation Decisions

### サブペインの構造・レイアウト（IND-04/05/06, CHART-04）
- **D-32:** サブペインの高さは**ドラッグでリサイズ可**。lightweight-charts のペイン標準のリサイズハンドルを活かし TradingView に近い操作感。※ペイン高さの**永続**は P5（レイアウト保存）。この Phase 4 ではメモリ内保持のみ。
- **D-33:** サブペイン指標は **1インスタンス=1ペイン**。同種を複数追加（例: RSI 14 と RSI 7、MACD と RSI）すると新しいペインが下に増える。ペイン割当ロジックが単純で予測可能、「制限なく好きなだけ重ねる」コア価値に合う。
- **D-34:** **出来高（Volume）は常時表示の固定サブペイン**（価格ペイン下に固定）。RSI/MACD のように「＋指標」から都度追加する管理インスタンスにはしない（追加/削除の対象外、または常設ペイン扱い）。※他のサブペイン指標とは扱いが異なる点に注意。

### サブペイン指標の追加/削除 UX（IND-04/05/06, IND-07）
- **D-35:** RSI/MACD の追加は**既存の「＋指標」メニュー（AddIndicatorMenu）を拡張**して行う。MA/BB と同じメニューに並べ、オーバーレイかサブペインかは**モジュールの出力種別が決める**（契約を一本化し IND-01 を徹底）。オーバーレイ/サブペインでメニューを分けない。
- **D-36:** サブペイン指標を削除したときは**ペインが消えて下が詰まる**。最後の1インスタンスを削除するとそのサブペインごと消え、下のペインが上に詰まる。空のペイン枠は残さない。価格ペインが広く使える。
- **D-37:** 各サブペインにも**価格ペインの凡例と同じ作法**の操作行を出す（表示切替=目 / 編集=歯車 / 削除=× を左上凡例に、D-23/24 をサブペインへ展開）。全指標で一貫した操作感。

### 十字カーソルの値表示 UX（CHART-04）
- **D-38:** カーソル移動時の指標値は**各ペインの左上凡例に生値を差し込む**（TradingView 風）。既存の左上オーバーレイ凡例（D-23）を拡張し、各ペインの凡例にそのペインの指標名＋カーソル位置の値を表示。チャート外の常駐データウィンドウは作らず描画面積を犠牲にしない。
- **D-39:** 価格ペインの読み取り（カーソル位置）は **OHLC 四値**（始値/高値/安値/終値）。TradingView の既定でローソク足の情報量に合う。※前足比の変化％を足すかは planner 裁量。
- **D-40:** カーソルが**チャート上にない（非ホバー）ときは最新バー（右端）の値**を凡例に表示。カーソルを外すと直近値に戻る TradingView の振る舞い。常に何か値が見える。

### RSI/MACD/出来高の見た目・既定（IND-04/05/06）
- **D-41:** RSI の買われすぎ/売られすぎ水準（**既定 70/30**）は**ガイド線＋間を薄く半透明で藄塗り**。Phase 3 の BB 帯塗り（BandPrimitive, D-29）を流用してゾーンを可視化。RSI ペインは **0-100 固定スケール**（D-45）なのでガイド線位置が常に一定。
- **D-42:** MACD のヒストグラムは **4色（正負×前足比の増減）**（濃緑/薄緑/濃赤/薄赤）。TradingView 既定で勢いの転換が見える。
- **D-43:** 出来高バーは**陰陽で色分け**（close≥open=緑 #22C55E / 陰線=赤 #EF4444）。ローソク足の色と揃える。
- **D-44:** 既定パラメータは**要件通りで確定**: RSI=期間14・買われすぎ70・売られすぎ30（IND-05）、MACD=12/26/9（IND-06）。追加後にライブ編集可（IND-08、D-25 のスキーマ駆動フォームに乗る）。

### RSI/MACD のスケール・軸
- **D-45:** RSI ペインの縦スケールは **0-100 固定**。TradingView 既定で 70/30 ガイド線位置が常に一定、ゾーン判断がしやすい。
- **D-46:** MACD ペインは**ゼロライン（0線）を表示**。ヒストグラムの正負・MACD 線のクロスが見やすい。MACD 本体は自動スケール。
- **D-47:** サブペイン各線（RSI 線、MACD 線/シグナル）の色は **D-30 パレット自動割当**に乗せる（オーバーレイと同じ仕組み、追加順に見分けやすい色）。後で編集可。

### 計算値検証（correctness gate, IND-09）
- **D-48:** TradingView 一致の「正解値（ゴールデン値）」は**ユーザーが TradingView から手採取**する。固定銘柄・日付レンジを決め、TV の実際の指標値を数点拾ってテストの期待値にハードコード。最も確実に TV 一致を担保する方式。
- **D-49:** リファレンスの固定銘柄・期間は**ユーザーが指定**（例: AAPL 日足）。未指定の間は **AAPL 日足を作業既定**とし、planner はゴールデン値を差し込む**フィクスチャ（プレースホルダ）付きのテストハーネス**を先に用意する。ユーザーが TV 実値を後から流し込めば gate が完全通過する形にする。correctness gate は **全5指標（SMA/EMA/BB/RSI/MACD）**をカバー。
- **D-50:** 計算の慣行は要件（IND-09）通り: RSI=Wilder 平滑（SMA シード）、MACD=EMA シグナル線、BB=母集団標準偏差、EMA の正しいシード。CLAUDE.md 方針で**手書き TS モジュール**、`trading-signals`@7.4.3 でクロスチェック（`technicalindicators` npm は使わない）。

### Claude's Discretion
- サブペイン指標の**モジュール契約拡張**の具体形（`OutputMeta` に `pane`/`histogram` 系の出力種別をどう足すか、ペイン割当を Chart の reconcile effect にどう組み込むか）。ユーザー可視の契約は D-35（同一メニュー・出力種別でオーバーレイ/サブペイン判定）で固定、内部表現は planner/researcher 裁量。
- lightweight-charts v5.2 の**マルチペイン API**の具体的使い方（`addSeries(..., paneIndex)` / `series.moveToPane()`、ペイン生成・破棄・リサイズハンドルの扱い、`HistogramSeries` の使用）。
- **十字カーソル**の実装詳細（`subscribeCrosshairMove` からの値取得、各ペイン凡例への配信、マグネットモード ON/OFF、時刻/価格ラベルの表示）。D-38/39/40 のユーザー可視挙動だけ固定。
- MACD ヒストグラムの4色分け（D-42）・出来高陰陽色（D-43）の具体実装手段（`HistogramSeries` の per-bar color か複数系列か）。
- RSI ガイド線＋帯（D-41）の実装（BandPrimitive 流用 or 水平線プリミティブ）。
- 前足比の変化％表示（D-39）を足すか、即時再計算の debounce（P3 D-26 と同様）。
- 出来高常時ペイン（D-34）の状態管理の置き場（常設扱い or store の特別インスタンス）。
- ゴールデン値テストの許容誤差の考え方（浮動小数の丸め幅）と、ハーネスのフィクスチャ形式（JSON/TS 定数）。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### プロジェクト定義・要件
- `.claude/CLAUDE.md` — 技術スタック確定と制約。特に **`<indicator-computation-decision>`**（SMA/EMA/BB/RSI/MACD は手書き TS モジュールで所有し `trading-signals`@7.4.3 でクロスチェック、`technicalindicators` npm は不使用）、lightweight-charts 5.2 を React 非依存で `useEffect` 内 DOM マウント（**native multi-pane API**: `addSeries(..., paneIndex)` / `series.moveToPane()`、native crosshair の記述が P4 に直結）、Zustand をウィジェット横断 UI 状態に使う指針。
- `.planning/REQUIREMENTS.md` — IND-04/05/06/09・CHART-04 の原文。IND-05（RSI 既定 14/70/30）、IND-06（MACD 12/26/9・MACD線/シグナル/ヒスト）、IND-09（Wilder 平滑・EMA・母集団標準偏差・正しい EMA シード）。Out of Scope（複数チャート間の十字カーソル連動は v1 範囲外＝このフェーズは単一チャート内の全ペイン同期のみ）。
- `.planning/ROADMAP.md` §Phase 4 — ゴール・成功基準3項目（サブペイン3種＋RSI 水準設定 / カーソルで全ペイン同期読み取り / 固定銘柄レンジで TV 参照値一致を reference-value テストで検証）。

### 前フェーズの決定（この上に乗る）
- `.planning/phases/03-indicator-engine-overlays/03-CONTEXT.md` — **最重要**。pluggable レジストリ、モジュール契約（`compute`/`params`/`outputs`）、スキーマ駆動編集フォーム（D-25）、左上オーバーレイ凡例（D-23/24）、パレット自動割当（D-30）、再フェッチなしクライアント即時計算（D-26）、指標セットは全チャート共通でメモリ内保持（D-31）。P4 のサブペイン指標・凡例拡張・色割当・カーソル値表示はすべてこの上に乗る。
- `.planning/phases/02-timeframes-free-tier-resilience/02-CONTEXT.md` — 時間軸切替・W/M 日足導出・gated/レート制限 UX・pan/zoom gap-fetch。カーソル同期は足切替後の新データにも追随する必要。
- `.planning/phases/01-core-pipeline-slice/01-CONTEXT.md` — read-through キャッシュ・main/renderer 分離・API 節約最優先。指標計算は renderer 完結（フェッチ非発生）。

### 実装が触れる既存コード（P1/P2/P3 成果物）
- `src/renderer/components/Chart.tsx` — create-once chart インスタンス＋`barsRef`（全バー）＋指標 reconcile effect（`indicatorSeriesRef` / `bandPrimitiveRef` の add/update/remove）。サブペインは同じ chart に **paneIndex 指定の系列**を足す方向で、この reconcile effect を拡張する。十字カーソルの `subscribeCrosshairMove` もここに足す。
- `src/renderer/indicators/types.ts` — モジュール契約（`IndicatorModule` / `IndicatorInstance` / `FieldDesc` / `OutputMeta` / `sourceValues`）。サブペイン用の出力種別（histogram/pane 系）はここを拡張する起点。
- `src/renderer/indicators/registry.ts` — 単一登録点 `{ ma, bb }`。RSI/MACD/Volume モジュールをここに足す（IND-01: チャートコードを触らず追加）。
- `src/renderer/indicators/math.ts` — SMA/EMA/BB の計算基盤（P3）。RSI(Wilder)/MACD(EMA) をここに足し、IND-09 の慣行一致・EMA シードを厳密化。correctness gate のテスト対象。
- `src/renderer/indicators/ma.ts` / `bb.ts` — 既存モジュール実装の型・構造の手本。`bandPrimitive.ts`（BandPrimitive, `hexToRgba`）は RSI の 70/30 帯塗り（D-41）に流用候補。
- `src/renderer/components/AddIndicatorMenu.tsx` — 「＋指標」メニュー。RSI/MACD を並べる差し込み先（D-35）。
- `src/renderer/components/IndicatorLegend.tsx` — 左上オーバーレイ凡例。各サブペインへの凡例展開（D-37）＋カーソル生値表示（D-38）の拡張元。
- `src/renderer/components/IndicatorEditForm.tsx` — スキーマ駆動編集フォーム（D-25）。RSI の 70/30 しきい値・MACD パラメータもここから自動生成される。
- `src/renderer/store.ts` — Zustand（`indicators` インスタンス配列）。サブペイン指標も同じ配列に乗せる。出来高常設ペイン（D-34）の置き場は裁量。
- `src/shared/types.ts` — `Bar`（volume 含む）。出来高は既に取得済みバーにある。

外部 ADR/spec は未作成。要件は上記ファイルと本 decisions に集約。P3 の UI-SPEC（`03-UI-SPEC.md`）の凡例・追加メニューの見た目基準を踏襲。
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Chart.tsx` の指標 reconcile effect（add/update/remove、`barsRef` 入力、setData 再描画）：サブペイン系列も同じパターンで管理。`paneIndex` を足すだけで価格ペイン→サブペインに拡張できる見込み。
- `bandPrimitive.ts`（BandPrimitive / `hexToRgba`）：BB の帯塗り実績。RSI の 70/30 ゾーン塗り（D-41）に流用候補。
- P3 のモジュール契約（`compute`/`params`/`outputs`）＋スキーマ駆動フォーム（D-25）：RSI/MACD/Volume を「モジュール登録だけ」で足せる土台。編集 UI も自動生成される。
- D-30 パレット自動割当：サブペイン各線の色にそのまま再利用（D-47）。
- `math.ts` の SMA/EMA 基盤：MACD の EMA・RSI の Wilder 平滑の実装ベース。

### Established Patterns
- lightweight-charts は React ラッパを使わず `useEffect` 内 DOM マウント。ペイン add/remove・crosshair 購読も同じ effect 管理下に置く。
- 計算は renderer（クライアント）側・API 非発生・キャッシュ済みバーから即時再計算（P1/P3 方針）。
- ダークテーマ・色は既存パレット（`#0B0E11` 系、ローソク #22C55E/#EF4444）に合わせる。

### Integration Points
- Chart：`indicators` 配列を購読 → オーバーレイ系列（価格ペイン）とサブペイン系列（paneIndex）を出力種別で振り分け add/update/remove。出来高は常設サブペイン（D-34）。
- 十字カーソル：`subscribeCrosshairMove` → 各ペイン凡例へ値配信（D-38/39/40）。
- レジストリ：RSI/MACD/Volume モジュールを追加（IND-01、チャートコード非改変が理想）。
- テスト（Vitest）：`math.ts` の全5指標に対する reference-value スイート（D-48/49/50）。

</code_context>

<specifics>
## Specific Ideas

- TradingView 風を UI 基準に継続：各ペイン左上の凡例に生値（D-38）、非ホバー時は最新値（D-40）、RSI 0-100 固定＋70/30 ゾーン塗り（D-41/45）、MACD 4色ヒスト＋ゼロ線（D-42/46）。
- コア価値「制限なく好きなだけ重ねる」をサブペインでも徹底：1インスタンス=1ペインで無制限に積める（D-33）、追加/削除は同じ「＋指標」＋凡例作法で一貫（D-35/37）。
- IND-01 の pluggable 契約を貫く：オーバーレイ/サブペインの別はメニューを分けず**出力種別で判定**（D-35）。P3 のスキーマ駆動 UI がそのまま RSI/MACD に効く。
- IND-09 は「TV の実値そのもの」を正解に据える（D-48）：lib 一致でなく TradingView 一致を最終基準にする厳格方針。

</specifics>

<deferred>
## Deferred Ideas

- サブペイン高さ・サブペイン指標セットのシリアライズ永続、複数チャートグリッドで各セル独立の指標/ペイン → **Phase 5**（LAYOUT-01/02/03/04）。P4 はメモリ内保持に留め、シリアライズ可能な形を意識。
- 複数チャート間の十字カーソル連動 → **Out of Scope（v1）/ v1.x**。P4 は単一チャート内の全ペイン同期のみ。
- 出来高移動平均オーバーレイ・指標プリセット/テンプレート → **v2**（IND2-01 / IND2-02）。
- ユーザー記述の指標スクリプト（Pine Script 相当） → Out of Scope。開発者がコードで指標モジュールを足す設計（IND-01）で足りる。

None deferred outside the roadmap — discussion stayed within phase scope.

</deferred>

---

*Phase: 4-Pane Indicators, Crosshair & Correct Math*
*Context gathered: 2026-07-19*
