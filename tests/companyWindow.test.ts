import { describe, it, expect } from 'vitest'
import { buildCompanyHash, parseCompanySymbol } from '../src/shared/companyWindow'

describe('company window hash', () => {
  it('round-trips a plain symbol', () => {
    expect(parseCompanySymbol('#' + buildCompanyHash('AAPL'))).toBe('AAPL')
  })

  it('parses a hash with a leading #', () => {
    expect(parseCompanySymbol('#company=MSFT')).toBe('MSFT')
  })

  it('parses a hash without a leading #', () => {
    expect(parseCompanySymbol('company=MSFT')).toBe('MSFT')
  })

  it('round-trips a symbol needing encoding', () => {
    expect(parseCompanySymbol('#' + buildCompanyHash('BRK.B'))).toBe('BRK.B')
  })

  it('returns null when there is no company param', () => {
    expect(parseCompanySymbol('')).toBeNull()
    expect(parseCompanySymbol('#foo=bar')).toBeNull()
  })
})
