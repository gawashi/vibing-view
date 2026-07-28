import { describe, it, expect } from 'vitest'
import { buildHash, parseHash, type WindowKind } from '../src/shared/windowHash'

const KINDS: WindowKind[] = ['company', 'chart', 'symbolChart', 'economic']

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

  // 経済カレンダーは値を見ず有無だけで判定するので、他の窓の hash で誤って開かないことを押さえる。
  it('only reports the economic window for its own hash', () => {
    expect(parseHash('economic', '#' + buildHash('economic', '1'))).toBe('1')
    expect(parseHash('economic', '#' + buildHash('company', 'AAPL'))).toBeNull()
    expect(parseHash('company', '#' + buildHash('economic', '1'))).toBeNull()
  })
})

describe('windowHash — economicIndicator', () => {
  it('round-trips the singleton marker', () => {
    const hash = buildHash('economicIndicator', '1')
    expect(parseHash('economicIndicator', hash)).toBe('1')
  })

  it('does not parse as another kind', () => {
    const hash = buildHash('economicIndicator', '1')
    expect(parseHash('economic', hash)).toBeNull()
    expect(parseHash('company', hash)).toBeNull()
    expect(parseHash('chart', hash)).toBeNull()
    expect(parseHash('symbolChart', hash)).toBeNull()
  })

  it('is not matched by the economic calendar hash', () => {
    expect(parseHash('economicIndicator', buildHash('economic', '1'))).toBeNull()
  })
})
