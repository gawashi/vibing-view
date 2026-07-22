# ワークスペース統合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ウォッチリストとグリッドレイアウトを、切り替えると両方が一緒に変わる1つの名前付き「Workspace」に統合する。

**Architecture:** コード上の grid 型 `Workspace` を `Layout` に改名し、新 `Workspace = { name, items, layout }` を導入。永続化は `watchlist.json` + `layouts.json` を1本の `workspaces.json`（`WorkspaceCollection` v3）へ統合し、初回起動時に旧ファイルから一度だけ移行する。切替器はヘッダーの `WorkspaceSwitcher` 一本に集約。

**Tech Stack:** TypeScript, React 19, Zustand 5, Electron 43, Vitest 3, electron-vite。

## Global Constraints

- Pin Vite at `^7`（electron-vite@5 は Vite 8 を peer 宣言していない）。
- better-sqlite3 は Electron の Node ABI に対してリビルド（`postinstall` の `electron-builder install-app-deps` が担う）。
- JSON（layouts/watchlists/window state）は `app.getPath('userData')` 下、SQLite は OHLCV キャッシュ専用。両者を混ぜない。この機能は JSON 側のみ触り、SQLite 読み抜きキャッシュ層は一切変更しない。
- `technicalindicators` / `react-financial-charts` は使わない。
- main プロセスは layout 形状を検証しない「dumb persister」。renderer の `parseLayout` / `parseWorkspaceCollection` が信頼境界を持つ。
- コマンド: テスト `npx vitest run <path>` / 全テスト `npm test` / 型検査 `npm run typecheck` / ビルド `npm run build`。

---

### Task 1: grid 型 `Workspace` を `Layout` に一括改名

新 `Workspace`（コンテナ）と衝突しないよう、既存の grid 型を機械的に `Layout` へ改名する。挙動変更なし。全テストが安全網。

**Files:**
- Modify: `src/shared/types.ts:66-71`
- Modify: `src/renderer/workspace.ts:1,23,35,49,88`
- Modify: `src/renderer/store.ts`（import と `defaultWorkspace`/`parseWorkspace`/`currentWorkspace`/`hydrate` の型）
- Modify: `src/renderer/App.tsx`（`parseWorkspace` import と使用箇所）
- Modify: `src/shared/ipc.ts:1,68-76`
- Modify: `src/preload/index.ts:2,34-42`
- Modify: `src/main/ipc.ts:2,140-146`
- Modify: `src/main/layoutStore.ts:4,19,33`
- Modify: `tests/main/layoutStore.test.ts:5,18,60,75`
- Modify: `tests/renderer/store.test.ts:3,84,115,137,155`

**Interfaces:**
- Produces: `type Layout = { schemaVersion: number; cells: Cell[]; shape: GridShape; activeCellId: string }`（旧 `Workspace`）、`parseLayout(raw: unknown): Layout | null`、`defaultLayout(cellId: string, volId: string): Layout`。

- [ ] **Step 1: `src/shared/types.ts` の grid 型を改名**

```ts
// 旧 export type Workspace = { ... } を Layout に
export type Layout = {
  schemaVersion: number
  cells: Cell[]
  shape: GridShape
  activeCellId: string
}
```

- [ ] **Step 2: `src/renderer/workspace.ts` を改名**

- import: `... Timeframe, Workspace } from '@shared/types'` → `... Timeframe, Layout } from '@shared/types'`
- `export function defaultWorkspace(cellId: string, volId: string): Workspace` → `export function defaultLayout(cellId: string, volId: string): Layout`
- `export function parseWorkspace(raw: unknown): Workspace | null` → `export function parseLayout(raw: unknown): Layout | null`
- 関数本体の型注釈 `Workspace` はすべて `Layout` に置換（`newCellSeed`/`duplicateCell`/`parseCell` は変更なし）。

- [ ] **Step 3: `src/renderer/store.ts` の参照を更新**

- `@shared/types` import の `Workspace` → `Layout`
- `./workspace` import: `defaultWorkspace` → `defaultLayout`、`parseWorkspace` → `parseLayout`
- `const initialWorkspace = defaultWorkspace(...)` → `const initialLayout = defaultLayout(...)` とし、`initialWorkspace.cells/activeCellId/shape` を `initialLayout.*` に置換
- AppState 型と実装の `currentWorkspace: () => Workspace` → `() => Layout`、`hydrate: (ws: Workspace)` → `(ws: Layout)`
- `switchToLayout` 内 `parseWorkspace(raw)` → `parseLayout(raw)`

- [ ] **Step 4: `App.tsx` / `ipc.ts`(shared,main) / `preload` / `layoutStore.ts` / 両テストの `Workspace` を `Layout` に置換**

- `src/renderer/App.tsx`: `import { parseWorkspace }` → `import { parseLayout }`、`parseWorkspace(raw)` → `parseLayout(raw)`
- `src/shared/ipc.ts`: `import type { ... Workspace ... }` → `Layout`、`Api.layout` の `Workspace` を `Layout` に
- `src/preload/index.ts`: 同上（`(ws: Workspace)` → `(ws: Layout)`）
- `src/main/ipc.ts`: 同上
- `src/main/layoutStore.ts`: `import type { Workspace }` → `Layout`、関数引数の `Workspace` を `Layout` に
- `tests/main/layoutStore.test.ts` と `tests/renderer/store.test.ts`: `import ... Workspace` → `Layout`、`const ws: Workspace` / `const ws2: Workspace` を `Layout` に

- [ ] **Step 5: 型検査とテスト**

Run: `npm run typecheck && npm test`
Expected: PASS（改名のみ、赤なし）

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: grid 型 Workspace を Layout に改名"
```

---

### Task 2: 新コンテナ型と renderer パース／既定レイアウト

新 `Workspace` / `WorkspaceCollection` 型を追加し、renderer に `parseWorkspaceCollection` と空レイアウト（symbol=null）を用意する。既定チャートの初期銘柄 AAPL を廃止する。

**Files:**
- Modify: `src/shared/types.ts`（末尾に新型を追加）
- Modify: `src/renderer/workspace.ts`（`newCellSeed` の symbol を null に、`emptyLayout`/`parseWorkspaceCollection`/`defaultWorkspaceCollection` を追加）
- Create: `tests/renderer/workspace.test.ts`

**Interfaces:**
- Consumes: `Layout`, `parseLayout`（Task 1）
- Produces:
  - `type Workspace = { name: string; items: WatchlistItem[]; layout: Layout }`
  - `type WorkspaceCollection = { version: 3; active: string; workspaces: Workspace[] }`
  - `emptyLayout(): Layout`（1x1・単一セル・symbol=null・固定 Volume のみ）
  - `parseWorkspaceCollection(raw: unknown): WorkspaceCollection`（never throws、常に workspaces.length ≥ 1、active は必ず実在名）
  - `defaultWorkspaceCollection(): WorkspaceCollection`（`Workspace 1` 1件）

- [ ] **Step 1: `src/shared/types.ts` に新型を追加**

`WatchlistItem` / `NamedWatchlist` / `WatchlistCollection` は移行入力用に残す。末尾（`Layout` の下）に追記:

```ts
// 名前付き作業コンテキスト = ウォッチリスト + グリッドレイアウト
export type Workspace = {
  name: string
  items: WatchlistItem[]
  layout: Layout
}

export type WorkspaceCollection = {
  version: 3
  active: string
  workspaces: Workspace[]
}
```

- [ ] **Step 2: 失敗するテストを書く** — `tests/renderer/workspace.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import {
  emptyLayout,
  parseWorkspaceCollection,
  defaultWorkspaceCollection
} from '../../src/renderer/workspace'

const aapl = { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }

describe('emptyLayout', () => {
  it('is a 1x1 grid with an empty (null-symbol) cell that keeps the fixed Volume', () => {
    const l = emptyLayout()
    expect(l.shape).toBe('1x1')
    expect(l.cells).toHaveLength(1)
    expect(l.cells[0].symbol).toBeNull()
    const vol = l.cells[0].indicators.find((i) => i.type === 'volume')
    expect(vol?.fixed).toBe(true)
  })
})

describe('parseWorkspaceCollection', () => {
  it('returns the default single "Workspace 1" for non-object input', () => {
    expect(parseWorkspaceCollection(null)).toEqual(defaultWorkspaceCollection())
    expect(parseWorkspaceCollection(defaultWorkspaceCollection())).toEqual(defaultWorkspaceCollection())
  })

  it('round-trips a valid collection and preserves the active name', () => {
    const c = {
      version: 3,
      active: 'Scan',
      workspaces: [
        { name: 'Main', items: [aapl], layout: emptyLayout() },
        { name: 'Scan', items: [], layout: emptyLayout() }
      ]
    }
    expect(parseWorkspaceCollection(c)).toEqual(c)
  })

  it('falls back active to the first workspace when the stored active is missing', () => {
    const c = { version: 3, active: 'Gone', workspaces: [{ name: 'Main', items: [], layout: emptyLayout() }] }
    expect(parseWorkspaceCollection(c).active).toBe('Main')
  })

  it('replaces an invalid layout with emptyLayout instead of dropping the workspace', () => {
    const c = { version: 3, active: 'Main', workspaces: [{ name: 'Main', items: [], layout: 42 }] }
    const parsed = parseWorkspaceCollection(c)
    expect(parsed.workspaces[0].layout).toEqual(emptyLayout())
  })

  it('drops nameless workspaces and malformed items, defaulting when all drop', () => {
    const c = {
      version: 3,
      active: 'Main',
      workspaces: [
        { name: 'Main', items: [aapl, { symbol: 'BAD' }, null], layout: emptyLayout() },
        { items: [], layout: emptyLayout() }
      ]
    }
    const parsed = parseWorkspaceCollection(c)
    expect(parsed.workspaces).toHaveLength(1)
    expect(parsed.workspaces[0].items).toEqual([aapl])
    expect(parseWorkspaceCollection({ version: 3, active: 'x', workspaces: [] })).toEqual(defaultWorkspaceCollection())
  })
})
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npx vitest run tests/renderer/workspace.test.ts`
Expected: FAIL（`emptyLayout` などが未 export）

- [ ] **Step 4: `src/renderer/workspace.ts` を実装**

`newCellSeed` の symbol を null に変更:

```ts
export function newCellSeed(id: string, volId: string): Cell {
  return {
    id,
    symbol: null,
    timeframe: '1d',
    indicators: [{ id: volId, type: 'volume', params: {}, colors: {}, visible: true, fixed: true }]
  }
}
```

ファイル末尾に追加（`WatchlistItem`, `Workspace`, `WorkspaceCollection` を import 型に追加）:

```ts
// 永続化シード用の静的id空レイアウト。store は hydrate 時に nextId を再シードし id を癒すので、
// 固定 id '1'/'2' が実行時に衝突することはない。
export function emptyLayout(): Layout {
  return {
    schemaVersion: SCHEMA_VERSION,
    cells: [
      {
        id: '1',
        symbol: null,
        timeframe: '1d',
        indicators: [{ id: '2', type: 'volume', params: {}, colors: {}, visible: true, fixed: true }]
      }
    ],
    shape: '1x1',
    activeCellId: '1'
  }
}

const isWatchlistItem = (v: unknown): v is WatchlistItem =>
  isRecord(v) &&
  typeof v.symbol === 'string' &&
  typeof v.name === 'string' &&
  typeof v.exchange === 'string'

function parseWorkspaceEntry(raw: unknown): Workspace | null {
  if (!isRecord(raw) || typeof raw.name !== 'string') return null
  const items = Array.isArray(raw.items) ? raw.items.filter(isWatchlistItem) : []
  const layout = parseLayout(raw.layout) ?? emptyLayout()
  return { name: raw.name, items, layout }
}

export function defaultWorkspaceCollection(): WorkspaceCollection {
  return { version: 3, active: 'Workspace 1', workspaces: [{ name: 'Workspace 1', items: [], layout: emptyLayout() }] }
}

// never throws。workspaces は最低1件、active は必ず実在名に正規化。
export function parseWorkspaceCollection(raw: unknown): WorkspaceCollection {
  if (!isRecord(raw)) return defaultWorkspaceCollection()
  const workspaces = Array.isArray(raw.workspaces)
    ? raw.workspaces.map(parseWorkspaceEntry).filter((w): w is Workspace => w !== null)
    : []
  if (workspaces.length === 0) return defaultWorkspaceCollection()
  const active =
    typeof raw.active === 'string' && workspaces.some((w) => w.name === raw.active)
      ? raw.active
      : workspaces[0].name
  return { version: 3, active, workspaces }
}
```

import 行を更新: `import type { Cell, GridShape, IndicatorInstance, Timeframe, Layout, Workspace, WorkspaceCollection, WatchlistItem } from '@shared/types'`

- [ ] **Step 5: テストが通ることを確認（＋全体退行なし）**

Run: `npx vitest run tests/renderer/workspace.test.ts && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(workspace): 新コンテナ型・parseWorkspaceCollection・空レイアウト"
```

---

### Task 3: main の `workspaceStore` と旧データ移行

`workspaces.json` の read/write と、初回起動時の `watchlist.json` + `layouts.json` からの一度きり移行を実装する。旧 store はまだ消さない。

**Files:**
- Create: `src/main/workspaceStore.ts`
- Create: `tests/main/workspaceStore.test.ts`

**Interfaces:**
- Consumes: `WorkspaceCollection`, `Workspace`, `Layout`, `WatchlistItem`, `NamedWatchlist`, `WatchlistCollection`（`@shared/types`）、`readJsonFile`/`writeJsonFile`（`./jsonStore`）
- Produces: `getWorkspaces(): WorkspaceCollection`、`setWorkspaces(c: WorkspaceCollection): void`

- [ ] **Step 1: 失敗するテストを書く** — `tests/main/workspaceStore.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { WorkspaceCollection } from '@shared/types'

let userDataDir: string
vi.mock('electron', () => ({ app: { getPath: () => userDataDir } }))

const store = await import('../../src/main/workspaceStore')

const aapl = { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }
const msft = { symbol: 'MSFT', name: 'Microsoft Corp.', exchange: 'NASDAQ' }
const layoutL = { schemaVersion: 1, cells: [{ id: 'c1', symbol: 'AAPL', timeframe: '1d', indicators: [] }], shape: '1x1', activeCellId: 'c1' }

describe('workspaceStore', () => {
  beforeEach(() => { userDataDir = mkdtempSync(join(tmpdir(), 'wsstore-test-')) })
  afterEach(() => { rmSync(userDataDir, { recursive: true, force: true }) })

  it('returns a default single "Workspace 1" on a clean install', () => {
    const c = store.getWorkspaces()
    expect(c.active).toBe('Workspace 1')
    expect(c.workspaces.map((w) => w.name)).toEqual(['Workspace 1'])
    expect(c.workspaces[0].items).toEqual([])
    expect(c.workspaces[0].layout.cells[0].symbol).toBeNull()
  })

  it('round-trips a v3 collection through set → get', () => {
    const c: WorkspaceCollection = {
      version: 3,
      active: 'Scan',
      workspaces: [
        { name: 'Main', items: [aapl], layout: layoutL },
        { name: 'Scan', items: [], layout: layoutL }
      ]
    }
    store.setWorkspaces(c)
    expect(store.getWorkspaces()).toEqual(c)
  })

  it('migrates legacy watchlist.json (v2) + layouts.json: active list carries the current layout, others default', () => {
    writeFileSync(join(userDataDir, 'watchlist.json'), JSON.stringify({
      version: 2, active: 'Tech',
      lists: [{ name: 'Watchlist', items: [aapl] }, { name: 'Tech', items: [msft] }]
    }))
    writeFileSync(join(userDataDir, 'layouts.json'), JSON.stringify({ current: layoutL, named: {} }))

    const c = store.getWorkspaces()
    expect(c.active).toBe('Tech')
    expect(c.workspaces.map((w) => w.name)).toEqual(['Watchlist', 'Tech'])
    expect(c.workspaces.find((w) => w.name === 'Tech')!.layout).toEqual(layoutL)
    expect(c.workspaces.find((w) => w.name === 'Tech')!.items).toEqual([msft])
    // non-active list gets the empty default layout
    expect(c.workspaces.find((w) => w.name === 'Watchlist')!.layout.cells[0].symbol).toBeNull()
  })

  it('migrates an old flat-array watchlist.json into the active default workspace', () => {
    writeFileSync(join(userDataDir, 'watchlist.json'), JSON.stringify([aapl, msft]))
    writeFileSync(join(userDataDir, 'layouts.json'), JSON.stringify({ current: layoutL, named: {} }))
    const c = store.getWorkspaces()
    expect(c.workspaces).toHaveLength(1)
    expect(c.workspaces[0].name).toBe('Watchlist')
    expect(c.workspaces[0].items).toEqual([aapl, msft])
    expect(c.workspaces[0].layout).toEqual(layoutL)
  })

  it('does NOT re-migrate once workspaces.json exists (even if legacy files remain)', () => {
    store.setWorkspaces({ version: 3, active: 'Kept', workspaces: [{ name: 'Kept', items: [], layout: layoutL }] })
    writeFileSync(join(userDataDir, 'watchlist.json'), JSON.stringify({ version: 2, active: 'Old', lists: [{ name: 'Old', items: [aapl] }] }))
    expect(store.getWorkspaces().workspaces.map((w) => w.name)).toEqual(['Kept'])
  })

  it('falls back to default (not migration) when an existing workspaces.json is corrupt', () => {
    writeFileSync(join(userDataDir, 'workspaces.json'), '{not valid json')
    writeFileSync(join(userDataDir, 'watchlist.json'), JSON.stringify({ version: 2, active: 'Old', lists: [{ name: 'Old', items: [aapl] }] }))
    expect(() => store.getWorkspaces()).not.toThrow()
    expect(store.getWorkspaces().workspaces.map((w) => w.name)).toEqual(['Workspace 1'])
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/main/workspaceStore.test.ts`
Expected: FAIL（`src/main/workspaceStore` が存在しない）

- [ ] **Step 3: `src/main/workspaceStore.ts` を実装**

```ts
import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { readJsonFile, writeJsonFile } from './jsonStore'
import type { WatchlistItem, NamedWatchlist, Layout, Workspace, WorkspaceCollection } from '@shared/types'

const workspacesPath = (): string => join(app.getPath('userData'), 'workspaces.json')
const watchlistPath = (): string => join(app.getPath('userData'), 'watchlist.json')
const layoutsPath = (): string => join(app.getPath('userData'), 'layouts.json')

const DEFAULT_NAME = 'Workspace 1'
const LEGACY_DEFAULT_NAME = 'Watchlist'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

// renderer/workspace.ts の emptyLayout と同じ形（main からは import できないため複製）。
const emptyLayout = (): Layout => ({
  schemaVersion: 1,
  cells: [
    { id: '1', symbol: null, timeframe: '1d', indicators: [{ id: '2', type: 'volume', params: {}, colors: {}, visible: true, fixed: true }] }
  ],
  shape: '1x1',
  activeCellId: '1'
})

const defaultCollection = (): WorkspaceCollection => ({
  version: 3,
  active: DEFAULT_NAME,
  workspaces: [{ name: DEFAULT_NAME, items: [], layout: emptyLayout() }]
})

const isWellFormedItem = (v: unknown): v is WatchlistItem =>
  isRecord(v) && typeof v.symbol === 'string' && typeof v.name === 'string' && typeof v.exchange === 'string'

const isWorkspace = (v: unknown): v is Workspace =>
  isRecord(v) && typeof v.name === 'string' && Array.isArray(v.items) && isRecord(v.layout)

// 既存 v3 を検証（layout は不透明のまま。renderer の parseWorkspaceCollection が最終検証）。
function validateV3(raw: unknown): WorkspaceCollection | null {
  if (!isRecord(raw) || !Array.isArray(raw.workspaces)) return null
  const workspaces = raw.workspaces
    .filter(isWorkspace)
    .map((w) => ({ name: w.name, items: w.items.filter(isWellFormedItem), layout: w.layout }))
  if (workspaces.length === 0) return null
  const active = typeof raw.active === 'string' && workspaces.some((w) => w.name === raw.active) ? raw.active : workspaces[0].name
  return { version: 3, active, workspaces }
}

// 旧 watchlist.json を { active, lists } に正規化。無い/壊れている/空なら null。
function readLegacyWatchlists(): { active: string; lists: NamedWatchlist[] } | null {
  const raw = readJsonFile<unknown>(watchlistPath(), null)
  if (Array.isArray(raw)) {
    return { active: LEGACY_DEFAULT_NAME, lists: [{ name: LEGACY_DEFAULT_NAME, items: raw.filter(isWellFormedItem) }] }
  }
  if (isRecord(raw) && Array.isArray(raw.lists)) {
    const lists = (raw.lists as unknown[])
      .filter((l): l is NamedWatchlist => isRecord(l) && typeof l.name === 'string' && Array.isArray(l.items))
      .map((l) => ({ name: l.name, items: l.items.filter(isWellFormedItem) }))
    if (lists.length === 0) return null
    const active = typeof raw.active === 'string' && lists.some((l) => l.name === raw.active) ? raw.active : lists[0].name
    return { active, lists }
  }
  return null
}

function readLegacyCurrentLayout(): Layout | null {
  const raw = readJsonFile<{ current?: unknown }>(layoutsPath(), { current: null })
  return isRecord(raw) && isRecord(raw.current) ? (raw.current as Layout) : null
}

function migrateFromLegacy(): WorkspaceCollection | null {
  const legacy = readLegacyWatchlists()
  if (!legacy) return null
  const current = readLegacyCurrentLayout()
  const workspaces = legacy.lists.map((l) => ({
    name: l.name,
    items: l.items,
    layout: l.name === legacy.active && current ? current : emptyLayout()
  }))
  return { version: 3, active: legacy.active, workspaces }
}

export function getWorkspaces(): WorkspaceCollection {
  if (existsSync(workspacesPath())) {
    return validateV3(readJsonFile<unknown>(workspacesPath(), null)) ?? defaultCollection()
  }
  return migrateFromLegacy() ?? defaultCollection()
}

export function setWorkspaces(c: WorkspaceCollection): void {
  writeJsonFile(workspacesPath(), c)
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/main/workspaceStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(main): workspaceStore と旧データ移行"
```

---

### Task 4: IPC / preload / Api に workspaces チャンネルを追加

`workspaces:get` / `workspaces:set` を追加配線する（旧 layout/watchlist はまだ残す）。

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc.ts`

**Interfaces:**
- Consumes: `workspaceStore.getWorkspaces/setWorkspaces`（Task 3）、`WorkspaceCollection`
- Produces: `window.api.workspaces.get(): Promise<WorkspaceCollection>`、`window.api.workspaces.set(c): Promise<void>`

- [ ] **Step 1: `src/shared/ipc.ts` にチャンネルと Api を追加**

`CH` に追加:

```ts
  workspacesGet: 'workspaces:get',
  workspacesSet: 'workspaces:set'
```

import に `WorkspaceCollection` を追加。`Api` インターフェースに追加:

```ts
  workspaces: {
    get(): Promise<WorkspaceCollection>
    set(c: WorkspaceCollection): Promise<void>
  }
```

- [ ] **Step 2: `src/preload/index.ts` に実装を追加**

import に `WorkspaceCollection` を追加。`api` オブジェクトに追加:

```ts
  workspaces: {
    get: () => ipcRenderer.invoke(CH.workspacesGet),
    set: (c: WorkspaceCollection) => ipcRenderer.invoke(CH.workspacesSet, c)
  }
```

- [ ] **Step 3: `src/main/ipc.ts` にハンドラを追加**

import に追加: `import * as workspaceStore from './workspaceStore'`、型 import に `WorkspaceCollection`。ハンドラ追加（watchlist ハンドラの近く）:

```ts
  ipcMain.handle(CH.workspacesGet, () => workspaceStore.getWorkspaces())
  ipcMain.handle(CH.workspacesSet, (_e, c: WorkspaceCollection) => workspaceStore.setWorkspaces(c))
```

- [ ] **Step 4: 型検査とテスト**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ipc): workspaces:get/set チャンネル追加"
```

---

### Task 5: renderer 切替（store 統合 + WorkspaceSwitcher + App 配線）

store を workspaces ベースに統合し、`WorkspaceSwitcher` を新設、App/Watchlist/ヘッダーを差し替える。`LayoutMenu`/`WatchlistSwitcher` を削除。互いに参照し合うため1コミットで green にする。`store.test` は component を import しないので単独で先に green にできる。

**Files:**
- Modify: `src/renderer/store.ts`
- Modify: `tests/renderer/store.test.ts`（watchlist describe を workspaces に書き換え）
- Create: `src/renderer/components/WorkspaceSwitcher.tsx`
- Delete: `src/renderer/components/LayoutMenu.tsx`
- Delete: `src/renderer/components/WatchlistSwitcher.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/Watchlist.tsx`

**Interfaces:**
- Consumes: `parseWorkspaceCollection`, `emptyLayout`, `defaultLayout`（Task 2）、`api.workspaces`（Task 4）
- Produces（store）:
  - state: `workspaces: Workspace[]`、`activeWorkspace: string`
  - `currentLayout(): Layout`
  - `hydrateWorkspaces(c: WorkspaceCollection): void`
  - `switchWorkspace(name: string): void`
  - `createWorkspace(name: string): WatchlistActionResult`
  - `duplicateWorkspace(name: string): WatchlistActionResult`
  - `renameWorkspace(from: string, to: string): WatchlistActionResult`
  - `deleteWorkspace(name: string): void`
  - `reorderWorkspaces(from: number, to: number): WatchlistActionResult`
  - 据え置き（アクティブ Workspace の items を対象）: `addToWatchlist`, `removeFromWatchlist`, `reorderWatchlist`, `selectActiveItems`

- [ ] **Step 1: `store.test.ts` の watchlist describe を workspaces に書き換え（失敗テスト）**

`describe('watchlists (multi-list)', ...)` ブロック全体を以下で置換:

```ts
  describe('workspaces (unified list + layout)', () => {
    const L = (symbol: string | null, id = 'x1') => ({
      schemaVersion: 1,
      cells: [{ id, symbol, timeframe: '1d' as const, indicators: [] }],
      shape: '1x1' as const,
      activeCellId: id
    })

    beforeEach(() => {
      useAppStore.setState({
        cells: L('AAPL', 'c1').cells,
        shape: '1x1',
        activeCellId: 'c1',
        workspaces: [{ name: 'Workspace 1', items: [], layout: L('AAPL', 'c1') }],
        activeWorkspace: 'Workspace 1'
      })
    })

    const items = () => selectActiveItems(useAppStore.getState())

    it('addToWatchlist dedupes and scopes to the active workspace', () => {
      const a = { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }
      useAppStore.getState().addToWatchlist(a)
      useAppStore.getState().addToWatchlist(a)
      expect(items()).toEqual([a])
    })

    it('removeFromWatchlist removes only the matching symbol in the active workspace', () => {
      const a = { symbol: 'AAPL', name: 'Apple', exchange: 'NASDAQ' }
      const m = { symbol: 'MSFT', name: 'Microsoft', exchange: 'NASDAQ' }
      useAppStore.getState().addToWatchlist(a)
      useAppStore.getState().addToWatchlist(m)
      useAppStore.getState().removeFromWatchlist('AAPL')
      expect(items()).toEqual([m])
    })

    it('reorderWatchlist DOWN inserts before the target row', () => {
      const [a, b, c] = [
        { symbol: 'A', name: 'A', exchange: 'NYSE' },
        { symbol: 'B', name: 'B', exchange: 'NYSE' },
        { symbol: 'C', name: 'C', exchange: 'NYSE' }
      ]
      useAppStore.setState({ workspaces: [{ name: 'Workspace 1', items: [a, b, c], layout: L('AAPL') }], activeWorkspace: 'Workspace 1' })
      useAppStore.getState().reorderWatchlist(0, 2)
      expect(items()).toEqual([b, a, c])
    })

    it('reorderWatchlist to length moves the item to the last slot', () => {
      const [a, b, c] = [
        { symbol: 'A', name: 'A', exchange: 'NYSE' },
        { symbol: 'B', name: 'B', exchange: 'NYSE' },
        { symbol: 'C', name: 'C', exchange: 'NYSE' }
      ]
      useAppStore.setState({ workspaces: [{ name: 'Workspace 1', items: [a, b, c], layout: L('AAPL') }], activeWorkspace: 'Workspace 1' })
      useAppStore.getState().reorderWatchlist(0, 3)
      expect(items()).toEqual([b, c, a])
    })

    it('switchWorkspace snapshots the current grid into the old workspace and loads the target layout', () => {
      useAppStore.setState({
        cells: L('MSFT', 'c1').cells, shape: '1x1', activeCellId: 'c1',
        workspaces: [
          { name: 'Workspace 1', items: [], layout: L('MSFT', 'c1') },
          { name: 'Scan', items: [], layout: { schemaVersion: 1, cells: [{ id: 'd1', symbol: 'GOOG', timeframe: '1h', indicators: [] }], shape: '1x1', activeCellId: 'd1' } }
        ],
        activeWorkspace: 'Workspace 1'
      })
      useAppStore.getState().setActiveSymbol('TSLA')
      useAppStore.getState().switchWorkspace('Scan')

      const s = useAppStore.getState()
      expect(s.activeWorkspace).toBe('Scan')
      expect(s.cells[0].symbol).toBe('GOOG')
      expect(s.cells[0].timeframe).toBe('1h')
      expect(s.workspaces.find((w) => w.name === 'Workspace 1')!.layout.cells[0].symbol).toBe('TSLA')
    })

    it('createWorkspace adds an empty workspace, switches to it, and loads an empty grid', () => {
      useAppStore.getState().setActiveSymbol('AAPL')
      expect(useAppStore.getState().createWorkspace('B')).toEqual({ ok: true })
      const s = useAppStore.getState()
      expect(s.activeWorkspace).toBe('B')
      expect(s.cells[0].symbol).toBeNull()
      expect(s.workspaces.find((w) => w.name === 'Workspace 1')!.layout.cells[0].symbol).toBe('AAPL')
      expect(useAppStore.getState().createWorkspace('B').ok).toBe(false)
      expect(useAppStore.getState().createWorkspace('   ').ok).toBe(false)
    })

    it('duplicateWorkspace copies the current grid and active items into a new active workspace', () => {
      const a = { symbol: 'AAPL', name: 'Apple', exchange: 'NASDAQ' }
      useAppStore.setState({
        cells: L('AAPL', 'c1').cells, shape: '1x1', activeCellId: 'c1',
        workspaces: [{ name: 'A', items: [a], layout: L('AAPL', 'c1') }],
        activeWorkspace: 'A'
      })
      expect(useAppStore.getState().duplicateWorkspace('A copy')).toEqual({ ok: true })
      const copy = useAppStore.getState().workspaces.find((w) => w.name === 'A copy')!
      expect(useAppStore.getState().activeWorkspace).toBe('A copy')
      expect(copy.items).toEqual([a])
      expect(copy.layout.cells[0].symbol).toBe('AAPL')
    })

    it('renameWorkspace renames and moves the active pointer; rejects duplicates', () => {
      useAppStore.getState().createWorkspace('Tech')
      expect(useAppStore.getState().renameWorkspace('Tech', 'Growth')).toEqual({ ok: true })
      expect(useAppStore.getState().activeWorkspace).toBe('Growth')
      expect(useAppStore.getState().renameWorkspace('Growth', 'Workspace 1').ok).toBe(false)
    })

    it('deleteWorkspace protects the last workspace and re-points active to the first survivor', () => {
      useAppStore.setState({
        cells: L('AAPL', 'c1').cells, shape: '1x1', activeCellId: 'c1',
        workspaces: [
          { name: 'A', items: [], layout: L('AAPL', 'a1') },
          { name: 'B', items: [], layout: L('MSFT', 'b1') }
        ],
        activeWorkspace: 'A'
      })
      useAppStore.getState().deleteWorkspace('A')
      expect(useAppStore.getState().workspaces.map((w) => w.name)).toEqual(['B'])
      expect(useAppStore.getState().activeWorkspace).toBe('B')
      expect(useAppStore.getState().cells[0].symbol).toBe('MSFT')
      useAppStore.getState().deleteWorkspace('B')
      expect(useAppStore.getState().workspaces).toHaveLength(1)
    })

    it('reorderWorkspaces moves a workspace without touching the active pointer; rejects bad indices', () => {
      useAppStore.setState({
        workspaces: [
          { name: 'A', items: [], layout: L(null) },
          { name: 'B', items: [], layout: L(null) },
          { name: 'C', items: [], layout: L(null) }
        ],
        activeWorkspace: 'A'
      })
      expect(useAppStore.getState().reorderWorkspaces(0, 1)).toEqual({ ok: true })
      expect(useAppStore.getState().workspaces.map((w) => w.name)).toEqual(['B', 'A', 'C'])
      expect(useAppStore.getState().activeWorkspace).toBe('A')
      expect(useAppStore.getState().reorderWorkspaces(0, 5).ok).toBe(false)
      expect(useAppStore.getState().reorderWorkspaces(1, 1).ok).toBe(false)
    })

    it('hydrateWorkspaces loads the collection and the active workspace layout', () => {
      useAppStore.getState().hydrateWorkspaces({
        version: 3,
        active: 'Two',
        workspaces: [
          { name: 'One', items: [], layout: L('AAPL', 'o1') },
          { name: 'Two', items: [], layout: L('NVDA', 't1') }
        ]
      })
      expect(useAppStore.getState().activeWorkspace).toBe('Two')
      expect(useAppStore.getState().cells[0].symbol).toBe('NVDA')
    })
  })
```

- [ ] **Step 2: store.test が失敗することを確認**

Run: `npx vitest run tests/renderer/store.test.ts`
Expected: FAIL（`workspaces`/`switchWorkspace` などが未定義）

- [ ] **Step 3: `src/renderer/store.ts` を統合実装**

import 更新: `@shared/types` から `Workspace`, `WorkspaceCollection` を追加し `NamedWatchlist`, `WatchlistCollection` を削除（`Layout`, `WatchlistItem` は残す）。`./workspace` import から（`switchToLayout` 撤去で不要になる）`parseLayout` を削除し `defaultLayout, duplicateCell, SCHEMA_VERSION, VISIBLE_COUNT` を残す（`emptyLayout` は store では使わない）。

`selectActiveItems` を差し替え:

```ts
export const selectActiveItems = (s: AppState): WatchlistItem[] =>
  s.workspaces.find((w) => w.name === s.activeWorkspace)?.items ?? []
```

初期化を差し替え（`const initialLayout = defaultLayout(...)` は Task 1 で導入済み）:

```ts
  workspaces: [{ name: 'Workspace 1', items: [], layout: initialLayout }],
  activeWorkspace: 'Workspace 1',
```

AppState 型の layout 系（`activeLayoutName`, `currentWorkspace`, `saveLayoutAs`, `saveActiveLayout`, `renameActiveLayout`, `deleteLayout`, `switchToLayout`）と watchlist 系（`watchlists`, `activeWatchlist`, `createWatchlist`, `renameWatchlist`, `deleteWatchlist`, `switchWatchlist`, `reorderWatchlists`, `hydrateWatchlists`）の宣言を削除し、以下の宣言に置換:

```ts
  currentLayout: () => Layout
  workspaces: Workspace[]
  activeWorkspace: string
  addToWatchlist: (item: WatchlistItem) => void
  removeFromWatchlist: (symbol: string) => void
  reorderWatchlist: (from: number, to: number) => void
  reorderWorkspaces: (from: number, to: number) => WatchlistActionResult
  createWorkspace: (name: string) => WatchlistActionResult
  duplicateWorkspace: (name: string) => WatchlistActionResult
  renameWorkspace: (from: string, to: string) => WatchlistActionResult
  deleteWorkspace: (name: string) => void
  switchWorkspace: (name: string) => void
  hydrateWorkspaces: (collection: WorkspaceCollection) => void
```

実装側: `currentWorkspace` を `currentLayout` に改名（本体そのまま）。layout 系アクション（`saveLayoutAs`〜`switchToLayout`）と旧 watchlist 系アクションの実装ブロックを削除し、以下に置換:

```ts
  currentLayout: () => {
    const { cells, shape, activeCellId } = get()
    return { schemaVersion: SCHEMA_VERSION, cells, shape, activeCellId }
  },

  workspaces: [{ name: 'Workspace 1', items: [], layout: initialLayout }],
  activeWorkspace: 'Workspace 1',

  // アクティブ Workspace の layout を現在のホットなグリッドで置き換えた workspaces を返す（純粋）。
  // 切替/作成/削除の直前に呼び、編集中のグリッドを取りこぼさない。
  // (helper は store 内クロージャに閉じ込める)
  addToWatchlist: (item) => set((state) => ({
    workspaces: state.workspaces.map((w) =>
      w.name === state.activeWorkspace
        ? (w.items.some((i) => i.symbol === item.symbol) ? w : { ...w, items: [...w.items, item] })
        : w
    )
  })),
  removeFromWatchlist: (symbol) => set((state) => ({
    workspaces: state.workspaces.map((w) =>
      w.name === state.activeWorkspace ? { ...w, items: w.items.filter((i) => i.symbol !== symbol) } : w
    )
  })),
  reorderWatchlist: (from, to) => set((state) => ({
    workspaces: state.workspaces.map((w) => {
      if (w.name !== state.activeWorkspace) return w
      const items = [...w.items]
      const [moved] = items.splice(from, 1)
      items.splice(from < to ? to - 1 : to, 0, moved)
      return { ...w, items }
    })
  })),
  reorderWorkspaces: (from, to) => {
    const n = get().workspaces.length
    if (from < 0 || from >= n || to < 0 || to >= n || from === to) return { ok: false, error: 'Invalid index.' }
    set((state) => {
      const list = [...state.workspaces]
      const [moved] = list.splice(from, 1)
      list.splice(to, 0, moved)
      return { workspaces: list }
    })
    return { ok: true }
  },
  createWorkspace: (name) => {
    const trimmed = name.trim()
    if (trimmed.length === 0) return { ok: false, error: 'Name cannot be empty.' }
    if (get().workspaces.some((w) => w.name === trimmed)) {
      return { ok: false, error: `A workspace named "${trimmed}" already exists.` }
    }
    const layout = defaultLayout(String(nextId++), String(nextId++))
    const snapshot = snapshotActive()
    set({ workspaces: [...snapshot, { name: trimmed, items: [], layout }], activeWorkspace: trimmed })
    get().hydrate(layout)
    return { ok: true }
  },
  duplicateWorkspace: (name) => {
    const trimmed = name.trim()
    if (trimmed.length === 0) return { ok: false, error: 'Name cannot be empty.' }
    if (get().workspaces.some((w) => w.name === trimmed)) {
      return { ok: false, error: `A workspace named "${trimmed}" already exists.` }
    }
    const layout = get().currentLayout()
    const items = selectActiveItems(get()).map((i) => ({ ...i }))
    const snapshot = snapshotActive()
    set({ workspaces: [...snapshot, { name: trimmed, items, layout }], activeWorkspace: trimmed })
    get().hydrate(layout)
    return { ok: true }
  },
  renameWorkspace: (from, to) => {
    const trimmed = to.trim()
    if (trimmed.length === 0) return { ok: false, error: 'Name cannot be empty.' }
    if (trimmed !== from && get().workspaces.some((w) => w.name === trimmed)) {
      return { ok: false, error: `A workspace named "${trimmed}" already exists.` }
    }
    set((state) => ({
      workspaces: state.workspaces.map((w) => (w.name === from ? { ...w, name: trimmed } : w)),
      activeWorkspace: state.activeWorkspace === from ? trimmed : state.activeWorkspace
    }))
    return { ok: true }
  },
  deleteWorkspace: (name) => {
    const state = get()
    if (state.workspaces.length <= 1) return
    const remaining = snapshotActive().filter((w) => w.name !== name)
    if (state.activeWorkspace === name) {
      const next = remaining[0]
      set({ workspaces: remaining, activeWorkspace: next.name })
      get().hydrate(next.layout)
    } else {
      set({ workspaces: remaining })
    }
  },
  switchWorkspace: (name) => {
    const state = get()
    if (name === state.activeWorkspace) return
    const target = state.workspaces.find((w) => w.name === name)
    if (!target) return
    set({ workspaces: snapshotActive(), activeWorkspace: name })
    get().hydrate(target.layout)
  },
  hydrateWorkspaces: (collection) => {
    const active = collection.workspaces.find((w) => w.name === collection.active) ?? collection.workspaces[0]
    set({ workspaces: collection.workspaces, activeWorkspace: collection.active })
    get().hydrate(active.layout)
  }
```

`snapshotActive` を store ファクトリ内（`create(...(set, get) => { ... })` の本体先頭、`return { ... }` の前）に定義。現状 `subscribeWithSelector((set, get) => ({ ... }))` は即オブジェクトを返しているので、ブロック本体に変える:

```ts
export const useAppStore = create<AppState>()(subscribeWithSelector((set, get) => {
  // アクティブ Workspace の layout を現在のホットなグリッドで差し替えた配列を返す（純粋）。
  const snapshotActive = (): Workspace[] => {
    const { workspaces, activeWorkspace } = get()
    const layout = get().currentLayout()
    return workspaces.map((w) => (w.name === activeWorkspace ? { ...w, layout } : w))
  }
  return {
    // ...既存の state/アクション全部...
  }
}))
```

- [ ] **Step 4: store.test が通ることを確認**

Run: `npx vitest run tests/renderer/store.test.ts`
Expected: PASS

- [ ] **Step 5: `WorkspaceSwitcher.tsx` を新設**

```tsx
import React, { useState } from 'react'
import { ChevronDown, ChevronUp, Copy, Pencil, Plus, Trash2 } from 'lucide-react'
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

type NameDialogState = { mode: 'create' | 'rename' | 'duplicate'; value: string; error: string | null; target: string }

// ヘッダーの統合切替器。ワークスペース（= リスト + グリッド）の切替・並べ替え・rename・delete と、
// 新規作成／現在の複製。切り替えるとサイドバーの銘柄リストとグリッドが一緒に変わる。
export function WorkspaceSwitcher(): React.JSX.Element {
  const workspaces = useAppStore((s) => s.workspaces)
  const activeWorkspace = useAppStore((s) => s.activeWorkspace)
  const createWorkspace = useAppStore((s) => s.createWorkspace)
  const duplicateWorkspace = useAppStore((s) => s.duplicateWorkspace)
  const renameWorkspace = useAppStore((s) => s.renameWorkspace)
  const deleteWorkspace = useAppStore((s) => s.deleteWorkspace)
  const switchWorkspace = useAppStore((s) => s.switchWorkspace)
  const reorderWorkspaces = useAppStore((s) => s.reorderWorkspaces)

  const [menuOpen, setMenuOpen] = useState(false)
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const confirmNameDialog = (): void => {
    if (!nameDialog) return
    const result =
      nameDialog.mode === 'create'
        ? createWorkspace(nameDialog.value)
        : nameDialog.mode === 'duplicate'
          ? duplicateWorkspace(nameDialog.value)
          : renameWorkspace(nameDialog.target, nameDialog.value)
    if (!result.ok) {
      setNameDialog({ ...nameDialog, error: result.error })
      return
    }
    setNameDialog(null)
  }

  const dialogTitle =
    nameDialog?.mode === 'rename' ? 'Rename workspace' : nameDialog?.mode === 'duplicate' ? 'Duplicate workspace' : 'New workspace'

  return (
    <>
      {/* modal={false}: メニュー項目から Dialog を開くときの body ロック競合を避ける（旧 LayoutMenu と同じ）。 */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className="max-w-[220px]">
            <span className="truncate" title={activeWorkspace}>{activeWorkspace}</span>
            <ChevronDown className="shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[60vh] overflow-y-auto">
          {workspaces.map((w, i) => (
            <div
              key={w.name}
              className={`group flex items-center gap-1 rounded-sm px-2 py-1.5 text-sm ${
                w.name === activeWorkspace ? 'bg-accent text-accent-foreground' : ''
              }`}
            >
              <button
                type="button"
                title={w.name}
                className="min-w-0 flex-1 truncate text-left"
                onClick={() => { switchWorkspace(w.name); setMenuOpen(false) }}
              >
                {w.name}
              </button>
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  type="button"
                  aria-label="Move up"
                  disabled={i === 0}
                  className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
                  onClick={(e) => { e.stopPropagation(); reorderWorkspaces(i, i - 1) }}
                >
                  <ChevronUp className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  disabled={i === workspaces.length - 1}
                  className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
                  onClick={(e) => { e.stopPropagation(); reorderWorkspaces(i, i + 1) }}
                >
                  <ChevronDown className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Rename"
                  className="rounded p-0.5 hover:bg-muted"
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuOpen(false)
                    setNameDialog({ mode: 'rename', value: w.name, error: null, target: w.name })
                  }}
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Delete"
                  disabled={workspaces.length <= 1}
                  className="rounded p-0.5 text-destructive hover:bg-muted disabled:opacity-30"
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setDeleteTarget(w.name) }}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setNameDialog({ mode: 'create', value: '', error: null, target: '' })}>
            <Plus className="size-4" /> New workspace…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setNameDialog({ mode: 'duplicate', value: `${activeWorkspace} copy`, error: null, target: activeWorkspace })}>
            <Copy className="size-4" /> Duplicate current…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={nameDialog !== null} onOpenChange={(open) => { if (!open) setNameDialog(null) }}>
        <DialogContent className="p-6">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="mt-4 flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="workspace-name">Name</label>
            <Input
              id="workspace-name"
              value={nameDialog?.value ?? ''}
              placeholder="e.g. Morning watch"
              autoFocus
              onChange={(e) => setNameDialog((prev) => (prev ? { ...prev, value: e.target.value, error: null } : prev))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (nameDialog?.value ?? '').trim().length > 0) {
                  e.preventDefault()
                  confirmNameDialog()
                }
              }}
            />
            {nameDialog?.error && <p className="text-sm text-destructive">{nameDialog.error}</p>}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setNameDialog(null)}>Cancel</Button>
            <Button onClick={confirmNameDialog} disabled={(nameDialog?.value ?? '').trim().length === 0}>
              {nameDialog?.mode === 'rename' ? 'Rename' : nameDialog?.mode === 'duplicate' ? 'Duplicate' : 'Create'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent className="p-6">
          <DialogHeader>
            <DialogTitle>Delete workspace?</DialogTitle>
          </DialogHeader>
          <p className="mt-2 text-sm text-muted-foreground">
            This removes the workspace "{deleteTarget}", its watchlist, and its layout. This can't be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { if (deleteTarget) deleteWorkspace(deleteTarget); setDeleteTarget(null) }}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
```

- [ ] **Step 6: `LayoutMenu.tsx` と `WatchlistSwitcher.tsx` を削除**

```bash
git rm src/renderer/components/LayoutMenu.tsx src/renderer/components/WatchlistSwitcher.tsx
```

- [ ] **Step 7: `App.tsx` を差し替え**

- import: `import { LayoutMenu } from './components/LayoutMenu'` を `import { WorkspaceSwitcher } from './components/WorkspaceSwitcher'` に。`import { parseWorkspace } from './workspace'` を `import { parseWorkspaceCollection } from './workspace'` に。
- 起動 effect（`useEffect` 内）の layout/watchlist 復元2行を1本化:

```ts
    void api.workspaces.get().then((raw) => {
      useAppStore.getState().hydrateWorkspaces(parseWorkspaceCollection(raw))
    })
```

（`api.layout.getCurrent()...` と `api.watchlist.get()...` の2ブロックを上記1つに置換。theme/sidebar の3行は据え置き。）

- watchlists 永続化の `useEffect`（`s.watchlists, s.activeWatchlist` を購読しているもの）を削除。
- workspace 自動保存の `useEffect`（`s.cells, s.shape, s.activeCellId` を購読しているもの）を、workspaces も含む1本に置換:

```ts
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = useAppStore.subscribe(
      (s) => [s.cells, s.shape, s.activeCellId, s.workspaces, s.activeWorkspace] as const,
      () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          const s = useAppStore.getState()
          const layout = s.currentLayout()
          const workspaces = s.workspaces.map((w) => (w.name === s.activeWorkspace ? { ...w, layout } : w))
          void api.workspaces.set({ version: 3, active: s.activeWorkspace, workspaces })
        }, 500)
      },
      { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] }
    )
    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [])
```

- ヘッダー内 `<LayoutMenu />` を `<WorkspaceSwitcher />` に置換。

- [ ] **Step 8: `Watchlist.tsx` からサイドバー切替器を除去**

- `import { WatchlistSwitcher } from './WatchlistSwitcher'` を削除。
- サイドバー先頭の切替器ブロックを削除:

```tsx
        <div className="border-b border-border p-2">
          <WatchlistSwitcher />
        </div>
```

（銘柄リスト（`watchlist.length === 0 ? ... : <ul>...`）はそのまま残す。）

- [ ] **Step 9: 型検査・全テスト・ビルド**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(renderer): Workspace 統合（store/切替器/App 配線）"
```

---

### Task 6: 旧 layout/watchlist IPC と main store を撤去

renderer が参照しなくなった旧チャンネル・旧 store を削除する。純粋な削除。

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc.ts`
- Delete: `src/main/layoutStore.ts`, `src/main/watchlistStore.ts`
- Delete: `tests/main/layoutStore.test.ts`, `tests/main/watchlistStore.test.ts`

**Interfaces:**
- Produces: `Api` から `layout` と `watchlist` を除去した最終形（`workspaces` のみ）。

- [ ] **Step 1: `src/shared/ipc.ts` の旧チャンネル・型を削除**

- `CH` から `layoutGetCurrent`〜`layoutRename`、`watchlistGet`、`watchlistSet` を削除。
- import から未使用になった `Layout`, `WatchlistCollection` を削除（`WorkspaceCollection` は残す）。
- `Api` から `layout: {...}` と `watchlist: {...}` ブロックを削除。

- [ ] **Step 2: `src/preload/index.ts` の旧実装を削除**

- `api` から `layout: {...}` と `watchlist: {...}` を削除。
- import から未使用の `Layout`, `WatchlistCollection` を削除。

- [ ] **Step 3: `src/main/ipc.ts` の旧ハンドラ・import を削除**

- `import * as layoutStore` と `import * as watchlistStore` を削除。
- `CH.layout*` 7 ハンドラと `CH.watchlistGet`/`CH.watchlistSet` 2 ハンドラを削除。
- 型 import から未使用の `Layout`, `WatchlistCollection` を削除。

- [ ] **Step 4: 旧 store とテストを削除**

```bash
git rm src/main/layoutStore.ts src/main/watchlistStore.ts tests/main/layoutStore.test.ts tests/main/watchlistStore.test.ts
```

- [ ] **Step 5: 型検査・全テスト・ビルド**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: 旧 layout/watchlist IPC と store を撤去"
```

---

## Notes

- 旧 `watchlist.json` / `layouts.json` はディスクから削除しない（移行後も安全側で残す）。
- サイドバー幅・開閉・テーマは従来どおり `settings.json`。SQLite の OHLCV 読み抜きキャッシュは無変更。
- スコープ外（将来余地）: 銘柄の全セルへのブロードキャスト、リストのグリッドへの一括流し込み、セルのピン留め。
