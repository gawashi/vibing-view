import { describe, it, expect } from 'vitest'
import { buildChartHash, parseChartCellId } from '../src/shared/chartWindow'

describe('chart window hash', () => {
  it('round-trips a cell id', () => {
    expect(parseChartCellId('#' + buildChartHash('5'))).toBe('5')
  })

  it('parses with and without a leading #', () => {
    expect(parseChartCellId('#chart=12')).toBe('12')
    expect(parseChartCellId('chart=12')).toBe('12')
  })

  it('round-trips an id needing encoding', () => {
    expect(parseChartCellId('#' + buildChartHash('1__w0c1'))).toBe('1__w0c1')
  })

  it('returns null when there is no chart param', () => {
    expect(parseChartCellId('')).toBeNull()
    expect(parseChartCellId('#company=AAPL')).toBeNull()
  })
})
