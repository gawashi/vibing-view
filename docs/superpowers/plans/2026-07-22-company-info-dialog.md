# Company Info Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Right-click a chart cell → "Show company info" → a dialog shows the symbol's company profile (summary attributes + market metrics), fetched from FMP, cached on disk with a 1-day TTL.

**Architecture:** New `company` namespace kept strictly separate from the existing symbol-resolution `profile`. Main: `FmpProvider.getCompanyProfile` → `CompanyInfoService` (TTL read-through) → `company_profiles` SQLite table (JSON blob). Renderer: a zustand-held `companyInfoSymbol` opens a TanStack-Query-backed `CompanyInfoDialog`; a Radix context menu on each grid cell triggers it.

**Tech Stack:** TypeScript + React 19, Electron, better-sqlite3 + drizzle-orm, zod, TanStack Query, zustand, Radix UI (shadcn wrappers), Vitest.

## Global Constraints

- Pin Vite at `^7`. (already satisfied — do not touch)
- better-sqlite3 must be rebuilt against Electron's Node ABI (postinstall `electron-builder install-app-deps` handles it). After adding the npm dependency, re-run install so the postinstall fires.
- SQLite = OHLCV/company cache; JSON (`userData`) = user preferences. Company profiles go in SQLite.
- Path aliases: `@shared` → `src/shared`, `@` → `src/renderer`. Tests live in `tests/**/*.test.ts` (node env).
- The existing `profile` namespace (`ProfileService` / `symbol_profiles` / `symbols:profile`) is symbol-name resolution ONLY. Do NOT reuse or modify it. This feature uses the `company` namespace exclusively.
- Do not add tests that call `getDb()` (native better-sqlite3 bound to Electron). Existing db tests only cover pure functions; follow that convention.

---

### Task 1: Shared contract — types, IPC channel, Api interface, preload bridge

Defines the cross-process contract so every later task compiles against stable names. No runtime logic → no unit test; `npm run typecheck` is the gate.

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Produces: `CompanyProfileData` (JSON-blob shape) and `CompanyInfo = CompanyProfileData & { fetchedAt: number }` in `@shared/types`; `CH.companyInfo = 'company:info'`; `Api.company.info(symbol: string): Promise<CompanyInfo>`; `window.api.company.info`.

- [ ] **Step 1: Add the `CompanyProfileData` / `CompanyInfo` types**

Append to `src/shared/types.ts` (after the `WorkspaceCollection` block):

```typescript
// 会社情報ダイアログ用（既存 SymbolResult/profile とは別物 — company 名前空間）。
// nullable なのは FMP profile が欠損しうるため。数値は string 混在を coerce 済み。
export type CompanyProfileData = {
  symbol: string
  companyName: string
  image: string | null
  exchange: string | null
  sector: string | null
  industry: string | null
  country: string | null
  marketCap: number | null
  ceo: string | null
  fullTimeEmployees: number | null
  ipoDate: string | null
  website: string | null
  description: string | null
  beta: number | null
  range: string | null
  volume: number | null
  averageVolume: number | null
  lastDividend: number | null
}

// fetchedAt は列で持ちダイアログの「as of YYYY-MM-DD」表記に使う（blob には含めない）。
export type CompanyInfo = CompanyProfileData & { fetchedAt: number }
```

> Note: the spec sketched `CompanyProfileData` living in `companyProfileStore.ts`. It's defined in `@shared/types` instead so the provider (which must not import from `db/`) and the store can both reference it without a layering violation.

- [ ] **Step 2: Add the IPC channel and Api surface**

In `src/shared/ipc.ts`, extend the import and the `CH` object and the `Api` interface:

Change line 1 from:
```typescript
import type { Bar, SymbolResult, Timeframe, DateRange, WorkspaceCollection, Quote, MarketStatus } from './types'
```
to:
```typescript
import type { Bar, SymbolResult, Timeframe, DateRange, WorkspaceCollection, Quote, MarketStatus, CompanyInfo } from './types'
```

Add to the `CH` object (after `workspacesSet: 'workspaces:set'`, keeping it inside the `} as const`):
```typescript
  workspacesSet: 'workspaces:set',
  companyInfo: 'company:info'
```

Add to the `Api` interface (after the `symbols` block):
```typescript
  company: {
    info(symbol: string): Promise<CompanyInfo>
  }
```

- [ ] **Step 3: Wire the preload bridge**

In `src/preload/index.ts`, add to the `api` object (after the `symbols` block):
```typescript
  company: {
    info: (symbol) => ipcRenderer.invoke(CH.companyInfo, symbol)
  },
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (`Api.company.info` is declared and implemented in preload; main handler comes in Task 5 — typecheck of preload/shared passes now.)

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/shared/ipc.ts src/preload/index.ts
git commit -m "feat(company): shared CompanyInfo contract + preload bridge"
```

---

### Task 2: DB layer — schema, raw table create, companyProfileStore

**Files:**
- Modify: `src/main/db/schema.ts`
- Modify: `src/main/db/client.ts`
- Create: `src/main/db/companyProfileStore.ts`

**Interfaces:**
- Consumes: `CompanyProfileData` from `@shared/types` (Task 1).
- Produces: `companyProfiles` drizzle table; `getCompanyProfile(symbol): { data: CompanyProfileData; fetchedAt: number } | null`; `upsertCompanyProfile(symbol: string, data: CompanyProfileData, fetchedAt: number): void`.

- [ ] **Step 1: Declare the drizzle table**

Append to `src/main/db/schema.ts`:
```typescript
// 会社情報キャッシュ。data は CompanyProfileData(fetchedAt 除く) の JSON blob 一本 —
// フィールド追加時のマイグレーションを不要にする。fetched_at は TTL 判定用の列。
export const companyProfiles = sqliteTable('company_profiles', {
  symbol: text('symbol').primaryKey(),
  data: text('data').notNull(),
  fetchedAt: integer('fetched_at').notNull()
})
```

- [ ] **Step 2: Add the raw CREATE TABLE (REQUIRED — drizzle declaration alone does not create it)**

In `src/main/db/client.ts`, inside the `sqlite.exec(\`...\`)` block, add after the `symbol_profiles` table (before the closing `` ); ``):
```sql
    CREATE TABLE IF NOT EXISTS company_profiles (
      symbol TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at INTEGER NOT NULL
    );
```

So the exec block ends:
```typescript
    CREATE TABLE IF NOT EXISTS symbol_profiles (
      symbol TEXT PRIMARY KEY, name TEXT NOT NULL, exchange TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS company_profiles (
      symbol TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at INTEGER NOT NULL
    );
  `)
```

- [ ] **Step 3: Write the store**

Create `src/main/db/companyProfileStore.ts`:
```typescript
import { eq } from 'drizzle-orm'
import type { CompanyProfileData } from '@shared/types'
import { getDb } from './client'
import { companyProfiles } from './schema'

// data 列は CompanyProfileData の JSON blob。fetchedAt は列で持ち、CompanyInfo への組み立ては
// CompanyInfoService 側で行う（ここは純粋な blob の read/write のみ）。
export function getCompanyProfile(symbol: string): { data: CompanyProfileData; fetchedAt: number } | null {
  const row = getDb().select().from(companyProfiles)
    .where(eq(companyProfiles.symbol, symbol)).get()
  return row ? { data: JSON.parse(row.data) as CompanyProfileData, fetchedAt: row.fetchedAt } : null
}

export function upsertCompanyProfile(symbol: string, data: CompanyProfileData, fetchedAt: number): void {
  const blob = JSON.stringify(data)
  getDb().insert(companyProfiles)
    .values({ symbol, data: blob, fetchedAt })
    .onConflictDoUpdate({
      target: companyProfiles.symbol,
      set: { data: blob, fetchedAt }
    })
    .run()
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/db/schema.ts src/main/db/client.ts src/main/db/companyProfileStore.ts
git commit -m "feat(company): company_profiles table + JSON-blob store"
```

---

### Task 3: Provider — fmpProfileResponse schema + FmpProvider.getCompanyProfile (TDD)

**Files:**
- Modify: `src/main/providers/fmp.schema.ts`
- Modify: `src/main/providers/FmpProvider.ts`
- Create: `tests/fixtures/fmp-profile.json`
- Modify: `tests/main/providers/FmpProvider.test.ts`

**Interfaces:**
- Consumes: `CompanyProfileData` from `@shared/types`; existing `parseOrThrowHttpError`, `FmpHttpError`, `BASE` in `FmpProvider.ts`.
- Produces: `fmpProfileResponse` zod array schema; `FmpProvider.getCompanyProfile(symbol: string): Promise<CompanyProfileData>`.

- [ ] **Step 1: Add the fixture**

Create `tests/fixtures/fmp-profile.json` (note `fullTimeEmployees` is a string — exercises coercion):
```json
[
  {
    "symbol": "AAPL",
    "companyName": "Apple Inc.",
    "image": "https://images.financialmodelingprep.com/symbol/AAPL.png",
    "exchange": "NASDAQ",
    "sector": "Technology",
    "industry": "Consumer Electronics",
    "country": "US",
    "marketCap": 3400000000000,
    "ceo": "Mr. Timothy D. Cook",
    "fullTimeEmployees": "164000",
    "ipoDate": "1980-12-12",
    "website": "https://www.apple.com",
    "description": "Apple Inc. designs, manufactures, and markets smartphones, personal computers, tablets, wearables, and accessories worldwide.",
    "beta": 1.24,
    "range": "164.08-260.1",
    "volume": 41000000,
    "averageVolume": 55000000,
    "lastDividend": 1.0,
    "cik": "0000320193",
    "isin": "US0378331005"
  }
]
```

- [ ] **Step 2: Write the failing tests**

Add to `tests/main/providers/FmpProvider.test.ts` (new `describe` block at the end of the file):
```typescript
describe('FmpProvider.getCompanyProfile', () => {
  it('maps the first row to CompanyProfileData, coercing string numbers', async () => {
    const c = await provider(fx('fmp-profile.json')).getCompanyProfile('AAPL')
    expect(c.symbol).toBe('AAPL')
    expect(c.companyName).toBe('Apple Inc.')
    expect(c.exchange).toBe('NASDAQ')
    expect(c.marketCap).toBe(3400000000000)
    expect(c.fullTimeEmployees).toBe(164000) // "164000" string coerced to number
    expect(c.beta).toBe(1.24)
    expect(c.image).toBe('https://images.financialmodelingprep.com/symbol/AAPL.png')
  })

  it('calls /stable/profile with the symbol', async () => {
    const httpGetJson = vi.fn(async (_url: string) => fx('fmp-profile.json'))
    await new FmpProvider({ apiKey: 'k', httpGetJson }).getCompanyProfile('AAPL')
    expect(httpGetJson.mock.calls[0][0]).toContain('/profile?symbol=AAPL')
  })

  it('throws FmpHttpError(200) on an empty array', async () => {
    let caught: unknown
    try { await provider([]).getCompanyProfile('AAPL') } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(FmpHttpError)
    expect((caught as FmpHttpError).status).toBe(200)
  })

  it('wraps an error-shaped 200 payload as FmpHttpError(200)', async () => {
    await expect(provider(fx('fmp-error.json')).getCompanyProfile('AAPL')).rejects.toThrow()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/main/providers/FmpProvider.test.ts`
Expected: FAIL — `getCompanyProfile is not a function` (and `fmpProfileResponse` unresolved once you wire the provider).

- [ ] **Step 4: Add the schema**

Append to `src/main/providers/fmp.schema.ts`:
```typescript
// /stable/profile returns a flat array; we consume element [0]. Only the fields the dialog shows
// are typed — everything else is passthrough (CUSIP/ISIN/address/phone etc. are out of scope).
// Numeric fields are z.coerce.number() because FMP mixes string/number (e.g. fullTimeEmployees).
// .nullable() short-circuits null BEFORE coercion, so a real null stays null (not coerced to 0).
export const fmpProfileRow = z.object({
  symbol: z.string(),
  companyName: z.string(),
  image: z.string().nullable().optional(),
  exchange: z.string().nullable().optional(),
  sector: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  marketCap: z.coerce.number().nullable().optional(),
  ceo: z.string().nullable().optional(),
  fullTimeEmployees: z.coerce.number().nullable().optional(),
  ipoDate: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  beta: z.coerce.number().nullable().optional(),
  range: z.string().nullable().optional(),
  volume: z.coerce.number().nullable().optional(),
  averageVolume: z.coerce.number().nullable().optional(),
  lastDividend: z.coerce.number().nullable().optional()
}).passthrough()
export const fmpProfileResponse = z.array(fmpProfileRow)
```

- [ ] **Step 5: Add the provider method**

In `src/main/providers/FmpProvider.ts`:

Add `CompanyProfileData` to the `@shared/types` import (line 3):
```typescript
import type { Bar, SymbolResult, Timeframe, DateRange, Quote, MarketStatus, CompanyProfileData } from '@shared/types'
```

Add `fmpProfileResponse` to the schema import (line 4):
```typescript
import { fmpHistoricalResponse, fmpSearchResponse, fmpQuoteResponse, fmpMarketHoursResponse, fmpProfileResponse } from './fmp.schema'
```

Add this method to the `FmpProvider` class (after `getMarketStatus`, before the closing `}`):
```typescript
  async getCompanyProfile(symbol: string): Promise<CompanyProfileData> {
    const url = `${BASE}/profile?symbol=${encodeURIComponent(symbol)}&apikey=${this.apiKey}`
    const rows = this.parseOrThrowHttpError(fmpProfileResponse, await this.httpGetJson(url))
    const r = rows[0]
    if (!r) throw new FmpHttpError(200, rows) // empty array = not covered → classifiable
    return {
      symbol: r.symbol,
      companyName: r.companyName,
      image: r.image ?? null,
      exchange: r.exchange ?? null,
      sector: r.sector ?? null,
      industry: r.industry ?? null,
      country: r.country ?? null,
      marketCap: r.marketCap ?? null,
      ceo: r.ceo ?? null,
      fullTimeEmployees: r.fullTimeEmployees ?? null,
      ipoDate: r.ipoDate ?? null,
      website: r.website ?? null,
      description: r.description ?? null,
      beta: r.beta ?? null,
      range: r.range ?? null,
      volume: r.volume ?? null,
      averageVolume: r.averageVolume ?? null,
      lastDividend: r.lastDividend ?? null
    }
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/main/providers/FmpProvider.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 7: Commit**

```bash
git add src/main/providers/fmp.schema.ts src/main/providers/FmpProvider.ts tests/fixtures/fmp-profile.json tests/main/providers/FmpProvider.test.ts
git commit -m "feat(company): FmpProvider.getCompanyProfile + profile schema"
```

---

### Task 4: CompanyInfoService — TTL read-through with stale fallback (TDD, self-check)

This is the spec's required self-check (fresh→cache / stale→refetch / fetch-fail→stale fallback).

**Files:**
- Create: `src/main/profile/CompanyInfoService.ts`
- Create: `tests/main/profile/CompanyInfoService.test.ts`

**Interfaces:**
- Consumes: `CompanyInfo`, `CompanyProfileData` from `@shared/types`; a `store` matching `companyProfileStore`'s shape (Task 2); a `fetch(symbol) => Promise<CompanyProfileData>` (wired to the provider in Task 5).
- Produces: `createCompanyInfoService(deps) => { getInfo(symbol: string): Promise<CompanyInfo> }`.

- [ ] **Step 1: Write the failing test**

Create `tests/main/profile/CompanyInfoService.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { createCompanyInfoService } from '../../../src/main/profile/CompanyInfoService'
import type { CompanyProfileData } from '@shared/types'

const DATA: CompanyProfileData = {
  symbol: 'AAPL', companyName: 'Apple Inc.', image: null, exchange: 'NASDAQ',
  sector: 'Technology', industry: 'Consumer Electronics', country: 'US',
  marketCap: 3.4e12, ceo: 'Tim Cook', fullTimeEmployees: 164000, ipoDate: '1980-12-12',
  website: 'https://apple.com', description: 'desc', beta: 1.24, range: '164-260',
  volume: 41000000, averageVolume: 55000000, lastDividend: 1
}

const NOW = 1_000_000 // epoch seconds (fixed clock)

function fakeStore(initial: { data: CompanyProfileData; fetchedAt: number } | null = null) {
  let stored = initial
  return {
    getCompanyProfile: vi.fn(() => stored),
    upsertCompanyProfile: vi.fn((_s: string, data: CompanyProfileData, fetchedAt: number) => {
      stored = { data, fetchedAt }
    })
  }
}

describe('CompanyInfoService.getInfo', () => {
  it('returns the cached row without fetching when fresh (within TTL)', async () => {
    const store = fakeStore({ data: DATA, fetchedAt: NOW - 100 })
    const fetch = vi.fn()
    const svc = createCompanyInfoService({ store, fetch, now: () => NOW })
    const info = await svc.getInfo('AAPL')
    expect(fetch).not.toHaveBeenCalled()
    expect(info).toEqual({ ...DATA, fetchedAt: NOW - 100 })
  })

  it('refetches and upserts when the row is stale (past TTL)', async () => {
    const store = fakeStore({ data: DATA, fetchedAt: NOW - 90_000 }) // > 86400
    const fetch = vi.fn(async () => DATA)
    const svc = createCompanyInfoService({ store, fetch, now: () => NOW })
    const info = await svc.getInfo('AAPL')
    expect(fetch).toHaveBeenCalledOnce()
    expect(store.upsertCompanyProfile).toHaveBeenCalledWith('AAPL', DATA, NOW)
    expect(info).toEqual({ ...DATA, fetchedAt: NOW })
  })

  it('fetches and upserts on a cache miss (no row)', async () => {
    const store = fakeStore(null)
    const fetch = vi.fn(async () => DATA)
    const svc = createCompanyInfoService({ store, fetch, now: () => NOW })
    const info = await svc.getInfo('AAPL')
    expect(fetch).toHaveBeenCalledOnce()
    expect(store.upsertCompanyProfile).toHaveBeenCalledWith('AAPL', DATA, NOW)
    expect(info).toEqual({ ...DATA, fetchedAt: NOW })
  })

  it('falls back to a stale row when the fetch fails', async () => {
    const store = fakeStore({ data: DATA, fetchedAt: NOW - 90_000 })
    const fetch = vi.fn(async () => { throw new Error('rate limited') })
    const svc = createCompanyInfoService({ store, fetch, now: () => NOW })
    const info = await svc.getInfo('AAPL')
    expect(info).toEqual({ ...DATA, fetchedAt: NOW - 90_000 })
  })

  it('rethrows when the fetch fails and there is no row', async () => {
    const store = fakeStore(null)
    const fetch = vi.fn(async () => { throw new Error('down') })
    const svc = createCompanyInfoService({ store, fetch, now: () => NOW })
    await expect(svc.getInfo('AAPL')).rejects.toThrow('down')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/main/profile/CompanyInfoService.test.ts`
Expected: FAIL — cannot resolve `createCompanyInfoService`.

- [ ] **Step 3: Write the service**

Create `src/main/profile/CompanyInfoService.ts`:
```typescript
import type { CompanyInfo, CompanyProfileData } from '@shared/types'

// TTL = 1 day. Fresh row → cache hit (no network). Stale/missing → provider fetch + upsert.
// Fetch fails but a stale row exists → return stale (better than an empty dialog); no row → rethrow.
const TTL_SECONDS = 86400

export function createCompanyInfoService(deps: {
  store: {
    getCompanyProfile(symbol: string): { data: CompanyProfileData; fetchedAt: number } | null
    upsertCompanyProfile(symbol: string, data: CompanyProfileData, fetchedAt: number): void
  }
  fetch: (symbol: string) => Promise<CompanyProfileData>
  now?: () => number // epoch seconds — injectable for tests
}) {
  const { store, fetch } = deps
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000))
  return {
    async getInfo(symbol: string): Promise<CompanyInfo> {
      const cached = store.getCompanyProfile(symbol)
      if (cached && now() - cached.fetchedAt < TTL_SECONDS) {
        return { ...cached.data, fetchedAt: cached.fetchedAt }
      }
      try {
        const data = await fetch(symbol)
        const fetchedAt = now()
        store.upsertCompanyProfile(symbol, data, fetchedAt)
        return { ...data, fetchedAt }
      } catch (err) {
        if (cached) return { ...cached.data, fetchedAt: cached.fetchedAt } // stale fallback
        throw err
      }
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/main/profile/CompanyInfoService.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/profile/CompanyInfoService.ts tests/main/profile/CompanyInfoService.test.ts
git commit -m "feat(company): CompanyInfoService TTL read-through + stale fallback"
```

---

### Task 5: Main IPC wiring — register the `company:info` handler

**Files:**
- Modify: `src/main/ipc.ts`

**Interfaces:**
- Consumes: `createCompanyInfoService` (Task 4), `companyProfileStore` (Task 2), `FmpProvider.getCompanyProfile` (Task 3), existing `getApiKey`, `electronHttpGetJson`, `CH.companyInfo` (Task 1).
- Produces: an `ipcMain.handle(CH.companyInfo, ...)` handler backing `Api.company.info`.

- [ ] **Step 1: Add imports**

In `src/main/ipc.ts`, after the existing `createProfileService` / `profileStore` imports (lines 14-15), add:
```typescript
import { createCompanyInfoService } from './profile/CompanyInfoService'
import * as companyProfileStore from './db/companyProfileStore'
```

- [ ] **Step 2: Construct the service inside `registerIpc`**

In `registerIpc`, after the `profileService` construction block (ends at line 31, its closing `})`), add:
```typescript
  // Company info (company namespace — distinct from ProfileService/symbol resolution). TTL cache in
  // SQLite; fetch goes through the same electron net client as search/OHLCV.
  const companyInfoService = createCompanyInfoService({
    store: companyProfileStore,
    fetch: (symbol) => {
      const apiKey = getApiKey()
      if (!apiKey) throw new Error('NO_API_KEY')
      return new FmpProvider({ apiKey, httpGetJson: electronHttpGetJson }).getCompanyProfile(symbol)
    }
  })
```

- [ ] **Step 3: Register the handler**

In `src/main/ipc.ts`, next to `ipcMain.handle(CH.symbolsProfile, ...)` (line 71), add:
```typescript
  ipcMain.handle(CH.companyInfo, (_e, symbol: string) => companyInfoService.getInfo(symbol))
```

- [ ] **Step 4: Typecheck + full test run**

Run: `npm run typecheck && npm test`
Expected: PASS. (Full suite green — the main process now fully backs `Api.company.info`.)

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.ts
git commit -m "feat(company): register company:info IPC handler"
```

---

### Task 6: Renderer plumbing — query key + zustand dialog state

**Files:**
- Modify: `src/renderer/api.ts`
- Modify: `src/renderer/store.ts`

**Interfaces:**
- Produces: `qk.companyInfo(symbol: string)`; store fields `companyInfoSymbol: string | null`, `openCompanyInfo(symbol: string): void`, `closeCompanyInfo(): void`.

- [ ] **Step 1: Add the query key**

In `src/renderer/api.ts`, add to the `qk` object (after `marketStatus`):
```typescript
  marketStatus: () => ['market-status'] as const,
  companyInfo: (symbol: string) => ['company-info', symbol] as const
```

- [ ] **Step 2: Add the state fields to the `AppState` type**

In `src/renderer/store.ts`, add to the `AppState` type (place after the `setCrosshair` line, ~line 53):
```typescript
  // 会社情報ダイアログの対象銘柄。null = 閉。App 常設の CompanyInfoDialog が subscribe する。
  companyInfoSymbol: string | null
  openCompanyInfo: (symbol: string) => void
  closeCompanyInfo: () => void
```

- [ ] **Step 3: Add the initial value + actions**

In the store's returned object, after the `crosshairByCell` / `setCrosshair` block (~line 108), add:
```typescript
  companyInfoSymbol: null,
  openCompanyInfo: (symbol) => set({ companyInfoSymbol: symbol }),
  closeCompanyInfo: () => set({ companyInfoSymbol: null }),
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/api.ts src/renderer/store.ts
git commit -m "feat(company): renderer query key + dialog store state"
```

---

### Task 7: Context-menu UI primitive + dependency

**Files:**
- Modify: `package.json` (via `npm install`)
- Create: `src/renderer/components/ui/context-menu.tsx`

**Interfaces:**
- Produces: `ContextMenu`, `ContextMenuTrigger`, `ContextMenuContent`, `ContextMenuItem` (minimal shadcn wrappers — only what GridCell needs).

- [ ] **Step 1: Install the dependency**

Run: `npm install @radix-ui/react-context-menu@^2`
Expected: adds `@radix-ui/react-context-menu` to `dependencies`; the `postinstall` (`electron-builder install-app-deps`) runs and rebuilds native deps against Electron's ABI.

- [ ] **Step 2: Create the wrapper**

Create `src/renderer/components/ui/context-menu.tsx` (mirrors the existing `dropdown-menu.tsx` styling; only the four parts used here):
```tsx
import * as React from "react"
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu"

import { cn } from "@/lib/utils"

const ContextMenu = ContextMenuPrimitive.Root

const ContextMenuTrigger = ContextMenuPrimitive.Trigger

const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      className={cn(
        "z-50 min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        className
      )}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
))
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName

const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  />
))
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName

export { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/renderer/components/ui/context-menu.tsx
git commit -m "feat(company): add context-menu ui primitive (@radix-ui/react-context-menu)"
```

---

### Task 8: Wrap grid cells with the context menu

**Files:**
- Modify: `src/renderer/components/GridHost.tsx`

**Interfaces:**
- Consumes: `ContextMenu*` (Task 7), `openCompanyInfo` (Task 6).
- Produces: right-click on a populated cell shows "Show company info" → calls `openCompanyInfo(cell.symbol)`.

- [ ] **Step 1: Add imports**

In `src/renderer/components/GridHost.tsx`, add after the existing UI imports (near line 11):
```typescript
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from './ui/context-menu'
```

- [ ] **Step 2: Read the store action in `GridCell`**

In `GridCell`, alongside the existing store selectors (near line 209), add:
```typescript
  const openCompanyInfo = useAppStore((s) => s.openCompanyInfo)
```

- [ ] **Step 3: Wrap the populated-cell content**

In `GridCell`, replace the `cell.symbol ? ( ... )` true-branch. Currently it is a `<>...</>` fragment containing the toolbar `<div>` and the chart `<div>`. Wrap that fragment's contents in a context menu. The full return becomes:
```tsx
  return (
    <div
      onClick={() => setActiveCell(cell.id)}
      className={cn(
        'flex h-full min-h-0 min-w-0 flex-col gap-4 rounded-md',
        active && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
      )}
    >
      {cell.symbol
        ? (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className="flex h-full min-h-0 min-w-0 flex-col gap-4">
                <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
                  <SymbolLabel symbol={cell.symbol} timeframe={cell.timeframe} />
                  <TimeframeRow
                    value={cell.timeframe}
                    onChange={(tf) => setCellTimeframe(cell.id, tf)}
                  />
                  <AddIndicatorMenu cellId={cell.id} />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto h-6 w-6 [&_svg]:size-3.5"
                    aria-label={`Remove ${cell.symbol} chart`}
                    onClick={(e) => { e.stopPropagation(); clearCell(cell.id) }}
                  >
                    <X />
                  </Button>
                </div>
                <div className="min-h-0 flex-1">
                  <Chart cellId={cell.id} symbol={cell.symbol} timeframe={cell.timeframe} />
                </div>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => openCompanyInfo(cell.symbol!)}>
                Show company info
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          )
        : <div className="p-6 text-muted-foreground">Search a symbol to begin.</div>}
    </div>
  )
```

> `cell.symbol!` in `onSelect`: the closure loses TS's narrowing from the `cell.symbol ?` branch, so the non-null assertion is correct here — the menu only exists when `cell.symbol` is truthy.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/GridHost.tsx
git commit -m "feat(company): grid-cell context menu → Show company info"
```

---

### Task 9: CompanyInfoDialog + mount in App

**Files:**
- Create: `src/renderer/components/CompanyInfoDialog.tsx`
- Modify: `src/renderer/App.tsx`

**Interfaces:**
- Consumes: `companyInfoSymbol` / `closeCompanyInfo` (Task 6), `qk.companyInfo` + `api.company.info` (Tasks 6/1), `Dialog*` (existing `ui/dialog.tsx`), `CompanyInfo` type.
- Produces: an always-mounted `CompanyInfoDialog` that opens when `companyInfoSymbol` is set.

- [ ] **Step 1: Create the dialog**

Create `src/renderer/components/CompanyInfoDialog.tsx`:
```tsx
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, qk } from '@/api'
import { useAppStore } from '@/store'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import type { CompanyInfo } from '@shared/types'

const fmtCompact = (n: number): string =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n)

// 値が null/空なら行ごと出さない（未取得フィールドで空ラベルが並ぶのを防ぐ）。
function Attr({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element | null {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  )
}

function CompanyInfoBody({ symbol }: { symbol: string }): React.JSX.Element {
  const q = useQuery<CompanyInfo>({
    queryKey: qk.companyInfo(symbol),
    queryFn: () => api.company.info(symbol)
  })

  if (q.isLoading) {
    return <div className="p-2 text-muted-foreground">Loading company info…</div>
  }
  if (q.isError || !q.data) {
    // Chart と同じ文言方針: HTTP 40x（プラン外/未カバー）は専用文言、それ以外は汎用エラー。
    const notCovered = /FMP HTTP 40[0-9]/.test(String((q.error as Error)?.message))
    return (
      <div className="p-2 text-center text-muted-foreground">
        {notCovered
          ? 'Company info isn’t available on your current FMP plan.'
          : 'Couldn’t load company info. Check your connection or your FMP API key in Settings.'}
      </div>
    )
  }

  const c = q.data
  const asOf = new Date(c.fetchedAt * 1000).toISOString().slice(0, 10)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {c.image && <img src={c.image} alt="" className="h-10 w-10 shrink-0 rounded" />}
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-base font-semibold">{c.companyName}</span>
          <span className="text-sm text-muted-foreground">
            {c.symbol}{c.exchange ? ` · ${c.exchange}` : ''}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3">
        <Attr label="Sector" value={c.sector} />
        <Attr label="Industry" value={c.industry} />
        <Attr label="Country" value={c.country} />
        <Attr label="Market cap" value={c.marketCap === null ? null : fmtCompact(c.marketCap)} />
        <Attr label="CEO" value={c.ceo} />
        <Attr label="Employees" value={c.fullTimeEmployees === null ? null : fmtCompact(c.fullTimeEmployees)} />
        <Attr label="IPO date" value={c.ipoDate} />
        <Attr label="Beta" value={c.beta === null ? null : c.beta.toFixed(2)} />
        <Attr label="52-week range" value={c.range} />
        <Attr label="Volume" value={c.volume === null ? null : fmtCompact(c.volume)} />
        <Attr label="Avg volume" value={c.averageVolume === null ? null : fmtCompact(c.averageVolume)} />
        <Attr label="Last dividend" value={c.lastDividend === null ? null : c.lastDividend.toFixed(2)} />
      </div>

      {c.description && (
        <p className="line-clamp-4 text-sm text-muted-foreground">{c.description}</p>
      )}

      <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
        {c.website
          ? <a href={c.website} target="_blank" rel="noreferrer" className="truncate text-primary hover:underline">{c.website}</a>
          : <span />}
        <span className="shrink-0">As of {asOf}</span>
      </div>
    </div>
  )
}

export function CompanyInfoDialog(): React.JSX.Element {
  const symbol = useAppStore((s) => s.companyInfoSymbol)
  const closeCompanyInfo = useAppStore((s) => s.closeCompanyInfo)
  return (
    <Dialog open={!!symbol} onOpenChange={(open) => { if (!open) closeCompanyInfo() }}>
      <DialogContent className="max-w-xl">
        <DialogHeader className="mb-1">
          <DialogTitle>Company info</DialogTitle>
        </DialogHeader>
        {symbol && <CompanyInfoBody symbol={symbol} />}
      </DialogContent>
    </Dialog>
  )
}
```

> ponytail: `<a target="_blank">` for the website is the minimal option; if it opens an unwanted child BrowserWindow, add `shell.openExternal` via a small IPC later. Broken logo images just render nothing — no fallback needed.

- [ ] **Step 2: Mount it in App**

In `src/renderer/App.tsx`, add the import (after the `Watchlist` import, ~line 17):
```typescript
import { CompanyInfoDialog } from './components/CompanyInfoDialog'
```

Add the component next to `<Toaster />` (near the end of the returned JSX, before `</TooltipProvider>`):
```tsx
      <Toaster />
      <CompanyInfoDialog />
    </TooltipProvider>
```

- [ ] **Step 3: Typecheck + full test suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Manual smoke check**

Run: `npm run dev`
Verify: with an API key set, search a symbol into a cell → right-click the cell → "Show company info" → dialog opens with logo, name, attribute grid, description, website, "As of" date. Close via ✕ / Escape / overlay. Reopen the same symbol → no second network call (served from cache).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/CompanyInfoDialog.tsx src/renderer/App.tsx
git commit -m "feat(company): CompanyInfoDialog mounted in App"
```

---

## Self-Review

**Spec coverage:**
- §1 `FmpProvider.getCompanyProfile` → Task 3 ✓ · `fmpProfileResponse` (array, display fields only, passthrough, `z.coerce.number`, nullable/optional) → Task 3 ✓ · empty array → `FmpHttpError(200)` → Task 3 ✓ · `CompanyInfo` type → Task 1 ✓
- §2 `company_profiles` table (drizzle + raw CREATE TABLE) → Task 2 ✓ · `companyProfileStore` (`CompanyProfileData` payload, get/upsert, fetchedAt in column) → Task 2 ✓ · `CompanyInfoService.getInfo` (TTL 86400, fresh-hit, stale/miss refetch+upsert, fetch-fail stale fallback / rethrow) → Task 4 ✓ · IPC (`CH.companyInfo`, `Api.company.info`, preload, main wiring) → Tasks 1 + 5 ✓
- §3 dependency `@radix-ui/react-context-menu` → Task 7 ✓ · `ui/context-menu.tsx` → Task 7 ✓ · GridCell wrap + "Show company info" (English) → Task 8 ✓
- §4 store `companyInfoSymbol`/`openCompanyInfo`/`closeCompanyInfo` → Task 6 ✓ · `CompanyInfoDialog` (useQuery, header/attr-grid/footer, load/error/not-covered) → Task 9 ✓
- §5 self-check (TTL fresh/stale/fallback asserts) → Task 4 ✓

**Deliberate deviations from the spec (all noted inline):**
- `CompanyProfileData` defined in `@shared/types` (not `companyProfileStore.ts`) so the provider avoids importing from `db/`.
- Dialog attribute labels + "As of YYYY-MM-DD" are English to match the rest of the UI (spec wrote 「時点」; the context-menu label was already specified English).

**Type consistency:** `CompanyProfileData` / `CompanyInfo` field names identical across shared type, schema map, store, service, and dialog. Store signature `getCompanyProfile → { data; fetchedAt } | null` and `upsertCompanyProfile(symbol, data, fetchedAt)` matches the service's `deps.store` shape and the Task 4 fake. `qk.companyInfo` / `api.company.info` / `CH.companyInfo` consistent across Tasks 1/6/9.

**Placeholder scan:** none — every code step is complete.

---

Plan complete and saved to `docs/superpowers/plans/2026-07-22-company-info-dialog.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
