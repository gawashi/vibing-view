import { describe, it, expect } from 'vitest'
import { refreshTargets } from '../../src/renderer/lib/refreshTargets'
import type { Cell } from '@shared/types'

const cell = (id: string, symbol: string | null, timeframe: Cell['timeframe']): Cell =>
  ({ id, symbol, timeframe, indicators: [] })

describe('refreshTargets', () => {
  it('returns only visible cells for the shape', () => {
    const cells = [cell('a', 'AAPL', '1d'), cell('b', 'MSFT', '1d'), cell('c', 'TSLA', '1d')]
    expect(refreshTargets(cells, { rows: 1, cols: 1 }, undefined)).toEqual([{ symbol: 'AAPL', timeframe: '1d' }])
  })

  it('adds a 1d target for each intraday cell (prev-close label) and de-dupes', () => {
    const cells = [cell('a', 'AAPL', '5m'), cell('b', 'AAPL', '1d')]
    expect(refreshTargets(cells, { rows: 1, cols: 2 }, undefined)).toEqual([
      { symbol: 'AAPL', timeframe: '5m' },
      { symbol: 'AAPL', timeframe: '1d' }
    ])
  })

  it('adds a 1d target for weekly/monthly cells (header 前日比 is daily-based)', () => {
    const cells = [cell('a', 'AAPL', '1w'), cell('b', 'MSFT', '1M')]
    expect(refreshTargets(cells, { rows: 1, cols: 2 }, undefined)).toEqual([
      { symbol: 'AAPL', timeframe: '1w' },
      { symbol: 'AAPL', timeframe: '1d' },
      { symbol: 'MSFT', timeframe: '1M' },
      { symbol: 'MSFT', timeframe: '1d' }
    ])
  })

  it('skips gated timeframes', () => {
    const cells = [cell('a', 'AAPL', '5m')]
    const caps = { '1m': 'available', '5m': 'requires-plan', '15m': 'available', '1h': 'available',
      '1d': 'available', '1w': 'available', '1M': 'available' } as const
    expect(refreshTargets(cells, { rows: 1, cols: 1 }, caps)).toEqual([{ symbol: 'AAPL', timeframe: '1d' }])
  })

  it('ignores cells without a symbol', () => {
    expect(refreshTargets([cell('a', null, '1d')], { rows: 1, cols: 1 }, undefined)).toEqual([])
  })

  it('adds a 1d target for each watchlist symbol (after the grid targets)', () => {
    const cells = [cell('a', 'AAPL', '1d')]
    expect(refreshTargets(cells, { rows: 1, cols: 1 }, undefined, ['MSFT', 'TSLA'])).toEqual([
      { symbol: 'AAPL', timeframe: '1d' },
      { symbol: 'MSFT', timeframe: '1d' },
      { symbol: 'TSLA', timeframe: '1d' }
    ])
  })

  it('de-dupes a watchlist 1d already covered by a grid cell', () => {
    // AAPL 5m cell already pushes AAPL|1d; the watchlist AAPL must not add a second request.
    const cells = [cell('a', 'AAPL', '5m')]
    expect(refreshTargets(cells, { rows: 1, cols: 1 }, undefined, ['AAPL'])).toEqual([
      { symbol: 'AAPL', timeframe: '5m' },
      { symbol: 'AAPL', timeframe: '1d' }
    ])
  })

  it('skips watchlist symbols when 1d itself is gated', () => {
    const caps = { '1m': 'available', '5m': 'available', '15m': 'available', '1h': 'available',
      '1d': 'rate-limited', '1w': 'available', '1M': 'available' } as const
    expect(refreshTargets([], { rows: 1, cols: 1 }, caps, ['MSFT'])).toEqual([])
  })
})
