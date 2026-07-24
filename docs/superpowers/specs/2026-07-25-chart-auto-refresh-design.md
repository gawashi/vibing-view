# チャート自動更新（一定間隔リロード）設計

## 目的

表示中チャートを一定間隔（1分固定）で自動的にリロードする。既存の手動一括
リロード（ヘッダーの RefreshCw ボタン → `handleReload`）を **タイマーで叩くだけ**
とし、新しいフェッチ経路は作らない。

## 決定事項

- **間隔**: 1分固定。将来可変化する余地は残すが、v1 は固定 + ON/OFF トグル。
- **クローズ時**: 市場クローズ中（`marketStatus.isOpen === false`）は OHLCV / quote を
  取得せず自動停止する。
- **永続化**: トグル状態は `settings.json` に保存し、再起動後も維持する
  （`sidebarOpen` と同じ扱い）。

## スコープ外（YAGNI）

- 可変インターバル UI / プリセット選択。
- タイムフレームごとの個別更新間隔。
- ウィンドウ非表示時の一時停止。
- NY 取引時間に紐づくスケジューラ（クローズ中コストを厳密ゼロにする仕組み）。

## アーキテクチャ

### 1. トグルとその永続化

- `src/main/settings.ts` に `getAutoRefresh(): boolean`（既定 `false`）/
  `setAutoRefresh(on: boolean)` を追加。既存 `sidebarOpen` と同じ read/write パターン。
- preload / IPC（`src/preload/index.ts`, `src/main/ipc.ts`, `src/shared/ipc.ts`,
  `src/renderer/api.ts`）に `settings.getAutoRefresh` / `settings.setAutoRefresh` を追加。
  既存の `setSidebarOpen` 等と同じ配線をなぞる。

### 2. UI（App.tsx ヘッダー）

- 既存リロードボタンの隣に **自動更新トグルボタン**を追加。
  - ON/OFF をアイコンで表現（例: `Timer` / `TimerOff`、lucide-react）。
  - ツールチップに間隔（"Auto-refresh every 1 min" / "Auto-refresh off"）を表示。
  - クリックで state をトグルし、`api.settings.setAutoRefresh(next)` を呼ぶ。
- 初期値は起動時に `api.settings.getAutoRefresh()` から復元。

### 3. タイマー本体（App.tsx）

- トグル ON のとき `useEffect` 内で `setInterval(60_000)` を張る。OFF / アンマウントで
  `clearInterval`。
- **ON にした瞬間に即 1 回** tick を実行し、以降は毎分。
- 前回のリロードが走行中（`reloading === true`）の tick はスキップ（多重実行防止）。

### 4. クローズ時の自動停止

- `handleReload` を軽く整理し、**market status を先に取得 → 判定してから**
  OHLCV / quote を取る順序にする（現状は OHLCV → status → quote）。
  - 手動リロードの挙動は実質不変（status は元々毎回取得している）。
- 自動 tick は `isOpen === false` の場合、**market status 1 回だけで打ち切り**
  （OHLCV / quote は取得しない）。これで再オープンは自動検知できる。
- クローズ中のコストは「market-status 1 コール / 分」のみ。

  > トレードオフ: クローズ中も status を毎分 1 回叩く。厳密ゼロにするには NY
  > 取引時間スケジューラが必要でコードが増えるため、極小エンドポイントである
  > status の 1 コール / 分を許容する。

## データフロー

```
tick (毎分, トグルON時)
  └─ reloading? ── yes ─▶ skip
       │ no
       ▼
   market status 取得 → queryClient.setQueryData(marketStatus)
       │
       ├─ isOpen=false ─▶ 打ち切り（OHLCV/quote は取らない）
       │
       └─ isOpen=true ─▶ 既存の一括リロード（OHLCV refresh → quote → capability 再評価）
```

手動リロード（RefreshCw ボタン）は従来どおり isOpen に関わらず OHLCV を更新する
（クローズ後に確定日足を取りに行けるように）。自動停止は自動 tick 経路のみに適用。

## エラーハンドリング

- 既存 `handleReload` の方針を踏襲: OHLCV は `Promise.allSettled`、失敗があれば
  トースト。quote / market-status の失敗は握りつぶして OHLCV を止めない。
- tick 内の status 取得失敗は握りつぶし、そのtickは何もしない（次の分で再試行）。

## テスト

- 純粋関数の新規追加は無し。既存の `refreshTargets` / `quoteTargets` テストで
  ターゲット算出は担保済み。
- タイマー ON/OFF、クローズ時スキップ、多重実行防止は薄い挙動なので手動 UAT に
  委ねる（必要なら interval 制御を小関数に切り出して最小テストを足す）。
