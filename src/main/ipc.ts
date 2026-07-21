import { ipcMain } from 'electron'
import type { Bar, Timeframe, DateRange, Workspace, WatchlistCollection } from '@shared/types'
import { CH, type CapabilityStatus } from '@shared/ipc'
import { FmpProvider, FmpHttpError } from './providers/FmpProvider'
import { electronHttpGetJson } from './net/httpClient'
import { createCacheService } from './cache/CacheService'
import * as barStore from './db/barStore'
import { getApiKey, setApiKey, getKeyStatus, clearApiKey } from './keystore'
import { getLastSymbol, setLastSymbol, getSidebarOpen, setSidebarOpen, getSidebarWidth, setSidebarWidth, getTheme, setTheme } from './settings'
import { createSearchCache } from './searchCache'
import { classify } from './capabilityClassifier'
import * as capabilityCache from './capabilityCache'
import * as layoutStore from './layoutStore'
import * as watchlistStore from './watchlistStore'
import { createProfileService } from './profile/ProfileService'
import * as profileStore from './db/profileStore'

const ALL_TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '1d', '1w', '1M']
const DERIVED_TIMEFRAMES: Timeframe[] = ['1w', '1M'] // never gated — always 'available' (§8/§9)
const DAILY_BACKED: Timeframe[] = ['1d', '1w', '1M'] // all served from '1d' bars (W/M derive from them)

export function registerIpc(): void {
  const searchCache = createSearchCache({ ttlMs: 5 * 60 * 1000, now: () => Date.now() })

  const profileService = createProfileService({
    store: profileStore,
    search: (query) => {
      const apiKey = getApiKey()
      if (!apiKey) throw new Error('NO_API_KEY')
      return new FmpProvider({ apiKey, httpGetJson: electronHttpGetJson }).searchSymbols(query)
    }
  })

  // Symbols whose '1d' EOD is not on the current plan (402/403). In-memory, cleared on key change.
  // Once known, D/W/M short-circuit to [] instead of re-hitting FMP for every timeframe switch —
  // the daily fetch that W/M and D all funnel through is deterministic, so retrying it just burns
  // API budget and spams 402s. Empty [] (not a throw) → renderer shows the coverage message quietly.
  const dailyOutOfPlan = new Set<string>()

  const cacheFor = () => {
    const apiKey = getApiKey()
    if (!apiKey) throw new Error('NO_API_KEY')
    return createCacheService({ provider: new FmpProvider({ apiKey, httpGetJson: electronHttpGetJson }), store: barStore })
  }

  // Quote / market-status are volatile and NOT cached in SQLite (SQLite = OHLCV only). They call
  // the provider directly; errors reject and the renderer's reload flow swallows them → daily-close
  // fallback. Not recorded in the per-Timeframe capability cache (they aren't timeframes).
  const providerFor = () => {
    const apiKey = getApiKey()
    if (!apiKey) throw new Error('NO_API_KEY')
    return new FmpProvider({ apiKey })
  }

  ipcMain.handle(CH.symbolsSearch, async (_e, query: string) => {
    const cached = searchCache.get(query)
    if (cached) return cached
    const apiKey = getApiKey()
    if (!apiKey) throw new Error('NO_API_KEY')
    const results = await new FmpProvider({ apiKey, httpGetJson: electronHttpGetJson }).searchSymbols(query)
    searchCache.set(query, results)
    // Seed the profile cache for free — every result carries name/exchange, so a subsequently
    // selected symbol resolves its header profile with zero extra API calls.
    try {
      for (const r of results) profileStore.upsertProfile(r)
    } catch {
      // Seeding the profile cache is best-effort — never fail a search on a cache-warm side effect.
    }
    return results
  })

  ipcMain.handle(CH.symbolsProfile, (_e, symbol: string) => profileService.getProfile(symbol))

  // Shared capability bookkeeping for every real OHLCV fetch (get + refresh): short-circuit known
  // out-of-plan daily-backed symbols, record 'available' on success, and classify FmpHttpErrors.
  const withCapabilityTracking = async (
    symbol: string, timeframe: Timeframe, run: () => Promise<Bar[]>
  ): Promise<Bar[]> => {
    // Known out-of-plan daily → don't re-hit FMP for any daily-backed timeframe.
    if (DAILY_BACKED.includes(timeframe) && dailyOutOfPlan.has(symbol)) return []
    try {
      const bars = await run()
      const apiKey = getApiKey()
      if (apiKey && !DERIVED_TIMEFRAMES.includes(timeframe)) {
        capabilityCache.setStatus(apiKey, timeframe, 'available')
      }
      return bars
    } catch (err) {
      // A 402/403 on any daily-backed tf means the *symbol* isn't on the plan — remember it so the
      // next D/W/M switch short-circuits above instead of re-fetching the same failing daily.
      if (err instanceof FmpHttpError && DAILY_BACKED.includes(timeframe) && (err.status === 402 || err.status === 403)) {
        dailyOutOfPlan.add(symbol)
      }
      const apiKey = getApiKey()
      if (apiKey && !DERIVED_TIMEFRAMES.includes(timeframe) && err instanceof FmpHttpError) {
        const verdict = classify(err.status, err.body)
        // Daily is a free-tier capability. A 402/403 on '1d' means the *symbol* is outside the
        // plan's coverage, not that daily needs a paid plan — recording requires-plan here poisons
        // the key-wide '1d' verdict and greys D for every symbol (D-graying bug). Rate-limit is
        // transient and legitimate for any real-fetch tf, so that still records.
        if (!(timeframe === '1d' && verdict === 'requires-plan')) {
          capabilityCache.setStatus(apiKey, timeframe, verdict)
        }
      }
      throw err
    }
  }

  ipcMain.handle(CH.ohlcvGet, async (_e, symbol: string, timeframe: Timeframe, range: DateRange) =>
    withCapabilityTracking(symbol, timeframe, () => cacheFor().getOHLCV(symbol, timeframe, range))
  )

  ipcMain.handle(CH.ohlcvRefresh, async (_e, symbol: string, timeframe: Timeframe) =>
    withCapabilityTracking(symbol, timeframe, () => cacheFor().refreshOHLCV(symbol, timeframe))
  )

  ipcMain.handle(CH.quoteGet, (_e, symbol: string) => providerFor().getQuote(symbol))
  ipcMain.handle(CH.marketStatus, () => providerFor().getMarketStatus())

  ipcMain.handle(CH.apikeySet, (_e, key: string) => {
    const result = setApiKey(key)
    capabilityCache.clearForKeyChange() // D-21: never eagerly re-probe, just drop stale verdicts
    dailyOutOfPlan.clear() // a new key may cover previously-out-of-plan symbols — re-probe on demand
    return result
  })
  ipcMain.handle(CH.apikeyStatus, () => getKeyStatus())
  ipcMain.handle(CH.apikeyClear, () => {
    clearApiKey()
    capabilityCache.clearForKeyChange()
    dailyOutOfPlan.clear()
  })
  ipcMain.handle(CH.settingsGetLastSymbol, () => getLastSymbol())
  ipcMain.handle(CH.settingsSetLastSymbol, (_e, symbol: string) => setLastSymbol(symbol))
  ipcMain.handle(CH.settingsGetSidebarOpen, () => getSidebarOpen())
  ipcMain.handle(CH.settingsSetSidebarOpen, (_e, open: boolean) => setSidebarOpen(open))
  ipcMain.handle(CH.settingsGetSidebarWidth, () => getSidebarWidth())
  ipcMain.handle(CH.settingsSetSidebarWidth, (_e, width: number) => setSidebarWidth(width))
  ipcMain.handle(CH.settingsGetTheme, () => getTheme())
  ipcMain.handle(CH.settingsSetTheme, (_e, theme: import('./settings').Theme) => setTheme(theme))
  ipcMain.handle(CH.layoutGetCurrent, () => layoutStore.getCurrent())
  ipcMain.handle(CH.layoutSetCurrent, (_e, ws: Workspace) => layoutStore.setCurrent(ws))
  ipcMain.handle(CH.layoutList, () => layoutStore.listLayouts())
  ipcMain.handle(CH.layoutGet, (_e, name: string) => layoutStore.getLayout(name))
  ipcMain.handle(CH.layoutSave, (_e, name: string, ws: Workspace) => layoutStore.saveLayout(name, ws))
  ipcMain.handle(CH.layoutDelete, (_e, name: string) => layoutStore.deleteLayout(name))
  ipcMain.handle(CH.layoutRename, (_e, from: string, to: string) => layoutStore.renameLayout(from, to))
  ipcMain.handle(CH.watchlistGet, () => watchlistStore.getWatchlists())
  ipcMain.handle(CH.watchlistSet, (_e, c: WatchlistCollection) => watchlistStore.setWatchlists(c))

  ipcMain.handle(CH.capabilitiesGet, () => {
    const apiKey = getApiKey()
    const result = {} as Record<Timeframe, CapabilityStatus>
    for (const tf of ALL_TIMEFRAMES) {
      result[tf] = DERIVED_TIMEFRAMES.includes(tf) ? 'available' : apiKey ? capabilityCache.getStatus(apiKey, tf) : 'unknown'
    }
    return result
  })
}
