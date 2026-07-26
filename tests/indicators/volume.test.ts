import { describe, it, expect } from 'vitest'
import { volume, abbreviate } from '../../src/shared/indicators/volume'
import type { HistPoint } from '../../src/shared/indicators/types'
import type { Bar } from '../../src/shared/types'

function makeBars(): Bar[] {
  return [
    { time: 0, open: 10, high: 12, low: 9, close: 11, volume: 100 }, // up → green
    { time: 1, open: 10, high: 10, low: 8, close: 9, volume: 200 }, // down → red
    { time: 2, open: 10, high: 10, low: 10, close: 10, volume: 300 } // equal → green (boundary: close >= open)
  ]
}

describe('volume (module)', () => {
  it('registers under type volume', () => {
    expect(volume.type).toBe('volume')
  })

  it('compute returns one HistPoint per bar with value = bar volume', () => {
    const bars = makeBars()
    const { volume: points } = volume.compute(bars, {}) as { volume: HistPoint[] }
    expect(points).toHaveLength(bars.length)
    expect(points[0].value).toBe(100)
    expect(points[1].value).toBe(200)
    expect(points[2].value).toBe(300)
  })

  it('colors up bar (close > open) green', () => {
    const bars = makeBars()
    const { volume: points } = volume.compute(bars, {}) as { volume: HistPoint[] }
    expect(points[0].color).toBe('#22C55E')
  })

  it('colors down bar (close < open) red', () => {
    const bars = makeBars()
    const { volume: points } = volume.compute(bars, {}) as { volume: HistPoint[] }
    expect(points[1].color).toBe('#EF4444')
  })

  it('colors the close === open boundary green (D-43: close >= open)', () => {
    const bars = makeBars()
    const { volume: points } = volume.compute(bars, {}) as { volume: HistPoint[] }
    // This is the meaningful boundary check: if the source used `>` instead of
    // `>=`, this equal-candle bar would incorrectly come out red (#EF4444).
    expect(points[2].color).toBe('#22C55E')
  })
})

describe('abbreviate (volume axis formatter)', () => {
  it('formats thousands as K with 2 decimals', () => {
    expect(abbreviate(1234)).toBe('1.23K')
  })
  it('formats millions as M with 2 decimals', () => {
    expect(abbreviate(12450200)).toBe('12.45M')
  })
  it('formats billions as B with 2 decimals', () => {
    expect(abbreviate(3.4e9)).toBe('3.40B')
  })
  it('leaves values below 1000 as an integer', () => {
    expect(abbreviate(950)).toBe('950')
  })
})
