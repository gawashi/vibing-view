# サイドバー仕様調整 — 設計

作成日: 2026-07-20

## 目的

ウォッチリスト（サイドバー）の使い勝手を上げる5つの調整:

1. サイドバー幅をドラッグで可変にする（最低240px）
2. 前日比で株価を緑（上昇）/赤（下落）に色付け
3. ドラッグ並べ替え時の挿入位置マーカーのずれを修正
4. 複数ウォッチリストの切替
5. ウォッチリスト価格を最初から取得・表示（チャートに載せる前に）

いずれも `API節約が最優先` を崩さない（フェッチは常にキャッシュ読み抜き経由）。

## 現状（起点）

- `src/renderer/components/Watchlist.tsx` — `aside` は固定 `w-[240px]`、内側 div も `w-[240px]`。社名は `truncate`。行の株価は `useQuery({ enabled: false })` でキャッシュ読み取りのみ（D-64）→ チャートに載せていない銘柄は空欄。並べ替えマーカーは行上端の `border-t-2`。
- `src/renderer/store.ts` — `watchlist: WatchlistItem[]` 単一配列 + `add/remove/reorderWatchlist`。
- `src/main/watchlistStore.ts` — `watchlist.json` に配列を保存。
- `src/main/settings.ts` — `settings.json` に `sidebarOpen` 等を保存（`get/setSidebarOpen`）。
- `src/renderer/lib/priceChange.ts` — `computeChange(bars, tf, daily)` 既存。チャートは `GridHost.tsx:125` で `pct >= 0 ? text-green-500 : text-red-500`。
- `src/main/cache/CacheService.ts` — `getOHLCV` はキャッシュ優先（ヒット時無通信、ミス時のみ不足分フェッチ）。

## 設計

### 1. リサイズ可能なサイドバー

- 幅は `App` の state（初期値240）で保持し、`settings.json` に `sidebarWidth` として永続化。`settings.ts` に `getSidebarWidth(): number | null` / `setSidebarWidth(w: number)` を追加（`sidebarOpen` と同パターン）。preload/ipc/api に対応チャンネルを追加。
- `Watchlist` に幅 prop を渡す。`aside` の固定 `w-[240px]` と内側 div の固定 `w-[240px]` を撤廃し、渡された幅（`style={{ width }}`）に追従。閉じている時（`open === false`）は幅0。
- 右端にドラッグハンドル（幅4px程度、`cursor-col-resize`）。`onPointerDown` で `setPointerCapture`、`onPointerMove` で幅を `clamp(240, w, 640)` に更新、`onPointerUp` で `setSidebarWidth` 永続化。
- ドラッグ中は `transition-[width]` を無効化（追従ラグ防止）。開閉トグル時のトランジションは維持。
- 閉じている時はハンドル非表示。
- 幅が広がると内側コンテンツも広がり、`truncate` の社名が広げた分だけ表示される（追加実装不要）。

### 2. 前日比で株価を色付け

- `Row` で既存の `computeChange(bars, '1d', undefined)` を使う（日足基準 = `bars[-2].close` vs `bars[-1].close` = 前日比）。
- 株価 span に `GridHost.tsx:125` と同じ色付け: `pct >= 0 ? 'text-green-500' : 'text-red-500'`。`pct === null`（前バー無し）は無色のまま。
- 数値の追加表示はしない（色のみ）。

### 3. ドラッグ挿入位置のずれ修正

- 根本原因: `reorderWatchlist(from, to)` は `from` を `splice` で抜いてから `to` に挿入するため、下方向ドラッグ（`from < to`）で実挿入位置がマーカー（行上端＝その行の前）より1つ下にずれる。
- 修正: `reorderWatchlist` で `from < to` のとき挿入インデックスを1つ詰める。

  ```ts
  reorderWatchlist: (from, to) => set((state) => {
    const list = [...activeItems]
    const [moved] = list.splice(from, 1)
    list.splice(from < to ? to - 1 : to, 0, moved)
    return /* activeリストを差し替え */
  })
  ```
- これで上下両方向でマーカー（行上端＝挿入先）と実挿入位置が一致。表示側（`border-t-2`）は変更しない。

### 4. 複数ウォッチリスト切替

- **データモデル**（`shared/types.ts`）:
  ```ts
  export type NamedWatchlist = { name: string; items: WatchlistItem[] }
  export type WatchlistCollection = {
    version: 2
    active: string          // アクティブなリスト名
    lists: NamedWatchlist[] // 最低1件を常に保証
  }
  ```
- **永続化 / マイグレーション**（`watchlistStore.ts`）: `getWatchlist` を `getWatchlists(): WatchlistCollection` に置換。
  - 読み込んだ JSON が旧形式（配列）→ `{ version: 2, active: 'Watchlist', lists: [{ name: 'Watchlist', items: [...well-formed...] }] }` に移行。
  - `version: 2` 形式 → そのまま検証して返す（`lists` が空なら空の 'Watchlist' を1件生成）。
  - 空/破損/未存在 → 同じデフォルト（空の 'Watchlist' 1件）。
  - 常に「最低1リスト存在」を不変条件として保証。
  - `setWatchlists(collection)` で保存。
- **IPC / api**: `watchlist.get` は `WatchlistCollection` を返し、`watchlist.set` は `WatchlistCollection` を受ける（型のみ変更、チャンネルは既存流用）。
- **store**（`store.ts`）: `watchlist: WatchlistItem[]` を以下に置換。
  - state: `watchlists: NamedWatchlist[]`、`activeWatchlist: string`
  - 派生: セレクタで「アクティブリストの items」を取得（`Row` はこれを使うので実質そのまま）
  - 既存アクション `addToWatchlist / removeFromWatchlist / reorderWatchlist` はアクティブリストに作用するよう内部を書き換え（外部シグネチャは維持）
  - 追加アクション:
    - `createWatchlist(name)` — 重複名不可、作成後そのリストへ切替
    - `renameWatchlist(from, to)` — 重複名不可
    - `deleteWatchlist(name)` — 最後の1リストは削除不可。アクティブを消したら先頭リストへ切替
    - `switchWatchlist(name)`
  - hydrate 用に `hydrateWatchlists(collection)` を追加（起動時にコレクション全体を流し込む）。
- **UI**（`Watchlist.tsx`）: サイドバー上部に切替ドロップダウン（`dropdown-menu` を使い `LayoutMenu.tsx` と同じパターン）。現在のリスト名を表示、メニューに全リスト（クリックで切替）+ `新規作成 / リネーム / 削除`。空スペースを圧迫しない。
- **App**（`App.tsx`）:
  - 起動時 restore を `api.watchlist.get()` → `hydrateWatchlists(collection)` に変更（旧: 各 item を `addToWatchlist`）。
  - persist-on-change の subscribe 対象を `watchlist` → `watchlists` + `activeWatchlist` に変更（デバウンス保存は据え置き）。

### 5. ウォッチリスト価格を最初から取得・表示

- `Row` の `useQuery` を `enabled: false` → 有効化。マウント時に `api.ohlcv.get(symbol, '1d')` を実行。
  - `getOHLCV` はキャッシュ優先なのでキャッシュヒット銘柄は無通信、未取得銘柄のみ日足を1回フェッチ。`staleTime: Infinity` のまま以後は再取得しない。
  - D-64 のコメントを本方針に合わせて更新。
- 描画される行（＝アクティブリスト）だけがクエリを走らせるので、非アクティブなリストの銘柄は取得しない（自然にスコープ）。
- これで #2 の色付けが全銘柄で最初から効く。
- `// ponytail:` 起動時、未キャッシュ銘柄が多いとフェッチがバースト。TanStack Query がキー単位で重複排除。実運用（数〜十数銘柄）では問題なし。必要になったら将来 concurrency を絞る。

## テスト（`store.test.ts` に追加）

- 旧形式（配列）→ `WatchlistCollection` マイグレーション（`getWatchlists`）
- `reorderWatchlist` の上方向・下方向どちらもマーカー位置＝実挿入位置
- `createWatchlist` / `renameWatchlist`（重複名拒否含む）
- `deleteWatchlist`（最後の1リスト保護、アクティブ削除時の先頭切替）
- `switchWatchlist` でアクティブが切り替わり add/remove が対象リストに効く

## 非対象（YAGNI）

- ウォッチリストのドラッグ並べ替え（リスト自体の順序変更）
- リスト間の銘柄コピー/移動
- フェッチ concurrency 制御（バーストが実害になったら追加）
- 前日比%の数値表示（色のみ）
