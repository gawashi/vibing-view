import { describe, it, expect } from 'vitest'
import { INITIAL_BARS, initialLogicalRange } from '../src/renderer/lib/initialRange'

describe('initialLogicalRange', () => {
  it('returns the last N bars when there are more than N', () => {
    // 1d は 120 本。500 本あれば直近 120 本(index 380..499)。
    expect(initialLogicalRange('1d', 500)).toEqual({ from: 380, to: 499 })
  })

  it('returns null when bars are fewer than or equal to N (fall back to fitContent)', () => {
    expect(initialLogicalRange('1d', 120)).toBeNull()
    expect(initialLogicalRange('1d', 50)).toBeNull()
    expect(initialLogicalRange('1d', 0)).toBeNull()
  })

  it('covers every timeframe with a positive bar count', () => {
    const tfs = ['1m', '5m', '15m', '1h', '1d', '1w', '1M'] as const
    for (const tf of tfs) expect(INITIAL_BARS[tf]).toBeGreaterThan(0)
  })
})
