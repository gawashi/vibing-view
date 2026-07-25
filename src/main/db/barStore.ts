import { and, eq, gte, lte, asc, sql } from 'drizzle-orm'
import type { Bar, Timeframe, DateRange } from '@shared/types'
import { getDb } from './client'
import { bars, coverage } from './schema'

export function coverageFromBars(input: Bar[]): { oldestTime: number; newestTime: number } | null {
  if (input.length === 0) return null
  const times = input.map((b) => b.time)
  return { oldestTime: Math.min(...times), newestTime: Math.max(...times) }
}

// Widen an existing coverage window with a newly-fetched one (never shrink it). Required for the
// right-edge differential refresh: upserting only the new bars must not drop the older history.
export function unionCoverage(
  a: { oldestTime: number; newestTime: number },
  b: { oldestTime: number; newestTime: number }
): { oldestTime: number; newestTime: number } {
  return { oldestTime: Math.min(a.oldestTime, b.oldestTime), newestTime: Math.max(a.newestTime, b.newestTime) }
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

export function upsertBarsAndCoverage(symbol: string, tf: Timeframe, input: Bar[]): void {
  const cov = coverageFromBars(input)
  if (!cov) return
  const db = getDb()
  db.insert(bars)
    .values(input.map((b) => ({ symbol, timeframe: tf, ...b })))
    .onConflictDoUpdate({
      target: [bars.symbol, bars.timeframe, bars.time],
      // excluded.* = the row we just tried to insert. A re-fetched in-progress bar (right-edge
      // refresh) must overwrite the stale cached one — referencing bars.* would keep the old value.
      set: {
        open: sql`excluded.open`, high: sql`excluded.high`, low: sql`excluded.low`,
        close: sql`excluded.close`, volume: sql`excluded.volume`
      }
    })
    .run()
  // Union with any existing coverage so a partial (differential) upsert never shrinks the window.
  const existing = getCoverage(symbol, tf)
  const merged = existing ? unionCoverage(existing, cov) : cov
  db.insert(coverage)
    .values({ symbol, timeframe: tf, ...merged })
    .onConflictDoUpdate({
      target: [coverage.symbol, coverage.timeframe],
      set: { oldestTime: merged.oldestTime, newestTime: merged.newestTime }
    })
    .run()
}
