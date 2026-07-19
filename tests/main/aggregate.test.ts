import { describe, it, expect } from 'vitest'
import { deriveWeekly, deriveMonthly } from '../../src/main/aggregate'
import type { Bar } from '@shared/types'

// bar factory: time = UTC epoch seconds at 00:00Z for the given date string (P1's daily-bar
// encoding), distinguishable OHLCV so first/max/min/last/sum are each individually assertable.
const bar = (time: number, open: number, high: number, low: number, close: number, volume: number): Bar => ({
  time, open, high, low, close, volume
})

const utc = (dateStr: string): number => Math.floor(Date.parse(`${dateStr}T00:00:00Z`) / 1000)

describe('deriveWeekly', () => {
  it('returns [] for empty input', () => {
    expect(deriveWeekly([])).toEqual([])
  })

  it('aggregates Mon..Fri of one UTC week into exactly 1 bar', () => {
    // Mon 2024-01-01 .. Fri 2024-01-05, all UTC midnight (daily-bar encoding = the trading day)
    const daily: Bar[] = [
      bar(utc('2024-01-01'), 10, 12, 9, 11, 100), // Mon: open
      bar(utc('2024-01-02'), 11, 15, 8, 12, 200),
      bar(utc('2024-01-03'), 12, 20, 7, 13, 300), // high=20, low=7
      bar(utc('2024-01-04'), 13, 14, 10, 9, 400),
      bar(utc('2024-01-05'), 9, 16, 6, 18, 500)   // Fri: close=18
    ]
    const result = deriveWeekly(daily)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      time: utc('2024-01-01'), // bucket-start = Monday's UTC-midnight
      open: 10,
      high: 20,
      low: 6,
      close: 18,
      volume: 1500
    })
  })

  it('splits two adjacent Monday-start weeks into 2 ascending bars', () => {
    const daily: Bar[] = [
      bar(utc('2024-01-01'), 1, 2, 0.5, 1.5, 10), // week 1 (Mon Jan 1)
      bar(utc('2024-01-03'), 2, 3, 1, 2.5, 20),   // week 1
      bar(utc('2024-01-08'), 3, 4, 2, 3.5, 30),   // week 2 (Mon Jan 8)
      bar(utc('2024-01-10'), 4, 5, 3, 4.5, 40)    // week 2
    ]
    const result = deriveWeekly(daily)
    expect(result).toHaveLength(2)
    expect(result[0].time).toBeLessThan(result[1].time)
    expect(result[0]).toMatchObject({ open: 1, close: 2.5, high: 3, low: 0.5, volume: 30 })
    expect(result[1]).toMatchObject({ open: 3, close: 4.5, high: 5, low: 2, volume: 70 })
  })

  it('buckets a bar on UTC-midnight Sunday into the PRECEDING week (boundary cut on UTC date)', () => {
    const daily: Bar[] = [
      bar(utc('2024-01-01'), 1, 2, 0.5, 1.5, 10),  // Mon Jan 1 (week 1)
      bar(utc('2024-01-07'), 2, 3, 1, 2.5, 20),    // Sun Jan 7 -> still week 1 (preceding week of Jan 8)
      bar(utc('2024-01-08'), 3, 4, 2, 3.5, 30)     // Mon Jan 8 (week 2)
    ]
    const result = deriveWeekly(daily)
    expect(result).toHaveLength(2)
    // Week 1 bucket must include the Sunday bar as its LAST (close) bar, not week 2's first
    expect(result[0]).toMatchObject({ open: 1, close: 2.5, high: 3, low: 0.5, volume: 30 })
    expect(result[1]).toMatchObject({ open: 3, close: 3.5, high: 4, low: 2, volume: 30 })
  })
})

describe('deriveMonthly', () => {
  it('returns [] for empty input', () => {
    expect(deriveMonthly([])).toEqual([])
  })

  it('splits Jan + Feb bars on the calendar-month boundary into 2 bars', () => {
    const daily: Bar[] = [
      bar(utc('2024-01-01'), 1, 2, 0.5, 1.5, 10),
      bar(utc('2024-01-31'), 2, 5, 1, 2.5, 20), // Jan high=5
      bar(utc('2024-02-01'), 3, 4, 2, 3.5, 30),
      bar(utc('2024-02-29'), 4, 6, 0.2, 9, 40)  // Feb: low=0.2, close=9
    ]
    const result = deriveMonthly(daily)
    expect(result).toHaveLength(2)
    expect(result[0].time).toBeLessThan(result[1].time)
    expect(result[0]).toMatchObject({ open: 1, close: 2.5, high: 5, low: 0.5, volume: 30 })
    expect(result[1]).toMatchObject({ open: 3, close: 9, high: 6, low: 0.2, volume: 70 })
  })
})
