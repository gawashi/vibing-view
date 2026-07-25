import type { Bar, Timeframe, DateRange } from '@shared/types'
import type { FmpProvider } from '../providers/FmpProvider'
import type * as barStore from '../db/barStore'
import { deriveWeekly, deriveMonthly } from '../aggregate'

export function createCacheService(deps: {
  provider: Pick<FmpProvider, 'getOHLCV' | 'searchSymbols'>
  store: Pick<typeof barStore, 'getCoverage' | 'getBars' | 'upsertBarsAndCoverage'>
  now?: () => number // epoch SECONDS; injectable for tests
}) {
  const { provider, store } = deps
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000))
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
      // Miss. Fetch only what's missing on the left: with coverage, the gap below `cov.oldestTime`
      // (D-16); with NO coverage, the whole requested range. Without the `!cov` arm an intraday
      // request for old history would fall through to the provider's recent-window default and
      // silently return the wrong period (M-15). The renderer never hits the `!cov` arm — its only
      // ranged call is Chart.tsx's scrollback, anchored on bars[0].time, so coverage always exists.
      const fetched =
        range && (!cov || range.from < cov.oldestTime)
          ? await provider.getOHLCV(symbol, tf, { from: range.from, to: cov ? cov.oldestTime - 1 : range.to })
          : await provider.getOHLCV(symbol, tf, undefined)
      store.upsertBarsAndCoverage(symbol, tf, fetched)
      return store.getBars(symbol, tf, range)
    },

    // Right-edge differential (reload): advance the cached newest bar up to `now`. W/M re-derive
    // from a refreshed daily. Never re-fetches already-cached older history (API-call budget).
    async refreshOHLCV(symbol: string, tf: Timeframe): Promise<Bar[]> {
      if (tf === '1w' || tf === '1M') {
        const daily = await this.refreshOHLCV(symbol, '1d')
        return tf === '1w' ? deriveWeekly(daily) : deriveMonthly(daily)
      }
      const cov = store.getCoverage(symbol, tf)
      // Nothing cached → behave like a first fetch. (`1d` ignores range and returns full history;
      // intraday fetches only newestTime→now.)
      const fetched = cov
        ? await provider.getOHLCV(symbol, tf, { from: cov.newestTime, to: now() })
        : await provider.getOHLCV(symbol, tf, undefined)
      store.upsertBarsAndCoverage(symbol, tf, fetched)
      return store.getBars(symbol, tf, undefined)
    }
  }
}
