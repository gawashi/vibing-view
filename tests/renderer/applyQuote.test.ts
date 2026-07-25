import { describe, it, expect } from 'vitest'
import { applyQuote } from '../../src/renderer/lib/applyQuote'
import type { Bar, Quote } from '../../src/shared/types'

const DAY = 86400
const bar = (day: number, close: number): Bar => ({ time: day * DAY, open: close, high: close, low: close, close, volume: 0 })
// Jan 2 2026 15:00Z = 10:00 ET → NY trading date Jan 2 2026 → bucket = Date.UTC(2026,0,2)/1000.
const TS = Math.floor(Date.UTC(2026, 0, 2, 15, 0, 0) / 1000)
const JAN1 = Math.floor(Date.UTC(2026, 0, 1) / 1000)
const JAN2 = Math.floor(Date.UTC(2026, 0, 2) / 1000)
const quote = (over: Partial<Quote> = {}): Quote => ({
  price: 110, open: 105, dayHigh: 112, dayLow: 104, previousClose: 100,
  changePercentage: 10, timestamp: TS, exchange: 'NASDAQ', ...over
})

describe('applyQuote', () => {
  it('returns bars unchanged when closed', () => {
    const bars = [bar(1, 100)]
    expect(applyQuote(bars, quote(), false, '1d')).toBe(bars)
  })
  it('returns bars unchanged when no quote', () => {
    const bars = [bar(1, 100)]
    expect(applyQuote(bars, undefined, true, '1d')).toBe(bars)
  })
  it('returns bars unchanged when empty', () => {
    expect(applyQuote([], quote(), true, '1d')).toEqual([])
  })
  it('intraday: patches trailing bar close and extends high/low', () => {
    const out = applyQuote([bar(1, 90), { ...bar(1, 108), high: 108, low: 100 }], quote({ price: 111 }), true, '5m')
    expect(out).toHaveLength(2)
    expect(out[1].close).toBe(111)
    expect(out[1].high).toBe(111) // 111 > 108
    expect(out[1].low).toBe(100)  // 100 < 111
  })
  it('daily: appends a forming today bar when today is past the last daily bar', () => {
    const out = applyQuote([bar(0, 90), { time: JAN1, open: 100, high: 101, low: 99, close: 100, volume: 5 }], quote(), true, '1d')
    expect(out).toHaveLength(3)
    expect(out[2]).toEqual({ time: JAN2, open: 105, high: 112, low: 104, close: 110, volume: 0 })
  })
  it('daily: patches (does not append) when the last bar is already today', () => {
    const out = applyQuote([{ time: JAN2, open: 100, high: 101, low: 99, close: 100, volume: 5 }], quote({ price: 111 }), true, '1d')
    expect(out).toHaveLength(1)
    expect(out[0].close).toBe(111)
  })
  it('daily: never appends out of order (today before last bar → patch)', () => {
    const future = Math.floor(Date.UTC(2026, 0, 3) / 1000)
    const out = applyQuote([{ time: future, open: 100, high: 101, low: 99, close: 100, volume: 5 }], quote(), true, '1d')
    expect(out).toHaveLength(1)
    expect(out[0].close).toBe(110)
  })
  it('weekly/monthly: patches trailing bar only, never appends', () => {
    const bars = [{ time: JAN1, open: 100, high: 101, low: 99, close: 100, volume: 5 }]
    expect(applyQuote(bars, quote(), true, '1w')).toHaveLength(1)
    expect(applyQuote(bars, quote(), true, '1w')[0].close).toBe(110)
    expect(applyQuote(bars, quote(), true, '1M')).toHaveLength(1)
  })
})
