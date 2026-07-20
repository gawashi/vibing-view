import { describe, it, expect } from 'vitest'
import { computeChange } from '../../src/renderer/lib/priceChange'
import type { Bar } from '../../src/shared/types'

const DAY = 86400
// helper: bar at UTC day d (seconds), given close
const bar = (day: number, close: number, secOfDay = 0): Bar => ({
  time: day * DAY + secOfDay, open: close, high: close, low: close, close, volume: 0
})

describe('computeChange', () => {
  it('returns null when bars are empty or undefined', () => {
    expect(computeChange([], '1d', undefined)).toBeNull()
    expect(computeChange(undefined, '1d', undefined)).toBeNull()
  })

  it('daily: pct is vs previous bar close', () => {
    const bars = [bar(10, 100), bar(11, 110)]
    const r = computeChange(bars, '1d', undefined)
    expect(r).toEqual({ price: 110, pct: 10 })
  })

  it('weekly/monthly: pct is vs previous bar close', () => {
    expect(computeChange([bar(0, 200), bar(7, 190)], '1w', undefined)?.pct).toBeCloseTo(-5)
    expect(computeChange([bar(0, 50), bar(31, 55)], '1M', undefined)?.pct).toBeCloseTo(10)
  })

  it('daily: single bar has no previous → pct null, price still set', () => {
    expect(computeChange([bar(10, 100)], '1d', undefined)).toEqual({ price: 100, pct: null })
  })

  it('intraday: uses daily previous close when today already in daily cache', () => {
    // intraday latest bar on day 12; daily has day 12 (today, partial) → prev = daily day 11
    const intraday = [bar(12, 205, 100), bar(12, 210, 200)]
    const daily = [bar(10, 190), bar(11, 200), bar(12, 208)]
    const r = computeChange(intraday, '5m', daily)
    expect(r?.price).toBe(210)
    expect(r?.pct).toBeCloseTo(5) // (210-200)/200*100
  })

  it('intraday: uses latest daily close when today not yet in daily cache', () => {
    // intraday latest bar on day 12; daily latest is day 11 → prev = daily day 11
    const intraday = [bar(12, 210, 200)]
    const daily = [bar(10, 190), bar(11, 200)]
    expect(computeChange(intraday, '1h', daily)?.pct).toBeCloseTo(5)
  })

  it('intraday: no daily cache → pct null', () => {
    expect(computeChange([bar(12, 210)], '1m', undefined)).toEqual({ price: 210, pct: null })
    expect(computeChange([bar(12, 210)], '1m', [])).toEqual({ price: 210, pct: null })
  })
})
