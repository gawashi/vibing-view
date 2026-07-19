import type { Bar } from '@shared/types'

// Daily bars are UTC-midnight-encoded calendar dates (P1's dateToEpochSeconds convention) — the
// UTC calendar date already IS the trading day, so bucket on plain UTC arithmetic, no tz conversion
// (decision: bucket by UTC calendar date, not America/New_York — see 02-DESIGN-ADDENDUM discussion).
function aggregateByBucket(daily: Bar[], bucketStartSeconds: (d: Date) => number): Bar[] {
  if (daily.length === 0) return []

  const sorted = [...daily].sort((a, b) => a.time - b.time)
  const buckets = new Map<number, Bar[]>()

  for (const b of sorted) {
    const bucketTime = bucketStartSeconds(new Date(b.time * 1000))
    const bucket = buckets.get(bucketTime)
    if (bucket) bucket.push(b)
    else buckets.set(bucketTime, [b])
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([time, bars]) => ({
      time,
      open: bars[0].open,
      high: Math.max(...bars.map((b) => b.high)),
      low: Math.min(...bars.map((b) => b.low)),
      close: bars[bars.length - 1].close,
      volume: bars.reduce((sum, b) => sum + b.volume, 0)
    }))
}

function weekStartSeconds(d: Date): number {
  const daysSinceMonday = (d.getUTCDay() + 6) % 7
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceMonday) / 1000
}

function monthStartSeconds(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000
}

export function deriveWeekly(daily: Bar[]): Bar[] {
  return aggregateByBucket(daily, weekStartSeconds)
}

export function deriveMonthly(daily: Bar[]): Bar[] {
  return aggregateByBucket(daily, monthStartSeconds)
}
