import { ipcMain } from 'electron'
import type { Timeframe, DateRange } from '@shared/types'
import { CH } from '@shared/ipc'
import { FmpProvider } from './providers/FmpProvider'
import { createCacheService } from './cache/CacheService'
import * as barStore from './db/barStore'
import { getApiKey, setApiKey, getKeyStatus, clearApiKey } from './keystore'
import { getLastSymbol, setLastSymbol } from './settings'
import { createSearchCache } from './searchCache'

export function registerIpc(): void {
  const searchCache = createSearchCache({ ttlMs: 5 * 60 * 1000, now: () => Date.now() })

  const cacheFor = () => {
    const apiKey = getApiKey()
    if (!apiKey) throw new Error('NO_API_KEY')
    return createCacheService({ provider: new FmpProvider({ apiKey }), store: barStore })
  }

  ipcMain.handle(CH.symbolsSearch, async (_e, query: string) => {
    const cached = searchCache.get(query)
    if (cached) return cached
    const apiKey = getApiKey()
    if (!apiKey) throw new Error('NO_API_KEY')
    const results = await new FmpProvider({ apiKey }).searchSymbols(query)
    searchCache.set(query, results)
    return results
  })

  ipcMain.handle(CH.ohlcvGet, async (_e, symbol: string, timeframe: Timeframe, range: DateRange) =>
    cacheFor().getOHLCV(symbol, timeframe, range)
  )

  ipcMain.handle(CH.apikeySet, (_e, key: string) => setApiKey(key))
  ipcMain.handle(CH.apikeyStatus, () => getKeyStatus())
  ipcMain.handle(CH.apikeyClear, () => clearApiKey())
  ipcMain.handle(CH.settingsGetLastSymbol, () => getLastSymbol())
  ipcMain.handle(CH.settingsSetLastSymbol, (_e, symbol: string) => setLastSymbol(symbol))
}
