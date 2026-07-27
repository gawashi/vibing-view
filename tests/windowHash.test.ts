import { describe, it, expect } from 'vitest'
import { buildHash, parseHash, type WindowKind } from '../src/shared/windowHash'

const KINDS: WindowKind[] = ['company', 'chart', 'symbolChart']

describe('satellite window hash', () => {
  it('round-trips values needing encoding, with or without the leading #', () => {
    for (const kind of KINDS) {
      for (const value of ['AAPL', 'BRK.B', 'BTC/USD', '1__w0c1']) {
        expect(parseHash(kind, '#' + buildHash(kind, value))).toBe(value)
        expect(parseHash(kind, buildHash(kind, value))).toBe(value)
      }
    }
  })

  it('returns null for an empty or foreign hash', () => {
    expect(parseHash('company', '')).toBeNull()
    expect(parseHash('company', '#foo=bar')).toBeNull()
  })

  it('never reads a sibling kind’s hash (symbolChart vs chart is the close call)', () => {
    const hash = '#' + buildHash('symbolChart', 'AAPL')
    expect(parseHash('chart', hash)).toBeNull()
    expect(parseHash('company', hash)).toBeNull()
    expect(parseHash('symbolChart', '#' + buildHash('chart', '5'))).toBeNull()
  })
})
