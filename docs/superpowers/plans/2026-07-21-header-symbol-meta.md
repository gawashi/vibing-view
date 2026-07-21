# ヘッダー社名・取引所表示＋お気に入り星ボタン Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 各グリッドセルのヘッダーにティッカー・取引所・社名を表示し、ウォッチリスト追加/削除の星ボタンを置く。

**Architecture:** 銘柄プロファイル（社名・取引所）を read-through で解決する `ProfileService` を追加。SQLite `symbol_profiles` に永続キャッシュし、銘柄あたり最大1回だけフェッチ。検索結果でキャッシュに種まきし、ヘッダー表示と星ボタンの両方が同一クエリ（`qk.profile`）を共有する。`Cell` スキーマは変更しない。

**Tech Stack:** TypeScript, Electron (main/preload/renderer), better-sqlite3 + drizzle-orm, React 19, TanStack Query v5, Zustand, lucide-react, Vitest.

## Global Constraints

- Vite は `^7` にピン留め（変更しない）。
- better-sqlite3 は Electron の Node ABI に対してリビルド済み（`postinstall` が担保）。native モジュールは静的 import しない（`db/client.ts` の lazy require パターンを踏襲）。
- 永続化の区分：**SQLite = 取得データのキャッシュ / JSON = ユーザ設定**。プロファイルは取得データなので SQLite。
- API呼び出し節約が最優先：プロファイルは銘柄あたり最大1フェッチ、以後は無通信。
- 一時的失敗（APIキー未設定・通信エラー）時のフォールバックは**キャッシュに書かない**（キー登録後に再解決させるため）。
- 指標計算ライブラリ（`technicalindicators` / `react-financial-charts`）は使わない（本機能では無関係）。
- テスト実行：`npm test`（全体）、単体は `npx vitest run <path>`。型検査：`npm run typecheck`。ビルド：`npm run build`。

---

### Task 1: SQLite に `symbol_profiles` テーブルを追加

**Files:**
- Modify: `src/main/db/schema.ts`
- Modify: `src/main/db/client.ts:17-28`（`sqlite.exec` の `CREATE TABLE` ブロック）

**Interfaces:**
- Produces: drizzle テーブル `symbolProfiles`（列 `symbol` PK / `name` / `exchange`、すべて TEXT NOT NULL）。

このタスクにはロジックが無く、テーブル定義とDDLの追加のみ。型検査が通ることが受け入れ基準。

- [ ] **Step 1: schema.ts にテーブルを追加**

`src/main/db/schema.ts` の末尾（`coverage` 定義の後）に追記：

```ts
export const symbolProfiles = sqliteTable('symbol_profiles', {
  symbol: text('symbol').primaryKey(),
  name: text('name').notNull(),
  exchange: text('exchange').notNull()
})
```

- [ ] **Step 2: client.ts の DDL に CREATE TABLE を追加**

`src/main/db/client.ts` の `sqlite.exec(\`...\`)` テンプレート内、`coverage` の CREATE TABLE の直後に追記：

```sql
    CREATE TABLE IF NOT EXISTS symbol_profiles (
      symbol TEXT PRIMARY KEY, name TEXT NOT NULL, exchange TEXT NOT NULL
    );
```

- [ ] **Step 3: 型検査**

Run: `npm run typecheck`
Expected: エラーなしで完了。

- [ ] **Step 4: Commit**

```bash
git add src/main/db/schema.ts src/main/db/client.ts
git commit -m "feat(db): add symbol_profiles table"
```

---

### Task 2: `profileStore`（SQLite 読み書き）

**Files:**
- Create: `src/main/db/profileStore.ts`

**Interfaces:**
- Consumes: `symbolProfiles` テーブル（Task 1）、`getDb`（`src/main/db/client.ts`）。
- Produces:
  - `getProfile(symbol: string): SymbolResult | null`
  - `upsertProfile(p: SymbolResult): void`
  - （`SymbolResult = { symbol: string; name: string; exchange: string }`、`@shared/types` 既存）

`getDb` は Electron 実行時にしか動かない native モジュールを lazy require するため、この store はユニットテストしない（`barStore.ts` も同様に直接のユニットテストは無い）。ロジックは Task 3 の `ProfileService` 側で fake store を注入して検証する。

- [ ] **Step 1: profileStore.ts を作成**

```ts
import { eq } from 'drizzle-orm'
import type { SymbolResult } from '@shared/types'
import { getDb } from './client'
import { symbolProfiles } from './schema'

export function getProfile(symbol: string): SymbolResult | null {
  const row = getDb().select().from(symbolProfiles)
    .where(eq(symbolProfiles.symbol, symbol)).get()
  return row ? { symbol: row.symbol, name: row.name, exchange: row.exchange } : null
}

export function upsertProfile(p: SymbolResult): void {
  getDb().insert(symbolProfiles)
    .values({ symbol: p.symbol, name: p.name, exchange: p.exchange })
    .onConflictDoUpdate({
      target: symbolProfiles.symbol,
      set: { name: p.name, exchange: p.exchange }
    })
    .run()
}
```

- [ ] **Step 2: 型検査**

Run: `npm run typecheck`
Expected: エラーなし。

- [ ] **Step 3: Commit**

```bash
git add src/main/db/profileStore.ts
git commit -m "feat(db): add profileStore read/write"
```

---

### Task 3: `ProfileService`（read-through リゾルバ）

**Files:**
- Create: `src/main/profile/ProfileService.ts`
- Test: `tests/main/profile/ProfileService.test.ts`

**Interfaces:**
- Consumes: `SymbolResult`（`@shared/types`）。注入する `store`（Task 2 の `profileStore` の形）と `search` 関数。
- Produces:
  - `createProfileService(deps: { store: { getProfile(symbol: string): SymbolResult | null; upsertProfile(p: SymbolResult): void }; search: (query: string) => Promise<SymbolResult[]> }): { getProfile(symbol: string): Promise<SymbolResult> }`

挙動：キャッシュヒット→無通信／ミス時 `search(symbol)` 成功で完全一致（大小無視）を書き込み＋返却／一致なしはフォールバックを書き込み＋返却／`search` が throw したらフォールバックを**書き込まず**返却。

- [ ] **Step 1: 失敗するテストを書く**

`tests/main/profile/ProfileService.test.ts` を作成：

```ts
import { describe, it, expect, vi } from 'vitest'
import { createProfileService } from '../../../src/main/profile/ProfileService'
import type { SymbolResult } from '@shared/types'

function fakeStore(initial: SymbolResult | null = null) {
  let stored = initial
  return {
    getProfile: vi.fn(() => stored),
    upsertProfile: vi.fn((p: SymbolResult) => { stored = p })
  }
}

const AAPL: SymbolResult = { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }

describe('ProfileService.getProfile', () => {
  it('returns cached profile with NO search call on a hit', async () => {
    const store = fakeStore(AAPL)
    const search = vi.fn()
    const svc = createProfileService({ store, search })

    const p = await svc.getProfile('AAPL')

    expect(search).not.toHaveBeenCalled()
    expect(p).toEqual(AAPL)
  })

  it('fetches and caches the exact-symbol match on a miss', async () => {
    const store = fakeStore(null)
    const search = vi.fn(async () => [
      { symbol: 'AAPLX', name: 'Something Else', exchange: 'NYSE' },
      AAPL
    ])
    const svc = createProfileService({ store, search })

    const p = await svc.getProfile('AAPL')

    expect(search).toHaveBeenCalledOnce()
    expect(search).toHaveBeenCalledWith('AAPL')
    expect(store.upsertProfile).toHaveBeenCalledWith(AAPL)
    expect(p).toEqual(AAPL)
  })

  it('matches the symbol case-insensitively', async () => {
    const store = fakeStore(null)
    const search = vi.fn(async () => [AAPL])
    const svc = createProfileService({ store, search })

    const p = await svc.getProfile('aapl')

    expect(p).toEqual(AAPL)
    expect(store.upsertProfile).toHaveBeenCalledWith(AAPL)
  })

  it('caches a fallback when a successful response has no exact match', async () => {
    const store = fakeStore(null)
    const search = vi.fn(async () => [
      { symbol: 'ZZZZ', name: 'Zzz Corp', exchange: 'NYSE' }
    ])
    const svc = createProfileService({ store, search })

    const p = await svc.getProfile('NOPE')

    expect(p).toEqual({ symbol: 'NOPE', name: 'NOPE', exchange: '' })
    expect(store.upsertProfile).toHaveBeenCalledWith({ symbol: 'NOPE', name: 'NOPE', exchange: '' })
  })

  it('returns a fallback WITHOUT caching on a transient failure (search throws)', async () => {
    const store = fakeStore(null)
    const search = vi.fn(async () => { throw new Error('NO_API_KEY') })
    const svc = createProfileService({ store, search })

    const p = await svc.getProfile('AAPL')

    expect(p).toEqual({ symbol: 'AAPL', name: 'AAPL', exchange: '' })
    expect(store.upsertProfile).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/main/profile/ProfileService.test.ts`
Expected: FAIL（`createProfileService` が見つからない、モジュール解決エラー）。

- [ ] **Step 3: 最小実装を書く**

`src/main/profile/ProfileService.ts` を作成：

```ts
import type { SymbolResult } from '@shared/types'

export function createProfileService(deps: {
  store: {
    getProfile(symbol: string): SymbolResult | null
    upsertProfile(p: SymbolResult): void
  }
  search: (query: string) => Promise<SymbolResult[]>
}) {
  const { store, search } = deps
  return {
    async getProfile(symbol: string): Promise<SymbolResult> {
      const cached = store.getProfile(symbol)
      if (cached) return cached

      let results: SymbolResult[]
      try {
        results = await search(symbol)
      } catch {
        // Transient failure (no API key / network / HTTP error) — return a fallback but do NOT
        // cache it, so a later successful resolve (e.g. after the key is added) refetches.
        return { symbol, name: symbol, exchange: '' }
      }

      const match = results.find((r) => r.symbol.toLowerCase() === symbol.toLowerCase())
      const resolved: SymbolResult = match ?? { symbol, name: symbol, exchange: '' }
      store.upsertProfile(resolved)
      return resolved
    }
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/main/profile/ProfileService.test.ts`
Expected: PASS（5 件）。

- [ ] **Step 5: Commit**

```bash
git add src/main/profile/ProfileService.ts tests/main/profile/ProfileService.test.ts
git commit -m "feat(main): add ProfileService read-through resolver"
```

---

### Task 4: IPC 配線（`symbols:profile` チャンネル＋検索の種まき）

**Files:**
- Modify: `src/shared/ipc.ts:1-33`（`CH` と `Api.symbols`）
- Modify: `src/preload/index.ts:6`（`symbols` ブリッジ）
- Modify: `src/main/ipc.ts`（import・service 生成・ハンドラ登録・検索の種まき）

**Interfaces:**
- Consumes: `createProfileService`（Task 3）、`profileStore`（Task 2）、`FmpProvider` / `getApiKey`（既存）。
- Produces:
  - `CH.symbolsProfile = 'symbols:profile'`
  - `Api.symbols.profile(symbol: string): Promise<SymbolResult>`
  - preload の `window.api.symbols.profile`

このタスクは main プロセス配線でユニットテスト対象外（既存 IPC ハンドラも直接テストしていない）。型検査とビルドが通ることが受け入れ基準。

- [ ] **Step 1: shared/ipc.ts に channel と型を追加**

`CH` オブジェクトの `symbolsSearch` の直後に追加：

```ts
  symbolsProfile: 'symbols:profile',
```

`Api` インターフェースの `symbols` を次に変更：

```ts
  symbols: {
    search(query: string): Promise<SymbolResult[]>
    profile(symbol: string): Promise<SymbolResult>
  }
```

（`SymbolResult` は同ファイル冒頭で既に import 済み。追加 import 不要。）

- [ ] **Step 2: preload/index.ts にブリッジを追加**

`src/preload/index.ts` の `symbols` を次に変更：

```ts
  symbols: {
    search: (query) => ipcRenderer.invoke(CH.symbolsSearch, query),
    profile: (symbol) => ipcRenderer.invoke(CH.symbolsProfile, symbol)
  },
```

- [ ] **Step 3: main/ipc.ts に import を追加**

既存 import 群（`createSearchCache` の近く）に追加：

```ts
import { createProfileService } from './profile/ProfileService'
import * as profileStore from './db/profileStore'
```

- [ ] **Step 4: main/ipc.ts で ProfileService を生成**

`registerIpc()` 内、`const searchCache = ...` の直後に追加：

```ts
  const profileService = createProfileService({
    store: profileStore,
    search: (query) => {
      const apiKey = getApiKey()
      if (!apiKey) throw new Error('NO_API_KEY')
      return new FmpProvider({ apiKey }).searchSymbols(query)
    }
  })
```

- [ ] **Step 5: 検索ハンドラでプロファイルに種まき**

`ipcMain.handle(CH.symbolsSearch, ...)` のハンドラを次に変更（フェッチ結果を profileStore に upsert）：

```ts
  ipcMain.handle(CH.symbolsSearch, async (_e, query: string) => {
    const cached = searchCache.get(query)
    if (cached) return cached
    const apiKey = getApiKey()
    if (!apiKey) throw new Error('NO_API_KEY')
    const results = await new FmpProvider({ apiKey }).searchSymbols(query)
    searchCache.set(query, results)
    // Seed the profile cache for free — every result carries name/exchange, so a subsequently
    // selected symbol resolves its header profile with zero extra API calls.
    for (const r of results) profileStore.upsertProfile(r)
    return results
  })
```

- [ ] **Step 6: プロファイルハンドラを登録**

`ipcMain.handle(CH.symbolsSearch, ...)` ブロックの直後に追加：

```ts
  ipcMain.handle(CH.symbolsProfile, (_e, symbol: string) => profileService.getProfile(symbol))
```

- [ ] **Step 7: 型検査とビルド**

Run: `npm run typecheck && npm run build`
Expected: どちらもエラーなしで完了。

- [ ] **Step 8: 既存テストが壊れていないことを確認**

Run: `npm test`
Expected: 全テスト PASS（Task 3 の 5 件を含む）。

- [ ] **Step 9: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/ipc.ts
git commit -m "feat(ipc): symbols:profile channel + search seeds profile cache"
```

---

### Task 5: renderer に `qk.profile` を追加

**Files:**
- Modify: `src/renderer/api.ts:6-10`

**Interfaces:**
- Produces: `qk.profile(symbol: string): readonly ['profile', string]`

- [ ] **Step 1: qk に profile を追加**

`src/renderer/api.ts` の `qk` オブジェクトに追加：

```ts
  profile: (symbol: string) => ['profile', symbol] as const,
```

（`ohlcv` などと同じ並び。`search` の直前でも直後でも可。）

- [ ] **Step 2: 型検査**

Run: `npm run typecheck`
Expected: エラーなし。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/api.ts
git commit -m "feat(renderer): add profile query key"
```

---

### Task 6: ヘッダーに取引所・社名を表示

**Files:**
- Modify: `src/renderer/components/GridHost.tsx`（`SymbolLabel`、import 群）

**Interfaces:**
- Consumes: `api.symbols.profile`（Task 4）、`qk.profile`（Task 5）、`SymbolResult`（`@shared/types`）。
- Produces: 取引所・社名を含む `SymbolLabel` の描画。

このタスクは UI 描画で、既存に GridHost のコンポーネントテストは無い（方針どおり重い UI テストは追加しない）。型検査・ビルド・目視が受け入れ基準。

- [ ] **Step 1: import を追加**

`src/renderer/components/GridHost.tsx` 冒頭の型 import に `SymbolResult` を追加（既存の `import type { Bar, Cell, Timeframe } from '@shared/types'` を変更）：

```ts
import type { Bar, Cell, Timeframe, SymbolResult } from '@shared/types'
```

- [ ] **Step 2: SymbolLabel にプロファイルクエリと表示を追加**

`SymbolLabel` を次に置き換える（`profileQ` を追加し、取引所・社名を描画）：

```tsx
function SymbolLabel({ symbol, timeframe }: { symbol: string; timeframe: Timeframe }): React.JSX.Element {
  const isIntraday = timeframe === '1m' || timeframe === '5m' || timeframe === '15m' || timeframe === '1h'
  const barsQ = useQuery<Bar[]>({
    queryKey: qk.ohlcv(symbol, timeframe),
    queryFn: () => api.ohlcv.get(symbol, timeframe, undefined),
    enabled: false // subscribe-only: Chart/gating が同キーを埋める
  })
  const dailyQ = useQuery<Bar[]>({
    queryKey: qk.ohlcv(symbol, '1d'),
    queryFn: () => api.ohlcv.get(symbol, '1d', undefined),
    enabled: isIntraday, // intraday のみ前日終値のため実フェッチ
    staleTime: Infinity
  })
  const change = computeChange(barsQ.data, timeframe, dailyQ.data)

  // 銘柄あたり最大1フェッチ。検索で選んだ銘柄は種まき済みで無通信ヒット。staleTime:Infinity で
  // 以後は API キー登録時の invalidate(['profile']) のみが再取得契機。
  const profileQ = useQuery<SymbolResult>({
    queryKey: qk.profile(symbol),
    queryFn: () => api.symbols.profile(symbol),
    staleTime: Infinity
  })
  const profile = profileQ.data
  const exchange = profile?.exchange ? profile.exchange : null
  // フォールバック（name===symbol）は社名未知なので出さない — ティッカーと重複させない。
  const name = profile && profile.name !== symbol ? profile.name : null

  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="shrink-0 text-lg font-semibold">{symbol}</span>
      {exchange && <span className="shrink-0 text-sm text-muted-foreground">· {exchange}</span>}
      {name && <span className="truncate text-sm text-muted-foreground" title={name}>{name}</span>}
      {change && (
        <>
          <span className="shrink-0 text-sm text-muted-foreground">{change.price.toFixed(2)}</span>
          {change.pct !== null && (
            <span className={cn('shrink-0 text-sm', change.pct >= 0 ? 'text-green-500' : 'text-red-500')}>
              {change.pct >= 0 ? '+' : ''}{change.pct.toFixed(2)}%
            </span>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 型検査とビルド**

Run: `npm run typecheck && npm run build`
Expected: どちらもエラーなし。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/GridHost.tsx
git commit -m "feat(header): show exchange and company name next to ticker"
```

---

### Task 7: ヘッダーにお気に入り星ボタンを追加

**Files:**
- Modify: `src/renderer/components/GridHost.tsx`（`FavoriteStar` 新規・`GridCell` ツールバー・import 群）

**Interfaces:**
- Consumes: `api.symbols.profile` / `qk.profile`（Task 4/5）、`selectActiveItems` / `addToWatchlist` / `removeFromWatchlist`（`@/store` 既存）、`Star`（lucide-react）、`Tooltip*`（`./ui/tooltip`）。
- Produces: `FavoriteStar({ symbol }: { symbol: string })` コンポーネントと、`GridCell` ツールバー右端の star＋× グループ。

星は `SearchResults.tsx` の実装を踏襲。プロファイルクエリは Task 6 と同じ `qk.profile(symbol)` なので TanStack が同一エントリを共有し、追加フェッチは発生しない。

- [ ] **Step 1: import を追加**

`GridHost.tsx` の import を修正：

- lucide-react の import に `Star` を追加：
  ```ts
  import { X, Star } from 'lucide-react'
  ```
- store import に `selectActiveItems` を追加：
  ```ts
  import { useAppStore, selectActiveItems } from '@/store'
  ```
- Tooltip を追加（新規 import 行）：
  ```ts
  import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
  ```

（`TooltipProvider` は `App.tsx` が全体をラップ済みのため、ここでは不要。）

- [ ] **Step 2: FavoriteStar コンポーネントを追加**

`SymbolLabel` の定義の直後に追加：

```tsx
// ヘッダーのお気に入り星。SearchResults の星と同一の store アクションを叩くので、サイドバー星と
// 状態は常に一致。プロファイルは SymbolLabel と同じ qk.profile(symbol) を使うため追加フェッチなし。
function FavoriteStar({ symbol }: { symbol: string }): React.JSX.Element {
  const watched = useAppStore((s) => selectActiveItems(s).some((w) => w.symbol === symbol))
  const addToWatchlist = useAppStore((s) => s.addToWatchlist)
  const removeFromWatchlist = useAppStore((s) => s.removeFromWatchlist)
  const profileQ = useQuery<SymbolResult>({
    queryKey: qk.profile(symbol),
    queryFn: () => api.symbols.profile(symbol),
    staleTime: Infinity
  })

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (watched) {
              removeFromWatchlist(symbol)
            } else {
              const p = profileQ.data
              addToWatchlist({ symbol, name: p?.name ?? symbol, exchange: p?.exchange ?? '' })
            }
          }}
          aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
          className={cn(
            'shrink-0 cursor-pointer',
            watched ? 'text-primary hover:text-muted-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Star className={cn('size-4', watched && 'fill-current')} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{watched ? 'Remove from watchlist' : 'Add to watchlist'}</TooltipContent>
    </Tooltip>
  )
}
```

- [ ] **Step 3: GridCell ツールバーに star＋× グループを配置**

`GridCell` 内、`AddIndicatorMenu` と閉じ `X` ボタンの箇所を次に変更。現在の `<Button ... aria-label={`Remove ${cell.symbol} chart`}>` から `ml-auto` を外し、star とともに右寄せグループに包む：

```tsx
              <AddIndicatorMenu cellId={cell.id} />
              <div className="ml-auto flex items-center gap-1">
                <FavoriteStar symbol={cell.symbol} />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 [&_svg]:size-3.5"
                  aria-label={`Remove ${cell.symbol} chart`}
                  onClick={(e) => { e.stopPropagation(); clearCell(cell.id) }}
                >
                  <X />
                </Button>
              </div>
```

- [ ] **Step 4: 型検査とビルド**

Run: `npm run typecheck && npm run build`
Expected: どちらもエラーなし。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/GridHost.tsx
git commit -m "feat(header): add favorite star button to chart header"
```

---

### Task 8: APIキー登録時にプロファイルを再クエリ

**Files:**
- Modify: `src/renderer/components/SettingsDialog.tsx:18-24`（`save` 関数）

**Interfaces:**
- Consumes: `queryClient`（既存）。

キー登録直後にヘッダーのプロファイルを再解決させる。一時失敗のフォールバックはキャッシュに書いていないため（Task 3）、invalidate でミス扱いとなり再フェッチされる。

- [ ] **Step 1: save に profile invalidate を追加**

`SettingsDialog.tsx` の `save` 内、既存の invalidate 群に1行追加：

```ts
  const save = async (): Promise<void> => {
    await api.apikey.set(key)
    setKey('')
    setStatus(await api.apikey.status())
    void queryClient.invalidateQueries({ queryKey: ['ohlcv'] })
    void queryClient.invalidateQueries({ queryKey: ['capabilities'] }) // SC4: paid key re-enables intraday, no code change
    void queryClient.invalidateQueries({ queryKey: ['profile'] }) // キー登録でヘッダー社名/取引所を再解決
  }
```

- [ ] **Step 2: 型検査**

Run: `npm run typecheck`
Expected: エラーなし。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/SettingsDialog.tsx
git commit -m "feat(settings): re-resolve profiles after API key is set"
```

---

### Task 9: 最終検証

**Files:** なし（検証のみ）

- [ ] **Step 1: 全テスト実行**

Run: `npm test`
Expected: 全 PASS（`ProfileService` 5 件を含む）。

- [ ] **Step 2: 型検査**

Run: `npm run typecheck`
Expected: エラーなし。

- [ ] **Step 3: ビルド**

Run: `npm run build`
Expected: main / preload / renderer すべてビルド成功。

- [ ] **Step 4: 目視確認（`npm run dev`）**

以下を手動確認：
1. デフォルト AAPL のヘッダーに `AAPL · NASDAQ  Apple Inc.` が出る（キー設定済みの場合）。
2. 検索で別銘柄を選ぶと即座に取引所・社名が出る（追加フェッチなし）。
3. ヘッダーの星をクリック → アクティブなウォッチリストに追加され、サイドバーにも現れる。塗り星になる。
4. 塗り星を再クリック → ウォッチリストから消え、空星に戻る。
5. サイドバーで同じ銘柄を削除 → ヘッダーの星も空星に同期する。
6. （任意）キー未設定 → ティッカーのみ表示 → Settings でキー登録 → ヘッダーに社名・取引所が自動で反映（リロード不要）。

---

## Self-Review

**Spec coverage:**
- プロファイル・リゾルバ（SQLite 永続キャッシュ）→ Task 1/2/3。
- 検索種まき → Task 4 Step 5。
- 一時失敗を非キャッシュ → Task 3（テスト有り）。
- 新 IPC `symbols:profile` → Task 4。
- `qk.profile` → Task 5。
- ヘッダー：ティッカー`·`取引所＋社名 → Task 6。
- 星ボタン（アクティブリストへトグル）→ Task 7。
- キー登録時 `['profile']` invalidate → Task 8。
- エッジケース（オフライン/フォールバック非表示）→ Task 3/6 で実装、Task 9 Step 4 で目視。
- `Cell` スキーマ非変更 → 全タスクでスキーマに触れない。

**Placeholder scan:** TBD/TODO 無し。全コードステップに実コードを記載。

**Type consistency:** `SymbolResult { symbol, name, exchange }` を全タスクで一貫使用。`createProfileService` / `getProfile` / `upsertProfile` / `qk.profile` / `CH.symbolsProfile` / `api.symbols.profile` の名称は Task 間で一致。`FavoriteStar` は Task 7 でのみ定義・使用。
