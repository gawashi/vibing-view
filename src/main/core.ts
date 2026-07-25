import type {
  Bar, Timeframe, DateRange, WorkspaceCollection, SymbolResult,
  CompanyProfileData, Quote, MarketStatus, CompanyInfo, ClipboardCell
} from '@shared/types'
import type { CapabilityStatus, KeyStatus, SetKeyResult } from '@shared/ipc'
import { CH } from '@shared/ipc'
import type { FmpProvider } from './providers/FmpProvider'
import { FmpHttpError } from './providers/FmpProvider'
import type * as barStoreModule from './db/barStore'
import type { BarSummary } from './db/barStore'
import { createCacheService } from './cache/CacheService'
import { classify } from './capabilityClassifier'
import { createSearchCache } from './searchCache'
import { createProfileService } from './profile/ProfileService'
import { createCompanyInfoService } from './profile/CompanyInfoService'

export type { BarSummary } from './db/barStore'

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
  const { barStore, capabilityCache, keystore, makeProvider, broadcast } = deps

  // Symbols whose '1d' EOD is not on the current plan (402/403). In-memory, cleared on key change.
  // Once known, D/W/M short-circuit instead of re-hitting FMP on every timeframe switch.
  const dailyOutOfPlan = new Set<string>()

  const searchCache = createSearchCache({ ttlMs: 5 * 60 * 1000, now: () => Date.now() })

  // Monotonic version stamped on each persisted workspace write. Renderers ignore stale
  // (<= lastRev) get/broadcast payloads — see useWorkspaceSync.
  let workspacesRev = 0

  // Chart clipboard: the authoritative value lives here (in-memory, never persisted) so a window
  // opened after a copy can still fetch it. Same rev/broadcast contract as workspaces.
  let clipboard: ClipboardCell | null = null
  let clipboardRev = 0

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
    },

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
  }
}
