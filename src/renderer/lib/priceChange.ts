import type { Bar, Quote } from '@shared/types'

export type ChangeResult = { price: number; pct: number | null }

// 現在値 = 最新バー(bars[-1])終値、騰落率 = 前のバー(bars[-2])終値比。前日比は日足バー基準。
export function computeChange(bars: Bar[] | undefined): ChangeResult | null {
  if (!bars || bars.length === 0) return null
  const price = bars[bars.length - 1].close
  const prev = bars[bars.length - 2]?.close
  const pct = prev !== undefined && prev !== 0 ? ((price - prev) / prev) * 100 : null
  return { price, pct }
}

// Watchlist "latest price": during market hours use the live quote (price + FMP's own
// changePercentage, which is authoritative vs previousClose); otherwise the daily-close change.
export function latestPriceChange(
  daily: Bar[] | undefined,
  quote: Quote | undefined,
  isOpen: boolean
): ChangeResult | null {
  if (isOpen && quote) return { price: quote.price, pct: quote.changePercentage }
  return computeChange(daily)
}
