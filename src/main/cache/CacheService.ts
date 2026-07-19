import type { Bar, Timeframe, DateRange } from '@shared/types'
import type { IDataProvider } from '../providers/IDataProvider'

export interface BarStore {
  getCoverage(symbol: string, tf: Timeframe): { oldestTime: number; newestTime: number } | null
  getBars(symbol: string, tf: Timeframe, range: DateRange): Bar[]
  upsertBarsAndCoverage(symbol: string, tf: Timeframe, bars: Bar[]): void
}

function covers(
  cov: { oldestTime: number; newestTime: number } | null,
  range: DateRange
): boolean {
  if (!cov) return false
  if (!range) return true // any coverage satisfies an "all available" request in P1 (D-08)
  return cov.oldestTime <= range.from && cov.newestTime >= range.to
}

export function createCacheService(deps: { provider: IDataProvider; store: BarStore }) {
  const { provider, store } = deps
  return {
    async getOHLCV(symbol: string, tf: Timeframe, range: DateRange): Promise<Bar[]> {
      const cov = store.getCoverage(symbol, tf)
      if (covers(cov, range)) {
        return store.getBars(symbol, tf, range) // cache hit → no network
      }
      // P1: miss → fetch all history once, persist, then serve
      const fetched = await provider.getOHLCV(symbol, tf, undefined)
      store.upsertBarsAndCoverage(symbol, tf, fetched)
      return store.getBars(symbol, tf, range)
    }
  }
}
