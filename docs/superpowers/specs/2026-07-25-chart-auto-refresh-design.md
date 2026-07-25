# チャート自動更新（一定間隔リロード）設計

## 目的

表示中チャートを一定間隔（1分固定）で自動的にリロードする。核は既存の手動一括
リロード（ヘッダーの RefreshCw ボタン → `handleReload`）を **タイマーで叩く**こと。
新しい FMP フェッチ経路は作らない（既存の reload を再利用し、結果を他ウィンドウへ
配るだけ）。あわせて手動/自動の排他、クローズ時停止、非表示時停止、マルチウィンドウ
反映、状態表示を備える。

## 決定事項

- **間隔**: 1分固定。将来可変化する余地は残すが、v1 は固定 + ON/OFF トグル。
- **クローズ時**: 市場クローズ中（`marketStatus.isOpen === false`）は OHLCV / quote を
  取得せず自動停止する。
- **永続化**: トグル状態は `settings.json` に保存し、再起動後も維持する
  （`sidebarOpen` と同じ扱い）。
- **非表示時の一時停止**: ウィンドウ非表示（`document.hidden`）の間は tick をスキップし、
  再表示時に 1 回だけ更新する（API 節約最優先に合わせる）。
- **マルチウィンドウ**: タイマー（スケジューラ）はメインウィンドウに 1 つだけ置き、
  取得結果を他ウィンドウ（enlarge した ChartWindow 等）へブロードキャストして反映する。
- **単一 in-flight ガード**: 手動リロードと自動 tick の競合を、同期フラグ（`useRef`）で
  確実に排他する（`reloading` state だけに頼らない）。
- **状態表示**: 最終更新時刻／失敗／クローズ中一時停止をメインウィンドウのヘッダーに表示する。

## スコープ外（YAGNI）

- 可変インターバル UI / プリセット選択。
- タイムフレームごとの個別更新間隔。
- NY 取引時間に紐づくスケジューラ（クローズ中コストを厳密ゼロにする仕組み）。
- 日足フェッチのコスト最適化（既存課題・別 issue #17 で扱う）。
- ChartWindow（enlarge 窓）側での状態表示（最終更新インジケータはメインウィンドウのみ）。

## アーキテクチャ

### 1. トグルとその永続化

- `src/main/settings.ts` に `getAutoRefresh(): boolean`（既定 `false`）/
  `setAutoRefresh(on: boolean)` を追加。既存 `sidebarOpen` と同じ read/write パターン。
- preload / IPC（`src/preload/index.ts`, `src/main/ipc.ts`, `src/shared/ipc.ts`,
  `src/renderer/api.ts`）に `settings.getAutoRefresh` / `settings.setAutoRefresh` を追加。
  既存の `setSidebarOpen` 等と同じ配線をなぞる。

### 2. `reload({ source })` リファクタ（App.tsx）

現状の `handleReload` を `reload(opts: { source: 'manual' | 'auto' })` に置き換える。

- **同期 in-flight ガード**: `useRef<boolean>` の `inFlight` を先頭でチェック。走行中なら
  即 return。`true` にして `finally` で戻す。`reloading` state は表示専用（スピナー）で、
  排他は ref が担う（state 反映のラグでの二重実行を防ぐ）。
- **順序変更**: market status を最初に取得 → `setQueryData(marketStatus)`。
  - `source === 'auto'` かつ `isOpen === false` → **status のみで打ち切り**
    （OHLCV / quote は取らない）。インジケータを「クローズ中で一時停止」に更新。
  - それ以外（手動、または auto かつ open）→ 従来どおり OHLCV refresh
    （`Promise.allSettled`）→ capability 再評価 → open なら quote 取得。
  - 手動リロードは従来どおり isOpen に関わらず OHLCV を更新する（クローズ後の確定日足取得）。
- **完了時**: 最終更新インジケータを更新し、取得結果を他ウィンドウへブロードキャスト（§5）。

### 3. トグル UI（App.tsx ヘッダー）

- 既存リロードボタンの隣に **自動更新トグルボタン**を追加。
  - ON/OFF をアイコンで表現（例: `Timer` / `TimerOff`、lucide-react）。
  - クリックで state をトグルし、`api.settings.setAutoRefresh(next)` を呼ぶ。
- 初期値は起動時に `api.settings.getAutoRefresh()` から復元。
- 隣接して **最終更新インジケータ**（§6）を表示。

### 4. タイマー本体（App.tsx）

- App はメインウィンドウでのみマウントされる（ChartWindow は別コンポーネント）ため、
  タイマーは自然にメインウィンドウ 1 つだけに存在する（＝集中スケジューラ）。
- トグル ON のとき `useEffect` 内で `setInterval(60_000)`。OFF / アンマウントで `clearInterval`。
- **ON にした瞬間に即 1 回** `reload({source:'auto'})` を実行し、以降は毎分。
- tick 冒頭で `document.hidden` なら skip（非表示中の API 消費を止める。interval は張ったまま）。
- `visibilitychange` で再表示を検知し、トグル ON なら即 1 回 tick（再開時 1 回更新）。
- React StrictMode の二重 mount は cleanup の `clearInterval` と in-flight ガードで吸収。

### 5. マルチウィンドウ集中スケジューラ

各レンダラ（メイン App / enlarge した ChartWindow）は **QueryClient が別インスタンス**で、
OHLCV/quote キャッシュを共有しない（workspace のみ IPC 同期）。そこでスケジューラを 1 つに
集約し、取得結果を配る。

- **スケジューラはメインウィンドウのみ**。ChartWindow はタイマーを持たない。
- reload 完了後（手動・自動どちらも）、メインウィンドウが取得済みデータをブロードキャスト:
  - 新 IPC `refresh:applied`。payload = `{ ohlcv: {symbol,timeframe,bars}[], quotes: {symbol,quote}[], marketStatus }`。
  - main は `workspaces:changed` と同じ規約で **送信元以外の全ウィンドウ**へ転送。
  - 受信側は薄いフック（`useRefreshSync`、App/ChartWindow 双方で使用）で各キーに
    `setQueryData`（`qk.ohlcv` / `qk.quote` / `qk.marketStatus`）。**追加の FMP 呼び出しは無し。**
- これにより enlarge 窓も 1 つのスケジューラで最新化され、ウィンドウ間の重複フェッチが起きない。
  副次的に「手動リロードが enlarge 窓へ伝播しない」既存の隙も同じ経路で解消する。

  > enlarge 窓が表示するセルはアクティブ workspace のグリッドセルなので、メインの
  > `refreshTargets` が算出する対象に既に含まれる（別途ターゲット算出は不要）。
  > payload に bars 配列を載せるためウィンドウ数に比例して IPC が増えるが、対象は
  > 少数（デスクトップアプリ）なので許容。
  > メインウィンドウを閉じるとスケジューラは失われるが、その時点でアプリ終了に向かうため許容。

### 6. 状態表示（インジケータ）

- メインウィンドウのヘッダーに、reload の結果を反映する小さな表示を置く:
  - 最終更新時刻（成功時に更新）、失敗（トーストに加えアイコン/色で明示）、
    「クローズ中で一時停止」。
- App ローカル state（`{ lastRefreshedAt, status: 'ok'|'failed'|'paused-closed' }`）で保持。
  ChartWindow には出さない（§スコープ外）。

## データフロー

```
tick (毎分, トグルON時, メインウィンドウ)
  └─ document.hidden? ── yes ─▶ skip
  └─ inFlight? ─────────── yes ─▶ skip
       │ no
       ▼
   reload({source:'auto'})
       │  market status 取得 → setQueryData(marketStatus)
       ├─ isOpen=false ─▶ 打ち切り・インジケータ「一時停止(クローズ)」
       └─ isOpen=true ─▶ OHLCV refresh → capability 再評価 → quote 取得
                          → インジケータ更新
                          → IPC refresh:applied で他ウィンドウへブロードキャスト
                                                   │
                          ChartWindow (useRefreshSync) ◀─┘ setQueryData（FMP 呼び出し無し）
```

手動リロード（RefreshCw ボタン）は `reload({source:'manual'})`。isOpen に関わらず OHLCV を
更新し、同じくブロードキャストする。自動停止（クローズ時打ち切り）は auto 経路のみ。

## エラーハンドリング

- 既存方針を踏襲: OHLCV は `Promise.allSettled`、失敗があればトースト＋インジケータを failed に。
  quote / market-status の失敗は握りつぶして OHLCV を止めない。
- tick 内の status 取得失敗は握りつぶし、そのtickは何もしない（次の分で再試行）。
- `refresh:applied` 受信側の適用失敗は握りつぶす（次回更新で回復）。

## テスト

- 純粋関数の新規追加は無し（`refreshTargets` / `quoteTargets` は既存テストで担保）。
- fake timer で薄い挙動を最小限カバー: (1) トグル ON/OFF の interval 生成・cleanup、
  (2) クローズ時 auto の打ち切り、(3) 手動と auto の in-flight 衝突で二重実行しないこと。
  非表示 pause・ブロードキャスト伝播は手動 UAT に委ねる。
