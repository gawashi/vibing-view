import { describe, it, expect } from 'vitest'
import { buildSymbolChartHash, parseSymbolChartSymbol } from '../src/shared/symbolChartWindow'
import { parseChartCellId } from '../src/shared/chartWindow'
import { parseCompanySymbol } from '../src/shared/companyWindow'

describe('symbol-chart window hash', () => {
  it('round-trips a symbol', () => {
    expect(parseSymbolChartSymbol('#' + buildSymbolChartHash('AAPL'))).toBe('AAPL')
  })

  it('parses with or without the leading #', () => {
    expect(parseSymbolChartSymbol('#symbolChart=MSFT')).toBe('MSFT')
    expect(parseSymbolChartSymbol('symbolChart=MSFT')).toBe('MSFT')
  })

  it('survives symbols needing encoding (crypto pairs, dotted tickers)', () => {
    expect(parseSymbolChartSymbol('#' + buildSymbolChartHash('BTC/USD'))).toBe('BTC/USD')
    expect(parseSymbolChartSymbol('#' + buildSymbolChartHash('BRK.B'))).toBe('BRK.B')
  })

  it('returns null for an empty or foreign hash', () => {
    expect(parseSymbolChartSymbol('')).toBeNull()
    expect(parseSymbolChartSymbol('#company=AAPL')).toBeNull()
    expect(parseSymbolChartSymbol('#chart=5')).toBeNull()
  })

  it('does not collide with the sibling window hashes', () => {
    // 'symbolChart' must not be read as 'chart' (or vice versa) by the other parsers.
    const hash = '#' + buildSymbolChartHash('AAPL')
    expect(parseChartCellId(hash)).toBeNull()
    expect(parseCompanySymbol(hash)).toBeNull()
  })
})
