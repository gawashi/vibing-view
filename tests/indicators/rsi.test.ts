import { describe, it, expect } from 'vitest'
import { rsi as computeRsi } from '../../src/renderer/indicators/math'
import { rsi } from '../../src/renderer/indicators/rsi'
import { registry } from '../../src/renderer/indicators/registry'
import type { Bar } from '../../src/shared/types'

describe('rsi (math)', () => {
  it('has a leading gap of `period` (one bar later than sma/ema), then defined values', () => {
    // rsi([1,2,3,4,5], 3):
    // needs 3 diffs from 4 closes → first defined value lands at index 3 (= period), not 2 (= period-1).
    // diffs (i=1..3): 2-1=+1, 3-2=+1, 4-3=+1 → gainSum=3, lossSum=0
    // avgGain = 3/3 = 1, avgLoss = 0 → avgLoss===0 branch → out[3] = 100
    // i=4: diff = 5-4=+1, gain=1, loss=0
    // avgGain = (1*(3-1) + 1)/3 = 3/3 = 1, avgLoss = (0*2 + 0)/3 = 0 → out[4] = 100
    const result = computeRsi([1, 2, 3, 4, 5], 3)
    expect(result).toHaveLength(5)
    expect(result[2]).toBeUndefined() // period-1: still undefined
    expect(result[3]).toBeDefined() // period: first defined value
    expect(result[3]).toBeCloseTo(100)
    expect(result[4]).toBeCloseTo(100)
  })

  it('stays within [0, 100] for a rising-then-falling series', () => {
    const values = [10, 11, 12, 13, 14, 15, 14, 13, 12, 11, 10, 9, 8]
    const result = computeRsi(values, 4)
    for (const v of result) {
      if (v === undefined) continue
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
  })

  it('returns 100 when avgLoss is 0 (monotonically rising series)', () => {
    // All diffs positive → lossSum stays 0 → avgLoss===0 → RSI pinned at 100 throughout.
    const result = computeRsi([1, 2, 3, 4, 5, 6], 3)
    expect(result[3]).toBeCloseTo(100)
    expect(result[4]).toBeCloseTo(100)
    expect(result[5]).toBeCloseTo(100)
  })
})

function makeBars(closes: number[]): Bar[] {
  return closes.map((close, i) => ({
    time: i,
    open: close,
    high: close,
    low: close,
    close,
    volume: 0
  }))
}

describe('rsi (module)', () => {
  it('registers under registry.rsi', () => {
    expect(registry.rsi).toBe(rsi)
    expect(rsi.type).toBe('rsi')
  })

  it('compute returns { line } aligned to bars, first point at index period', () => {
    const bars = makeBars([1, 2, 3, 4, 5, 6, 7, 8])
    const period = 3
    const { line } = rsi.compute(bars, { period, overbought: 70, oversold: 30 })
    // computeRsi's leading gap for this series is `period` (index 3), so bars[0..2] are
    // skipped and the compute output's first point aligns to bars[period].
    expect(line[0].time).toBe(bars[period].time)
    expect(line).toHaveLength(bars.length - period)
  })

  it('guides(p) reflects the overbought/oversold params passed (live-edit wiring)', () => {
    const guides = rsi.guides!({ period: 14, overbought: 80, oversold: 25 })
    expect(guides).toHaveLength(2)
    const values = guides.map((g) => g.value)
    expect(values).toContain(80)
    expect(values).toContain(25)
  })

  it('band(p) reflects the overbought/oversold params passed', () => {
    const band = rsi.band!({ period: 14, overbought: 85, oversold: 20 })
    expect(band.from).toBe(20)
    expect(band.to).toBe(85)
  })
})
