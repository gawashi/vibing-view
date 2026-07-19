# Phase 5: Layouts, Persistence & Watchlist - Context

**Gathered:** 2026-07-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 4 までの単一チャート（価格ペイン＋サブペイン＋指標＋クロスヘア）を、**複数チャートのグリッド（1x1 / 2x1 / 2x2）**へ拡張し、各セルを**独立**（銘柄・時間軸・指標セット）にする。ワークスペース全体を**一元的なシリアライズ可能設定モデル**（銘柄・時間軸・指標インスタンス＋パラメータ・グリッド配置）で表し、そこから描画する。**名前付きレイアウトの保存/リネーム/削除/切替**＋**起動時の自動復元**、そして**永続ウォッチリスト**（追加/削除/並べ替え、クリックでアクティブセルへロード）を足す。ここが v1 ゴールライン＝ワークスペースが「自分のもの」になり、次回起動で元通りに戻る。

**このフェーズの範囲:** 複数チャートグリッド（LAYOUT-01）、一元シリアライズ設定モデル（LAYOUT-02）、名前付きレイアウト保存/復元（LAYOUT-03）、起動時自動復元（LAYOUT-04）、ウォッチリスト管理＋永続（WATCH-01）、ウォッチリストからアクティブチャートへロード（WATCH-02）。

**範囲外:** 3x3 以上・可変グリッド、ペインのドラッグリサイズ永続（v1.x）、複数ウォッチリスト（v2 WATCH2-01）、指標プリセット/テンプレート（v2 IND2-02）、複数チャート間のクロスヘア連動（Out of Scope / v1.x）、新データプロバイダ・リアルタイム配信。

**Covers:** LAYOUT-01, LAYOUT-02, LAYOUT-03, LAYOUT-04, WATCH-01, WATCH-02
</domain>

<decisions>
## Implementation Decisions

### グリッド操作とアクティブセル（LAYOUT-01, WATCH-02）
- **D-51:** グリッドは **v1 で 2x2 上限**（1x1 / 2x1 / 2x2 の3プリセット）。ロードマップ SC1・要件 LAYOUT-01 に一致。ただし**設定モデルは汎用**に持つ（例: `{rows, cols}` またはプリセット指定＋cells 配列）ので、3x3 やカスタムを足すのは後日プリセット追加だけで済む。3x3 以上・可変グリッドは Deferred（v1.x）。
- **D-52:** グリッド配置の切替は**ヘッダーのアイコンボタン列**（1x1/2x1/2x2 のレイアウトアイコンを並べ 1 クリック切替）。TradingView のレイアウトセレクタに近く、既存の toggle-group 部品を流用。名前付きレイアウトの保存/切替とは**別 UI**（D-56 のレイアウトメニューと役割分担: 形状切替はアイコン列、名前付き管理はメニュー）。
- **D-53:** アクティブセルは**クリックでフォーカス（発光する枠でハイライト）**。検索結果・ウォッチリストからの銘柄ロードは**アクティブセル**に入る。TradingView 風。
- **D-54:** グリッドを縮小したとき（例 2x2→1x1）に見えなくなるセルの構成（銘柄・時間軸・指標）は**モデルに保持**し、再拡大で復活。誤操作で構成を失わない。→ 設定モデルはフラットに「セル配列（最大4）＋現在のグリッド形状」を持ち、形状は表示セル数だけを決める形が自然（実装は planner 裁量）。
- **D-55:** グリッドを拡張したとき（例 1x1→2x2）に新しく現れるセルの初期状態は**アクティブセルの複製**（銘柄・時間軸・指標セットをコピー）。「同じ銘柄を複数時間軸で並べる（AAPL を 1h/D/W/M）」用途に即移行できる。

### レイアウト保存 UX と自動復元（LAYOUT-03, LAYOUT-04）
- **D-56:** 名前付きレイアウトの**保存/名前を付けて保存/リネーム/削除/切替**は**ヘッダーのレイアウトメニュー（ドロップダウン）**に集約。1 カ所で分かりやすい。
- **D-57:** 起動時に自動復元するのは**直前セッションの作業状態**。名前付きレイアウトとは**別枠**で「最後の状態（current/last session）」を**常に自動保存**し、閉じて開くとそのまま戻る。これが LAYOUT-04「直近/既定のレイアウトが自動復元」の実装形。
- **D-58:** 名前付きレイアウトを切り替えるとき、切替前の現在状態は**「最後の状態」として自動保存**され失われない（確認ダイアログ不要）。名前付きレイアウトは常にクリーンなスナップショットに保たれる。
- **D-59:** 初回起動（保存レイアウトも「最後の状態」も無い）の既定は **1x1 ＋ AAPL**。既存 D-06/07（起動時 `lastSymbol` 復元＋AAPL フォールバック、`settings.json`）をグリッドへ拡張。

### 設定モデルの粒度とスコープ（LAYOUT-02, WATCH-01）
- **D-60:** 1 セルの永続対象は**銘柄・時間軸・指標インスタンス（種別・パラメータ・色・可視）**。**サブペインの高さ（D-32）は v1 では永続に含めない**（復元時は既定高さに戻る、高さ永続は v1.x 繰延）。LAYOUT-02 の要件（銘柄・時間軸・指標＋パラメータ・グリッド配置）を過不足なく満たす最小形。
- **D-61:** D-31（指標セットは全チャート共通・メモリ内保持）は **P5 で上書き**: 指標セットは**セル単位に独立**して持ち、レイアウトに含めてディスク永続する。現行 `store.ts` の単一グローバル `indicators` 配列を**セル配列（各セルが自分の indicators を持つ）**へ再構成する。`store.ts` の `nextId` は既に JSON 安定 id 用に用意済み（インスタンス id はシリアライズしても衝突しない）。
- **D-62:** ウォッチリストは**単一・グローバル**（全レイアウト共通、レイアウトに紐づかない）。レイアウトを切り替えてもウォッチリストは変わらず、セッションをまたいで永続。複数ウォッチリストは v2（WATCH2-01）。

### ウォッチリスト UX（WATCH-01, WATCH-02）
- **D-63:** ウォッチリストは**左サイドバー（折りたたみ可）**に常設。ボタンで開閉。一覧性が高く、クリックで即アクティブセルへロード（D-53/WATCH-02）。
- **D-64:** 各行は**シンボル＋銘柄名**を表示し、**キャッシュ済みバーがあればその最新 close も表示**（無ければ空欄）。**追加フェッチはしない**（API 節約最優先）。ライブ価格・変化率の常時取得は v1 では作らない（無料枠圧迫を避ける）。
- **D-65:** ウォッチリストへの追加は**検索結果の各行の「星/＋」ボタン**。「検索結果クリック＝アクティブセルへロード」とは別アクションにして直感的に。
- **D-66:** 並べ替え（WATCH-01）は**ドラッグ＆ドロップ**。実装手段（HTML5 DnD 手書き / 軽量ライブラリ）は planner 裁量だが、CLAUDE.md 方針で新規依存は最小に（まず HTML5 DnD 手書きを検討）。

### 永続の器（確定 — planner 裁量ではない）
- **D-67:** レイアウト（「最後の状態」＋名前付きレイアウト群）とウォッチリストは **`userData` 配下の小さな JSON** に保存する（既存 `jsonStore.ts` / `settings.ts` パターンの踏襲）。**SQLite は OHLCV キャッシュ専用**（STACK.md の永続分離方針）。IPC は既存 `settings:getLastSymbol/setLastSymbol` と同じ型付き IPC パターンで layout / watchlist 用チャンネルを足す。ファイルを 1 本にまとめるか分けるか（例 `layouts.json` / `watchlist.json`）は planner 裁量。

### Claude's Discretion
- 設定モデルの内部表現の具体形（セル配列＋グリッド形状の型、`store.ts` のグローバル `indicators` からセル単位への再構成の実装、既存 `activeSymbol`/`crosshair`/timeframe state の再配置）。ユーザー可視の挙動は D-51〜D-62 で固定。
- 複数チャートを 1 ページ内にどう並べるか（CSS grid でセルを配置、各セルに独立した `Chart` インスタンスをマウント）。`Chart.tsx` は既に `symbol`/`timeframe` を props で受け取るので複数マウントの土台はある。lightweight-charts インスタンスをセル数分持つときのリソース/破棄の扱い。
- ドラッグ＆ドロップ並べ替え（D-66）の実装手段と、左サイドバーの幅・開閉の既定・アニメーション。
- 名前付きレイアウトの命名 UI（インライン入力 / ダイアログ）、同名保存時の扱い（上書き確認 / 連番）、レイアウト一覧の並び。
- 「最後の状態」の自動保存タイミング（変更のたび debounce / 終了時 / 両方）と、シリアライズのスキーマバージョニング（将来のモデル変更に備えるか）。
- クロスヘア state（`store.ts` の `crosshair`）を複数セルでどう分離するか（P4 は単一チャート前提。複数セルでは各セルが自分のクロスヘア読み取りを持つ必要。複数チャート間の連動は Out of Scope なので**セル内で完結**させる）。
- レイアウト復元時の各セルの初回データ取得順序・並列度（キャッシュ優先で既取得分は再フェッチしないのが前提、D-67／P1 read-through）。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### プロジェクト定義・要件
- `.claude/CLAUDE.md` — 技術スタック確定と制約。特に**永続の分離方針**（SQLite = OHLCV キャッシュ専用の大規模・表形式データ / **レイアウト・ウォッチリストは `userData` 配下の小さな JSON**＝`electron-store` か手書き JSON、両者を混ぜない）、lightweight-charts 5.2 を React 非依存で `useEffect` 内 DOM マウント（複数セル＝複数インスタンス）、Zustand をウィジェット横断 UI 状態に使う指針が P5 に直結。
- `.planning/REQUIREMENTS.md` — LAYOUT-01/02/03/04・WATCH-01/02 の原文。Out of Scope（複数ウォッチリスト＝v2 WATCH2-01、ペインのドラッグリサイズ＝v2 LAYOUT2-01、複数チャート間クロスヘア連動＝v1 範囲外）。
- `.planning/ROADMAP.md` §Phase 5 — ゴール・成功基準4項目（グリッド 1x1/2x1/2x2 各セル独立 / 一元シリアライズ設定モデル / 名前付き保存＋起動時自動復元 / ウォッチリスト永続＋クリックでロード）。

### 前フェーズの決定（この上に乗る／一部を上書き）
- `.planning/phases/04-pane-indicators-crosshair-correct-math/04-CONTEXT.md` — サブペイン指標・クロスヘア・指標モジュール契約。**D-32（サブペイン高さは P4 メモリ内のみ、永続は P5）**→ P5 では **D-60 で永続に含めない**と確定。クロスヘア state はセル内で完結させる（P4 は単一チャート前提）。
- `.planning/phases/03-indicator-engine-overlays/03-CONTEXT.md` — pluggable レジストリ、モジュール契約（`compute`/`params`/`outputs`）、**D-31（指標セット全チャート共通・メモリ内保持）**→ P5 では **D-61 でセル独立＋ディスク永続へ上書き**。指標インスタンス型（種別・パラメータ・色・可視）がそのままシリアライズ対象。
- `.planning/phases/02-timeframes-free-tier-resilience/02-CONTEXT.md` — 時間軸切替・W/M 日足導出・gated/レート制限 UX・pan/zoom gap-fetch。各セルが独立に時間軸を持つ（D-60）。gated/レート制限はセルごとに効く。
- `.planning/phases/01-core-pipeline-slice/01-CONTEXT.md` — read-through キャッシュ・main/renderer 分離・API 節約最優先。**D-06/07（起動時 `lastSymbol` 復元＋AAPL フォールバック）**→ P5 では **D-57/59 でフルレイアウト自動復元へ拡張**。レイアウト復元の複数銘柄取得もキャッシュ優先で既取得分は再フェッチしない。

### 実装が触れる既存コード（P1〜P4 成果物）
- `src/renderer/store.ts` — 現状は**単一グローバル**の Zustand（`activeSymbol` / `indicators` 配列 / `crosshair`）。P5 で**セル配列（各セルが symbol・timeframe・indicators を持つ）＋アクティブセル id ＋ウォッチリスト**へ再構成する中心。`nextId` は JSON 安定 id 用に用意済み。`PALETTE`/`addIndicator` の色割当ロジックはセル単位でも再利用。
- `src/renderer/App.tsx` — 現状は単一 `Chart` ＋ヘッダー＋TimeframeRow＋AddIndicatorMenu。timeframe は App ローカル state（D-12）。起動時 `api.settings.getLastSymbol()` 復元（D-06/07）がここにある → **フルレイアウト復元へ差し替え**。グリッド host（CSS grid でセルを配置）とレイアウトメニュー・レイアウトアイコン列・左サイドバーの差し込み先。
- `src/renderer/components/Chart.tsx` — 既に `symbol`/`timeframe` を props で受け取り `useEffect` 内でチャート生成。**複数セル＝複数マウント**の土台はある。インスタンス破棄・リソース、クロスヘア購読をセルごとに閉じる必要。
- `src/renderer/components/SearchResults.tsx` / `SearchBar.tsx` — 検索結果に「星/＋」（ウォッチ追加、D-65）を足す先。「クリック＝アクティブセルへロード」との役割分担。
- `src/main/settings.ts` / `src/main/jsonStore.ts` — `userData` 配下 JSON 永続の**手本パターン**（`readJsonFile` ＋ `writeFileSync`）。layout / watchlist の永続をここに倣って足す（D-67）。
- `src/shared/ipc.ts` / `src/main/ipc.ts` / `src/preload/index.ts` — 型付き IPC。`settings:getLastSymbol/setLastSymbol` と同形で layout（保存/一覧/削除/最後の状態）・watchlist（取得/保存）チャンネルを追加。
- `src/renderer/components/ui/*` — shadcn/ui 部品（button/dialog/toggle-group/tooltip/input/sonner）。レイアウトメニュー・アイコン列・サイドバー・並べ替え UI の部品源。新規依存は最小に。
- `src/shared/types.ts` — `Timeframe`/`Bar`/`SymbolResult`。レイアウト設定モデル型・セル型・ウォッチリスト項目型を足す起点。

外部 ADR/spec は未作成。要件は上記ファイルと本 decisions に集約。P3/P4 の UI-SPEC（凡例・追加メニュー・ダークテーマ配色）を踏襲。
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Chart.tsx`（`symbol`/`timeframe` props ＋ create-once インスタンス）: そのまま複数セルにマウントできる。グリッドは CSS grid でセルを並べ、各セルに `Chart` を置く。
- `store.ts` の `indicators` CRUD ＋ `PALETTE` 色割当（D-30）: セル単位に切り出して各セルの指標管理へ再利用。`nextId`（module-level）で JSON 安定 id 済み。
- `settings.ts` ＋ `jsonStore.ts`（`readJsonFile`/`writeFileSync`, {} フォールバック）: レイアウト・ウォッチリスト JSON 永続の完成した手本（D-67）。
- 型付き IPC（`settings:*` チャンネル）: layout/watchlist チャンネルを同形で追加。
- P1 の read-through キャッシュ: レイアウト復元で複数銘柄を開いても既取得分は再フェッチしない（API 節約）。
- shadcn/ui 部品一式: サイドバー・ドロップダウン・アイコン列・並べ替え UI をほぼ既存部品で組める。

### Established Patterns
- lightweight-charts は React ラッパを使わず `useEffect` 内 DOM マウント。複数セルでもこの流儀を各セルで踏襲し、破棄をセルごとに閉じる。
- 永続は main プロセスで `userData` JSON、renderer は IPC 経由（キー・パス非露出）。SQLite は OHLCV 専用。
- 計算は renderer（クライアント）側・API 非発生。指標セットはセルごとに保持しても計算はキャッシュ済みバーから即時（P3/P4 方針）。
- ダークテーマ・色は既存パレット（`#0B0E11` 系、ローソク #22C55E/#EF4444、指標 `PALETTE`）に合わせる。

### Integration Points
- store（Zustand）: 単一グローバルからセル配列＋アクティブセル id ＋グローバルウォッチリストへ再構成（D-61）。CRUD はセル単位。
- App: グリッド host、レイアウトアイコン列（D-52）、レイアウトメニュー（D-56）、左サイドバー（D-63）の統合。起動時復元を `lastSymbol` からフルレイアウトへ差し替え（D-57/59）。
- main 永続層: layout（最後の状態＋名前付き群）・watchlist の JSON 保存/読込（D-67）、型付き IPC チャンネル追加。
- 検索: 検索結果に星/＋（ウォッチ追加、D-65）、クリックはアクティブセルへロード（D-53）。

</code_context>

<specifics>
## Specific Ideas

- TradingView 風を UI 基準に継続: ヘッダーのレイアウトアイコン列で 1 クリック形状切替（D-52）、クリックでアクティブセル＋発光枠（D-53）、左サイドバーの常設ウォッチリスト（D-63）。
- コア価値「制限なく好きなだけ並べる」を v1 ゴールで体現: セル独立の銘柄・時間軸・指標（D-60/61）、拡張時はアクティブセル複製で同一銘柄マルチ時間軸に即移行（D-55）。ただし v1 のグリッドは 2x2 上限、モデルは汎用で将来拡張を塞がない（D-51）。
- 「自分のワークスペースが次回そのまま戻る」を最優先の体験に: 直前セッションを常に自動保存し起動時復元、切替でも失わない（D-57/58）。
- API 節約方針の継続: ウォッチリスト行はキャッシュ済み終値のみ、追加フェッチなし（D-64）。レイアウト復元もキャッシュ優先。

</specifics>

<deferred>
## Deferred Ideas

- 3x3 以上・可変（行×列自由）グリッド → **v1.x**。v1 は 2x2 上限だがモデルは汎用に持ちプリセット追加で拡張可（D-51）。
- サブペイン高さ・ペイン配置のドラッグリサイズ永続 → **v1.x / v2（LAYOUT2-01）**。v1 は復元時に既定高さ（D-60）。
- 複数ウォッチリスト → **v2（WATCH2-01）**。v1 は単一グローバル（D-62）。
- ウォッチリストのライブ価格・変化率の常時取得 → 見送り（API 節約、D-64）。将来 FMP 有料枠・軽量な一括見積もりエンドポイントが使えるなら再検討。
- 指標プリセット/テンプレート（"いつもの構成"をまとめて適用） → **v2（IND2-02）**。
- 複数チャート間のクロスヘア連動 → **Out of Scope（v1）/ v1.x**。v1 はセル内で完結。

None deferred outside the roadmap — discussion stayed within phase scope.

</deferred>

---

*Phase: 5-Layouts, Persistence & Watchlist*
*Context gathered: 2026-07-20*
