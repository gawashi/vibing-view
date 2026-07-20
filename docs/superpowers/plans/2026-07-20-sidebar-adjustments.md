# Sidebar Adjustments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** サイドバー（ウォッチリスト）を可変幅・前日比の色付き価格・複数リスト切替に対応させ、価格を起動時から取得表示し、ドラッグ並べ替えの挿入位置ずれを直す。

**Architecture:** 5つの独立寄りな調整。(1) サイドバー幅は `settings.json` に永続（`sidebarOpen` と同パターン）、`App` が state 保持、`Watchlist` 右端のドラッグハンドルで更新。(2) 行の価格は既存 `computeChange` の日足基準で色付け＋クエリを有効化して起動時取得。(3) 複数ウォッチリストは `WatchlistCollection` へデータモデル変更（旧配列は移行）、store をアクティブリスト作用に置換、ヘッダにドロップダウン切替 UI。(4) 並べ替えは `reorderWatchlist` の splice 座標を補正。

**Tech Stack:** TypeScript, React 19, Zustand 5, TanStack Query 5, Electron 43, Vitest（`environment: 'node'`, `tests/**/*.test.ts`）, shadcn dropdown-menu/dialog。

## Global Constraints

- **API節約が最優先** — フェッチは常にキャッシュ読み抜き（`CacheService.getOHLCV`）経由。キャッシュヒット銘柄は無通信。
- **UI chrome は `settings.json`** — 幅/開閉は Workspace/named layout に混ぜない（D-63）。
- **ウォッチリストは専用 JSON**（`watchlist.json`）— layouts.json と分離（D-62）。
- **サイドバー幅** — `clamp(240, w, 640)`。最低 240px 未満不可。
- **色** — 上昇 `text-green-500` / 下落 `text-red-500`（`GridHost.tsx:125` と一致）。基準は前日比（日足 `bars[-2].close` vs `bars[-1].close`）。
- **テスト実行** — `npm test`（`vitest run`）。型チェック — `npm run typecheck`。
- **store の watchlist アクションは IPC を呼ばない純関数**（永続化は App の subscribe が担当）。

---

## File Structure

- `src/main/settings.ts` — `getSidebarWidth`/`setSidebarWidth` 追加（Task 1）
- `src/shared/ipc.ts` — `settingsGet/SetSidebarWidth` チャンネル + `Api.settings` 型 + `Api.watchlist` 型を collection に（Task 1, 3）
- `src/main/ipc.ts` — sidebar width ハンドラ（Task 1）、watchlist ハンドラを collection に（Task 3）
- `src/preload/index.ts` — 新チャンネル配線（Task 1, 3）
- `src/renderer/App.tsx` — width state + 永続 effect + Watchlist props（Task 1）、watchlist hydrate/persist を collection に（Task 3）
- `src/renderer/components/Watchlist.tsx` — 可変幅 + リサイズハンドル（Task 1）、Row 色付け+取得（Task 2）、アクティブリスト参照 + switcher 埋め込み（Task 3, 4）
- `src/shared/types.ts` — `NamedWatchlist` / `WatchlistCollection`（Task 3）
- `src/main/watchlistStore.ts` — `getWatchlists`/`setWatchlists` + 旧配列マイグレーション（Task 3）
- `src/renderer/store.ts` — `watchlists`/`activeWatchlist` + アクション + reorder 補正 + selector（Task 3）
- `src/renderer/components/WatchlistSwitcher.tsx` — 切替ドロップダウン（Task 4, 新規）
- Tests: `tests/main/settings.test.ts`（新規, Task 1）, `tests/main/watchlistStore.test.ts`（書換, Task 3）, `tests/renderer/store.test.ts`（書換, Task 3）

---

## Task 1: サイドバー可変幅 + 永続化

**Files:**
- Modify: `src/main/settings.ts`
- Modify: `src/shared/ipc.ts:9-12` (CH), `:37-44` (Api.settings)
- Modify: `src/main/ipc.ts:8` (import), `:89-90` (handlers)
- Modify: `src/preload/index.ts:16-21` (settings bridge)
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/Watchlist.tsx`
- Test: `tests/main/settings.test.ts` (create)

**Interfaces:**
- Produces: `settings.getSidebarWidth(): number | null`, `settings.setSidebarWidth(width: number): void`; IPC `Api.settings.getSidebarWidth(): Promise<number|null>` / `setSidebarWidth(width:number): Promise<void>`; `Watchlist` props `{ open: boolean; width: number; onWidthChange: (w: number) => void }`.

- [ ] **Step 1: Write the failing test**

Create `tests/main/settings.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let userDataDir: string

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir }
}))

const settings = await import('../../src/main/settings')

describe('settings sidebar width', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'settings-test-'))
  })
  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('returns null before anything is saved', () => {
    expect(settings.getSidebarWidth()).toBeNull()
  })

  it('round-trips a width through set → get', () => {
    settings.setSidebarWidth(360)
    expect(settings.getSidebarWidth()).toBe(360)
  })

  it('does not clobber sidebarOpen when writing width', () => {
    settings.setSidebarOpen(false)
    settings.setSidebarWidth(360)
    expect(settings.getSidebarOpen()).toBe(false)
    expect(settings.getSidebarWidth()).toBe(360)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/settings.test.ts`
Expected: FAIL — `settings.getSidebarWidth is not a function`.

- [ ] **Step 3: Add settings accessors**

Append to `src/main/settings.ts`:

```ts
// D-63 と同じ扱い（UI chrome）。幅もここへ。clamp は呼び出し側(renderer)の責務。
export function getSidebarWidth(): number | null {
  const v = read().sidebarWidth
  return typeof v === 'number' ? v : null
}

export function setSidebarWidth(width: number): void {
  writeJsonFile(settingsPath(), { ...read(), sidebarWidth: width })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/settings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire IPC channels + types**

In `src/shared/ipc.ts`, add to `CH` (after `settingsSetSidebarOpen`):

```ts
  settingsGetSidebarWidth: 'settings:getSidebarWidth',
  settingsSetSidebarWidth: 'settings:setSidebarWidth',
```

In the same file, add to `Api.settings` (after `setSidebarOpen`):

```ts
    getSidebarWidth(): Promise<number | null>
    setSidebarWidth(width: number): Promise<void>
```

In `src/main/ipc.ts` line 8, extend the settings import:

```ts
import { getLastSymbol, setLastSymbol, getSidebarOpen, setSidebarOpen, getSidebarWidth, setSidebarWidth } from './settings'
```

In `src/main/ipc.ts`, after the `settingsSetSidebarOpen` handler (line 90):

```ts
  ipcMain.handle(CH.settingsGetSidebarWidth, () => getSidebarWidth())
  ipcMain.handle(CH.settingsSetSidebarWidth, (_e, width: number) => setSidebarWidth(width))
```

In `src/preload/index.ts`, add to the `settings` object (after `setSidebarOpen`):

```ts
    getSidebarWidth: () => ipcRenderer.invoke(CH.settingsGetSidebarWidth),
    setSidebarWidth: (width) => ipcRenderer.invoke(CH.settingsSetSidebarWidth, width)
```

- [ ] **Step 6: Add width state + persistence in App**

In `src/renderer/App.tsx`, add state next to `sidebarOpen` (line 19):

```ts
  const [sidebarWidth, setSidebarWidth] = useState(240)
```

In the startup `useEffect` (after the `getSidebarOpen` call, line 32-34), add:

```ts
    void api.settings.getSidebarWidth().then((w) => {
      if (w !== null) setSidebarWidth(w)
    })
```

Add a new debounced persist effect (below the sidebar startup effect):

```ts
  // ponytail: React-state (not a store subscribe) so a plain 500ms debounced effect is enough.
  // The one redundant write of the default 240 on first mount (before load resolves) is harmless.
  useEffect(() => {
    const t = setTimeout(() => { void api.settings.setSidebarWidth(sidebarWidth) }, 500)
    return () => clearTimeout(t)
  }, [sidebarWidth])
```

Pass props to `<Watchlist>` (line 116):

```tsx
          <Watchlist open={sidebarOpen} width={sidebarWidth} onWidthChange={setSidebarWidth} />
```

- [ ] **Step 7: Make Watchlist width-driven + add resize handle**

In `src/renderer/components/Watchlist.tsx`, replace the `Watchlist` function signature and `<aside>` block (lines 87-121) with:

```tsx
export function Watchlist({
  open,
  width,
  onWidthChange
}: {
  open: boolean
  width: number
  onWidthChange: (w: number) => void
}): React.JSX.Element {
  const watchlist = useAppStore((s) => s.watchlist)
  const [overIndex, setOverIndex] = React.useState<number | null>(null)
  const [dragging, setDragging] = React.useState(false)

  return (
    <aside
      style={{ width: open ? width : 0 }}
      className={cn(
        'relative h-full overflow-hidden border-r border-border bg-background',
        // トランジションはドラッグ中は無効（追従ラグ防止）、開閉時のみ有効。
        !dragging && 'transition-[width]'
      )}
    >
      <div className="h-full overflow-y-auto" style={{ width }}>
        {watchlist.length === 0
          ? (
            <div className="p-2 text-sm text-muted-foreground">
              Your watchlist is empty. Add symbols from search results.
            </div>
            )
          : (
            <ul onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverIndex(null) }}>
              {watchlist.map((item, i) => (
                <Row
                  key={item.symbol}
                  item={item}
                  index={i}
                  isOver={overIndex === i}
                  setOverIndex={setOverIndex}
                />
              ))}
            </ul>
            )}
      </div>
      {open && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            setDragging(true)
          }}
          onPointerMove={(e) => {
            if (!dragging) return
            const left = e.currentTarget.parentElement!.getBoundingClientRect().left
            onWidthChange(Math.min(640, Math.max(240, e.clientX - left)))
          }}
          onPointerUp={(e) => {
            e.currentTarget.releasePointerCapture(e.pointerId)
            setDragging(false)
          }}
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary"
        />
      )}
    </aside>
  )
}
```

Note: the inner `div` no longer has the fixed `w-[240px]` — it follows `width`, so `truncate`'d 社名 reveal more as the sidebar widens.

- [ ] **Step 8: Typecheck + run full test suite**

Run: `npm run typecheck && npm test`
Expected: PASS. (No unit test for the drag UI — verified manually.)

- [ ] **Step 9: Commit**

```bash
git add src/main/settings.ts src/shared/ipc.ts src/main/ipc.ts src/preload/index.ts src/renderer/App.tsx src/renderer/components/Watchlist.tsx tests/main/settings.test.ts
git commit -m "feat(sidebar): drag-resizable width (min 240) persisted to settings"
```

---

## Task 2: 行の価格を前日比で色付け + 起動時取得

**Files:**
- Modify: `src/renderer/components/Watchlist.tsx` (`Row`, lines 23-72)

**Interfaces:**
- Consumes: `computeChange(bars, '1d', undefined)` from `@/lib/priceChange` (returns `{ price: number; pct: number | null } | null`).

- [ ] **Step 1: Import computeChange**

At the top of `src/renderer/components/Watchlist.tsx`, add:

```ts
import { computeChange } from '@/lib/priceChange'
```

- [ ] **Step 2: Enable the row query + compute change**

In `Row`, replace the query block + `lastClose` (lines 23-33) with:

```tsx
  // 起動時から価格を表示する（ユーザー要望 #5）。queryFn は CacheService 経由のキャッシュ読み抜き
  // なので、キャッシュ済み銘柄は無通信、未取得の日足だけ1回フェッチ。staleTime:Infinity で以後は
  // 再取得しない。描画される行（=アクティブリスト）だけが走るので非アクティブ銘柄は取得しない。
  const { data: bars } = useQuery<Bar[]>({
    queryKey: qk.ohlcv(item.symbol, '1d'),
    queryFn: () => api.ohlcv.get(item.symbol, '1d', undefined),
    staleTime: Infinity
  })
  // 前日比（日足基準）: price=bars[-1].close, pct= (price - bars[-2].close)/bars[-2].close。
  const change = computeChange(bars, '1d', undefined)
```

- [ ] **Step 3: Color the price span**

Replace the price `<span>` (line 72) with:

```tsx
      <span
        className={cn(
          'ml-auto shrink-0 text-sm',
          change?.pct != null && (change.pct >= 0 ? 'text-green-500' : 'text-red-500')
        )}
      >
        {change ? change.price.toFixed(2) : ''}
      </span>
```

- [ ] **Step 4: Typecheck + run tests**

Run: `npm run typecheck && npm test`
Expected: PASS. (Color/fetch is component-level; the daily `computeChange` path is already covered by `tests/renderer/priceChange.test.ts`.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/Watchlist.tsx
git commit -m "feat(watchlist): color price by prior-day change and fetch on load"
```

---

## Task 3: 複数ウォッチリスト（データモデル移行 + store + 配線）

**Files:**
- Modify: `src/shared/types.ts` (append after `WatchlistItem`, line 18)
- Modify: `src/main/watchlistStore.ts` (rewrite)
- Modify: `src/shared/ipc.ts` (`Api.watchlist`, lines 55-58)
- Modify: `src/main/ipc.ts` (imports line 2, watchlist handlers lines 98-99)
- Modify: `src/preload/index.ts` (imports line 2, watchlist bridge lines 32-35)
- Modify: `src/renderer/store.ts`
- Modify: `src/renderer/App.tsx` (watchlist hydrate + persist)
- Modify: `src/renderer/components/Watchlist.tsx` (item source)
- Test: `tests/main/watchlistStore.test.ts` (rewrite), `tests/renderer/store.test.ts` (rewrite watchlist describe)

**Interfaces:**
- Produces:
  - Types `NamedWatchlist = { name: string; items: WatchlistItem[] }`, `WatchlistCollection = { version: 2; active: string; lists: NamedWatchlist[] }`.
  - `watchlistStore.getWatchlists(): WatchlistCollection`, `watchlistStore.setWatchlists(c: WatchlistCollection): void`.
  - `Api.watchlist.get(): Promise<WatchlistCollection>`, `Api.watchlist.set(c: WatchlistCollection): Promise<void>`.
  - store state `watchlists: NamedWatchlist[]`, `activeWatchlist: string`; selector `selectActiveItems(s): WatchlistItem[]`.
  - store actions (act on active list): `addToWatchlist(item)`, `removeFromWatchlist(symbol)`, `reorderWatchlist(from, to)`; plus `createWatchlist(name): WatchlistActionResult`, `renameWatchlist(from, to): WatchlistActionResult`, `deleteWatchlist(name)`, `switchWatchlist(name)`, `hydrateWatchlists(c)`.
  - `type WatchlistActionResult = { ok: true } | { ok: false; error: string }`.

### 3a — Backend types, store, migration (green: renderer wired minimally, no switcher yet)

- [ ] **Step 1: Write the failing watchlistStore tests**

Replace the body of `tests/main/watchlistStore.test.ts` with:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { WatchlistItem, WatchlistCollection } from '@shared/types'

let userDataDir: string

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir }
}))

const watchlistStore = await import('../../src/main/watchlistStore')

const aapl: WatchlistItem = { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }
const msft: WatchlistItem = { symbol: 'MSFT', name: 'Microsoft Corp.', exchange: 'NASDAQ' }

describe('watchlistStore (collection)', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'watchliststore-test-'))
  })
  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('returns a default single "Watchlist" before anything is saved', () => {
    expect(watchlistStore.getWatchlists()).toEqual({
      version: 2,
      active: 'Watchlist',
      lists: [{ name: 'Watchlist', items: [] }]
    })
  })

  it('migrates an old flat-array watchlist.json into the default list', () => {
    writeFileSync(join(userDataDir, 'watchlist.json'), JSON.stringify([aapl, msft]))
    expect(watchlistStore.getWatchlists()).toEqual({
      version: 2,
      active: 'Watchlist',
      lists: [{ name: 'Watchlist', items: [aapl, msft] }]
    })
  })

  it('drops malformed items during migration instead of throwing', () => {
    writeFileSync(
      join(userDataDir, 'watchlist.json'),
      JSON.stringify([aapl, { symbol: 'BAD' }, null, 'nonsense'])
    )
    expect(watchlistStore.getWatchlists().lists[0].items).toEqual([aapl])
  })

  it('round-trips a v2 collection through set → get', () => {
    const c: WatchlistCollection = {
      version: 2,
      active: 'Tech',
      lists: [
        { name: 'Watchlist', items: [aapl] },
        { name: 'Tech', items: [msft] }
      ]
    }
    watchlistStore.setWatchlists(c)
    expect(watchlistStore.getWatchlists()).toEqual(c)
  })

  it('falls back to active=first list when stored active name is missing', () => {
    watchlistStore.setWatchlists({ version: 2, active: 'Gone', lists: [{ name: 'Watchlist', items: [] }] })
    expect(watchlistStore.getWatchlists().active).toBe('Watchlist')
  })

  it('falls back to the default collection when watchlist.json is corrupt', () => {
    writeFileSync(join(userDataDir, 'watchlist.json'), '{not valid json')
    expect(() => watchlistStore.getWatchlists()).not.toThrow()
    expect(watchlistStore.getWatchlists().lists).toEqual([{ name: 'Watchlist', items: [] }])
  })

  it('yields a default list when the stored collection has zero lists', () => {
    watchlistStore.setWatchlists({ version: 2, active: 'x', lists: [] })
    expect(watchlistStore.getWatchlists().lists).toEqual([{ name: 'Watchlist', items: [] }])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/main/watchlistStore.test.ts`
Expected: FAIL — `getWatchlists is not a function` / type import errors.

- [ ] **Step 3: Add the collection types**

In `src/shared/types.ts`, after `export type WatchlistItem = SymbolResult` (line 18):

```ts
export type NamedWatchlist = { name: string; items: WatchlistItem[] }

// version は将来のスキーマ変更検知用。lists は最低1件を getWatchlists が保証する。
export type WatchlistCollection = {
  version: 2
  active: string
  lists: NamedWatchlist[]
}
```

- [ ] **Step 4: Rewrite watchlistStore**

Replace the whole body of `src/main/watchlistStore.ts` with:

```ts
import { app } from 'electron'
import { join } from 'path'
import { readJsonFile, writeJsonFile } from './jsonStore'
import type { WatchlistItem, NamedWatchlist, WatchlistCollection } from '@shared/types'

// ponytail: layoutStore と同じ「userData 下の小さな JSON」パターン、SEPARATE file (D-62)。
const watchlistPath = (): string => join(app.getPath('userData'), 'watchlist.json')

const DEFAULT_NAME = 'Watchlist'
const defaultCollection = (): WatchlistCollection => ({
  version: 2,
  active: DEFAULT_NAME,
  lists: [{ name: DEFAULT_NAME, items: [] }]
})

const isWellFormed = (item: unknown): item is WatchlistItem =>
  typeof item === 'object' &&
  item !== null &&
  typeof (item as WatchlistItem).symbol === 'string' &&
  typeof (item as WatchlistItem).name === 'string' &&
  typeof (item as WatchlistItem).exchange === 'string'

const isNamedList = (v: unknown): v is NamedWatchlist =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as NamedWatchlist).name === 'string' &&
  Array.isArray((v as NamedWatchlist).items)

export function getWatchlists(): WatchlistCollection {
  const raw = readJsonFile<unknown>(watchlistPath(), null)

  // 旧形式（フラット配列）→ デフォルトリストへ移行。
  if (Array.isArray(raw)) {
    return { version: 2, active: DEFAULT_NAME, lists: [{ name: DEFAULT_NAME, items: raw.filter(isWellFormed) }] }
  }

  // v2 コレクション。壊れた要素は落とし、空なら既定へ。
  if (typeof raw === 'object' && raw !== null && Array.isArray((raw as WatchlistCollection).lists)) {
    const lists = (raw as WatchlistCollection).lists
      .filter(isNamedList)
      .map((l) => ({ name: l.name, items: l.items.filter(isWellFormed) }))
    if (lists.length === 0) return defaultCollection()
    const storedActive = (raw as WatchlistCollection).active
    const active = lists.some((l) => l.name === storedActive) ? storedActive : lists[0].name
    return { version: 2, active, lists }
  }

  return defaultCollection()
}

export function setWatchlists(c: WatchlistCollection): void {
  writeJsonFile(watchlistPath(), c)
}
```

- [ ] **Step 5: Run to verify watchlistStore tests pass**

Run: `npx vitest run tests/main/watchlistStore.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Wire IPC/preload/api types to the collection**

In `src/shared/ipc.ts`, replace the `watchlist` block in `Api` (lines 55-58):

```ts
  watchlist: {
    get(): Promise<WatchlistCollection>
    set(c: WatchlistCollection): Promise<void>
  }
```

At the top of `src/shared/ipc.ts` (line 1), add `WatchlistCollection` to the type import:

```ts
import type { Bar, SymbolResult, Timeframe, DateRange, Workspace, WatchlistItem, WatchlistCollection } from './types'
```

In `src/main/ipc.ts` line 2, add `WatchlistCollection`:

```ts
import type { Timeframe, DateRange, Workspace, WatchlistCollection } from '@shared/types'
```

Replace the two watchlist handlers (lines 98-99):

```ts
  ipcMain.handle(CH.watchlistGet, () => watchlistStore.getWatchlists())
  ipcMain.handle(CH.watchlistSet, (_e, c: WatchlistCollection) => watchlistStore.setWatchlists(c))
```

(`WatchlistItem` may become unused in `ipc.ts`. Remove it from the import if `npm run typecheck` flags it — grep first: it is not referenced elsewhere in that file.)

In `src/preload/index.ts` line 2, replace `WatchlistItem` with `WatchlistCollection`:

```ts
import type { Timeframe, DateRange, Workspace, WatchlistCollection } from '@shared/types'
```

Replace the `watchlist` bridge (lines 32-35):

```ts
  watchlist: {
    get: () => ipcRenderer.invoke(CH.watchlistGet),
    set: (c: WatchlistCollection) => ipcRenderer.invoke(CH.watchlistSet, c)
  }
```

- [ ] **Step 7: Write the failing store tests (rewrite watchlist describe)**

In `tests/renderer/store.test.ts`, replace the entire `describe('watchlist', ...)` block (lines 218-252) with:

```ts
  describe('watchlists (multi-list)', () => {
    beforeEach(() => {
      useAppStore.setState({
        watchlists: [{ name: 'Watchlist', items: [] }],
        activeWatchlist: 'Watchlist'
      })
    })

    const items = () => selectActiveItems(useAppStore.getState())

    it('addToWatchlist twice with the same symbol yields one entry (dedupe, active list)', () => {
      const item = { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }
      useAppStore.getState().addToWatchlist(item)
      useAppStore.getState().addToWatchlist(item)
      expect(items()).toEqual([item])
    })

    it('removeFromWatchlist removes only the matching symbol in the active list', () => {
      const a = { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }
      const m = { symbol: 'MSFT', name: 'Microsoft Corp.', exchange: 'NASDAQ' }
      useAppStore.getState().addToWatchlist(a)
      useAppStore.getState().addToWatchlist(m)
      useAppStore.getState().removeFromWatchlist('AAPL')
      expect(items()).toEqual([m])
    })

    // マーカー(行上端 = その行の前に挿入)と実挿入位置を一致させる:
    it('reorder DOWN inserts before the target row (marker == actual)', () => {
      const [a, b, c] = [
        { symbol: 'A', name: 'A', exchange: 'NYSE' },
        { symbol: 'B', name: 'B', exchange: 'NYSE' },
        { symbol: 'C', name: 'C', exchange: 'NYSE' }
      ]
      useAppStore.setState({ watchlists: [{ name: 'Watchlist', items: [a, b, c] }], activeWatchlist: 'Watchlist' })
      // A(0) を C(index2) の上（=Cの前）にドロップ → [B, A, C]
      useAppStore.getState().reorderWatchlist(0, 2)
      expect(items()).toEqual([b, a, c])
    })

    it('reorder UP inserts before the target row', () => {
      const [a, b, c] = [
        { symbol: 'A', name: 'A', exchange: 'NYSE' },
        { symbol: 'B', name: 'B', exchange: 'NYSE' },
        { symbol: 'C', name: 'C', exchange: 'NYSE' }
      ]
      useAppStore.setState({ watchlists: [{ name: 'Watchlist', items: [a, b, c] }], activeWatchlist: 'Watchlist' })
      // C(2) を A(index0) の上にドロップ → [C, A, B]
      useAppStore.getState().reorderWatchlist(2, 0)
      expect(items()).toEqual([c, a, b])
    })

    it('createWatchlist adds a list and switches to it; rejects duplicate/empty names', () => {
      expect(useAppStore.getState().createWatchlist('Tech')).toEqual({ ok: true })
      expect(useAppStore.getState().activeWatchlist).toBe('Tech')
      expect(useAppStore.getState().createWatchlist('Tech').ok).toBe(false)
      expect(useAppStore.getState().createWatchlist('   ').ok).toBe(false)
    })

    it('switchWatchlist scopes add/remove to the active list', () => {
      const a = { symbol: 'AAPL', name: 'Apple', exchange: 'NASDAQ' }
      useAppStore.getState().createWatchlist('Tech')
      useAppStore.getState().addToWatchlist(a)
      useAppStore.getState().switchWatchlist('Watchlist')
      expect(items()).toEqual([])
      useAppStore.getState().switchWatchlist('Tech')
      expect(items()).toEqual([a])
    })

    it('renameWatchlist renames and moves active pointer; rejects duplicates', () => {
      useAppStore.getState().createWatchlist('Tech') // active = Tech
      expect(useAppStore.getState().renameWatchlist('Tech', 'Growth')).toEqual({ ok: true })
      expect(useAppStore.getState().activeWatchlist).toBe('Growth')
      expect(useAppStore.getState().renameWatchlist('Growth', 'Watchlist').ok).toBe(false)
    })

    it('deleteWatchlist protects the last list and re-points active to the first', () => {
      useAppStore.getState().createWatchlist('Tech') // lists: [Watchlist, Tech], active Tech
      useAppStore.getState().deleteWatchlist('Tech')
      expect(useAppStore.getState().watchlists.map((w) => w.name)).toEqual(['Watchlist'])
      expect(useAppStore.getState().activeWatchlist).toBe('Watchlist')
      // last list is protected — no-op
      useAppStore.getState().deleteWatchlist('Watchlist')
      expect(useAppStore.getState().watchlists).toHaveLength(1)
    })
  })
```

At the top of `tests/renderer/store.test.ts` (line 2), extend the import:

```ts
import { useAppStore, selectActiveItems } from '../../src/renderer/store'
```

- [ ] **Step 8: Run to verify store tests fail**

Run: `npx vitest run tests/renderer/store.test.ts`
Expected: FAIL — `selectActiveItems` / `createWatchlist` undefined.

- [ ] **Step 9: Update the store state, actions, and selector**

In `src/renderer/store.ts`:

a) Extend the type import (line 6) to include the new types:

```ts
import type { Cell, GridShape, IndicatorInstance, Params, Timeframe, Workspace, WatchlistItem, NamedWatchlist } from '@shared/types'
```

b) In the `AppState` type, replace the watchlist section (lines 68-71) with:

```ts
  // Persistent multi-watchlist (D-62). All actions act on the ACTIVE list; App wires
  // load-on-startup and persist-on-change. Pure state mutations (no IPC) so they're unit-testable.
  watchlists: NamedWatchlist[]
  activeWatchlist: string
  addToWatchlist: (item: WatchlistItem) => void
  removeFromWatchlist: (symbol: string) => void
  reorderWatchlist: (from: number, to: number) => void
  createWatchlist: (name: string) => WatchlistActionResult
  renameWatchlist: (from: string, to: string) => WatchlistActionResult
  deleteWatchlist: (name: string) => void
  switchWatchlist: (name: string) => void
  hydrateWatchlists: (collection: WatchlistCollection) => void
```

c) Add the result type + selector near the top of the file (after the `PALETTE` export, line 17). Also add `WatchlistCollection` to the type import in (a) — final import line:

```ts
import type { Cell, GridShape, IndicatorInstance, Params, Timeframe, Workspace, WatchlistItem, NamedWatchlist, WatchlistCollection } from '@shared/types'
```

```ts
export type WatchlistActionResult = { ok: true } | { ok: false; error: string }

// アクティブリストの items。見つからなければ空配列。found 時は items 参照が安定（再描画churn防止）。
export const selectActiveItems = (s: AppState): WatchlistItem[] =>
  s.watchlists.find((w) => w.name === s.activeWatchlist)?.items ?? []
```

d) Replace the watchlist actions at the bottom of the store (lines 286-301) with:

```ts
  watchlists: [{ name: 'Watchlist', items: [] }],
  activeWatchlist: 'Watchlist',
  addToWatchlist: (item) => set((state) => ({
    watchlists: state.watchlists.map((w) =>
      w.name === state.activeWatchlist
        ? (w.items.some((i) => i.symbol === item.symbol) ? w : { ...w, items: [...w.items, item] })
        : w
    )
  })),
  removeFromWatchlist: (symbol) => set((state) => ({
    watchlists: state.watchlists.map((w) =>
      w.name === state.activeWatchlist ? { ...w, items: w.items.filter((i) => i.symbol !== symbol) } : w
    )
  })),
  // ずれ修正: from を抜いた後の座標系に合わせ、下方向(from<to)は挿入位置を1つ詰める。
  // これでマーカー(行上端=その行の前)と実挿入位置が上下両方向で一致する。
  reorderWatchlist: (from, to) => set((state) => ({
    watchlists: state.watchlists.map((w) => {
      if (w.name !== state.activeWatchlist) return w
      const items = [...w.items]
      const [moved] = items.splice(from, 1)
      items.splice(from < to ? to - 1 : to, 0, moved)
      return { ...w, items }
    })
  })),
  createWatchlist: (name) => {
    const trimmed = name.trim()
    if (trimmed.length === 0) return { ok: false, error: 'Name cannot be empty.' }
    if (get().watchlists.some((w) => w.name === trimmed)) {
      return { ok: false, error: `A watchlist named "${trimmed}" already exists.` }
    }
    set((state) => ({ watchlists: [...state.watchlists, { name: trimmed, items: [] }], activeWatchlist: trimmed }))
    return { ok: true }
  },
  renameWatchlist: (from, to) => {
    const trimmed = to.trim()
    if (trimmed.length === 0) return { ok: false, error: 'Name cannot be empty.' }
    if (trimmed !== from && get().watchlists.some((w) => w.name === trimmed)) {
      return { ok: false, error: `A watchlist named "${trimmed}" already exists.` }
    }
    set((state) => ({
      watchlists: state.watchlists.map((w) => (w.name === from ? { ...w, name: trimmed } : w)),
      activeWatchlist: state.activeWatchlist === from ? trimmed : state.activeWatchlist
    }))
    return { ok: true }
  },
  deleteWatchlist: (name) => set((state) => {
    if (state.watchlists.length <= 1) return state // 最後の1リストは削除不可
    const watchlists = state.watchlists.filter((w) => w.name !== name)
    const activeWatchlist = state.activeWatchlist === name ? watchlists[0].name : state.activeWatchlist
    return { watchlists, activeWatchlist }
  }),
  switchWatchlist: (name) => set((state) =>
    state.watchlists.some((w) => w.name === name) ? { activeWatchlist: name } : state
  ),
  hydrateWatchlists: (collection) => set({
    watchlists: collection.lists,
    activeWatchlist: collection.active
  })
```

- [ ] **Step 10: Run store tests to verify pass**

Run: `npx vitest run tests/renderer/store.test.ts`
Expected: PASS.

- [ ] **Step 11: Update App startup + persist to the collection**

In `src/renderer/App.tsx`, replace the watchlist restore in the startup effect (lines 29-31) with:

```ts
    void api.watchlist.get().then((c) => useAppStore.getState().hydrateWatchlists(c))
```

Replace the watchlist persist effect (lines 39-52) with:

```ts
  // Persist-on-change for watchlists (debounced). Serializes the whole collection into watchlist.json.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = useAppStore.subscribe(
      (s) => [s.watchlists, s.activeWatchlist] as const,
      ([watchlists, activeWatchlist]) => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          void api.watchlist.set({ version: 2, active: activeWatchlist, lists: watchlists })
        }, 500)
      },
      { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] }
    )
    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [])
```

- [ ] **Step 12: Point Watchlist at the active list**

In `src/renderer/components/Watchlist.tsx`, replace the watchlist read inside the `Watchlist` component (from Task 1, the `const watchlist = useAppStore((s) => s.watchlist)` line) with:

```tsx
  const watchlist = useAppStore(selectActiveItems)
```

And add `selectActiveItems` to the store import at the top:

```ts
import { useAppStore, selectActiveItems } from '@/store'
```

- [ ] **Step 13: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: PASS. Fix any leftover unused imports flagged (e.g. `WatchlistItem` in `ipc.ts`/`preload`).

- [ ] **Step 14: Commit**

```bash
git add src/shared/types.ts src/main/watchlistStore.ts src/shared/ipc.ts src/main/ipc.ts src/preload/index.ts src/renderer/store.ts src/renderer/App.tsx src/renderer/components/Watchlist.tsx tests/main/watchlistStore.test.ts tests/renderer/store.test.ts
git commit -m "feat(watchlist): multi-list model with migration; fix reorder insert position"
```

---

## Task 4: ウォッチリスト切替 UI（ドロップダウン）

**Files:**
- Create: `src/renderer/components/WatchlistSwitcher.tsx`
- Modify: `src/renderer/components/Watchlist.tsx` (mount switcher at top of the scroll container)

**Interfaces:**
- Consumes: store `watchlists`, `activeWatchlist`, `createWatchlist`, `renameWatchlist`, `deleteWatchlist`, `switchWatchlist` (from Task 3).

- [ ] **Step 1: Create the switcher component**

Create `src/renderer/components/WatchlistSwitcher.tsx`:

```tsx
import React, { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { useAppStore } from '../store'

type NameDialogState = { mode: 'create' | 'rename'; value: string; error: string | null }

// サイドバー上部のウォッチリスト切替。LayoutMenu と同じ shadcn DropdownMenu パターン
// (キーボードナビ / セパレータ / 破壊的項目 / max-height スクロール)。
export function WatchlistSwitcher(): React.JSX.Element {
  const watchlists = useAppStore((s) => s.watchlists)
  const activeWatchlist = useAppStore((s) => s.activeWatchlist)
  const createWatchlist = useAppStore((s) => s.createWatchlist)
  const renameWatchlist = useAppStore((s) => s.renameWatchlist)
  const deleteWatchlist = useAppStore((s) => s.deleteWatchlist)
  const switchWatchlist = useAppStore((s) => s.switchWatchlist)

  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const confirmNameDialog = (): void => {
    if (!nameDialog) return
    const result =
      nameDialog.mode === 'create'
        ? createWatchlist(nameDialog.value)
        : renameWatchlist(activeWatchlist, nameDialog.value)
    if (!result.ok) {
      setNameDialog({ ...nameDialog, error: result.error })
      return
    }
    setNameDialog(null)
  }

  return (
    <>
      {/* modal={false}: メニュー項目から Dialog を開くときの body ロック競合を避ける (LayoutMenu と同じ)。 */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className="w-full justify-between">
            <span className="truncate" title={activeWatchlist}>{activeWatchlist}</span>
            <ChevronDown className="shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[60vh] overflow-y-auto">
          {watchlists.map((w) => (
            <DropdownMenuItem
              key={w.name}
              title={w.name}
              className="max-w-[240px] truncate"
              onClick={() => switchWatchlist(w.name)}
            >
              {w.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setNameDialog({ mode: 'create', value: '', error: null })}>
            New list…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setNameDialog({ mode: 'rename', value: activeWatchlist, error: null })}>
            Rename…
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={watchlists.length <= 1}
            className="text-destructive focus:text-destructive"
            onClick={() => setDeleteTarget(activeWatchlist)}
          >
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={nameDialog !== null} onOpenChange={(open) => { if (!open) setNameDialog(null) }}>
        <DialogContent className="p-6">
          <DialogHeader>
            <DialogTitle>{nameDialog?.mode === 'rename' ? 'Rename watchlist' : 'New watchlist'}</DialogTitle>
          </DialogHeader>
          <div className="mt-4 flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="watchlist-name">Name</label>
            <Input
              id="watchlist-name"
              value={nameDialog?.value ?? ''}
              placeholder="e.g. Tech"
              onChange={(e) => setNameDialog((prev) => (prev ? { ...prev, value: e.target.value, error: null } : prev))}
            />
            {nameDialog?.error && <p className="text-sm text-destructive">{nameDialog.error}</p>}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setNameDialog(null)}>Cancel</Button>
            <Button onClick={confirmNameDialog} disabled={(nameDialog?.value ?? '').trim().length === 0}>
              {nameDialog?.mode === 'rename' ? 'Rename' : 'Create'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent className="p-6">
          <DialogHeader>
            <DialogTitle>Delete watchlist?</DialogTitle>
          </DialogHeader>
          <p className="mt-2 text-sm text-muted-foreground">
            This removes the watchlist "{deleteTarget}" and its symbols. This can't be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => { if (deleteTarget) deleteWatchlist(deleteTarget); setDeleteTarget(null) }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
```

- [ ] **Step 2: Mount the switcher at the top of the sidebar**

In `src/renderer/components/Watchlist.tsx`, import it:

```ts
import { WatchlistSwitcher } from './WatchlistSwitcher'
```

Inside the scroll container `<div className="h-full overflow-y-auto" style={{ width }}>`, add the switcher as the first child (before the empty-state / `<ul>`):

```tsx
      <div className="h-full overflow-y-auto" style={{ width }}>
        <div className="border-b border-border p-2">
          <WatchlistSwitcher />
        </div>
        {watchlist.length === 0
          ? (
```

(Leave the rest of the container unchanged.)

- [ ] **Step 3: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Manual smoke check**

Run: `npm run dev`. Verify: create a list, switch, add symbols to different lists, rename, delete (last-list Delete disabled), widen sidebar, prices show colored on load, drag-reorder lands where the marker shows.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/WatchlistSwitcher.tsx src/renderer/components/Watchlist.tsx
git commit -m "feat(watchlist): dropdown to switch/create/rename/delete watchlists"
```

---

## Self-Review

**Spec coverage:**
1. 可変幅サイドバー（min 240）→ Task 1 ✅ (clamp 240–640, persisted, inner div follows width so names reveal).
2. 前日比で価格を色付け → Task 2 ✅ (`computeChange('1d')`, green/red matching chart).
3. ドラッグ挿入位置ずれ → Task 3 step 9 `reorderWatchlist` `from<to?to-1:to` ✅ (tests: up & down).
4. 複数ウォッチリスト切替 → Task 3 (model/store/migration) + Task 4 (UI) ✅.
5. 価格を最初から取得表示 → Task 2 step 2 (`enabled` removed → default true, cache-read-through) ✅.

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✅

**Type consistency:** `getWatchlists`/`setWatchlists`, `WatchlistCollection {version:2, active, lists}`, `NamedWatchlist {name, items}`, `selectActiveItems`, `WatchlistActionResult`, `createWatchlist`/`renameWatchlist` return `WatchlistActionResult`, `hydrateWatchlists(collection)` — used consistently across store, tests, App, switcher. `Watchlist` props `{open,width,onWidthChange}` consistent between App (Task 1) and component. ✅

**Notes / known simplifications:**
- App width-persist effect writes the default 240 once on first mount before load resolves — harmless (noted inline).
- No component-level unit tests for drag-resize / switcher (repo has none; verified via typecheck + manual dev smoke). Reorder logic and migration are unit-tested.
- Dropping below the last row isn't a drop target (before-row semantics only) — out of scope, unchanged from current behavior.
