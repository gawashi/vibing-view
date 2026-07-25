# グローバル「リロード」ボタン（可視セルの差分更新）— 設計

- 日付: 2026-07-20
- ステータス: 承認済み（実装計画待ち）

## 背景と問題

FMP のプランを free → starter に変更しても intraday が使えないという症状の調査から始まった。

根本原因は capability キャッシュの sticky 判定だった（`requires-plan` は無期限、クリアは API キー変更時のみ）。API キーの再保存で即時解消したため、恒久対策としてユーザーが選んだのは「**リロードボタン**」で、特に **intraday において現在時刻までのデータを反映できるようにする**こと。

技術的な核心: 現在のキャッシュ（`src/main/cache/CacheService.ts`）は「カバレッジがあれば `range` 無し取得はネットワークに行かない」設計で、**右端（最新方向）の足は一度キャッシュすると二度と更新されない**。既存の gap-fetch は左端（過去）方向のみ。よって「現在時刻を反映」するには**右端の差分フェッチ**が必要。

## スコープ

- **グローバルなボタン1つ**をヘッダーに配置する。
- リロード対象は**現在レイアウトに表示中のセルのみ**（`cells.slice(0, VISIBLE_COUNT[shape])`）。非表示セルは対象外。
- 取得方式は**差分のみ**（キャッシュ済み最新足 `newestTime` 〜 現在時刻）。API 呼び出し節約を最優先とするプロジェクト方針に合致。
- 自動更新（インターバル）は**なし**。手動ボタンのみ。

## 設計

### バックエンド（main）

1. **新 IPC チャネル `ohlcv:refresh(symbol, tf)`** を追加（`src/shared/ipc.ts` の `CH` と `Api` に `ohlcv.refresh` を追加）。

2. **`CacheService.refreshOHLCV(symbol, tf)`** を新設する。既存の `getOHLCV` と renderer 側 gap-fetch ロジックには触れない（独立した経路）。
   - 派生足（`1w` / `1M`）→ 基礎の `1d` を対象にする（W/M のカバレッジは daily のカバレッジそのもの）。
   - `cov = store.getCoverage(symbol, tf)` を取得。
     - **未キャッシュ**（`cov` なし）→ 通常の初回フェッチにフォールバック（`provider.getOHLCV(symbol, tf, undefined)` → upsert → return）。
     - **キャッシュ済み** → `provider.getOHLCV(symbol, tf, { from: cov.newestTime, to: now })` で**差分のみ**取得。
       - `1d` は provider が `range` を無視し全期間を1リクエストで返す仕様（`FmpProvider.getOHLCV` の `historical-price-eod/full`）なので、それを利用して最新 EOD を得る（1リクエスト）。
       - intraday は与えた `{from, to}` レンジで `historical-chart/{interval}` を叩き、差分だけ取得。
     - 進行中の最終足は `newestTime` を含めて取り直すことで last-write-wins 更新される。
   - **coverage を union して書く**: `oldest = min(cov.oldest, fetched.oldest)`, `newest = max(cov.newest, fetched.newest)`。
   - `store.getBars(symbol, tf, undefined)` を返す。

3. **`barStore.upsertBarsAndCoverage` を union ベースに修正**する。
   - 現状は coverage を「入力バーの範囲」で**上書き**しており、右端差分だけを渡すと `oldestTime` が失われる。
   - 既存の左方向 gap-fetch にも同種の潜在バグ（`newestTime` が縮む）があるが、`range` 無し取得では `getBars` が全行を返すため露見していないだけ。
   - 修正方針: upsert 時に既存 coverage 行があれば `min`/`max` で union して書く。全期間フェッチ（`1d` フルや初回）でも結果は同じかより広くなるだけで安全。

4. `src/main/ipc.ts` に `ohlcv:refresh` ハンドラを追加し、**既存 `ohlcvGet` と同じ try/catch を通す**。
   - 成功で `capabilityCache.setStatus(apiKey, tf, 'available')`（派生足除く）。
   - `FmpHttpError` は既存の `classify` で分類して記録（`1d` の 402/403 は既存どおり `requires-plan` を記録しない）。
   - 副次効果として、表示中足の capability 再判定が自然に走る。

### フロント（renderer）

5. **`App.tsx` のヘッダーにリロードボタン**（更新アイコン、SearchBar 付近）を追加。
   - 押下で**可視セルのみ**を対象に、各 `(symbol, timeframe)` を並行リフレッシュ。
   - 各セル: `api.ohlcv.refresh(symbol, tf)` → 返り値を `queryClient.setQueryData(qk.ohlcv(symbol, tf), bars)` で反映。
     - Chart は「同一キーの `q.data` 更新」として扱い、pan 位置をリセットしない（D-11: `fitContent` は symbol/timeframe 切替時のみ）。
   - **intraday セルは前日終値（`1d`）も更新**する（安価に1リクエスト、`qk.ohlcv(symbol, '1d')` を refresh）ことで騰落率ラベルを正しく保つ。
   - **gated な足（`requires-plan` / `rate-limited`）はスキップ**（リクエスト浪費なし。gated intraday はゲーティングで daily にスナップ済みのため、可視セルの足が gated intraday になることは基本ない）。
   - 実行中はボタンに**スピナー表示＋disable**。全体失敗時のみ控えめにトーストを出す。
   - 可視セルの重複 `(symbol, tf)` は de-dup して二重リクエストを避ける。

### 対象範囲外（YAGNI）

- 自動/定期リロード。
- 非表示セルのリロード。
- キャッシュ済み全範囲の再フェッチ（差分のみ）。
- capability の sticky 判定自体の期限付き化（キー再保存で解消済み。今回はリロード経由で表示中足のみ再判定される）。

## テスト

- `CacheService.refreshOHLCV`
  - キャッシュ済み: 差分レンジ `{ from: newestTime, to: now }` で provider を呼ぶ。
  - 未キャッシュ: `undefined` レンジで初回フェッチにフォールバック。
  - 派生足（`1w`/`1M`）: `1d` を対象に処理。
  - coverage union: 既存より広い範囲になること。
- `barStore.upsertBarsAndCoverage`
  - union 化: 右端差分のみ upsert しても `oldestTime` が保持される。
  - 回帰: 左 gap-fetch 相当（古い side だけ upsert）で `newestTime` が縮まない。
- capability 記録は既存テスト（`FmpProvider.test.ts` / classify）を踏襲。
- renderer 側の可視セル抽出・de-dup・gated スキップは可能なら軽い単体テスト、難しければ手動 UAT。

## 未解決事項

なし。
