import { describe, it, expect } from 'vitest'
import {
  sliceRange, tableRows, latestRow, formatValue, formatDelta, INDICATOR_YEARS
} from '@/lib/economicIndicatorSeries'
import type { EconomicIndicatorPoint } from '@shared/types'

// 2016-01-01 から 2026-01-01 まで毎年 1 点（value は年の下 2 桁）。
const YEARLY: EconomicIndicatorPoint[] = Array.from({ length: 11 }, (_, i) => ({
  date: `${2016 + i}-01-01`,
  value: 16 + i
}))

describe('INDICATOR_YEARS', () => {
  it('offers only 1 / 5 with 1 first as the default (EI-01: 90 日窓なので 10Y / Max は無い)', () => {
    expect(INDICATOR_YEARS).toEqual([1, 5])
  })
})

describe('sliceRange — 基準は最新観測日 (EI-08)', () => {
  it('1Y counts back from the newest observation, not from today', () => {
    // 最新は 2026-01-01。今日（2026-07-27 以降）から 1 年遡ると 1 点も残らないが、
    // 最新観測から遡れば 2025-01-01 と 2026-01-01 が残る。
    expect(sliceRange(YEARLY, 1).map((p) => p.date)).toEqual(['2025-01-01', '2026-01-01'])
  })

  it('5Y slices from the newest observation', () => {
    expect(sliceRange(YEARLY, 5).map((p) => p.date)).toEqual([
      '2021-01-01', '2022-01-01', '2023-01-01', '2024-01-01', '2025-01-01', '2026-01-01'
    ])
  })

  it('keeps a lagging series non-empty (四半期系列で発表が遅れているケース)', () => {
    // 最新観測が 2 年前でも 1Y ビューは空にならない。
    const lagging: EconomicIndicatorPoint[] = [
      { date: '2023-07-01', value: 1 },
      { date: '2023-10-01', value: 2 },
      { date: '2024-01-01', value: 3 }
    ]
    expect(sliceRange(lagging, 1).map((p) => p.date)).toEqual(['2023-07-01', '2023-10-01', '2024-01-01'])
  })

  it('handles an empty series', () => {
    expect(sliceRange([], 1)).toEqual([])
    expect(sliceRange([], 5)).toEqual([])
  })

  it('handles a single point', () => {
    const one = [{ date: '2026-06-01', value: 1 }]
    expect(sliceRange(one, 1)).toEqual(one)
  })

  it('does not crash on a Feb 29 newest date', () => {
    // 文字列比較でカットオフを作るので、'2020-02-29' の 1 年前 '2019-02-29'（実在しない日付）でも
    // 境界として正しく働く。
    const leap: EconomicIndicatorPoint[] = [
      { date: '2019-01-01', value: 1 },
      { date: '2019-03-01', value: 2 },
      { date: '2020-02-29', value: 3 }
    ]
    expect(sliceRange(leap, 1).map((p) => p.date)).toEqual(['2019-03-01', '2020-02-29'])
  })
})

describe('tableRows — 新しい順、Δ は絶対差 (EI-07)', () => {
  it('reverses the visible slice and computes deltas', () => {
    const visible = sliceRange(YEARLY, 1)
    expect(tableRows(YEARLY, visible)).toEqual([
      { date: '2026-01-01', value: 26, delta: 1 },
      { date: '2025-01-01', value: 25, delta: 1 }
    ])
  })

  it('uses the observation before the slice for the oldest visible row (境界で空欄にしない)', () => {
    const visible = sliceRange(YEARLY, 1)
    const oldest = tableRows(YEARLY, visible).at(-1)!
    expect(oldest.date).toBe('2025-01-01')
    expect(oldest.delta).toBe(1) // 2024 の 24 との差。スライス外を参照している
  })

  it('leaves delta null for the very first observation of the whole series', () => {
    const rows = tableRows(YEARLY, YEARLY)
    expect(rows.at(-1)).toEqual({ date: '2016-01-01', value: 16, delta: null })
  })

  it('caps the row count at the limit', () => {
    expect(tableRows(YEARLY, YEARLY, 3).map((r) => r.date)).toEqual([
      '2026-01-01', '2025-01-01', '2024-01-01'
    ])
  })

  it('defaults the limit to 20', () => {
    const many: EconomicIndicatorPoint[] = Array.from({ length: 50 }, (_, i) => ({
      date: `2020-01-${String(i + 1).padStart(2, '0')}`, value: i
    }))
    expect(tableRows(many, many)).toHaveLength(20)
  })

  it('handles an empty series', () => {
    expect(tableRows([], [])).toEqual([])
  })
})

describe('latestRow', () => {
  it('returns the newest observation with its delta', () => {
    expect(latestRow(YEARLY)).toEqual({ date: '2026-01-01', value: 26, delta: 1 })
  })

  it('returns a null delta for a single-point series', () => {
    expect(latestRow([{ date: '2026-06-01', value: 5 }])).toEqual({ date: '2026-06-01', value: 5, delta: null })
  })

  it('returns null for an empty series', () => {
    expect(latestRow([])).toBeNull()
  })
})

describe('formatValue / formatDelta', () => {
  it('caps fraction digits at 2 for every magnitude', () => {
    expect(formatValue(0.0312)).toBe('0.03')
    expect(formatValue(4.2)).toBe('4.2')
    expect(formatValue(322.1)).toBe('322.1')
  })

  it('groups large numbers', () => {
    expect(formatValue(30331.117)).toBe('30,331.12')
  })

  it('signs the delta and dashes null', () => {
    expect(formatDelta(0.7)).toBe('+0.7')
    expect(formatDelta(-0.7)).toBe('-0.7')
    expect(formatDelta(0)).toBe('0')
    expect(formatDelta(null)).toBe('—')
  })
})
