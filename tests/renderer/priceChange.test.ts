import { describe, it, expect } from 'vitest'
import { computeChange, latestPriceChange } from '../../src/renderer/lib/priceChange'
import type { Bar } from '../../src/shared/types'
import type { Quote } from '../../src/shared/types'

const DAY = 86400
// helper: bar at UTC day d (seconds), given close
const bar = (day: number, close: number): Bar => ({
  time: day * DAY, open: close, high: close, low: close, close, volume: 0
})

describe('computeChange', () => {
  it('returns null when bars are empty or undefined', () => {
    expect(computeChange([])).toBeNull()
    expect(computeChange(undefined)).toBeNull()
  })

  it('pct is vs previous bar close', () => {
    expect(computeChange([bar(10, 100), bar(11, 110)])).toEqual({ price: 110, pct: 10 })
  })

  it('single bar has no previous → pct null, price still set', () => {
    expect(computeChange([bar(10, 100)])).toEqual({ price: 100, pct: null })
  })
})

const quote = (over: Partial<Quote> = {}): Quote => ({
  price: 110, open: 105, dayHigh: 112, dayLow: 104, previousClose: 100,
  changePercentage: 10, timestamp: 0, exchange: 'NASDAQ', ...over
})

describe('latestPriceChange', () => {
  const daily = [bar(10, 190), bar(11, 200)]
  it('open + quote: uses quote price and changePercentage', () => {
    expect(latestPriceChange(daily, quote({ price: 210, changePercentage: 5 }), true)).toEqual({ price: 210, pct: 5 })
  })
  it('closed: falls back to daily close change', () => {
    const r = latestPriceChange(daily, quote(), false)
    expect(r?.price).toBe(200)
    expect(r?.pct).toBeCloseTo(5.263157894736842)
  })
  it('open but no quote yet: falls back to daily close change', () => {
    const r = latestPriceChange(daily, undefined, true)
    expect(r?.price).toBe(200)
    expect(r?.pct).toBeCloseTo(5.263157894736842)
  })
  it('no daily and closed: null', () => {
    expect(latestPriceChange(undefined, undefined, false)).toBeNull()
  })
})
