import { and, eq, gte, lte, asc } from 'drizzle-orm'
import type { Bar, Timeframe, DateRange } from '@shared/types'
import { getDb } from './client'
import { bars, coverage } from './schema'

export function coverageFromBars(input: Bar[]): { oldestTime: number; newestTime: number } | null {
  if (input.length === 0) return null
  const times = input.map((b) => b.time)
  return { oldestTime: Math.min(...times), newestTime: Math.max(...times) }
}

export function getCoverage(symbol: string, tf: Timeframe): { oldestTime: number; newestTime: number } | null {
  const row = getDb().select().from(coverage)
    .where(and(eq(coverage.symbol, symbol), eq(coverage.timeframe, tf))).get()
  return row ? { oldestTime: row.oldestTime, newestTime: row.newestTime } : null
}

export function getBars(symbol: string, tf: Timeframe, range: DateRange): Bar[] {
  const conds = [eq(bars.symbol, symbol), eq(bars.timeframe, tf)]
  if (range) conds.push(gte(bars.time, range.from), lte(bars.time, range.to))
  const rows = getDb().select().from(bars).where(and(...conds)).orderBy(asc(bars.time)).all()
  return rows.map((r) => ({
    time: r.time, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume
  }))
}

export function upsertBarsAndCoverage(symbol: string, tf: Timeframe, input: Bar[]): void {
  const cov = coverageFromBars(input)
  if (!cov) return
  const db = getDb()
  db.insert(bars)
    .values(input.map((b) => ({ symbol, timeframe: tf, ...b })))
    .onConflictDoUpdate({
      target: [bars.symbol, bars.timeframe, bars.time],
      set: { open: bars.open, high: bars.high, low: bars.low, close: bars.close, volume: bars.volume }
    })
    .run()
  db.insert(coverage)
    .values({ symbol, timeframe: tf, ...cov })
    .onConflictDoUpdate({
      target: [coverage.symbol, coverage.timeframe],
      set: { oldestTime: cov.oldestTime, newestTime: cov.newestTime }
    })
    .run()
}
