# MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose Vibing View's cached OHLCV, workspaces, and company data to Claude Desktop / Claude Code through a localhost MCP server hosted inside the Electron main process.

**Architecture:** Extract a transport-independent `src/main/core.ts` out of `src/main/ipc.ts` (it currently hides `withCapabilityTracking`, the `dailyOutOfPlan` short-circuit, and the `workspaces`/`clipboard` rev bookkeeping inside one closure). `ipc.ts` becomes a channel→core lookup table; a new `src/main/mcp/` tree registers MCP tools against the same core, so the cache-hit decision and API-call behaviour are identical whether the caller is the UI or Claude. Transport is `@modelcontextprotocol/sdk`'s Streamable HTTP mounted on `node:http`, bound to `127.0.0.1`, guarded by a Bearer token and an `Origin` check.

**Tech Stack:** TypeScript, Electron 43 (main process), `@modelcontextprotocol/sdk` ^1.29, zod ^3.25 (already a dependency), `node:http`, `node:crypto`, drizzle-orm + better-sqlite3 (existing), React 19 + shadcn UI (settings row), Vitest 3 (node env).

## Global Constraints

- **Read-only v1.** Eight tools, all reads. Workspace mutation is out of scope (`core.workspaces.set` already exists for a later task).
- **Text Claude reads is English** — tool descriptions, argument descriptions, error messages, the `get_ohlcv` summary line. **Text the user reads is Japanese** — the Settings dialog row and its toasts. This mirrors the existing codebase split.
- **MCP is disabled by default.** `settings.json` holds `{ "mcp": { "enabled": false, "port": 39100, "token": "<random>" } }`.
- **Never widen the `Api` contract's existing shapes.** `Api.ohlcv.get` still resolves to `Bar[]`; only a new `mcp` namespace is added.
- **SQLite = OHLCV cache / JSON = user preferences.** MCP settings go in `settings.json`, never SQLite.
- **Pin Vite at `^7`** (electron-vite@5 does not declare Vite 8 as a peer). Do not upgrade it.
- **Do not add Express or any HTTP framework.** `node:http` only.
- Tests live in `tests/**/*.test.ts`, run in the `node` environment, and must **never** pull `electron` or `better-sqlite3` into the module graph. Vitest runs on plain Node, where `require('better-sqlite3')` fails with `ERR_DLOPEN_FAILED` (the binary is built for Electron's ABI). This is why every new main-process module takes its stores by injection.
- Timestamps: `Bar.time` stays UTC epoch **seconds** internally; every MCP input and output is an **ISO string** (M-08).
- `get_ohlcv` default `limit` = 300, hard cap = 2000. Over-cap requests are clamped with a note, never rejected.
- Run `npm run typecheck` before each commit; it covers both tsconfigs.

---

## File Structure

**Create:**
- `src/main/core.ts` — transport-independent service layer. Owns `dailyOutOfPlan`, the search cache, `workspacesRev`, the clipboard + its rev, and the in-flight fetch dedup map. Takes every Electron/SQLite touchpoint by injection (`broadcast`, stores, keystore, capability cache, provider factory).
- `src/main/mcp/format.ts` — pure formatting/parsing: ISO ⇄ epoch, CSV rendering, summary line, notes, cache-status text, workspace text, company-info text. No SDK import, no I/O.
- `src/main/mcp/tools.ts` — the eight tool registrations, zod argument schemas, and the `OhlcvOutcome`/`FmpHttpError` → English-message mapping. Takes the core by injection.
- `src/main/mcp/auth.ts` — pure `tokenMatches` / `originAllowed`.
- `src/main/mcp/httpServer.ts` — `node:http` listener, body reading, auth gate. Takes the MCP request handler by injection so it is testable without the SDK.
- `src/main/mcp/index.ts` — lifecycle (start / stop / restart on config change), status broadcasting.
- `src/renderer/components/settings/McpSetting.tsx` — the Settings dialog row.
- Tests: `tests/main/core/ohlcv.test.ts`, `tests/main/core/surfaces.test.ts`, `tests/main/mcp/format.test.ts`, `tests/main/mcp/tools.test.ts`, `tests/main/mcp/auth.test.ts`, `tests/main/mcp/httpServer.test.ts`.

**Modify:**
- `src/main/cache/CacheService.ts` — widen the left-backfill guard (M-15); loosen the `store` dep to a `Pick`.
- `src/main/db/barStore.ts` — add `summarizeBars()`.
- `src/main/ipc.ts` — becomes a thin channel→core table; folds `OhlcvOutcome` back to `Bar[]`.
- `src/main/index.ts` — builds the core with real deps, wires MCP startup/shutdown.
- `src/main/settings.ts` — `getMcpConfig` / `setMcpConfig`.
- `src/shared/ipc.ts` — `CH.mcp*` channels, `McpConfig` / `McpStatus` types, `Api.mcp`.
- `src/preload/index.ts` — the `mcp` namespace.
- `src/renderer/components/SettingsDialog.tsx` — one more row.
- `package.json` — add `@modelcontextprotocol/sdk`.
- `tests/main/cache/CacheService.test.ts` — new guard cases.

**Not tested, deliberately:** `barStore.summarizeBars` is a drizzle query and cannot run under Vitest (native binding, see Global Constraints). Its untested status matches the existing `getBars`/`getCoverage`. Everything that *interprets* its output (derived W/M annotation, formatting) is pure and is tested in `format.test.ts`.

---

### Task 1: Widen the CacheService range guard (M-15)

Today `CacheService.getOHLCV` only honours a requested range when coverage already exists (`cov && range && ...`). With no coverage row, an intraday request falls through to `provider.getOHLCV(symbol, tf, undefined)`, which fetches only `intradayInitialRange`'s recent window — so an MCP caller asking for older intraday history silently gets recent bars. Widen the guard to `!cov || range.from < cov.oldestTime`.

**Files:**
- Modify: `src/main/cache/CacheService.ts:6-41`
- Test: `tests/main/cache/CacheService.test.ts`

**Interfaces:**
- Produces: `createCacheService(deps: { provider: Pick<FmpProvider, 'getOHLCV' | 'searchSymbols'>; store: Pick<typeof barStore, 'getCoverage' | 'getBars' | 'upsertBarsAndCoverage'>; now?: () => number })` — the `store` type is loosened from `typeof barStore` to a `Pick` so Task 2 can inject a narrow store object.

- [ ] **Step 1: Write the failing tests**

Append to `tests/main/cache/CacheService.test.ts`, inside the existing `describe('CacheService.getOHLCV', ...)` block:

```ts
  it('passes the full requested range to the provider when there is NO coverage', async () => {
    const store = fakeStore()
    const provider = { getOHLCV: vi.fn(async () => [bar(500)]), searchSymbols: vi.fn() }
    const svc = createCacheService({ provider, store })

    await svc.getOHLCV('NVDA', '5m', { from: 100, to: 900 })

    expect(provider.getOHLCV).toHaveBeenCalledWith('NVDA', '5m', { from: 100, to: 900 })
  })

  it('still fetches only the missing left sub-range when coverage exists', async () => {
    const store = fakeStore([bar(500)], { oldestTime: 500, newestTime: 900 })
    const provider = { getOHLCV: vi.fn(async () => [bar(200)]), searchSymbols: vi.fn() }
    const svc = createCacheService({ provider, store })

    await svc.getOHLCV('NVDA', '5m', { from: 100, to: 900 })

    expect(provider.getOHLCV).toHaveBeenCalledWith('NVDA', '5m', { from: 100, to: 499 })
  })

  it('passes undefined to the provider when no range is requested (regression)', async () => {
    const store = fakeStore()
    const provider = { getOHLCV: vi.fn(async () => [bar(500)]), searchSymbols: vi.fn() }
    const svc = createCacheService({ provider, store })

    await svc.getOHLCV('NVDA', '5m', undefined)

    expect(provider.getOHLCV).toHaveBeenCalledWith('NVDA', '5m', undefined)
  })
```

- [ ] **Step 2: Run the tests to verify the first one fails**

Run: `npx vitest run tests/main/cache/CacheService.test.ts`
Expected: FAIL — "passes the full requested range to the provider when there is NO coverage" reports the provider was called with `undefined` instead of `{ from: 100, to: 900 }`. The other two pass.

- [ ] **Step 3: Widen the guard**

In `src/main/cache/CacheService.ts`, replace the `const fetched =` expression (currently lines 35-38) with:

```ts
      // Miss. Fetch only what's missing on the left: with coverage, the gap below `cov.oldestTime`
      // (D-16); with NO coverage, the whole requested range. Without the `!cov` arm an intraday
      // request for old history would fall through to the provider's recent-window default and
      // silently return the wrong period (M-15). The renderer never hits the `!cov` arm — its only
      // ranged call is Chart.tsx's scrollback, anchored on bars[0].time, so coverage always exists.
      const fetched =
        range && (!cov || range.from < cov.oldestTime)
          ? await provider.getOHLCV(symbol, tf, { from: range.from, to: cov ? cov.oldestTime - 1 : range.to })
          : await provider.getOHLCV(symbol, tf, undefined)
```

- [ ] **Step 4: Loosen the store dep type**

In the same file, change the `deps` signature:

```ts
export function createCacheService(deps: {
  provider: Pick<FmpProvider, 'getOHLCV' | 'searchSymbols'>
  store: Pick<typeof barStore, 'getCoverage' | 'getBars' | 'upsertBarsAndCoverage'>
  now?: () => number // epoch SECONDS; injectable for tests
}) {
```

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all tests PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/main/cache/CacheService.ts tests/main/cache/CacheService.test.ts
git commit -m "fix(cache): fetch the requested range when no coverage exists"
```

---

### Task 2: `core.ts` — the OHLCV surface

Extract the OHLCV path out of `ipc.ts` into an injectable core: capability tracking, the `dailyOutOfPlan` short-circuit, the four-way `OhlcvOutcome`, in-flight dedup, and the API-key mutations that clear that state.

**Files:**
- Create: `src/main/core.ts`
- Test: `tests/main/core/ohlcv.test.ts`

**Interfaces:**
- Consumes: `createCacheService` from Task 1 (with the loosened `store` type).
- Produces:

```ts
export type OhlcvOutcome =
  | { kind: 'ok'; bars: Bar[]; apiCalls: number }
  | { kind: 'out-of-plan' }
  | { kind: 'unknown-symbol' }
  | { kind: 'empty-range' }

export type ProviderLike = Pick<FmpProvider, 'getOHLCV' | 'searchSymbols' | 'getQuote' | 'getMarketStatus' | 'getCompanyProfile'>
export type CoreDeps = { /* see Step 3 */ }
export type Core = ReturnType<typeof createCore>
export function createCore(deps: CoreDeps): {
  ohlcv: {
    get(symbol: string, timeframe: Timeframe, range: DateRange): Promise<OhlcvOutcome>
    refresh(symbol: string, timeframe: Timeframe): Promise<OhlcvOutcome>
  }
  apikey: { set(key: string): SetKeyResult; status(): KeyStatus; clear(): void }
  /* Task 3 adds: symbols, quote, market, company, workspaces, clipboard, capabilities, cacheStatus */
}
```

**Deviation from the spec, deliberate:** the spec writes `{ kind: 'ok'; bars; fromCache: boolean }`. This plan uses `apiCalls: number` instead — `fromCache` is exactly `apiCalls === 0`, and the `get_ohlcv` summary line needs the count anyway ("(1 API call)"). One field cannot disagree with itself; two can.

**Behaviour change to note when reviewing:** a 402/403 on a daily-backed timeframe now resolves as `{ kind: 'out-of-plan' }` instead of throwing. `ipc.ts` (Task 4) folds that to `[]`, so the renderer shows its quiet "not covered" message on the *first* off-plan symbol too, instead of an error state on the first and silence on every later one. That inconsistency is what `ipc.ts:46-50`'s comment already intends to avoid.

- [ ] **Step 1: Write the failing test file**

Create `tests/main/core/ohlcv.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createCore, type CoreDeps } from '../../../src/main/core'
import { FmpHttpError } from '../../../src/main/providers/FmpProvider'
import type { Bar } from '@shared/types'

const bar = (time: number): Bar => ({ time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 })

// Minimal fakes: every dep the core touches, none of them electron/sqlite.
function deps(over: Partial<CoreDeps> = {}) {
  let stored: Bar[] = []
  let cov: { oldestTime: number; newestTime: number } | null = null
  const base: CoreDeps = {
    broadcast: vi.fn(),
    barStore: {
      getCoverage: vi.fn(() => cov),
      getBars: vi.fn((_s, _tf, range) =>
        stored.filter((b) => !range || (b.time >= range.from && b.time <= range.to)).sort((a, b) => a.time - b.time)
      ),
      upsertBarsAndCoverage: vi.fn((_s: string, _tf: string, bars: Bar[]) => {
        if (bars.length === 0) return
        stored = [...stored, ...bars]
        const times = bars.map((b) => b.time)
        cov = {
          oldestTime: Math.min(cov?.oldestTime ?? Infinity, ...times),
          newestTime: Math.max(cov?.newestTime ?? -Infinity, ...times)
        }
      }),
      summarizeBars: vi.fn(() => [])
    },
    profileStore: { getProfile: vi.fn(() => null), upsertProfile: vi.fn() },
    companyProfileStore: { getCompanyProfile: vi.fn(() => null), upsertCompanyProfile: vi.fn() },
    workspaceStore: {
      getWorkspaces: vi.fn(() => ({ version: 3, active: 'W', workspaces: [{ name: 'W', items: [], layout: { schemaVersion: 1, cells: [], shape: { rows: 1, cols: 1 }, activeCellId: '1' } }] })),
      setWorkspaces: vi.fn()
    },
    capabilityCache: { getStatus: vi.fn(() => 'unknown' as const), setStatus: vi.fn(), clearForKeyChange: vi.fn() },
    keystore: {
      getApiKey: vi.fn(() => 'KEY'),
      setApiKey: vi.fn(() => ({ ok: true, encryptionAvailable: true })),
      getKeyStatus: vi.fn(() => ({ hasKey: true, encryptionAvailable: true })),
      clearApiKey: vi.fn()
    },
    makeProvider: vi.fn(() => ({
      getOHLCV: vi.fn(async () => [bar(100), bar(200)]),
      searchSymbols: vi.fn(async () => []),
      getQuote: vi.fn(),
      getMarketStatus: vi.fn(),
      getCompanyProfile: vi.fn()
    })),
    nowSec: () => 1_000
  }
  return { ...base, ...over }
}

describe('core.ohlcv.get', () => {
  it('returns ok with the fetched bars and the API-call count', async () => {
    const core = createCore(deps())
    const out = await core.ohlcv.get('NVDA', '1d', undefined)
    expect(out).toEqual({ kind: 'ok', bars: [bar(100), bar(200)], apiCalls: 1 })
  })

  it('reports apiCalls: 0 when the request is served from cache', async () => {
    const core = createCore(deps())
    await core.ohlcv.get('NVDA', '1d', undefined)
    const out = await core.ohlcv.get('NVDA', '1d', undefined)
    expect(out).toEqual({ kind: 'ok', bars: [bar(100), bar(200)], apiCalls: 0 })
  })

  it('returns unknown-symbol when the provider yields nothing and nothing is cached', async () => {
    const d = deps({
      makeProvider: () => ({
        getOHLCV: vi.fn(async () => []), searchSymbols: vi.fn(), getQuote: vi.fn(), getMarketStatus: vi.fn(), getCompanyProfile: vi.fn()
      })
    })
    const core = createCore(d)
    expect(await core.ohlcv.get('NOPE', '1d', undefined)).toEqual({ kind: 'unknown-symbol' })
  })

  it('returns empty-range when coverage exists but the range holds no bars', async () => {
    const core = createCore(deps())
    await core.ohlcv.get('NVDA', '1d', undefined) // seed coverage 100..200
    expect(await core.ohlcv.get('NVDA', '1d', { from: 150, to: 180 })).toEqual({ kind: 'empty-range' })
  })

  it('returns out-of-plan on a 402 for a daily-backed timeframe, and short-circuits after that', async () => {
    const getOHLCV = vi.fn(async () => { throw new FmpHttpError(402, null) })
    const core = createCore(deps({
      makeProvider: () => ({ getOHLCV, searchSymbols: vi.fn(), getQuote: vi.fn(), getMarketStatus: vi.fn(), getCompanyProfile: vi.fn() })
    }))
    expect(await core.ohlcv.get('XYZ', '1d', undefined)).toEqual({ kind: 'out-of-plan' })
    expect(await core.ohlcv.get('XYZ', '1w', undefined)).toEqual({ kind: 'out-of-plan' })
    expect(getOHLCV).toHaveBeenCalledOnce() // second call never reached the provider
  })

  it('rethrows a 402 on an intraday timeframe so the caller can say "not on this plan"', async () => {
    const core = createCore(deps({
      makeProvider: () => ({
        getOHLCV: vi.fn(async () => { throw new FmpHttpError(402, null) }),
        searchSymbols: vi.fn(), getQuote: vi.fn(), getMarketStatus: vi.fn(), getCompanyProfile: vi.fn()
      })
    }))
    await expect(core.ohlcv.get('NVDA', '5m', undefined)).rejects.toBeInstanceOf(FmpHttpError)
  })

  it('records the timeframe as available after a successful fetch', async () => {
    const d = deps()
    await createCore(d).ohlcv.get('NVDA', '5m', undefined)
    expect(d.capabilityCache.setStatus).toHaveBeenCalledWith('KEY', '5m', 'available')
  })

  it('does NOT record requires-plan for 1d (a 402 there means the symbol, not the timeframe)', async () => {
    const d = deps({
      makeProvider: () => ({
        getOHLCV: vi.fn(async () => { throw new FmpHttpError(403, null) }),
        searchSymbols: vi.fn(), getQuote: vi.fn(), getMarketStatus: vi.fn(), getCompanyProfile: vi.fn()
      })
    })
    await createCore(d).ohlcv.get('XYZ', '1d', undefined)
    expect(d.capabilityCache.setStatus).not.toHaveBeenCalled()
  })

  it('throws NO_API_KEY when no key is configured', async () => {
    const d = deps()
    d.keystore.getApiKey = vi.fn(() => null)
    await expect(createCore(d).ohlcv.get('NVDA', '1d', undefined)).rejects.toThrow('NO_API_KEY')
  })

  it('dedupes concurrent identical requests into ONE provider call', async () => {
    let resolve!: (v: Bar[]) => void
    const getOHLCV = vi.fn(() => new Promise<Bar[]>((r) => { resolve = r }))
    const core = createCore(deps({
      makeProvider: () => ({ getOHLCV, searchSymbols: vi.fn(), getQuote: vi.fn(), getMarketStatus: vi.fn(), getCompanyProfile: vi.fn() })
    }))

    const a = core.ohlcv.get('NVDA', '1d', undefined)
    const b = core.ohlcv.get('NVDA', '1d', undefined)
    resolve([bar(100)])

    expect(await a).toEqual(await b)
    expect(getOHLCV).toHaveBeenCalledOnce()
  })

  it('does not dedupe across different ranges', async () => {
    const d = deps()
    const core = createCore(d)
    await Promise.all([
      core.ohlcv.get('NVDA', '1d', { from: 0, to: 50 }),
      core.ohlcv.get('NVDA', '1d', { from: 60, to: 90 })
    ])
    // two distinct keys → two independent runs (each cache-misses and fetches)
    expect(d.makeProvider).toHaveBeenCalledTimes(2)
  })

  it('drops the in-flight entry once settled so a later call can fetch again', async () => {
    const d = deps()
    const core = createCore(d)
    await core.ohlcv.get('NVDA', '1d', { from: 0, to: 50 })
    await core.ohlcv.get('NVDA', '1d', { from: 0, to: 50 })
    expect(d.makeProvider).toHaveBeenCalledTimes(2)
  })
})

describe('core.ohlcv.refresh', () => {
  it('goes through the right-edge differential and reports the API call', async () => {
    const core = createCore(deps())
    const out = await core.ohlcv.refresh('NVDA', '1d')
    expect(out).toEqual({ kind: 'ok', bars: [bar(100), bar(200)], apiCalls: 1 })
  })
})

describe('core.apikey', () => {
  it('clears the capability cache and the out-of-plan set on set()', async () => {
    const d = deps()
    const core = createCore(d)
    core.apikey.set('NEW')
    expect(d.keystore.setApiKey).toHaveBeenCalledWith('NEW')
    expect(d.capabilityCache.clearForKeyChange).toHaveBeenCalled()
  })

  it('clears them on clear() too', () => {
    const d = deps()
    createCore(d).apikey.clear()
    expect(d.keystore.clearApiKey).toHaveBeenCalled()
    expect(d.capabilityCache.clearForKeyChange).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/main/core/ohlcv.test.ts`
Expected: FAIL — `Failed to resolve import "../../../src/main/core"`.

- [ ] **Step 3: Write `src/main/core.ts`**

```ts
import type {
  Bar, Timeframe, DateRange, WorkspaceCollection, ClipboardCell, SymbolResult,
  Quote, MarketStatus, CompanyInfo, CompanyProfileData
} from '@shared/types'
import type { CapabilityStatus, KeyStatus, SetKeyResult } from '@shared/ipc'
import type { FmpProvider } from './providers/FmpProvider'
import { FmpHttpError } from './providers/FmpProvider'
import type * as barStoreModule from './db/barStore'
import { createCacheService } from './cache/CacheService'
import { classify } from './capabilityClassifier'

const ALL_TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '1d', '1w', '1M']
const DERIVED_TIMEFRAMES: Timeframe[] = ['1w', '1M'] // never gated — always 'available'
const DAILY_BACKED: Timeframe[] = ['1d', '1w', '1M'] // all served from '1d' bars

// `[]` used to mean three different things at once (off-plan short-circuit, unknown symbol, empty
// window). The renderer can collapse them into one "not covered" message; MCP has to explain
// which one happened, so the core reports the discriminant and ipc.ts folds it back (M-09).
export type OhlcvOutcome =
  | { kind: 'ok'; bars: Bar[]; apiCalls: number }
  | { kind: 'out-of-plan' }
  | { kind: 'unknown-symbol' }
  | { kind: 'empty-range' }

export type ProviderLike = Pick<
  FmpProvider, 'getOHLCV' | 'searchSymbols' | 'getQuote' | 'getMarketStatus' | 'getCompanyProfile'
>

// Every electron/sqlite touchpoint arrives by injection so the core loads under plain-Node Vitest
// (same rationale as db/client.ts's lazy require).
export type CoreDeps = {
  broadcast: (channel: string, payload: unknown, exceptWebContentsId?: number) => void
  barStore: Pick<typeof barStoreModule, 'getCoverage' | 'getBars' | 'upsertBarsAndCoverage' | 'summarizeBars'>
  profileStore: {
    getProfile(symbol: string): SymbolResult | null
    upsertProfile(p: SymbolResult): void
  }
  companyProfileStore: {
    getCompanyProfile(symbol: string): { data: CompanyProfileData; fetchedAt: number } | null
    upsertCompanyProfile(symbol: string, data: CompanyProfileData, fetchedAt: number): void
  }
  workspaceStore: {
    getWorkspaces(): WorkspaceCollection
    setWorkspaces(c: WorkspaceCollection): void
  }
  capabilityCache: {
    getStatus(apiKey: string, tf: Timeframe): CapabilityStatus
    setStatus(apiKey: string, tf: Timeframe, status: CapabilityStatus): void
    clearForKeyChange(): void
  }
  keystore: {
    getApiKey(): string | null
    setApiKey(key: string): SetKeyResult
    getKeyStatus(): KeyStatus
    clearApiKey(): void
  }
  makeProvider: (apiKey: string) => ProviderLike
  nowSec?: () => number // epoch SECONDS; injectable for tests
}

export type Core = ReturnType<typeof createCore>

export function createCore(deps: CoreDeps) {
  const { broadcast, barStore, capabilityCache, keystore, makeProvider } = deps

  // Symbols whose '1d' EOD is not on the current plan (402/403). In-memory, cleared on key change.
  // Once known, D/W/M short-circuit instead of re-hitting FMP on every timeframe switch.
  const dailyOutOfPlan = new Set<string>()

  // Neither CacheService nor TanStack Query dedupes across transports: the renderer's dedup is
  // per query-key and never sees an MCP call. Without this map, the UI and Claude asking for the
  // same symbol×timeframe at once cost two FMP requests (M-10).
  const inFlight = new Map<string, Promise<OhlcvOutcome>>()

  const requireKey = (): string => {
    const apiKey = keystore.getApiKey()
    if (!apiKey) throw new Error('NO_API_KEY')
    return apiKey
  }

  const providerFor = (): ProviderLike => makeProvider(requireKey())

  // The cache service gets a provider wrapper that counts real fetches, so callers can report
  // "cache hit, no API call" vs "1 API call" without CacheService having to track it.
  const cacheFor = (counter: { calls: number }) => {
    const provider = providerFor()
    return createCacheService({
      provider: {
        getOHLCV: (symbol, tf, range) => {
          counter.calls += 1
          return provider.getOHLCV(symbol, tf, range)
        },
        searchSymbols: (query) => provider.searchSymbols(query)
      },
      store: barStore,
      now: deps.nowSec
    })
  }

  // Shared bookkeeping for every real OHLCV fetch (get + refresh): short-circuit known off-plan
  // symbols, record 'available' on success, classify FmpHttpErrors, and turn the result into an
  // OhlcvOutcome.
  const runTracked = async (
    symbol: string, timeframe: Timeframe, counter: { calls: number }, run: () => Promise<Bar[]>
  ): Promise<OhlcvOutcome> => {
    if (DAILY_BACKED.includes(timeframe) && dailyOutOfPlan.has(symbol)) return { kind: 'out-of-plan' }

    let bars: Bar[]
    try {
      bars = await run()
    } catch (err) {
      const planGated = err instanceof FmpHttpError && (err.status === 402 || err.status === 403)
      const symbolOffPlan = planGated && DAILY_BACKED.includes(timeframe)
      if (symbolOffPlan) dailyOutOfPlan.add(symbol)
      const apiKey = keystore.getApiKey()
      if (apiKey && !DERIVED_TIMEFRAMES.includes(timeframe) && err instanceof FmpHttpError) {
        const verdict = classify(err.status, err.body)
        // Daily is a free-tier capability: a 402/403 on '1d' means the SYMBOL is outside the plan,
        // not that daily needs a paid plan. Recording requires-plan here would grey D for every
        // symbol (D-graying bug). Rate-limit is transient and still records.
        if (!(timeframe === '1d' && verdict === 'requires-plan')) {
          capabilityCache.setStatus(apiKey, timeframe, verdict)
        }
      }
      // Symbol-level plan gating is a *result*, not a failure — the renderer already renders it as
      // "not covered". A timeframe-level 402/403 (intraday) still throws so callers can say so.
      if (symbolOffPlan) return { kind: 'out-of-plan' }
      throw err
    }

    const apiKey = keystore.getApiKey()
    if (apiKey && !DERIVED_TIMEFRAMES.includes(timeframe)) {
      capabilityCache.setStatus(apiKey, timeframe, 'available')
    }
    if (bars.length > 0) return { kind: 'ok', bars, apiCalls: counter.calls }
    // Empty. W/M carry no rows of their own (D-17) — their coverage IS the daily coverage.
    const covTf = DAILY_BACKED.includes(timeframe) ? '1d' : timeframe
    return barStore.getCoverage(symbol, covTf) ? { kind: 'empty-range' } : { kind: 'unknown-symbol' }
  }

  const dedup = (key: string, run: () => Promise<OhlcvOutcome>): Promise<OhlcvOutcome> => {
    const existing = inFlight.get(key)
    if (existing) return existing
    const started = run().finally(() => inFlight.delete(key))
    inFlight.set(key, started)
    return started
  }

  return {
    ohlcv: {
      get(symbol: string, timeframe: Timeframe, range: DateRange): Promise<OhlcvOutcome> {
        const key = `get|${symbol}|${timeframe}|${range?.from ?? ''}|${range?.to ?? ''}`
        return dedup(key, () => {
          const counter = { calls: 0 }
          return runTracked(symbol, timeframe, counter, () => cacheFor(counter).getOHLCV(symbol, timeframe, range))
        })
      },
      refresh(symbol: string, timeframe: Timeframe): Promise<OhlcvOutcome> {
        return dedup(`refresh|${symbol}|${timeframe}`, () => {
          const counter = { calls: 0 }
          return runTracked(symbol, timeframe, counter, () => cacheFor(counter).refreshOHLCV(symbol, timeframe))
        })
      }
    },

    apikey: {
      set(key: string): SetKeyResult {
        const result = keystore.setApiKey(key)
        capabilityCache.clearForKeyChange() // D-21: drop stale verdicts, never eagerly re-probe
        dailyOutOfPlan.clear() // a new key may cover previously-off-plan symbols
        return result
      },
      status: (): KeyStatus => keystore.getKeyStatus(),
      clear(): void {
        keystore.clearApiKey()
        capabilityCache.clearForKeyChange()
        dailyOutOfPlan.clear()
      }
    }
  }
}
```

Note: `broadcast` and `ALL_TIMEFRAMES` are unused until Task 3 — silence the lint/TS noise by leaving `broadcast` destructured only once Task 3 uses it. If `npm run typecheck` complains about the unused binding, drop `broadcast` from the destructuring in this task and add it back in Task 3. Same for `ALL_TIMEFRAMES`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/main/core/ohlcv.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/core.ts tests/main/core/ohlcv.test.ts
git commit -m "feat(core): transport-independent OHLCV surface with outcome kinds and fetch dedup"
```

---

### Task 3: `core.ts` — remaining surfaces, and `barStore.summarizeBars`

Move the rest of `ipc.ts`'s domain logic into the core: symbol search (+ its 5-minute cache and profile seeding), profile, quote, market status, company info, workspaces (rev + broadcast), clipboard (rev + broadcast), capabilities, and the new cache-status summary.

**Files:**
- Modify: `src/main/db/barStore.ts` (add `summarizeBars`)
- Modify: `src/main/core.ts` (add the surfaces to the returned object)
- Test: `tests/main/core/surfaces.test.ts`

**Interfaces:**
- Consumes: `CoreDeps`, `createCore` from Task 2.
- Produces:

```ts
// src/main/db/barStore.ts
export type BarSummary = { symbol: string; timeframe: Timeframe; count: number; oldestTime: number; newestTime: number }
export function summarizeBars(): BarSummary[]

// added to createCore's return
symbols: { search(query: string): Promise<SymbolResult[]>; profile(symbol: string): Promise<SymbolResult> }
quote: { get(symbol: string): Promise<Quote> }
market: { status(): Promise<MarketStatus> }
company: { info(symbol: string, opts?: { force?: boolean }): Promise<CompanyInfo> }
workspaces: {
  get(): { collection: WorkspaceCollection; rev: number }
  set(c: WorkspaceCollection, fromWebContentsId?: number): void
}
clipboard: {
  get(): { clipboard: ClipboardCell | null; rev: number }
  set(c: ClipboardCell | null, fromWebContentsId?: number): number
}
capabilities: { get(): Record<Timeframe, CapabilityStatus> }
cacheStatus: { summarize(symbol?: string): BarSummary[] }
```

- [ ] **Step 1: Write the failing test file**

Create `tests/main/core/surfaces.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createCore, type CoreDeps } from '../../../src/main/core'
import { CH } from '@shared/ipc'
import type { WorkspaceCollection } from '@shared/types'

const collection = (name: string): WorkspaceCollection => ({
  version: 3,
  active: name,
  workspaces: [{ name, items: [], layout: { schemaVersion: 1, cells: [], shape: { rows: 1, cols: 1 }, activeCellId: '1' } }]
})

function deps(over: Partial<CoreDeps> = {}): CoreDeps {
  const base: CoreDeps = {
    broadcast: vi.fn(),
    barStore: {
      getCoverage: vi.fn(() => null),
      getBars: vi.fn(() => []),
      upsertBarsAndCoverage: vi.fn(),
      summarizeBars: vi.fn(() => [
        { symbol: 'AAPL', timeframe: '1d' as const, count: 10, oldestTime: 1, newestTime: 2 },
        { symbol: 'NVDA', timeframe: '5m' as const, count: 20, oldestTime: 3, newestTime: 4 }
      ])
    },
    profileStore: { getProfile: vi.fn(() => null), upsertProfile: vi.fn() },
    companyProfileStore: { getCompanyProfile: vi.fn(() => null), upsertCompanyProfile: vi.fn() },
    workspaceStore: { getWorkspaces: vi.fn(() => collection('W')), setWorkspaces: vi.fn() },
    capabilityCache: { getStatus: vi.fn(() => 'requires-plan' as const), setStatus: vi.fn(), clearForKeyChange: vi.fn() },
    keystore: {
      getApiKey: vi.fn(() => 'KEY'),
      setApiKey: vi.fn(() => ({ ok: true, encryptionAvailable: true })),
      getKeyStatus: vi.fn(() => ({ hasKey: true, encryptionAvailable: true })),
      clearApiKey: vi.fn()
    },
    makeProvider: vi.fn(() => ({
      getOHLCV: vi.fn(async () => []),
      searchSymbols: vi.fn(async () => [{ symbol: 'NVDA', name: 'NVIDIA', exchange: 'NASDAQ' }]),
      getQuote: vi.fn(async () => ({ price: 1, open: 1, dayHigh: 1, dayLow: 1, previousClose: 1, changePercentage: 0, timestamp: 0, exchange: 'NASDAQ' })),
      getMarketStatus: vi.fn(async () => ({ isOpen: true })),
      getCompanyProfile: vi.fn()
    })),
    nowSec: () => 1_000
  }
  return { ...base, ...over }
}

describe('core.symbols.search', () => {
  it('caches results and seeds the profile store', async () => {
    const d = deps()
    const core = createCore(d)

    const first = await core.symbols.search('nvda')
    const second = await core.symbols.search('NVDA ') // same key after trim+lowercase

    expect(first).toEqual([{ symbol: 'NVDA', name: 'NVIDIA', exchange: 'NASDAQ' }])
    expect(second).toEqual(first)
    expect(d.makeProvider).toHaveBeenCalledOnce() // second hit came from the 5-minute cache
    expect(d.profileStore.upsertProfile).toHaveBeenCalledWith({ symbol: 'NVDA', name: 'NVIDIA', exchange: 'NASDAQ' })
  })

  it('throws NO_API_KEY without a key', async () => {
    const d = deps()
    d.keystore.getApiKey = vi.fn(() => null)
    await expect(createCore(d).symbols.search('nvda')).rejects.toThrow('NO_API_KEY')
  })
})

describe('core.workspaces', () => {
  it('stamps a monotonic rev and broadcasts to everyone except the sender', () => {
    const d = deps()
    const core = createCore(d)
    const c = collection('Main')

    expect(core.workspaces.get().rev).toBe(0)
    core.workspaces.set(c, 7)

    expect(d.workspaceStore.setWorkspaces).toHaveBeenCalledWith(c)
    expect(d.broadcast).toHaveBeenCalledWith(CH.workspacesChanged, { collection: c, rev: 1 }, 7)
    expect(core.workspaces.get().rev).toBe(1)
  })
})

describe('core.clipboard', () => {
  it('holds the value, returns the authoritative rev, and broadcasts', () => {
    const d = deps()
    const core = createCore(d)
    const cell = { symbol: 'NVDA', timeframe: '1d' as const, indicators: [] }

    expect(core.clipboard.get()).toEqual({ clipboard: null, rev: 0 })
    expect(core.clipboard.set(cell, 3)).toBe(1)

    expect(d.broadcast).toHaveBeenCalledWith(CH.clipboardChanged, { clipboard: cell, rev: 1 }, 3)
    expect(core.clipboard.get()).toEqual({ clipboard: cell, rev: 1 })
  })
})

describe('core.capabilities.get', () => {
  it('always reports derived timeframes as available and consults the cache for the rest', () => {
    const core = createCore(deps())
    expect(core.capabilities.get()).toEqual({
      '1m': 'requires-plan', '5m': 'requires-plan', '15m': 'requires-plan', '1h': 'requires-plan',
      '1d': 'requires-plan', '1w': 'available', '1M': 'available'
    })
  })

  it('reports unknown for real timeframes when there is no API key', () => {
    const d = deps()
    d.keystore.getApiKey = vi.fn(() => null)
    expect(createCore(d).capabilities.get()['1d']).toBe('unknown')
  })
})

describe('core.cacheStatus.summarize', () => {
  it('returns every series when no symbol is given', () => {
    expect(createCore(deps()).cacheStatus.summarize()).toHaveLength(2)
  })

  it('filters to one symbol, case-insensitively', () => {
    const rows = createCore(deps()).cacheStatus.summarize('nvda')
    expect(rows.map((r) => r.symbol)).toEqual(['NVDA'])
  })
})

describe('core.quote / core.market', () => {
  it('reaches the provider directly (never the SQLite cache)', async () => {
    const core = createCore(deps())
    expect((await core.quote.get('NVDA')).price).toBe(1)
    expect(await core.market.status()).toEqual({ isOpen: true })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/main/core/surfaces.test.ts`
Expected: FAIL — `core.symbols is undefined` (and the same for the other new surfaces).

- [ ] **Step 3: Add `summarizeBars` to `barStore`**

Append to `src/main/db/barStore.ts` (and add `desc` is NOT needed; the existing `sql` import already covers it):

```ts
export type BarSummary = {
  symbol: string
  timeframe: Timeframe
  count: number
  oldestTime: number
  newestTime: number
}

// One aggregate for every symbol×timeframe — the alternative (enumerate, then COUNT(*) per series)
// is an N+1. Aggregates `bars`, not `coverage`: a coverage window is a union and can be wider than
// the bars actually stored, and the question this answers is "how many bars are here right now".
// '1w'/'1M' never appear — they are derived from '1d' at read time and hold no rows (D-17).
export function summarizeBars(): BarSummary[] {
  const rows = getDb()
    .select({
      symbol: bars.symbol,
      timeframe: bars.timeframe,
      count: sql<number>`count(*)`,
      oldestTime: sql<number>`min(${bars.time})`,
      newestTime: sql<number>`max(${bars.time})`
    })
    .from(bars)
    .groupBy(bars.symbol, bars.timeframe)
    .all()
  return rows.map((r) => ({ ...r, timeframe: r.timeframe as Timeframe }))
}
```

- [ ] **Step 4: Add the surfaces to `core.ts`**

Add these imports at the top of `src/main/core.ts`:

```ts
import { CH } from '@shared/ipc'
import { createSearchCache } from './searchCache'
import { createProfileService } from './profile/ProfileService'
import { createCompanyInfoService } from './profile/CompanyInfoService'
import type { BarSummary } from './db/barStore'
```

Re-export the summary type so consumers don't reach into the store module:

```ts
export type { BarSummary } from './db/barStore'
```

Inside `createCore`, after the `dailyOutOfPlan` declaration, add the state and services:

```ts
  const searchCache = createSearchCache({ ttlMs: 5 * 60 * 1000, now: () => Date.now() })

  // Monotonic version stamped on each persisted workspace write. Renderers ignore stale
  // (<= lastRev) get/broadcast payloads — see useWorkspaceSync.
  let workspacesRev = 0

  // Chart clipboard: the authoritative value lives here (in-memory, never persisted) so a window
  // opened after a copy can still fetch it. Same rev/broadcast contract as workspaces.
  let clipboard: ClipboardCell | null = null
  let clipboardRev = 0
```

After the `cacheFor` helper, add:

```ts
  const profileService = createProfileService({
    store: deps.profileStore,
    search: (query) => providerFor().searchSymbols(query)
  })

  // Company info (distinct from ProfileService/symbol resolution): TTL cache in SQLite, same
  // provider path as search/OHLCV.
  const companyInfoService = createCompanyInfoService({
    store: deps.companyProfileStore,
    fetch: (symbol) => providerFor().getCompanyProfile(symbol)
  })
```

And extend the returned object (keep `ohlcv` and `apikey` from Task 2):

```ts
    symbols: {
      async search(query: string): Promise<SymbolResult[]> {
        const cached = searchCache.get(query)
        if (cached) return cached
        const results = await providerFor().searchSymbols(query)
        searchCache.set(query, results)
        // Seed the profile cache for free — every result carries name/exchange, so a symbol picked
        // from these results resolves its header profile with zero extra API calls.
        try {
          for (const r of results) deps.profileStore.upsertProfile(r)
        } catch {
          // best-effort cache warming — never fail a search on a side effect
        }
        return results
      },
      profile: (symbol: string): Promise<SymbolResult> => profileService.getProfile(symbol)
    },

    // Quote / market status are volatile and NOT cached in SQLite (SQLite = OHLCV only), and are
    // not timeframes, so they stay out of the capability cache.
    quote: { get: (symbol: string): Promise<Quote> => providerFor().getQuote(symbol) },
    market: { status: (): Promise<MarketStatus> => providerFor().getMarketStatus() },

    company: {
      info: (symbol: string, opts?: { force?: boolean }): Promise<CompanyInfo> =>
        companyInfoService.getInfo(symbol, opts)
    },

    workspaces: {
      get: (): { collection: WorkspaceCollection; rev: number } => ({
        collection: deps.workspaceStore.getWorkspaces(),
        rev: workspacesRev
      }),
      set(c: WorkspaceCollection, fromWebContentsId?: number): void {
        deps.workspaceStore.setWorkspaces(c)
        workspacesRev += 1
        // Every OTHER window re-hydrates; the sender skips itself (its store is already current
        // and re-applying would fight its debounce).
        broadcast(CH.workspacesChanged, { collection: c, rev: workspacesRev }, fromWebContentsId)
      }
    },

    clipboard: {
      get: (): { clipboard: ClipboardCell | null; rev: number } => ({ clipboard, rev: clipboardRev }),
      set(c: ClipboardCell | null, fromWebContentsId?: number): number {
        clipboard = c
        clipboardRev += 1
        broadcast(CH.clipboardChanged, { clipboard: c, rev: clipboardRev }, fromWebContentsId)
        // Return the authoritative rev: the sender gets no self-broadcast, so without it a startup
        // get() that lost the race could clobber this write.
        return clipboardRev
      }
    },

    capabilities: {
      get(): Record<Timeframe, CapabilityStatus> {
        const apiKey = keystore.getApiKey()
        const result = {} as Record<Timeframe, CapabilityStatus>
        for (const tf of ALL_TIMEFRAMES) {
          result[tf] = DERIVED_TIMEFRAMES.includes(tf)
            ? 'available'
            : apiKey
              ? capabilityCache.getStatus(apiKey, tf)
              : 'unknown'
        }
        return result
      }
    },

    cacheStatus: {
      summarize(symbol?: string): BarSummary[] {
        const rows = barStore.summarizeBars()
        if (!symbol) return rows
        const wanted = symbol.toUpperCase()
        return rows.filter((r) => r.symbol.toUpperCase() === wanted)
      }
    }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/main/core && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/core.ts src/main/db/barStore.ts tests/main/core/surfaces.test.ts
git commit -m "feat(core): move symbols, quote, company, workspaces, clipboard, capabilities into the core"
```

---

### Task 4: Rewire `ipc.ts` and `index.ts` onto the core

`registerIpc` becomes a channel→core table. The `OhlcvOutcome` kinds all fold back to `[]` so the renderer's contract is untouched.

**Files:**
- Modify: `src/main/ipc.ts` (full rewrite of the file)
- Modify: `src/main/index.ts:118-130`
- Test: `tests/main/core/fold.test.ts` (create)

**Interfaces:**
- Consumes: `createCore`, `Core`, `OhlcvOutcome` from Tasks 2-3.
- Produces:
  - `export function toBars(outcome: OhlcvOutcome): Bar[]` in **`src/main/core.ts`** — the renderer-facing fold. It lives next to `OhlcvOutcome` (it is that type's inverse) and not in `ipc.ts`, because `ipc.ts` imports `electron` at module scope and Vitest cannot resolve it.
  - `export function registerIpc(core: Core): void` — signature change; `index.ts` now builds the core.

- [ ] **Step 1: Write the failing test**

Create `tests/main/core/fold.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { toBars } from '../../../src/main/core'
import type { Bar } from '@shared/types'

const bar: Bar = { time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }

describe('toBars', () => {
  it('passes bars through on ok', () => {
    expect(toBars({ kind: 'ok', bars: [bar], apiCalls: 1 })).toEqual([bar])
  })

  it.each(['out-of-plan', 'unknown-symbol', 'empty-range'] as const)(
    'folds %s to an empty array so the renderer contract is unchanged',
    (kind) => {
      expect(toBars({ kind })).toEqual([])
    }
  )
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/main/core/fold.test.ts`
Expected: FAIL — `toBars is not a function` / not exported.

- [ ] **Step 3: Add `toBars` to `core.ts`**

Append to `src/main/core.ts` (module scope, next to the `OhlcvOutcome` type):

```ts
// The renderer's Api contract predates OhlcvOutcome and still resolves to Bar[]: every non-ok kind
// collapses to [] there, which the UI already renders as "not covered" (M-09).
export function toBars(outcome: OhlcvOutcome): Bar[] {
  return outcome.kind === 'ok' ? outcome.bars : []
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/main/core/fold.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite `src/main/ipc.ts`**

Replace the entire file with:

```ts
import { ipcMain, BrowserWindow } from 'electron'
import type { Timeframe, DateRange, WorkspaceCollection, ClipboardCell } from '@shared/types'
import { CH, type RefreshAppliedPayload } from '@shared/ipc'
import { toBars, type Core } from './core'
import {
  getLastSymbol, setLastSymbol, getSidebarOpen, setSidebarOpen, getSidebarWidth, setSidebarWidth,
  getTheme, setTheme, getAutoRefresh, setAutoRefresh, type Theme
} from './settings'

// Thin transport layer: channel name → core method. Every behaviour (capability tracking, cache
// decisions, rev bookkeeping) lives in core.ts so MCP gets the identical semantics.
export function registerIpc(core: Core): void {
  ipcMain.handle(CH.symbolsSearch, (_e, query: string) => core.symbols.search(query))
  ipcMain.handle(CH.symbolsProfile, (_e, symbol: string) => core.symbols.profile(symbol))
  ipcMain.handle(CH.companyInfo, (_e, symbol: string, opts?: { force?: boolean }) => core.company.info(symbol, opts))

  ipcMain.handle(CH.ohlcvGet, async (_e, symbol: string, timeframe: Timeframe, range: DateRange) =>
    toBars(await core.ohlcv.get(symbol, timeframe, range))
  )
  ipcMain.handle(CH.ohlcvRefresh, async (_e, symbol: string, timeframe: Timeframe) =>
    toBars(await core.ohlcv.refresh(symbol, timeframe))
  )

  ipcMain.handle(CH.quoteGet, (_e, symbol: string) => core.quote.get(symbol))
  ipcMain.handle(CH.marketStatus, () => core.market.status())

  ipcMain.handle(CH.apikeySet, (_e, key: string) => core.apikey.set(key))
  ipcMain.handle(CH.apikeyStatus, () => core.apikey.status())
  ipcMain.handle(CH.apikeyClear, () => core.apikey.clear())

  ipcMain.handle(CH.settingsGetLastSymbol, () => getLastSymbol())
  ipcMain.handle(CH.settingsSetLastSymbol, (_e, symbol: string) => setLastSymbol(symbol))
  ipcMain.handle(CH.settingsGetSidebarOpen, () => getSidebarOpen())
  ipcMain.handle(CH.settingsSetSidebarOpen, (_e, open: boolean) => setSidebarOpen(open))
  ipcMain.handle(CH.settingsGetSidebarWidth, () => getSidebarWidth())
  ipcMain.handle(CH.settingsSetSidebarWidth, (_e, width: number) => setSidebarWidth(width))
  ipcMain.handle(CH.settingsGetTheme, () => getTheme())
  ipcMain.handle(CH.settingsSetTheme, (_e, theme: Theme) => setTheme(theme))
  ipcMain.handle(CH.settingsGetAutoRefresh, () => getAutoRefresh())
  ipcMain.handle(CH.settingsSetAutoRefresh, (_e, on: boolean) => setAutoRefresh(on))

  ipcMain.handle(CH.workspacesGet, () => core.workspaces.get())
  ipcMain.handle(CH.workspacesSet, (e, c: WorkspaceCollection) => core.workspaces.set(c, e.sender.id))

  ipcMain.handle(CH.clipboardGet, () => core.clipboard.get())
  ipcMain.handle(CH.clipboardSet, (e, c: ClipboardCell | null) => core.clipboard.set(c, e.sender.id))

  // refresh 配信: 送信元(メインウィンドウ)以外の全ウィンドウへ転送。純粋な転送で状態を持たないので
  // core には置かない。
  ipcMain.handle(CH.refreshBroadcast, (e, p: RefreshAppliedPayload) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.webContents.id !== e.sender.id) w.webContents.send(CH.refreshApplied, p)
    }
  })

  ipcMain.handle(CH.capabilitiesGet, () => core.capabilities.get())
}
```

- [ ] **Step 6: Build the core in `src/main/index.ts`**

Add these imports at the top of `src/main/index.ts`:

```ts
import { createCore } from './core'
import * as barStore from './db/barStore'
import * as profileStore from './db/profileStore'
import * as companyProfileStore from './db/companyProfileStore'
import * as workspaceStore from './workspaceStore'
import * as capabilityCache from './capabilityCache'
import { getApiKey, setApiKey, getKeyStatus, clearApiKey } from './keystore'
import { FmpProvider } from './providers/FmpProvider'
import { electronHttpGetJson } from './net/httpClient'
```

Add above `app.whenReady()`:

```ts
// Send to every window except the originator. core.ts stays free of `electron` imports by taking
// this as a dep (same reasoning as db/client.ts's lazy require).
function broadcast(channel: string, payload: unknown, exceptWebContentsId?: number): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.webContents.id !== exceptWebContentsId) w.webContents.send(channel, payload)
  }
}

function buildCore(): ReturnType<typeof createCore> {
  return createCore({
    broadcast,
    barStore,
    profileStore,
    companyProfileStore,
    workspaceStore,
    capabilityCache,
    keystore: { getApiKey, setApiKey, getKeyStatus, clearApiKey },
    makeProvider: (apiKey) => new FmpProvider({ apiKey, httpGetJson: electronHttpGetJson })
  })
}
```

Then in `app.whenReady().then(...)`, replace `registerIpc()` with:

```ts
  const core = buildCore()
  registerIpc(core)
```

- [ ] **Step 7: Run everything**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 8: Smoke-test the app**

Run: `npm run dev`
Expected: the app opens, a chart loads from cache, switching timeframes works, and copy/paste between cells still syncs. Close the app.

- [ ] **Step 9: Commit**

```bash
git add src/main/core.ts src/main/ipc.ts src/main/index.ts tests/main/core/fold.test.ts
git commit -m "refactor(main): route ipc through the core"
```

---

### Task 5: MCP configuration in `settings.json`

**Files:**
- Modify: `src/main/settings.ts`
- Modify: `src/shared/ipc.ts` (types only, in this task)
- Test: none — `settings.ts` reads `app.getPath('userData')` at call time and is untested by existing precedent (`keystore.ts`, `capabilityCache.ts` file I/O likewise). The one piece of logic worth pinning (the token generator) is a single `randomBytes` call.

**Interfaces:**
- Produces:

```ts
// src/shared/ipc.ts
export type McpConfig = { enabled: boolean; port: number; token: string }
export type McpStatus = { running: boolean; error?: string }

// src/main/settings.ts
export function getMcpConfig(): McpConfig   // mints + persists a token on first read
export function setMcpConfig(patch: Partial<McpConfig>): McpConfig
export function regenerateMcpToken(): McpConfig
```

- [ ] **Step 1: Add the shared types**

In `src/shared/ipc.ts`, after the `Theme` type, add:

```ts
// MCP サーバ設定。token は Settings 画面のコピーボタン用に平文で渡す（M-11）。
export type McpConfig = { enabled: boolean; port: number; token: string }
export type McpStatus = { running: boolean; error?: string }
```

- [ ] **Step 2: Add the settings accessors**

Append to `src/main/settings.ts`:

```ts
import { randomBytes } from 'crypto'
import type { McpConfig } from '@shared/ipc'

const MCP_DEFAULT_PORT = 39100

// M-11: the MCP token is stored in plain text, unlike the FMP API key (D-05). It is a
// localhost-only credential, revocable from the Settings dialog, and has to be displayed verbatim
// so the user can paste it into a client config — safeStorage would protect nothing extra here.
export function getMcpConfig(): McpConfig {
  const raw = read().mcp
  const cfg = typeof raw === 'object' && raw !== null ? (raw as Partial<McpConfig>) : {}
  const config: McpConfig = {
    enabled: cfg.enabled === true,
    port: typeof cfg.port === 'number' && Number.isInteger(cfg.port) ? cfg.port : MCP_DEFAULT_PORT,
    token: typeof cfg.token === 'string' && cfg.token.length > 0 ? cfg.token : randomBytes(32).toString('base64url')
  }
  // Persist a freshly minted token so the value shown in Settings is the one the server accepts.
  if (config.token !== cfg.token) writeJsonFile(settingsPath(), { ...read(), mcp: config })
  return config
}

export function setMcpConfig(patch: Partial<McpConfig>): McpConfig {
  const next = { ...getMcpConfig(), ...patch }
  writeJsonFile(settingsPath(), { ...read(), mcp: next })
  return next
}

export function regenerateMcpToken(): McpConfig {
  return setMcpConfig({ token: randomBytes(32).toString('base64url') })
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/main/settings.ts src/shared/ipc.ts
git commit -m "feat(settings): MCP server config with a generated bearer token"
```

---

### Task 6: `mcp/format.ts` — pure output formatting

Every string Claude reads is built here, with no SDK and no I/O, so it is fully unit-testable.

**Files:**
- Create: `src/main/mcp/format.ts`
- Test: `tests/main/mcp/format.test.ts`

**Interfaces:**
- Consumes: `BarSummary` from `src/main/core.ts`.
- Produces:

```ts
export function parseIsoToEpoch(value: string): number          // seconds; throws on unparseable
export function formatEpoch(time: number, tf: Timeframe): string // YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ
export function isIntraday(tf: Timeframe): boolean
export function clampLimit(limit: number | undefined): { limit: number; note: string | null }
export function interpretationNote(label: 'from' | 'to', value: string, tf: Timeframe): string | null
export function unmetRangeNotes(req: { from?: string; to?: string }, full: Bar[], tf: Timeframe): string[]
export function summaryLine(a: { symbol: string; timeframe: Timeframe; shown: Bar[]; total: number; apiCalls: number }): string
export function toCsv(bars: Bar[], tf: Timeframe): string
export function formatCacheStatus(rows: BarSummary[], capabilities: Record<Timeframe, CapabilityStatus>, symbol?: string): string
export function formatWorkspaceList(collection: WorkspaceCollection): string
export function formatWorkspaceDetail(w: Workspace, isActive: boolean): string
export function formatSymbolResults(results: SymbolResult[]): string
export function formatQuote(symbol: string, q: Quote): string
export function formatCompanyInfo(info: CompanyInfo, forcedButStale: boolean): string
```

- [ ] **Step 1: Write the failing test file**

Create `tests/main/mcp/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  parseIsoToEpoch, formatEpoch, clampLimit, interpretationNote, unmetRangeNotes,
  summaryLine, toCsv, formatCacheStatus, formatWorkspaceList, formatWorkspaceDetail
} from '../../../src/main/mcp/format'
import type { Bar, Timeframe, WorkspaceCollection, Workspace } from '@shared/types'
import type { CapabilityStatus } from '@shared/ipc'

const at = (iso: string): number => Math.floor(Date.parse(iso) / 1000)
const bar = (time: number): Bar => ({ time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 })

describe('parseIsoToEpoch', () => {
  it('reads a date as midnight UTC', () => {
    expect(parseIsoToEpoch('2026-07-24')).toBe(at('2026-07-24T00:00:00Z'))
  })

  it('reads a full ISO timestamp', () => {
    expect(parseIsoToEpoch('2026-07-24T13:30:00Z')).toBe(at('2026-07-24T13:30:00Z'))
  })

  it('throws on garbage', () => {
    expect(() => parseIsoToEpoch('yesterday')).toThrow()
  })
})

describe('formatEpoch', () => {
  it('prints a date for daily-backed timeframes', () => {
    expect(formatEpoch(at('2026-07-24T00:00:00Z'), '1d')).toBe('2026-07-24')
    expect(formatEpoch(at('2026-07-24T00:00:00Z'), '1M')).toBe('2026-07-24')
  })

  it('prints a full timestamp for intraday', () => {
    expect(formatEpoch(at('2026-07-24T13:30:00Z'), '5m')).toBe('2026-07-24T13:30:00Z')
  })
})

describe('clampLimit', () => {
  it('defaults to 300', () => {
    expect(clampLimit(undefined)).toEqual({ limit: 300, note: null })
  })

  it('passes an in-range limit through', () => {
    expect(clampLimit(50)).toEqual({ limit: 50, note: null })
  })

  it('caps at 2000 and says so', () => {
    expect(clampLimit(5000)).toEqual({ limit: 2000, note: 'note: limit was capped at 2000 (requested 5000).' })
  })
})

describe('interpretationNote', () => {
  it('explains a date-only bound on an intraday request', () => {
    expect(interpretationNote('from', '2026-01-01', '5m')).toBe('note: from=2026-01-01 was read as 2026-01-01T00:00:00Z.')
  })

  it('says nothing for a daily request', () => {
    expect(interpretationNote('from', '2026-01-01', '1d')).toBeNull()
  })

  it('says nothing when a full timestamp was given', () => {
    expect(interpretationNote('to', '2026-01-01T10:00:00Z', '5m')).toBeNull()
  })
})

describe('unmetRangeNotes', () => {
  it('warns when the oldest returned bar is newer than the requested from', () => {
    const notes = unmetRangeNotes({ from: '2026-01-01' }, [bar(at('2026-07-18T13:30:00Z'))], '5m')
    expect(notes).toEqual([
      'note: requested from=2026-01-01 but the oldest bar returned is 2026-07-18T13:30:00Z — the FMP plan may not carry intraday history that far back. This is NOT the complete history for that range.'
    ])
  })

  it('warns when the newest returned bar is older than the requested to', () => {
    const notes = unmetRangeNotes({ to: '2026-07-24' }, [bar(at('2026-07-20T00:00:00Z'))], '1d')
    expect(notes).toEqual([
      'note: requested to=2026-07-24 but the newest bar returned is 2026-07-20 — pass force=true to fetch newer bars from FMP.'
    ])
  })

  it('says nothing when the range was satisfied', () => {
    const bars = [bar(at('2026-07-01T00:00:00Z')), bar(at('2026-07-24T00:00:00Z'))]
    expect(unmetRangeNotes({ from: '2026-07-01', to: '2026-07-24' }, bars, '1d')).toEqual([])
  })

  it('says nothing when no bounds were requested', () => {
    expect(unmetRangeNotes({}, [bar(1)], '1d')).toEqual([])
  })
})

describe('summaryLine', () => {
  it('reports a cache hit', () => {
    const shown = [bar(at('2025-05-12T00:00:00Z')), bar(at('2026-07-24T00:00:00Z'))]
    expect(summaryLine({ symbol: 'NVDA', timeframe: '1d', shown, total: 4812, apiCalls: 0 }))
      .toBe('NVDA 1d — 2 of 4812 cached bars, 2025-05-12 to 2026-07-24 (cache hit, no API call)')
  })

  it('reports the number of API calls made', () => {
    const shown = [bar(at('2026-07-18T13:30:00Z'))]
    expect(summaryLine({ symbol: 'NVDA', timeframe: '5m', shown, total: 1170, apiCalls: 1 }))
      .toBe('NVDA 5m — 1 of 1170 cached bars, 2026-07-18T13:30:00Z to 2026-07-18T13:30:00Z (1 API call)')
  })
})

describe('toCsv', () => {
  it('emits a header and one row per bar', () => {
    expect(toCsv([bar(at('2026-07-24T00:00:00Z'))], '1d')).toBe(
      'time,open,high,low,close,volume\n2026-07-24,1,2,0.5,1.5,100'
    )
  })
})

const caps: Record<Timeframe, CapabilityStatus> = {
  '1m': 'unknown', '5m': 'available', '15m': 'unknown', '1h': 'requires-plan',
  '1d': 'available', '1w': 'available', '1M': 'available'
}

describe('formatCacheStatus', () => {
  it('lists every series and tags the daily row with its derived timeframes', () => {
    const rows = [
      { symbol: 'AAPL', timeframe: '1d' as const, count: 4812, oldestTime: at('1998-01-02T00:00:00Z'), newestTime: at('2026-07-24T00:00:00Z') },
      { symbol: 'NVDA', timeframe: '5m' as const, count: 1170, oldestTime: at('2026-07-18T13:30:00Z'), newestTime: at('2026-07-24T20:00:00Z') }
    ]
    const text = formatCacheStatus(rows, caps)
    expect(text).toContain('AAPL 1d — 4812 bars, 1998-01-02 to 2026-07-24 (also serves 1w, 1M)')
    expect(text).toContain('NVDA 5m — 1170 bars, 2026-07-18T13:30:00Z to 2026-07-24T20:00:00Z')
    expect(text).toContain('Timeframe capability: 1m unknown, 5m available, 15m unknown, 1h requires-plan, 1d available, 1w available, 1M available')
  })

  it('says so when a symbol has nothing cached', () => {
    expect(formatCacheStatus([], caps, 'TSLA')).toContain('Nothing cached for TSLA.')
  })
})

const workspace = (name: string): Workspace => ({
  name,
  items: [{ symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ' }],
  layout: {
    schemaVersion: 1,
    shape: { rows: 2, cols: 2 },
    activeCellId: 'c1',
    cells: [
      { id: 'c1', symbol: 'NVDA', timeframe: '1d', indicators: [{ id: 'i1', type: 'ma', params: { period: 20 }, colors: {}, visible: true }] },
      { id: 'c2', symbol: null, timeframe: '5m', indicators: [] }
    ]
  }
})

describe('formatWorkspaceList', () => {
  it('summarises each workspace on one line', () => {
    const collection: WorkspaceCollection = { version: 3, active: 'Main', workspaces: [workspace('Main'), workspace('Scratch')] }
    expect(formatWorkspaceList(collection)).toBe(
      [
        'Workspaces (2) — active: Main',
        '- Main (active) — 1 watchlist symbol, 2x2 grid, 2 cells',
        '- Scratch — 1 watchlist symbol, 2x2 grid, 2 cells'
      ].join('\n')
    )
  })
})

describe('formatWorkspaceDetail', () => {
  it('prints the watchlist and every cell with its indicators', () => {
    const text = formatWorkspaceDetail(workspace('Main'), true)
    expect(text).toContain('Workspace: Main (active)')
    expect(text).toContain('Grid: 2 rows x 2 cols, active cell: c1')
    expect(text).toContain('- NVDA — NVIDIA Corporation (NASDAQ)')
    expect(text).toContain('- [c1] NVDA 1d — ma(period=20)')
    expect(text).toContain('- [c2] (empty) 5m — no indicators')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/main/mcp/format.test.ts`
Expected: FAIL — cannot resolve `src/main/mcp/format`.

- [ ] **Step 3: Write `src/main/mcp/format.ts`**

```ts
import type {
  Bar, Timeframe, SymbolResult, Quote, CompanyInfo, Workspace, WorkspaceCollection
} from '@shared/types'
import type { CapabilityStatus } from '@shared/ipc'
import type { BarSummary } from '../core'

const ALL_TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '1d', '1w', '1M']
const DERIVED_TIMEFRAMES: Timeframe[] = ['1w', '1M']

export const DEFAULT_LIMIT = 300
export const MAX_LIMIT = 2000

export function isIntraday(tf: Timeframe): boolean {
  return tf !== '1d' && tf !== '1w' && tf !== '1M'
}

// Bar.time is epoch seconds internally, but models mis-handle epochs — every MCP boundary speaks
// ISO (M-08). A bare date is midnight UTC; intraday callers may pass a full timestamp.
export function parseIsoToEpoch(value: string): number {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) throw new Error(`Invalid date "${value}". Use YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ.`)
  return Math.floor(ms / 1000)
}

export function formatEpoch(time: number, tf: Timeframe): string {
  const iso = new Date(time * 1000).toISOString()
  return isIntraday(tf) ? `${iso.slice(0, 19)}Z` : iso.slice(0, 10)
}

export function clampLimit(limit: number | undefined): { limit: number; note: string | null } {
  if (limit === undefined) return { limit: DEFAULT_LIMIT, note: null }
  if (limit > MAX_LIMIT) {
    return { limit: MAX_LIMIT, note: `note: limit was capped at ${MAX_LIMIT} (requested ${limit}).` }
  }
  return { limit, note: null }
}

export function interpretationNote(label: 'from' | 'to', value: string, tf: Timeframe): string | null {
  if (!isIntraday(tf) || value.length !== 10) return null
  return `note: ${label}=${value} was read as ${value}T00:00:00Z.`
}

// CacheService only backfills the LEFT edge; right-edge gaps and interior holes are never filled
// (coverage stores min/max only, so interior holes aren't even detectable). The renderer never
// trips over that because it refreshes the right edge, but MCP callers pass arbitrary ranges —
// so say plainly whenever the answer does not cover what was asked for.
export function unmetRangeNotes(req: { from?: string; to?: string }, full: Bar[], tf: Timeframe): string[] {
  if (full.length === 0) return []
  const notes: string[] = []
  const oldest = full[0].time
  const newest = full[full.length - 1].time
  if (req.from && oldest > parseIsoToEpoch(req.from)) {
    notes.push(
      `note: requested from=${req.from} but the oldest bar returned is ${formatEpoch(oldest, tf)} — ` +
      'the FMP plan may not carry intraday history that far back. This is NOT the complete history for that range.'
    )
  }
  if (req.to && newest < parseIsoToEpoch(req.to)) {
    notes.push(
      `note: requested to=${req.to} but the newest bar returned is ${formatEpoch(newest, tf)} — ` +
      'pass force=true to fetch newer bars from FMP.'
    )
  }
  return notes
}

export function summaryLine(a: {
  symbol: string
  timeframe: Timeframe
  shown: Bar[]
  total: number
  apiCalls: number
}): string {
  const first = formatEpoch(a.shown[0].time, a.timeframe)
  const last = formatEpoch(a.shown[a.shown.length - 1].time, a.timeframe)
  const cost = a.apiCalls === 0
    ? 'cache hit, no API call'
    : `${a.apiCalls} API call${a.apiCalls === 1 ? '' : 's'}`
  return `${a.symbol} ${a.timeframe} — ${a.shown.length} of ${a.total} cached bars, ${first} to ${last} (${cost})`
}

// CSV, not JSON: a few thousand daily bars as JSON objects costs tens of thousands of tokens (M-05).
export function toCsv(bars: Bar[], tf: Timeframe): string {
  const rows = bars.map((b) => [formatEpoch(b.time, tf), b.open, b.high, b.low, b.close, b.volume].join(','))
  return ['time,open,high,low,close,volume', ...rows].join('\n')
}

export function formatCacheStatus(
  rows: BarSummary[], capabilities: Record<Timeframe, CapabilityStatus>, symbol?: string
): string {
  const capLine = 'Timeframe capability: ' + ALL_TIMEFRAMES.map((tf) => `${tf} ${capabilities[tf]}`).join(', ')
  if (rows.length === 0) {
    const head = symbol ? `Nothing cached for ${symbol}.` : 'Nothing is cached yet.'
    return [head, capLine].join('\n')
  }
  const sorted = [...rows].sort((a, b) =>
    a.symbol.localeCompare(b.symbol) || ALL_TIMEFRAMES.indexOf(a.timeframe) - ALL_TIMEFRAMES.indexOf(b.timeframe)
  )
  const lines = sorted.map((r) => {
    const range = `${formatEpoch(r.oldestTime, r.timeframe)} to ${formatEpoch(r.newestTime, r.timeframe)}`
    // W/M hold no rows of their own — they are derived from these same daily bars (D-17/M-13),
    // so the daily row's coverage IS their coverage.
    const derived = r.timeframe === '1d' ? ` (also serves ${DERIVED_TIMEFRAMES.join(', ')})` : ''
    return `${r.symbol} ${r.timeframe} — ${r.count} bars, ${range}${derived}`
  })
  const symbols = new Set(sorted.map((r) => r.symbol)).size
  const head = symbol
    ? `Cache status for ${symbol} — ${sorted.length} series`
    : `Cache status — ${symbols} symbols, ${sorted.length} series`
  return [head, ...lines, capLine].join('\n')
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export function formatWorkspaceList(collection: WorkspaceCollection): string {
  const head = `Workspaces (${collection.workspaces.length}) — active: ${collection.active}`
  const lines = collection.workspaces.map((w) => {
    const active = w.name === collection.active ? ' (active)' : ''
    const { rows, cols } = w.layout.shape
    return `- ${w.name}${active} — ${plural(w.items.length, 'watchlist symbol')}, ${rows}x${cols} grid, ${plural(w.layout.cells.length, 'cell')}`
  })
  return [head, ...lines].join('\n')
}

const formatIndicator = (i: { type: string; params: Record<string, number | string> }): string => {
  const params = Object.entries(i.params).map(([k, v]) => `${k}=${v}`).join(', ')
  return params ? `${i.type}(${params})` : i.type
}

export function formatWorkspaceDetail(w: Workspace, isActive: boolean): string {
  const { rows, cols } = w.layout.shape
  const watchlist = w.items.length === 0
    ? ['Watchlist: empty']
    : [`Watchlist (${w.items.length}):`, ...w.items.map((i) => `- ${i.symbol} — ${i.name} (${i.exchange})`)]
  const cells = w.layout.cells.map((c) => {
    const indicators = c.indicators.length === 0
      ? 'no indicators'
      : c.indicators.map(formatIndicator).join(', ')
    return `- [${c.id}] ${c.symbol ?? '(empty)'} ${c.timeframe} — ${indicators}`
  })
  return [
    `Workspace: ${w.name}${isActive ? ' (active)' : ''}`,
    `Grid: ${rows} rows x ${cols} cols, active cell: ${w.layout.activeCellId}`,
    ...watchlist,
    `Cells (${w.layout.cells.length}):`,
    ...cells
  ].join('\n')
}

export function formatSymbolResults(results: SymbolResult[]): string {
  if (results.length === 0) return 'No matches.'
  return [
    `${results.length} match${results.length === 1 ? '' : 'es'}:`,
    ...results.map((r) => `- ${r.symbol} — ${r.name} (${r.exchange})`)
  ].join('\n')
}

export function formatQuote(symbol: string, q: Quote): string {
  return [
    `${symbol} — ${q.price} (${q.changePercentage >= 0 ? '+' : ''}${q.changePercentage}%) as of ${new Date(q.timestamp * 1000).toISOString()}`,
    `open ${q.open}, day high ${q.dayHigh}, day low ${q.dayLow}, previous close ${q.previousClose}`,
    `exchange: ${q.exchange}`
  ].join('\n')
}

const num = (v: number | null | undefined): string => (v == null ? '—' : String(v))

// Optional company-info endpoints collapse any failure (402/429/parse) to null (FmpProvider.opt),
// so a missing group is normal. Print the group as "not available" rather than omitting it —
// an omitted section reads as "this company has no such data".
function group(label: string, obj: Record<string, number | string | null | undefined> | null | undefined): string {
  if (obj == null) return `${label}: not available`
  const body = Object.entries(obj)
    .map(([k, v]) => `${k}=${v == null ? '—' : v}`)
    .join(', ')
  return `${label}: ${body}`
}

export function formatCompanyInfo(info: CompanyInfo, forcedButStale: boolean): string {
  const head = `${info.symbol} — ${info.companyName} (as of ${new Date(info.fetchedAt * 1000).toISOString()})`
  const stale = forcedButStale ? ['stale: fetch failed, showing cached'] : []
  return [
    head,
    ...stale,
    `sector: ${info.sector ?? '—'}, industry: ${info.industry ?? '—'}, country: ${info.country ?? '—'}`,
    `market cap: ${num(info.marketCap)}, price: ${num(info.price)}, beta: ${num(info.beta)}, employees: ${num(info.fullTimeEmployees)}`,
    group('valuation', info.valuation),
    group('financials', info.financials),
    group('analyst', info.analyst),
    group('growth', info.growth),
    group('schedule', info.schedule)
  ].join('\n')
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/main/mcp/format.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp/format.ts tests/main/mcp/format.test.ts
git commit -m "feat(mcp): pure output formatters for the MCP tool layer"
```

---

### Task 7: `mcp/tools.ts` — the eight tools

**Files:**
- Create: `src/main/mcp/tools.ts`
- Modify: `package.json` (add `@modelcontextprotocol/sdk`)
- Test: `tests/main/mcp/tools.test.ts`

**Interfaces:**
- Consumes: `Core`, `OhlcvOutcome`, `BarSummary` (Tasks 2-3); everything from `format.ts` (Task 6).
- Produces:

```ts
export type ToolCore = Pick<Core, 'ohlcv' | 'symbols' | 'quote' | 'company' | 'workspaces' | 'capabilities' | 'cacheStatus'>
export type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }
export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>
export type ToolDef = { name: string; description: string; schema: z.ZodTypeAny; handler: ToolHandler }
export function buildTools(core: ToolCore, now: () => number): ToolDef[]   // now: epoch MILLIseconds
export function registerTools(server: McpServer, core: ToolCore, now?: () => number): void
```

`buildTools` is the testable half (plain data + handlers, no SDK). `registerTools` is a five-line loop that hands each def to the SDK — that split keeps the SDK out of the test graph.

- [ ] **Step 1: Install the SDK**

Run: `npm install @modelcontextprotocol/sdk@^1.29.0`
Expected: it lands in `dependencies` (main-process deps must be externalized at build time, and `externalizeDepsPlugin` reads `dependencies`). Verify `npm ls zod` still resolves 3.25.x — the SDK's peer range is `^3.25 || ^4.0`, which the existing `zod: ^3.24.0` already satisfies at 3.25.76. Do **not** bump zod to v4.

- [ ] **Step 2: Write the failing test file**

Create `tests/main/mcp/tools.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { buildTools, type ToolCore } from '../../../src/main/mcp/tools'
import { FmpHttpError } from '../../../src/main/providers/FmpProvider'
import type { Bar, WorkspaceCollection } from '@shared/types'

const at = (iso: string): number => Math.floor(Date.parse(iso) / 1000)
const bar = (time: number): Bar => ({ time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 })
const NOW = Date.parse('2026-07-25T00:00:00Z')

const days = (from: string, count: number): Bar[] =>
  Array.from({ length: count }, (_, i) => bar(at(`${from}T00:00:00Z`) + i * 86400))

const collection: WorkspaceCollection = {
  version: 3,
  active: 'Main',
  workspaces: [
    { name: 'Main', items: [], layout: { schemaVersion: 1, shape: { rows: 1, cols: 1 }, activeCellId: 'c1', cells: [{ id: 'c1', symbol: 'NVDA', timeframe: '1d', indicators: [] }] } },
    { name: 'Scratch', items: [], layout: { schemaVersion: 1, shape: { rows: 1, cols: 1 }, activeCellId: 'c2', cells: [{ id: 'c2', symbol: null, timeframe: '1d', indicators: [] }] } }
  ]
}

function fakeCore(over: Partial<ToolCore> = {}): ToolCore {
  return {
    ohlcv: {
      get: vi.fn(async () => ({ kind: 'ok' as const, bars: days('2026-01-01', 10), apiCalls: 0 })),
      refresh: vi.fn(async () => ({ kind: 'ok' as const, bars: days('2026-01-01', 10), apiCalls: 1 }))
    },
    symbols: { search: vi.fn(async () => []), profile: vi.fn() },
    quote: { get: vi.fn() },
    company: { info: vi.fn() },
    workspaces: { get: vi.fn(() => ({ collection, rev: 1 })), set: vi.fn() },
    capabilities: {
      get: vi.fn(() => ({ '1m': 'unknown', '5m': 'available', '15m': 'unknown', '1h': 'unknown', '1d': 'available', '1w': 'available', '1M': 'available' }) as const)
    },
    cacheStatus: { summarize: vi.fn(() => []) },
    ...over
  } as ToolCore
}

const tool = (core: ToolCore, name: string) => {
  const def = buildTools(core, () => NOW).find((t) => t.name === name)
  if (!def) throw new Error(`no tool named ${name}`)
  return def
}

describe('get_ohlcv range handling', () => {
  it('passes both bounds straight through', async () => {
    const core = fakeCore()
    await tool(core, 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '1d', from: '2026-01-01', to: '2026-01-05' })
    expect(core.ohlcv.get).toHaveBeenCalledWith('NVDA', '1d', { from: at('2026-01-01T00:00:00Z'), to: at('2026-01-05T00:00:00Z') })
  })

  it('fills `to` with now when only `from` is given', async () => {
    const core = fakeCore()
    await tool(core, 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '1d', from: '2026-01-01' })
    expect(core.ohlcv.get).toHaveBeenCalledWith('NVDA', '1d', { from: at('2026-01-01T00:00:00Z'), to: Math.floor(NOW / 1000) })
  })

  it('passes undefined when only `to` is given, and filters the output instead', async () => {
    const core = fakeCore()
    const res = await tool(core, 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '1d', to: '2026-01-03' })
    expect(core.ohlcv.get).toHaveBeenCalledWith('NVDA', '1d', undefined)
    expect(res.content[0].text).toContain('2026-01-03')
    expect(res.content[0].text).not.toContain('2026-01-04')
  })

  it('passes undefined when neither bound is given', async () => {
    const core = fakeCore()
    await tool(core, 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '1d' })
    expect(core.ohlcv.get).toHaveBeenCalledWith('NVDA', '1d', undefined)
  })

  it('rejects from > to', async () => {
    const core = fakeCore()
    const res = await tool(core, 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '1d', from: '2026-02-01', to: '2026-01-01' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('from must not be after to')
    expect(core.ohlcv.get).not.toHaveBeenCalled()
  })
})

describe('get_ohlcv output', () => {
  it('returns a summary line plus CSV', async () => {
    const res = await tool(fakeCore(), 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '1d' })
    const lines = res.content[0].text.split('\n')
    expect(lines[0]).toBe('NVDA 1d — 10 of 10 cached bars, 2026-01-01 to 2026-01-10 (cache hit, no API call)')
    expect(lines[1]).toBe('time,open,high,low,close,volume')
    expect(lines).toHaveLength(12)
  })

  it('limits to the newest bars without changing what was fetched', async () => {
    const core = fakeCore()
    const res = await tool(core, 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '1d', limit: 2 })
    expect(core.ohlcv.get).toHaveBeenCalledWith('NVDA', '1d', undefined) // limit never reaches the core
    const text = res.content[0].text
    expect(text).toContain('2 of 10 cached bars, 2026-01-09 to 2026-01-10')
    expect(text).not.toContain('2026-01-08')
  })

  it('caps an over-large limit and says so', async () => {
    const res = await tool(fakeCore(), 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '1d', limit: 9999 })
    expect(res.content[0].text).toContain('note: limit was capped at 2000 (requested 9999).')
  })

  it('routes force=true to refresh', async () => {
    const core = fakeCore()
    await tool(core, 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '1d', force: true })
    expect(core.ohlcv.refresh).toHaveBeenCalledWith('NVDA', '1d')
    expect(core.ohlcv.get).not.toHaveBeenCalled()
  })
})

describe('get_ohlcv error mapping', () => {
  const failWith = (outcome: unknown) => fakeCore({ ohlcv: { get: vi.fn(async () => outcome), refresh: vi.fn() } } as Partial<ToolCore>)

  it('maps out-of-plan', async () => {
    const res = await tool(failWith({ kind: 'out-of-plan' }), 'get_ohlcv').handler({ symbol: 'X', timeframe: '1d' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe("No data available — the symbol may be outside the current plan's coverage.")
  })

  it('maps unknown-symbol', async () => {
    const res = await tool(failWith({ kind: 'unknown-symbol' }), 'get_ohlcv').handler({ symbol: 'X', timeframe: '1d' })
    expect(res.content[0].text).toBe('No results. Use search_symbols to find the correct ticker.')
  })

  it('maps empty-range and quotes the cached coverage', async () => {
    const core = fakeCore({
      ohlcv: { get: vi.fn(async () => ({ kind: 'empty-range' as const })), refresh: vi.fn() },
      cacheStatus: { summarize: vi.fn(() => [{ symbol: 'NVDA', timeframe: '1d' as const, count: 5, oldestTime: at('2026-01-01T00:00:00Z'), newestTime: at('2026-01-05T00:00:00Z') }]) }
    } as Partial<ToolCore>)
    const res = await tool(core, 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '1d', from: '2020-01-01', to: '2020-02-01' })
    expect(res.content[0].text).toBe('No bars in that range. Cached coverage is 2026-01-01 to 2026-01-05.')
  })

  it('maps a missing API key', async () => {
    const core = fakeCore({ ohlcv: { get: vi.fn(async () => { throw new Error('NO_API_KEY') }), refresh: vi.fn() } } as Partial<ToolCore>)
    const res = await tool(core, 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '1d' })
    expect(res.content[0].text).toBe("FMP API key is not configured. Set it in Vibing View's settings dialog.")
  })

  it('maps a 402 on an intraday timeframe to a plan message', async () => {
    const core = fakeCore({ ohlcv: { get: vi.fn(async () => { throw new FmpHttpError(402, null) }), refresh: vi.fn() } } as Partial<ToolCore>)
    const res = await tool(core, 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '5m' })
    expect(res.content[0].text).toBe('This timeframe is not available on the current FMP plan.')
  })

  it('maps a 429 to the daily-limit message', async () => {
    const core = fakeCore({ ohlcv: { get: vi.fn(async () => { throw new FmpHttpError(429, null) }), refresh: vi.fn() } } as Partial<ToolCore>)
    const res = await tool(core, 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '1d' })
    expect(res.content[0].text).toBe('FMP daily request limit reached. Try again tomorrow.')
  })
})

describe('workspace tools', () => {
  it('get_workspaces lists them', async () => {
    const res = await tool(fakeCore(), 'get_workspaces').handler({})
    expect(res.content[0].text).toContain('Workspaces (2) — active: Main')
  })

  it('get_active_workspace details the active one', async () => {
    const res = await tool(fakeCore(), 'get_active_workspace').handler({})
    expect(res.content[0].text).toContain('Workspace: Main (active)')
  })

  it('get_workspace finds one by name', async () => {
    const res = await tool(fakeCore(), 'get_workspace').handler({ name: 'Scratch' })
    expect(res.content[0].text).toContain('Workspace: Scratch')
    expect(res.content[0].text).not.toContain('(active)')
  })

  it('get_workspace lists the available names on a miss', async () => {
    const res = await tool(fakeCore(), 'get_workspace').handler({ name: 'Nope' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('No workspace named "Nope". Available: Main, Scratch')
  })
})

describe('get_cache_status', () => {
  it('passes the symbol filter to the core', async () => {
    const core = fakeCore()
    await tool(core, 'get_cache_status').handler({ symbol: 'NVDA' })
    expect(core.cacheStatus.summarize).toHaveBeenCalledWith('NVDA')
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/main/mcp/tools.test.ts`
Expected: FAIL — cannot resolve `src/main/mcp/tools`.

- [ ] **Step 4: Write `src/main/mcp/tools.ts`**

```ts
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { DateRange, Timeframe } from '@shared/types'
import type { Core, OhlcvOutcome } from '../core'
import { FmpHttpError } from '../providers/FmpProvider'
import {
  clampLimit, formatCacheStatus, formatCompanyInfo, formatEpoch, formatQuote, formatSymbolResults,
  formatWorkspaceDetail, formatWorkspaceList, interpretationNote, isIntraday, parseIsoToEpoch,
  summaryLine, toCsv, unmetRangeNotes, DEFAULT_LIMIT, MAX_LIMIT
} from './format'

export type ToolCore = Pick<
  Core, 'ohlcv' | 'symbols' | 'quote' | 'company' | 'workspaces' | 'capabilities' | 'cacheStatus'
>

export type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }
export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>
export type ToolDef = { name: string; description: string; schema: z.ZodTypeAny; handler: ToolHandler }

const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] })
// Tool-level failures are reported as isError results, never thrown: a protocol error tells the
// model "the call broke", an isError result tells it *what to do differently*.
const fail = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true })

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '1d', '1w', '1M'] as const
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z)?$/

const symbolArg = z.string().min(1).describe('Ticker symbol, e.g. NVDA. Case-insensitive.')
const dateArg = z.string().regex(DATE_RE, 'Use YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ (UTC).')

const ohlcvArgs = z
  .object({
    symbol: symbolArg,
    timeframe: z.enum(TIMEFRAMES).describe("Bar size. '1w' and '1M' are derived from cached daily bars."),
    from: dateArg.optional().describe('Oldest bar to return (inclusive), UTC.'),
    to: dateArg.optional().describe('Newest bar to return (inclusive), UTC.'),
    limit: z.number().int().positive().optional()
      .describe(`Maximum bars to return, counted back from the newest. Default ${DEFAULT_LIMIT}, capped at ${MAX_LIMIT}.`),
    force: z.boolean().optional()
      .describe('Fetch the newest bars from FMP before answering. Costs one API request EVERY call — omit it unless you specifically need up-to-the-minute data.')
  })
  .refine((a) => !(a.from && a.to) || parseIsoToEpoch(a.from) <= parseIsoToEpoch(a.to), {
    message: 'from must not be after to.'
  })

const OHLCV_DESCRIPTION = [
  'Return cached OHLCV candles for a symbol as CSV.',
  'Bars already cached on disk cost no API request; a symbol/timeframe that is not cached yet triggers an FMP fetch,',
  'so call get_cache_status first if you want to know what is free.',
  "Weekly ('1w') and monthly ('1M') bars are derived from the cached daily series — the daily coverage IS their coverage.",
  'The first line of the response summarises how many bars were returned, the period they span, and how many API requests it cost.',
  'Read that line: when the returned period does not cover what you asked for, a note explains why.'
].join(' ')

function messageForError(err: unknown, timeframe?: Timeframe): string {
  if (err instanceof Error && err.message === 'NO_API_KEY') {
    return "FMP API key is not configured. Set it in Vibing View's settings dialog."
  }
  if (err instanceof FmpHttpError) {
    if (err.status === 429) return 'FMP daily request limit reached. Try again tomorrow.'
    if (err.status === 402 || err.status === 403) {
      return timeframe && isIntraday(timeframe)
        ? 'This timeframe is not available on the current FMP plan.'
        : "No data available — the symbol may be outside the current plan's coverage."
    }
  }
  return `Unexpected error: ${err instanceof Error ? err.message : String(err)}`
}

export function buildTools(core: ToolCore, now: () => number): ToolDef[] {
  // Coverage sentence reused by the empty-range paths — the model needs to know what IS there.
  const coverageSentence = (symbol: string, timeframe: Timeframe): string => {
    const covTf = timeframe === '1w' || timeframe === '1M' ? '1d' : timeframe
    const row = core.cacheStatus.summarize(symbol).find((r) => r.timeframe === covTf)
    return row
      ? `Cached coverage is ${formatEpoch(row.oldestTime, covTf)} to ${formatEpoch(row.newestTime, covTf)}.`
      : `Nothing is cached for ${symbol} ${covTf}.`
  }

  const getOhlcv: ToolHandler = async (raw) => {
    const parsed = ohlcvArgs.safeParse(raw)
    if (!parsed.success) return fail(parsed.error.issues[0].message)
    const { symbol, timeframe, from, to, force } = parsed.data

    const notes: string[] = []
    const { limit, note: limitNote } = clampLimit(parsed.data.limit)
    if (limitNote) notes.push(limitNote)
    for (const [label, value] of [['from', from], ['to', to]] as const) {
      const n = value ? interpretationNote(label, value, timeframe) : null
      if (n) notes.push(n)
    }

    const fromSec = from ? parseIsoToEpoch(from) : undefined
    const toSec = to ? parseIsoToEpoch(to) : undefined
    // M-14: a lone `to` gets no synthetic `from` — epoch 0 on a minute series would ask FMP for
    // decades. Fetch the cached window and filter the output instead. A lone `from` gets to=now,
    // which the widened CacheService guard (M-15) can actually honour.
    const range: DateRange = fromSec === undefined ? undefined : { from: fromSec, to: toSec ?? Math.floor(now() / 1000) }

    let outcome: OhlcvOutcome
    try {
      outcome = force ? await core.ohlcv.refresh(symbol, timeframe) : await core.ohlcv.get(symbol, timeframe, range)
    } catch (err) {
      return fail(messageForError(err, timeframe))
    }

    if (outcome.kind === 'out-of-plan') return fail("No data available — the symbol may be outside the current plan's coverage.")
    if (outcome.kind === 'unknown-symbol') return fail('No results. Use search_symbols to find the correct ticker.')
    if (outcome.kind === 'empty-range') return fail(`No bars in that range. ${coverageSentence(symbol, timeframe)}`)

    // `force` (and the lone-`to` case) can return bars outside the requested window — narrow here.
    const full = outcome.bars.filter(
      (b) => (fromSec === undefined || b.time >= fromSec) && (toSec === undefined || b.time <= toSec)
    )
    if (full.length === 0) {
      const hint = fromSec === undefined && toSec !== undefined ? ' Pass `from` as well to fetch older history.' : ''
      return fail(`No bars in that range. ${coverageSentence(symbol, timeframe)}${hint}`)
    }

    notes.push(...unmetRangeNotes({ from, to }, full, timeframe))
    const shown = full.slice(-limit)
    return ok([
      summaryLine({ symbol, timeframe, shown, total: full.length, apiCalls: outcome.apiCalls }),
      ...notes,
      toCsv(shown, timeframe)
    ].join('\n'))
  }

  return [
    {
      name: 'search_symbols',
      description: 'Search FMP for tickers by symbol or company name. Costs one API request unless the same query was searched in the last 5 minutes.',
      schema: z.object({ query: z.string().min(1).describe('Ticker fragment or company name.') }),
      handler: async (raw) => {
        const parsed = z.object({ query: z.string().min(1) }).safeParse(raw)
        if (!parsed.success) return fail(parsed.error.issues[0].message)
        try {
          return ok(formatSymbolResults(await core.symbols.search(parsed.data.query)))
        } catch (err) {
          return fail(messageForError(err))
        }
      }
    },
    { name: 'get_ohlcv', description: OHLCV_DESCRIPTION, schema: ohlcvArgs, handler: getOhlcv },
    {
      name: 'get_quote',
      description: 'Current price, day range, and change for a symbol. Always costs one API request (quotes are never cached).',
      schema: z.object({ symbol: symbolArg }),
      handler: async (raw) => {
        const parsed = z.object({ symbol: symbolArg }).safeParse(raw)
        if (!parsed.success) return fail(parsed.error.issues[0].message)
        try {
          return ok(formatQuote(parsed.data.symbol, await core.quote.get(parsed.data.symbol)))
        } catch (err) {
          return fail(messageForError(err))
        }
      }
    },
    {
      name: 'get_company_info',
      description: 'Valuation, financials, analyst consensus, growth, and earnings schedule for a symbol. Cached for 24 hours; a cache miss costs up to 7 API requests. Groups that FMP did not return are shown as "not available".',
      schema: z.object({
        symbol: symbolArg,
        force: z.boolean().optional().describe('Ignore the 24-hour cache and refetch. Costs up to 7 API requests.')
      }),
      handler: async (raw) => {
        const parsed = z.object({ symbol: symbolArg, force: z.boolean().optional() }).safeParse(raw)
        if (!parsed.success) return fail(parsed.error.issues[0].message)
        const { symbol, force } = parsed.data
        try {
          const info = await core.company.info(symbol, force ? { force: true } : undefined)
          // CompanyInfoService returns the stale row when a forced refetch fails; fetchedAt then
          // stays old. Anything older than a minute after a forced call means the fetch failed.
          const stale = force === true && Math.floor(now() / 1000) - info.fetchedAt > 60
          return ok(formatCompanyInfo(info, stale))
        } catch (err) {
          return fail(messageForError(err))
        }
      }
    },
    {
      name: 'get_workspaces',
      description: 'List the saved workspaces (name, whether it is active, watchlist size, grid shape). No API request. Use get_workspace or get_active_workspace for the per-cell detail.',
      schema: z.object({}),
      handler: async () => ok(formatWorkspaceList(core.workspaces.get().collection))
    },
    {
      name: 'get_active_workspace',
      description: 'Full detail of the workspace the user currently has open: watchlist, grid shape, and every cell with its symbol, timeframe, and indicators. No API request.',
      schema: z.object({}),
      handler: async () => {
        const { collection } = core.workspaces.get()
        const active = collection.workspaces.find((w) => w.name === collection.active)
        if (!active) return fail(`No active workspace. Available: ${collection.workspaces.map((w) => w.name).join(', ')}`)
        return ok(formatWorkspaceDetail(active, true))
      }
    },
    {
      name: 'get_workspace',
      description: 'Full detail of one workspace by name. No API request.',
      schema: z.object({ name: z.string().min(1).describe('Exact workspace name, as listed by get_workspaces.') }),
      handler: async (raw) => {
        const parsed = z.object({ name: z.string().min(1) }).safeParse(raw)
        if (!parsed.success) return fail(parsed.error.issues[0].message)
        const { collection } = core.workspaces.get()
        const found = collection.workspaces.find((w) => w.name === parsed.data.name)
        if (!found) {
          return fail(`No workspace named "${parsed.data.name}". Available: ${collection.workspaces.map((w) => w.name).join(', ')}`)
        }
        return ok(formatWorkspaceDetail(found, found.name === collection.active))
      }
    },
    {
      name: 'get_cache_status',
      description: 'What OHLCV is already on disk: bar count and period per symbol and timeframe, plus each timeframe\'s availability on the current FMP plan. No API request. Call this before get_ohlcv to see which requests are free.',
      schema: z.object({ symbol: symbolArg.optional().describe('Restrict to one symbol. Omit for every cached symbol.') }),
      handler: async (raw) => {
        const parsed = z.object({ symbol: z.string().min(1).optional() }).safeParse(raw)
        if (!parsed.success) return fail(parsed.error.issues[0].message)
        const { symbol } = parsed.data
        return ok(formatCacheStatus(core.cacheStatus.summarize(symbol), core.capabilities.get(), symbol))
      }
    }
  ]
}

export function registerTools(server: McpServer, core: ToolCore, now: () => number = () => Date.now()): void {
  for (const def of buildTools(core, now)) {
    const shape = def.schema instanceof z.ZodObject ? def.schema.shape : (def.schema as z.ZodEffects<z.ZodObject<z.ZodRawShape>>).innerType().shape
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: shape },
      async (args: Record<string, unknown>) => def.handler(args ?? {})
    )
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/main/mcp/tools.test.ts && npm run typecheck`
Expected: PASS. If `registerTools`'s `shape` extraction fails to typecheck against the installed SDK, keep `buildTools` untouched and adapt only the `registerTools` loop — it is the only SDK-coupled code.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/main/mcp/tools.ts tests/main/mcp/tools.test.ts
git commit -m "feat(mcp): the eight read tools"
```

---

### Task 8: `mcp/auth.ts` + `mcp/httpServer.ts`

Three defences, per the spec: bind `127.0.0.1` only, require a Bearer token compared in constant time, and validate `Origin` when present (absent `Origin` passes — Claude Desktop and Claude Code are non-browser clients and send none, M-12).

**Files:**
- Create: `src/main/mcp/auth.ts`
- Create: `src/main/mcp/httpServer.ts`
- Test: `tests/main/mcp/auth.test.ts`, `tests/main/mcp/httpServer.test.ts`

**Interfaces:**
- Produces:

```ts
// auth.ts
export function tokenMatches(authorization: string | undefined, token: string): boolean
export function originAllowed(origin: string | undefined, port: number): boolean

// httpServer.ts
export type McpRequestHandler = (req: IncomingMessage, res: ServerResponse, body: unknown) => Promise<void>
export type McpHttpServer = { close(): Promise<void>; port(): number }
export function startMcpHttpServer(opts: {
  port: number
  token: string
  handle: McpRequestHandler
}): Promise<McpHttpServer>   // rejects on EADDRINUSE — no automatic port fallback (M-07)
```

- [ ] **Step 1: Write the failing auth test**

Create `tests/main/mcp/auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { tokenMatches, originAllowed } from '../../../src/main/mcp/auth'

describe('tokenMatches', () => {
  it('accepts the exact bearer token', () => {
    expect(tokenMatches('Bearer abc123', 'abc123')).toBe(true)
  })

  it('rejects a wrong token of the same length', () => {
    expect(tokenMatches('Bearer abc124', 'abc123')).toBe(false)
  })

  it('rejects a token of a different length without throwing', () => {
    expect(tokenMatches('Bearer short', 'a-much-longer-token')).toBe(false)
  })

  it('rejects a missing header', () => {
    expect(tokenMatches(undefined, 'abc123')).toBe(false)
  })

  it('rejects a non-Bearer scheme', () => {
    expect(tokenMatches('Basic abc123', 'abc123')).toBe(false)
  })
})

describe('originAllowed', () => {
  it('passes a request with no Origin header (non-browser clients send none)', () => {
    expect(originAllowed(undefined, 39100)).toBe(true)
  })

  it('allows loopback origins on the bound port', () => {
    expect(originAllowed('http://127.0.0.1:39100', 39100)).toBe(true)
    expect(originAllowed('http://localhost:39100', 39100)).toBe(true)
  })

  it('rejects another port', () => {
    expect(originAllowed('http://127.0.0.1:39101', 39100)).toBe(false)
  })

  it('rejects a remote origin', () => {
    expect(originAllowed('https://evil.example', 39100)).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/main/mcp/auth.test.ts`
Expected: FAIL — cannot resolve `src/main/mcp/auth`.

- [ ] **Step 3: Write `src/main/mcp/auth.ts`**

```ts
import { timingSafeEqual } from 'crypto'

const BEARER = /^Bearer (.+)$/

export function tokenMatches(authorization: string | undefined, token: string): boolean {
  const presented = authorization?.match(BEARER)?.[1]
  if (!presented) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(token)
  // timingSafeEqual throws on a length mismatch, so screen that first. Length is not a secret.
  return a.length === b.length && timingSafeEqual(a, b)
}

// MCP's DNS-rebinding guard. A browser always sends Origin; Claude Desktop and Claude Code are
// non-browser clients and send none, so a missing header must pass or nothing can connect (M-12).
export function originAllowed(origin: string | undefined, port: number): boolean {
  if (origin === undefined) return true
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`
}
```

- [ ] **Step 4: Write the failing HTTP-server test**

Create `tests/main/mcp/httpServer.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest'
import { startMcpHttpServer, type McpHttpServer } from '../../../src/main/mcp/httpServer'

let server: McpHttpServer | null = null

afterEach(async () => {
  await server?.close()
  server = null
})

const post = (port: number, headers: Record<string, string>, body: unknown = { jsonrpc: '2.0', id: 1, method: 'ping' }) =>
  fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })

describe('startMcpHttpServer', () => {
  it('passes an authorised request to the handler with the parsed body', async () => {
    const handle = vi.fn(async (_req, res, _body) => { res.writeHead(200).end('ok') })
    server = await startMcpHttpServer({ port: 0, token: 'secret', handle })

    const res = await post(server.port(), { authorization: 'Bearer secret' })

    expect(res.status).toBe(200)
    expect(handle).toHaveBeenCalledOnce()
    expect(handle.mock.calls[0][2]).toEqual({ jsonrpc: '2.0', id: 1, method: 'ping' })
  })

  it('rejects a request with no token', async () => {
    const handle = vi.fn()
    server = await startMcpHttpServer({ port: 0, token: 'secret', handle })

    expect((await post(server.port(), {})).status).toBe(401)
    expect(handle).not.toHaveBeenCalled()
  })

  it('rejects a wrong token', async () => {
    const handle = vi.fn()
    server = await startMcpHttpServer({ port: 0, token: 'secret', handle })

    expect((await post(server.port(), { authorization: 'Bearer nope' })).status).toBe(401)
    expect(handle).not.toHaveBeenCalled()
  })

  it('rejects a foreign Origin', async () => {
    const handle = vi.fn()
    server = await startMcpHttpServer({ port: 0, token: 'secret', handle })

    const res = await post(server.port(), { authorization: 'Bearer secret', origin: 'https://evil.example' })

    expect(res.status).toBe(403)
    expect(handle).not.toHaveBeenCalled()
  })

  it('accepts a loopback Origin on the bound port', async () => {
    const handle = vi.fn(async (_req, res) => { res.writeHead(200).end('ok') })
    server = await startMcpHttpServer({ port: 0, token: 'secret', handle })

    const res = await post(server.port(), { authorization: 'Bearer secret', origin: `http://127.0.0.1:${server.port()}` })

    expect(res.status).toBe(200)
  })

  it('404s a path other than /mcp', async () => {
    const handle = vi.fn()
    server = await startMcpHttpServer({ port: 0, token: 'secret', handle })

    const res = await fetch(`http://127.0.0.1:${server.port()}/other`, {
      method: 'POST', headers: { authorization: 'Bearer secret' }, body: '{}'
    })

    expect(res.status).toBe(404)
  })

  it('rejects the second listener on a busy port instead of silently moving (M-07)', async () => {
    server = await startMcpHttpServer({ port: 0, token: 'secret', handle: vi.fn() })
    await expect(
      startMcpHttpServer({ port: server.port(), token: 'secret', handle: vi.fn() })
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npx vitest run tests/main/mcp/httpServer.test.ts`
Expected: FAIL — cannot resolve `src/main/mcp/httpServer`.

- [ ] **Step 6: Write `src/main/mcp/httpServer.ts`**

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { tokenMatches, originAllowed } from './auth'

export type McpRequestHandler = (req: IncomingMessage, res: ServerResponse, body: unknown) => Promise<void>
export type McpHttpServer = { close(): Promise<void>; port(): number }

const PATH = '/mcp'
const MAX_BODY_BYTES = 4 * 1024 * 1024

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('error', reject)
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.length === 0) return resolve(undefined)
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
  })
}

const send = (res: ServerResponse, status: number, message: string): void => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: message }))
}

// Bound to 127.0.0.1 only. No automatic port fallback: if the port is taken, fail loudly so the
// configured port and the running one can never disagree (M-07).
export function startMcpHttpServer(opts: {
  port: number
  token: string
  handle: McpRequestHandler
}): Promise<McpHttpServer> {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (url.pathname !== PATH) return send(res, 404, 'not found')

        const address = server.address()
        const boundPort = typeof address === 'object' && address ? address.port : opts.port
        if (!originAllowed(req.headers.origin, boundPort)) return send(res, 403, 'origin not allowed')
        if (!tokenMatches(req.headers.authorization, opts.token)) return send(res, 401, 'unauthorized')

        const body = req.method === 'POST' ? await readBody(req) : undefined
        await opts.handle(req, res, body)
      } catch (err) {
        if (!res.headersSent) send(res, 400, err instanceof Error ? err.message : 'bad request')
        else res.end()
      }
    })()
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port, '127.0.0.1', () => {
      server.removeListener('error', reject)
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : opts.port
      resolve({
        port: () => port,
        close: () => new Promise<void>((done) => { server.close(() => done()) })
      })
    })
  })
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/main/mcp && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main/mcp/auth.ts src/main/mcp/httpServer.ts tests/main/mcp/auth.test.ts tests/main/mcp/httpServer.test.ts
git commit -m "feat(mcp): localhost HTTP listener with bearer-token and origin guards"
```

---

### Task 9: MCP lifecycle + IPC channels + preload

Wire the SDK's Streamable HTTP transport onto the listener, expose start/stop/port/token control over IPC, and start the server at boot when it is enabled.

**Files:**
- Create: `src/main/mcp/index.ts`
- Modify: `src/shared/ipc.ts` (channels + `Api.mcp`)
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc.ts` (register the `mcp:*` handlers)
- Modify: `src/main/index.ts` (start at boot, stop on quit)
- Test: none new — the lifecycle is glue over `startMcpHttpServer` (Task 8) and `buildTools` (Task 7), both covered. Verified manually in Task 10.

**Interfaces:**
- Consumes: `startMcpHttpServer` (Task 8), `registerTools` / `ToolCore` (Task 7), `getMcpConfig` / `setMcpConfig` / `regenerateMcpToken` (Task 5), `Core` (Tasks 2-3).
- Produces:

```ts
// src/main/mcp/index.ts
export function getStatus(): McpStatus
export async function applyConfig(core: ToolCore, config: McpConfig): Promise<McpStatus>  // stops, then starts if enabled
export async function stop(): Promise<void>
export function onStatusChanged(cb: (s: McpStatus) => void): void
```

- [ ] **Step 1: Add the channels and the `Api` namespace**

In `src/shared/ipc.ts`, add to the `CH` object (before the closing `} as const`):

```ts
  mcpGetConfig: 'mcp:getConfig',
  mcpSetEnabled: 'mcp:setEnabled',
  mcpSetPort: 'mcp:setPort',
  mcpRegenerateToken: 'mcp:regenerateToken',
  mcpGetStatus: 'mcp:getStatus',
  mcpStatusChanged: 'mcp:statusChanged'
```

And add to the `Api` interface, after `refresh`:

```ts
  // MCP サーバ（既定 off）。token は Settings のコピーボタン用に平文で往復する（M-11）。
  mcp: {
    getConfig(): Promise<McpConfig>
    setEnabled(on: boolean): Promise<McpStatus>
    setPort(port: number): Promise<McpStatus>
    regenerateToken(): Promise<McpConfig>
    getStatus(): Promise<McpStatus>
    onStatusChanged(cb: (s: McpStatus) => void): () => void
  }
```

- [ ] **Step 2: Add the preload bindings**

In `src/preload/index.ts`, add to the `api` object:

```ts
  mcp: {
    getConfig: () => ipcRenderer.invoke(CH.mcpGetConfig),
    setEnabled: (on) => ipcRenderer.invoke(CH.mcpSetEnabled, on),
    setPort: (port) => ipcRenderer.invoke(CH.mcpSetPort, port),
    regenerateToken: () => ipcRenderer.invoke(CH.mcpRegenerateToken),
    getStatus: () => ipcRenderer.invoke(CH.mcpGetStatus),
    onStatusChanged: (cb) => {
      const listener = (_e: unknown, s: McpStatus): void => cb(s)
      ipcRenderer.on(CH.mcpStatusChanged, listener)
      return () => ipcRenderer.removeListener(CH.mcpStatusChanged, listener)
    }
  }
```

and extend the type import at the top: `import { CH, type Api, type WorkspacesPayload, type ClipboardPayload, type RefreshAppliedPayload, type McpStatus } from '@shared/ipc'`.

- [ ] **Step 3: Write `src/main/mcp/index.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { McpConfig, McpStatus } from '@shared/ipc'
import { startMcpHttpServer, type McpHttpServer } from './httpServer'
import { registerTools, type ToolCore } from './tools'

let running: McpHttpServer | null = null
let lastError: string | undefined
let notify: ((s: McpStatus) => void) | null = null

export function getStatus(): McpStatus {
  return running ? { running: true } : { running: false, ...(lastError ? { error: lastError } : {}) }
}

export function onStatusChanged(cb: (s: McpStatus) => void): void {
  notify = cb
}

export async function stop(): Promise<void> {
  await running?.close()
  running = null
}

export async function applyConfig(core: ToolCore, config: McpConfig): Promise<McpStatus> {
  await stop()
  lastError = undefined
  if (config.enabled) {
    try {
      running = await startMcpHttpServer({
        port: config.port,
        token: config.token,
        // Stateless: a fresh server + transport per request. The SDK's own stateless example does
        // the same — reusing one transport across concurrent requests collides on JSON-RPC ids.
        // Building them is just object construction plus our tool registrations.
        handle: async (req, res, body) => {
          const server = new McpServer({ name: 'vibing-view', version: '0.2.0' })
          registerTools(server, core)
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true
          })
          res.on('close', () => {
            void transport.close()
            void server.close()
          })
          await server.connect(transport)
          await transport.handleRequest(req, res, body)
        }
      })
    } catch (err) {
      // Port already taken is the common case. Surface it instead of shifting the port silently,
      // which would leave the settings dialog describing a URL nothing is listening on (M-07).
      lastError = err instanceof Error ? err.message : String(err)
    }
  }
  const status = getStatus()
  notify?.(status)
  return status
}
```

- [ ] **Step 4: Register the IPC handlers**

In `src/main/ipc.ts`, add the imports:

```ts
import { getMcpConfig, setMcpConfig, regenerateMcpToken } from './settings'
import * as mcp from './mcp'
```

and at the end of `registerIpc`:

```ts
  ipcMain.handle(CH.mcpGetConfig, () => getMcpConfig())
  ipcMain.handle(CH.mcpGetStatus, () => mcp.getStatus())
  ipcMain.handle(CH.mcpSetEnabled, (_e, on: boolean) => mcp.applyConfig(core, setMcpConfig({ enabled: on })))
  ipcMain.handle(CH.mcpSetPort, (_e, port: number) => mcp.applyConfig(core, setMcpConfig({ port })))
  ipcMain.handle(CH.mcpRegenerateToken, async () => {
    const config = regenerateMcpToken()
    await mcp.applyConfig(core, config) // a live server must stop honouring the old token
    return config
  })
```

- [ ] **Step 5: Start at boot and stop on quit**

In `src/main/index.ts`, add the imports:

```ts
import * as mcp from './mcp'
import { getMcpConfig } from './settings'
```

Inside `app.whenReady().then(...)`, after `registerIpc(core)`:

```ts
  mcp.onStatusChanged((status) => broadcast(CH.mcpStatusChanged, status))
  void mcp.applyConfig(core, getMcpConfig()) // no-op unless the user enabled it (M-06)
```

and after the `window-all-closed` handler at the bottom of the file:

```ts
// The MCP server lives in main, so it answers only while the app is running. Release the port
// before the process exits.
app.on('before-quit', () => {
  void mcp.stop()
})
```

- [ ] **Step 6: Verify**

Run: `npx vitest run && npm run typecheck && npm run build`
Expected: tests PASS, typecheck clean, the electron-vite build succeeds (this is the first build that has to resolve the SDK in the main bundle — if it complains about the SDK being bundled rather than externalized, confirm `@modelcontextprotocol/sdk` is in `dependencies`, not `devDependencies`).

- [ ] **Step 7: Commit**

```bash
git add src/main/mcp/index.ts src/main/ipc.ts src/main/index.ts src/shared/ipc.ts src/preload/index.ts
git commit -m "feat(mcp): server lifecycle, IPC channels, and boot wiring"
```

---

### Task 10: Settings dialog row, and end-to-end verification

**Files:**
- Create: `src/renderer/components/settings/McpSetting.tsx`
- Modify: `src/renderer/components/SettingsDialog.tsx:31-34`
- Test: manual (the renderer test env is `node`, with no DOM — the existing settings components have no component tests either).

**Interfaces:**
- Consumes: `api.mcp.*` (Task 9), `McpConfig` / `McpStatus` (Task 5).

Display text here is **Japanese**, matching `ApiKeySetting`'s neighbours in the dialog.

- [ ] **Step 1: Write `src/renderer/components/settings/McpSetting.tsx`**

```tsx
import React, { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/api'
import type { McpConfig, McpStatus } from '@shared/ipc'

// 貼り付け用の設定 JSON。Claude Code は `claude mcp add --transport http` でも登録できる。
function clientConfig(config: McpConfig): string {
  return JSON.stringify(
    {
      mcpServers: {
        'vibing-view': {
          type: 'http',
          url: `http://127.0.0.1:${config.port}/mcp`,
          headers: { Authorization: `Bearer ${config.token}` }
        }
      }
    },
    null,
    2
  )
}

export function McpSetting(): React.JSX.Element {
  const [config, setConfig] = useState<McpConfig | null>(null)
  const [status, setStatus] = useState<McpStatus>({ running: false })
  const [port, setPort] = useState('')

  useEffect(() => {
    void api.mcp.getConfig().then((c) => {
      setConfig(c)
      setPort(String(c.port))
    })
    void api.mcp.getStatus().then(setStatus)
    // 起動失敗（ポート衝突など）は main から届く。
    return api.mcp.onStatusChanged((s) => {
      setStatus(s)
      if (s.error) toast.error(`MCP サーバを起動できませんでした: ${s.error}`)
    })
  }, [])

  if (!config) return <div className="text-sm text-muted-foreground">MCP サーバ</div>

  const toggle = async (): Promise<void> => {
    const next = !config.enabled
    setConfig({ ...config, enabled: next })
    setStatus(await api.mcp.setEnabled(next))
  }

  const savePort = async (): Promise<void> => {
    const parsed = Number(port)
    if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
      toast.error('ポートは 1024〜65535 の整数で指定してください')
      return
    }
    setConfig({ ...config, port: parsed })
    setStatus(await api.mcp.setPort(parsed))
  }

  const regenerate = async (): Promise<void> => {
    if (!confirm('トークンを再生成しますか？ 登録済みのクライアント設定を貼り直す必要があります。')) return
    setConfig(await api.mcp.regenerateToken())
    toast.success('トークンを再生成しました')
  }

  const copyConfig = async (): Promise<void> => {
    await navigator.clipboard.writeText(clientConfig(config))
    toast.success('設定 JSON をコピーしました')
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-medium">MCP サーバ</div>
      <div className="text-xs text-muted-foreground">
        Claude Desktop / Claude Code からキャッシュ済みの価格データとワークスペースを読めるようにします。
        127.0.0.1 のみで待ち受け、Bearer トークンが必要です。アプリの起動中だけ応答します。
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={toggle}>{config.enabled ? '停止する' : '有効にする'}</Button>
        <span className="text-xs text-muted-foreground">
          {status.running ? `起動中 — http://127.0.0.1:${config.port}/mcp` : status.error ? `停止中（${status.error}）` : '停止中'}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Input className="w-32" value={port} onChange={(e) => setPort(e.target.value)} aria-label="ポート" />
        <Button variant="secondary" onClick={savePort}>ポートを保存</Button>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={copyConfig}>設定 JSON をコピー</Button>
        <Button variant="secondary" onClick={regenerate}>トークンを再生成</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add the row to the dialog**

In `src/renderer/components/SettingsDialog.tsx`, add the import and the row:

```tsx
import { McpSetting } from './settings/McpSetting'
```

```tsx
        <div className="flex flex-col gap-6">
          <ThemeSetting />
          <ApiKeySetting />
          <McpSetting />
        </div>
```

- [ ] **Step 3: Typecheck and run the suite**

Run: `npx vitest run && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 4: Manual end-to-end verification**

Run: `npm run dev`

1. Open Settings → the MCP row shows 停止中.
2. Click 有効にする → it shows 起動中 with the URL.
3. Click 設定 JSON をコピー.
4. In a terminal: `claude mcp add --transport http vibing-view http://127.0.0.1:39100/mcp --header "Authorization: Bearer <token>"` (token from the copied JSON).
5. In Claude Code, call `get_active_workspace` — the cells, timeframes, and indicators must match what the app window is showing.
6. Call `get_cache_status` — the listed symbols/timeframes must match what you have charted; there must be **no `1w` or `1M` rows**, and the `1d` rows must say `(also serves 1w, 1M)`.
7. Call `get_ohlcv` for a symbol already on screen with `limit: 5` — the last CSV row's close must match the chart's last candle, and the summary line must say `cache hit, no API call`.
8. Call the same `get_ohlcv` without a token (`curl -X POST http://127.0.0.1:39100/mcp -d '{}'`) → 401.
9. Toggle 停止する → the same curl now fails to connect.
10. Set the port to one already in use (e.g. a running dev server's) and enable → a Japanese error toast appears and the row stays 停止中.

Record any mismatch as a bug before committing.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/settings/McpSetting.tsx src/renderer/components/SettingsDialog.tsx
git commit -m "feat(settings): MCP server row with token copy and port control"
```

---

## Spec coverage

| Spec section | Task |
|---|---|
| `core.ts` extraction (M-04) | 2, 3, 4 |
| `OhlcvOutcome` 4 kinds (M-09), `[]` fold | 2, 4 |
| in-flight dedup (M-10) | 2 |
| `CacheService` widened guard (M-15) | 1 |
| `summarizeBars` + W/M derived annotation (M-13) | 3, 6 |
| 8 MCP tools | 7 |
| CSV + limit 300/2000 (M-05) | 6, 7 |
| ISO in/out (M-08) | 6, 7 |
| `from`/`to` five cases (M-14) | 7 |
| unmet-range notes | 6, 7 |
| company info freshness / partial groups | 6, 7 |
| settings + token (M-06, M-11) | 5, 10 |
| 3-layer defence, Origin-absent passes (M-12) | 8 |
| port conflict fails loudly (M-07) | 8, 9 |
| Streamable HTTP on `node:http` (M-01, M-02) | 9 |
| error message table | 7 |
| Settings dialog row | 10 |
| manual verification | 10 |
