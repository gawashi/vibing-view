import { describe, it, expect } from 'vitest'
import { PALETTE, makeIndicatorInstance, sameParams } from '../../src/shared/indicators/instance'

describe('makeIndicatorInstance', () => {
  it('returns null for an unknown type', () => {
    expect(makeIndicatorInstance('nope', {}, 0, '1')).toBeNull()
  })

  it('gives a single-output indicator one palette color, picked by add order', () => {
    const inst = makeIndicatorInstance('ma', { kind: 'SMA', period: 20, source: 'close' }, 1, '7')!
    expect(inst.id).toBe('7')
    expect(inst.type).toBe('ma')
    expect(inst.visible).toBe(true)
    expect(inst.colors).toEqual({ line: PALETTE[1] })
  })

  // MACD has 3 outputs and no band: each LINE output walks the palette from `base`.
  it('walks the palette across every output of a multi-line indicator', () => {
    const inst = makeIndicatorInstance('macd', { fast: 12, slow: 26, signal: 9 }, 0, '9')!
    expect(inst.colors.macd).toBe(PALETTE[0])
    expect(inst.colors.signal).toBe(PALETTE[1])
    // The histogram is not a line: it takes the base color, not the next palette slot.
    expect(inst.colors.histogram).toBe(PALETTE[0])
  })

  // BB has a band output: every output shares one color (the band tint is derived from it).
  it('gives every output the same color when the module has a band', () => {
    const inst = makeIndicatorInstance('bb', { period: 20, mult: 2, source: 'close' }, 2, '3')!
    const values = new Set(Object.values(inst.colors))
    expect(values.size).toBe(1)
    expect(values.has(PALETTE[2])).toBe(true)
  })

  it('copies params instead of aliasing the caller object', () => {
    const params = { period: 20 }
    const inst = makeIndicatorInstance('ma', params, 0, '1')!
    params.period = 50
    expect(inst.params.period).toBe(20)
  })
})

describe('sameParams', () => {
  it('is true for identical key sets and values', () => {
    expect(sameParams({ period: 20, kind: 'SMA' }, { kind: 'SMA', period: 20 })).toBe(true)
  })

  it('is false when a value differs', () => {
    expect(sameParams({ period: 20 }, { period: 50 })).toBe(false)
  })

  it('is false when the key count differs', () => {
    expect(sameParams({ period: 20 }, { period: 20, kind: 'SMA' })).toBe(false)
  })
})
