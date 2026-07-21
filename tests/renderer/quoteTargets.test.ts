import { describe, it, expect } from 'vitest'
import { quoteSymbols } from '../../src/renderer/lib/quoteTargets'
import type { Cell } from '../../src/shared/types'

const cell = (id: string, symbol: string | null): Cell => ({ id, symbol, timeframe: '1d', indicators: [] })

describe('quoteSymbols', () => {
  it('collects visible cell symbols, skipping empty cells', () => {
    expect(quoteSymbols([cell('a', 'AAPL'), cell('b', null)], '2x1')).toEqual(['AAPL'])
  })
  it('unions watchlist symbols and de-dupes', () => {
    const out = quoteSymbols([cell('a', 'AAPL')], '1x1', ['AAPL', 'MSFT'])
    expect(out.sort()).toEqual(['AAPL', 'MSFT'])
  })
  it('ignores cells beyond the visible count for the shape', () => {
    // 1x1 shows 1 cell → the second cell's symbol is not quoted.
    expect(quoteSymbols([cell('a', 'AAPL'), cell('b', 'MSFT')], '1x1')).toEqual(['AAPL'])
  })
})
