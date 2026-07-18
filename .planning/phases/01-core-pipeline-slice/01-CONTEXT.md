# Phase 1: Core Pipeline Slice - Context

**Gathered:** 2026-07-19
**Status:** Ready for planning

<domain>
## Phase Boundary

銘柄検索 → `IDataProvider` 抽象経由で FMP から取得 → ローカルに永続キャッシュ → 日足ローソク足を描画、という end-to-end の縦スライスを一本立てる。APIキーは main プロセスに安全に保管し、レンダラー/devtools に露出しない。ダークテーマで表示する。

このフェーズはパイプラインの背骨（データプロバイダ層＋キャッシュ層）を立ち上げるのが目的。時間軸切替・パン/ズーム（P2）、指標（P3/P4）、レイアウト永続・ウォッチリスト（P5）は範囲外。

**Covers:** DATA-01, DATA-02, DATA-03, DATA-05, CHART-01, CHART-05
</domain>

<decisions>
## Implementation Decisions

### 銘柄検索（DATA-01）
- **D-01:** 確定検索方式。Enter またはボタンで検索を確定させて FMP の symbol search を叩く。打鍵ごとのインクリメンタル検索はしない（API quota 消費を最小化）。
- **D-02:** 同一クエリの検索結果は短期キャッシュして再叩きしない。TTL/保管方式は planner 裁量（インメモリ/セッション程度で十分）。

### APIキー保管（DATA-05）
- **D-03:** キーは設定画面で入力。main プロセスで Electron `safeStorage`（OSキーチェーン連携）を使って暗号化し userData 配下に保管。
- **D-04:** キーはレンダラー state・devtools・UI可視なネットワーク呼び出しに一切露出させない。FMP 呼び出しは main プロセス内で行い、レンダラーは IPC で「結果」だけを受け取る。
- **D-05:** `safeStorage.isEncryptionAvailable()` が false の環境（OS暗号化非対応）では、明示的に警告を出す。無言で平文フォールバックしない。挙動の最終形は planner 裁量だが「安全側にデグレード」が方針。

### 起動時の初期表示（CHART-01）
- **D-06:** 前回アクティブだった銘柄を軽く記録して復元する。最後に見た銘柄のみを electron-store（または userData 配下の小さな JSON）に保存し、起動時に読み込む。P5 のレイアウト永続とは別物の、最小の記録。
- **D-07:** 記録が無い初回起動時は既定銘柄（例: AAPL 日足）にフォールバックして描画する。常に画面に何か出る状態を保つ。

### 日足の取得レンジ（DATA-03）
- **D-08:** FMP 日足 EOD は1リクエストで全履歴が返るため、初回に全利用可能履歴を一括取得してキャッシュする。以降は同一範囲を再取得しない。
- **D-09:** キャッシュのカバレッジ判定は timeframe ごとに `[最古, 最新]` の単純区間で持つ。表示要求がこの区間に収まればネットワーク非発生。不足範囲だけを取得する設計の土台（P2 のパン時ギャップ取得がこの区間モデルの上に乗る）。

### Claude's Discretion
- ダークテーマの具体パレット（lightweight-charts のダークプリセット＋アプリ chrome のダーク化）。
- 検索結果キャッシュの TTL / 保管方式（インメモリ想定）。
- IPC のチャンネル設計・スキーマ、drizzle のテーブル定義の具体形。
- 既定フォールバック銘柄の最終選定（AAPL を想定）。
- FMP レスポンスの zod 検証スキーマの具体形（不正レスポンスをキャッシュに書かないことだけ必須）。
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### プロジェクト定義・要件
- `.claude/CLAUDE.md` — 技術スタック確定（Electron 43 / React 19 / lightweight-charts 5.2 / better-sqlite3 12 / drizzle-orm 0.45 / TanStack Query / Zustand / electron-vite / electron-builder / zod / date-fns-tz|Luxon）、バージョン互換制約、What NOT to Use、`DataSourceAdapter` 抽象方針。
- `.planning/REQUIREMENTS.md` — DATA-01/02/03/05・CHART-01/05 の原文と Out of Scope。
- `.planning/ROADMAP.md` §Phase 1 — ゴール・成功基準5項目。

### 特に効く制約（CLAUDE.md 内）
- Version Compatibility 表 — `vite@^7` にピン（Vite 8 は electron-vite@5 未対応）、`better-sqlite3` は Electron ABI 向けに再ビルド必須（electron-builder / @electron/rebuild）。
- Stack Patterns by Variant — `IDataProvider`（`getOHLCV(symbol, timeframe, range)` / `searchSymbols(query)`）を今フェーズで定義し FMP を唯一の実装にする。SQLite キャッシュを「取得済みか」の真実源にし、ヒット時はネットワーク非発生。
- Persistence 使い分け — OHLCV は SQLite、キー/最後の銘柄などの小設定は userData 配下の JSON/electron-store（SQLite に入れない）。

外部 ADR/spec は未作成。要件は上記3ファイルと本 decisions に集約。
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- なし。グリーンフィールド（`src/` も `package.json` も未作成）。本フェーズがプロジェクトの初期骨格を敷く。

### Established Patterns
- 未確立。CLAUDE.md の Recommended Stack と Stack Patterns がこのフェーズで最初に具現化されるパターンになる（main/preload/renderer 分離、IDataProvider 層、read-through キャッシュ）。

### Integration Points
- main プロセス: FMP 呼び出し・safeStorage・better-sqlite3（drizzle）・キャッシュ読み書き。
- preload: 型付き IPC ブリッジ（キーは渡さない、結果のみ）。
- renderer: React + lightweight-charts の描画、Zustand（activeSymbol）、TanStack Query（IPC 越しの fetch を read-through キャッシュ前段に）。
</code_context>

<specifics>
## Specific Ideas

- TradingView 無料枠で邪魔だったもの（指標上限・複数チャート制限・広告/ログイン・データ制限）が一切ない環境を作るのがコア価値。P1 はその背骨で、UX の作り込みより「パイプラインとキャッシュが正しく回ること」を優先する。
- API 節約が最優先という方針が、検索（確定検索）・取得レンジ（全履歴一括で以降再取得なし）両方の決定を駆動している。
</specifics>

<deferred>
## Deferred Ideas

- 時間軸切替（1m/5m/15m/1h/D/W/M）・パン/ズーム・無料枠デグレード → **Phase 2**（DATA-04, CHART-02, CHART-03）。D-09 の区間カバレッジモデルがパン時ギャップ取得の土台。
- 移動平均・ボリンジャーバンドのオーバーレイと pluggable 指標システム → **Phase 3**。
- 出来高/RSI/MACD サブペイン・十字カーソル同期・TradingView 一致の計算 → **Phase 4**。
- レイアウトグリッド・名前付きレイアウト保存/自動復元・ウォッチリスト → **Phase 5**。D-06 の「前回銘柄の記録」は P1 限定の最小実装で、P5 の本格的な永続モデルに置き換わる想定。

None deferred outside the roadmap — discussion stayed within phase scope.
</deferred>

---

*Phase: 1-Core Pipeline Slice*
*Context gathered: 2026-07-19*
