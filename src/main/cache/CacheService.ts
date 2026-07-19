import type { Bar, Timeframe, DateRange } from '@shared/types'
import type { FmpProvider } from '../providers/FmpProvider'
import type * as barStore from '../db/barStore'
import { deriveWeekly, deriveMonthly } from '../aggregate'

export function createCacheService(deps: {
  provider: Pick<FmpProvider, 'getOHLCV' | 'searchSymbols'>
  store: typeof barStore
}) {
  const { provider, store } = deps
  return {
    async getOHLCV(symbol: string, tf: Timeframe, range: DateRange): Promise<Bar[]> {
      // W/M are derived from cached daily bars, never fetched/cached themselves (D-17): their
      // coverage IS the daily coverage. Never call provider.getOHLCV or write a '1w'/'1M' row.
      if (tf === '1w' || tf === '1M') {
        if (!store.getCoverage(symbol, '1d')) {
          const fetched = await provider.getOHLCV(symbol, '1d', undefined)
          store.upsertBarsAndCoverage(symbol, '1d', fetched)
        }
        const dailyBars = store.getBars(symbol, '1d', undefined)
        return tf === '1w' ? deriveWeekly(dailyBars) : deriveMonthly(dailyBars)
      }

      const cov = store.getCoverage(symbol, tf)
      // cache hit → no network. No range = "all available" satisfied by any coverage (D-08).
      if (cov && (!range || (cov.oldestTime <= range.from && cov.newestTime >= range.to))) {
        return store.getBars(symbol, tf, range)
      }
      // Miss: coverage exists but doesn't reach the left edge of `range` → fetch ONLY the
      // missing left sub-range (D-16), contiguous with existing coverage (§1) — never re-fetch
      // bars already covered. Any other miss shape (no coverage at all, or a right-edge-only
      // miss where `to < from` would result) falls back to the full initial fetch.
      const fetched =
        cov && range && range.from < cov.oldestTime
          ? await provider.getOHLCV(symbol, tf, { from: range.from, to: cov.oldestTime - 1 })
          : await provider.getOHLCV(symbol, tf, undefined)
      store.upsertBarsAndCoverage(symbol, tf, fetched)
      return store.getBars(symbol, tf, range)
    }
  }
}
