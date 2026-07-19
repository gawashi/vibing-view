# Phase 2: Timeframes & Free-Tier Resilience - Context

**Gathered:** 2026-07-19
**Status:** Ready for planning

<domain>
## Phase Boundary

1つの銘柄を全時間軸（1m / 5m / 15m / 1h / D / W / M）で表示し、時間軸方向にパン/ズームして履歴を辿る。パンで未キャッシュ領域に入ったら不足サブレンジだけを取得する。FMP 無料枠で使えない足・エンドポイントを実行時に検知し、破綻せず「要上位プラン」/「レート制限」状態を足ごとに表示する。有料キーに切り替えると intraday がコード変更なしで有効化される（キー変更時に capability を再プローブ）。

このフェーズは P1 の背骨（`IDataProvider` 層＋単一区間カバレッジのキャッシュ層）の上に、実時間軸切替・ギャップ取得・無料枠デグレードを乗せる。指標（P3/P4）、レイアウト永続・ウォッチリスト（P5）は範囲外。新データプロバイダの追加・リアルタイム配信も範囲外。

**Covers:** CHART-02, CHART-03, DATA-04
</domain>

<decisions>
## Implementation Decisions

### 時間軸UIと切替挙動（CHART-02）
- **D-10:** 時間軸セレクタはボタン列を常時表示（1m / 5m / 15m / 1h / D / W / M を横一列）。TradingView 風に1クリックで切替。gated な足の状態表示（D-13）と同じ場所に同居する。
- **D-11:** 足を切り替えたときは常に最新にリセット（直近の一定本数を表示、`fitContent` 相当）。「中心時刻を保持」はしない。足ごとにデータのカバレッジが異なる問題を避けるため。
- **D-12:** 銘柄をロードしたときの既定足は常に日足(D)。日足は無料枠でも確実に取れ全履歴キャッシュ済みなので即表示できる。P1 の挙動（D-06/D-07 の起動時復元）をそのまま継承し、足自体の記録はしない。

### 無料枠の制限UX（DATA-04）
- **D-13:** gated な足（有料プラン必須 / レート制限中）のボタンはグレーアウト＋バッジ（鍵アイコン等）で表示し、ホバーで理由をツールチップ表示。**選択不可**にして切替そのものを弾く。
- **D-14:** 「要上位プラン」と「レート制限（当日枠切れ、明日には直る）」を**区別**し、別メッセージ/別バッジで見せる。ユーザーが「待てば直るのか課金が要るのか」を判断できるようにする。
- **D-15:** capability で gated な足は選択不可なので「空チャート」問題は起きない。ただし**表示中の足が途中でレート制限に達した**場合（例: 日足を見ていて当日枠を使い切る）はボタンを消せないので、キャッシュ済みバーを残したままバッジ/トースト通知で破綻を避ける。この扱いの最終形は planner 裁量。

### パン取得とW/M導出のAPI節約（CHART-03, CHART-02）
- **D-16:** パンで左端の未キャッシュ履歴に入ったら、不足サブレンジだけを自動取得（デバウンス付き）。全再取得はしない。CHART-03 SC2 の「不足分だけ取得」を満たす。
- **D-17:** 週足(W)・月足(M)は常にキャッシュ済み日足を集約して導出する。FMP の native W/M エンドポイントは叩かない（追加 FMP リクエストゼロ）。CHART-02 の「週・月は FMP が返さない場合は日足から導出」を、常時導出として単純化。API 節約最優先方針に直結。
- **D-18:** intraday（1m/5m/15m/1h）の初回取得は直近の必要分だけ。日足の「全履歴一括」(D-08) とは別戦略で、さかのぼりは D-16 のパン取得に任せる。無料枠でのレート制限リスクを抑える。

### 無料枠の検知方法（DATA-04）
- **D-19:** 足が gated かどうかは FMP レスポンス（403 / エラー形 payload、HTTP200 でエラーメッセージのケース含む）から自動検知し、結果を capability としてキャッシュする。ユーザーにプラン申告はさせない。有料キーへ切替えるとレスポンスが変わり自然に有効化される（SC4）。
- **D-20:** レート制限（日次バジェット枯渇）は FMP のエラー反応（429 / レート制限メッセージ）で判定する。既知の無料枠上限をローカルカウントする方式は取らない（上限値が変わるとずれるため、実際のレスポンスを真実源にする）。
- **D-21:** capability 再プローブはキー変更時にキャッシュを無効化 → 各足を**初めて要求したときに遅延プローブ**して再キャッシュ。キー入力の瞬間に全 intraday 足を一斉プローブする無駄打ちはしない。

### Claude's Discretion
- カバレッジモデル: 単一区間 `[oldest, newest]`（D-09）を P2 でも維持できる — パンは既存区間と**連続する**サブレンジを左へ拡張する限り穴が空かない。穴あき対応の多区間モデルは P2 では不要（planner が連続性を担保する実装を選ぶ）。W/M は導出なので coverage は日足のものを使う。
- FMP の intraday エンドポイント選定・レンジページングの具体形、レート制限/gated を判定する具体的なレスポンス条件（ステータス/エラーメッセージ文字列）。
- D-18 の「直近の必要分」の具体量（足ごとの初期取得スパン）。
- gated/レート制限の capability キャッシュの保管方式（インメモリ / userData JSON / DB のいずれか）と TTL、キー変更時の無効化フック。
- W/M 集約の実装場所（provider 手前の派生層 / cache 層 / renderer）と、週・月境界の切り方（timezone 扱いは date-fns-tz / Luxon）。
- 時間軸ボタン列・gated バッジ・ツールチップ・レート制限トーストの具体的な見た目（P1 のダークテーマ・shadcn/ui コンポーネントに合わせる）。
- パン自動取得のデバウンス閾値・先読み量。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### プロジェクト定義・要件
- `.claude/CLAUDE.md` — 技術スタック確定と制約（Electron 43 / React 19 / lightweight-charts 5.2 / better-sqlite3 12 / drizzle-orm 0.45 / TanStack Query / Zustand / zod / date-fns-tz|Luxon）。特に **Stack Patterns by Variant**（`IDataProvider` 抽象・SQLite を「取得済みか」の真実源に・intraday が tier-gated なとき "no more requests today" 状態を足ごとに出して破綻させない）が P2 の DATA-04 に直結。
- `.planning/REQUIREMENTS.md` — CHART-02 / CHART-03 / DATA-04 の原文と Out of Scope（リアルタイム配信・日本株は範囲外）。
- `.planning/ROADMAP.md` §Phase 2 — ゴール・成功基準4項目（全足切替＋W/M日足導出 / パンで不足分だけ取得 / gated・レート制限を足ごとに表示 / 有料キーでコード変更なし有効化）。

### 前フェーズの決定（この上に乗る）
- `.planning/phases/01-core-pipeline-slice/01-CONTEXT.md` — 特に **D-08**（日足は全履歴一括、以降再取得なし）・**D-09**（単一区間カバレッジ `[oldest, newest]`、パン時ギャップ取得の土台）・**D-06/D-07**（起動時の最後の銘柄復元と AAPL フォールバック）を P2 は継承・拡張する。

### 実装が触れる既存コード（P1 成果物）
- `src/shared/types.ts` — `Timeframe` は現状 `'1d'` のみ。P2 で `'1m' | '5m' | '15m' | '1h' | '1d' | '1w' | '1M'`（等）へ拡張する起点。`DateRange` 型も既存。
- `src/main/providers/IDataProvider.ts` / `FmpProvider.ts` — `getOHLCV(symbol, timeframe, range)` は現状 timeframe/range を無視し日足 EOD full 固定。P2 で timeframe 別エンドポイント＋range 対応にする seam。`fmp.schema.ts` の zod 検証もエンドポイント追加に合わせて拡張。
- `src/main/cache/CacheService.ts` — `covers()` と read-through。P2 でギャップ取得（不足サブレンジのみ fetch）と W/M 導出をここ（または近傍の派生層）に載せる。
- `src/main/db/barStore.ts` / `schema.ts` — `bars` / `coverage` テーブルと `coverageFromBars` / `upsertBarsAndCoverage`。timeframe をキーに含む構造は既にあるので intraday/W/M もそのまま乗る。
- `src/renderer/components/Chart.tsx` — lightweight-charts のマウント・`api.ohlcv.get(symbol, '1d', undefined)` 固定・`fitContent`。P2 で時間軸選択・パンイベント購読（`timeScale().subscribeVisibleLogicalRangeChange` 等）・gated 状態表示を追加。
- `src/shared/ipc.ts` / `src/main/ipc.ts` / `src/preload/index.ts` — 型付き IPC。capability 問い合わせ用チャンネル追加が要る可能性。

外部 ADR/spec は未作成。要件は上記ファイルと本 decisions に集約。

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `coverage` テーブル＋`coverageFromBars`（barStore.ts）: 単一区間カバレッジがそのままギャップ判定に使える。`covers()`（CacheService.ts）は「range が coverage に収まるか」を既に判定。
- `bars` 主キー `(symbol, timeframe, time)`: intraday・W/M も timeframe 違いで同居できる。`upsertBarsAndCoverage` の onConflict 済み upsert が重複取得に耐える。
- TanStack Query の `qk.ohlcv(symbol)`（Chart.tsx）: timeframe をキーに含める形へ拡張すれば足切替でクエリが分離される。P1 では key-set 時に invalidate 済み。

### Established Patterns
- read-through キャッシュ: cache hit → ネットワーク非発生、miss → provider fetch → upsert → serve（CacheService.ts）。P2 はこの中に「不足サブレンジだけ fetch」を差し込む。
- main で FMP 呼び出し・zod 検証、renderer は IPC で結果のみ受領（キー非露出）。gated/レート制限の判定も main 側で行い、結果（capability・状態）だけ renderer に返す。
- FMP は `/stable` サーフェス、newest-first を昇順ソートして返す（FmpProvider.ts）。intraday エンドポイントも同様の正規化が要る。

### Integration Points
- provider: timeframe 別エンドポイント（intraday / EOD）と range パラメータ、gated/レート制限レスポンスの検知。
- cache/派生層: ギャップ取得の範囲計算、W/M の日足からの集約導出、capability キャッシュ。
- IPC: capability 状態（足ごとの available / requires-higher-plan / rate-limited）を renderer へ渡すチャンネル。
- renderer: 時間軸ボタン列、gated バッジ＋ツールチップ、パン購読→不足範囲リクエスト、レート制限トースト。

</code_context>

<specifics>
## Specific Ideas

- API 節約が最優先という P1 からの方針が P2 の全決定を駆動: W/M は常に日足導出（追加リクエストゼロ, D-17）、intraday は直近だけ＋パンで遡る（D-18）、レート制限はローカルカウントより実レスポンス優先（D-20）、再プローブは遅延（D-21）。
- 無料枠の現実: intraday（特に 1m/5m）は無料枠で gated な可能性が高い。その場合ユーザーが見るのは「D が動き、W/M は日足導出で動き、intraday 足はグレーアウト＋"要上位プラン"バッジ」という状態。これで「破綻せず段階的にデグレード」を満たす。
- TradingView 風の1クリック足切替ボタン列（常時表示）を UI の基準にする。

</specifics>

<deferred>
## Deferred Ideas

- 指標オーバーレイ（移動平均・ボリンジャーバンド）と pluggable 指標システム → **Phase 3**。
- 出来高/RSI/MACD サブペイン・十字カーソル同期・TradingView 一致の計算 → **Phase 4**。
- レイアウトグリッド・名前付きレイアウト保存/自動復元・ウォッチリスト → **Phase 5**。
- 穴あき（非連続）カバレッジの多区間モデル: P2 は連続拡張前提で単一区間を維持。ジャンプ的なレンジ取得が必要になったら将来対応。
- FMP native の W/M エンドポイント利用: 現状は日足導出で足りる。より厳密な公式週足/月足が必要になったら再検討（v2 の 2つ目プロバイダ DATA2-01 とも関連）。

None deferred outside the roadmap — discussion stayed within phase scope.

</deferred>

---

*Phase: 2-Timeframes & Free-Tier Resilience*
*Context gathered: 2026-07-19*
