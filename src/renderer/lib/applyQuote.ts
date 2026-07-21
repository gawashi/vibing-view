import { toZonedTime } from 'date-fns-tz'
import type { Bar, Quote, Timeframe } from '@shared/types'

const INTRADAY: ReadonlySet<Timeframe> = new Set<Timeframe>(['1m', '5m', '15m', '1h'])
const DERIVED: ReadonlySet<Timeframe> = new Set<Timeframe>(['1w', '1M'])

// UTC-midnight epoch seconds of the NY trading date for a quote timestamp. Daily bars are keyed at
// UTC midnight of the FMP date string (= the NY trading date), so the forming today-bar must use
// the same rule or it collides with / misorders against the last daily bar.
function nyTradingDayUtcMidnight(tsSeconds: number): number {
  const ny = toZonedTime(tsSeconds * 1000, 'America/New_York')
  return Math.floor(Date.UTC(ny.getFullYear(), ny.getMonth(), ny.getDate()) / 1000)
}

// Render-time overlay of the live quote onto the cached candles. Never mutates the query cache.
export function applyQuote(
  bars: Bar[],
  quote: Quote | undefined,
  isOpen: boolean,
  timeframe: Timeframe
): Bar[] {
  if (!isOpen || !quote || bars.length === 0) return bars

  const last = bars[bars.length - 1]
  const patched: Bar = {
    ...last,
    close: quote.price,
    high: Math.max(last.high, quote.price),
    low: Math.min(last.low, quote.price)
  }

  // Intraday and derived W/M: patch the trailing bar only (never invent a bucket boundary).
  if (INTRADAY.has(timeframe) || DERIVED.has(timeframe)) {
    return [...bars.slice(0, -1), patched]
  }

  // Daily: append a forming "today" bar if today's bucket is beyond the last cached bar; else patch.
  // Strictly-ascending guard: only append when today > last.time (lightweight-charts requires it).
  const today = nyTradingDayUtcMidnight(quote.timestamp)
  if (today > last.time) {
    return [...bars, { time: today, open: quote.open, high: quote.dayHigh, low: quote.dayLow, close: quote.price, volume: 0 }]
  }
  return [...bars.slice(0, -1), patched]
}
