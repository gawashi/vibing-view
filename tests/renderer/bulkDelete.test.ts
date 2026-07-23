import { describe, it, expect } from 'vitest'
import { BULK_DELETE } from '../../src/renderer/components/bulkDelete'

describe('BULK_DELETE config', () => {
  it('routes charts → clearAllCells and indicators → removeAllIndicators (no swap)', () => {
    const clearAllCells = (): void => {}
    const removeAllIndicators = (): void => {}
    const store = { clearAllCells, removeAllIndicators }
    expect(BULK_DELETE.charts.action(store)).toBe(clearAllCells)
    expect(BULK_DELETE.indicators.action(store)).toBe(removeAllIndicators)
  })

  it('confirm copy names the right nouns and warns it is irreversible', () => {
    expect(BULK_DELETE.charts.title).toBe('Clear all charts?')
    expect(BULK_DELETE.indicators.title).toBe('Clear all indicators?')
    expect(BULK_DELETE.charts.description).toContain('symbol')
    expect(BULK_DELETE.charts.description).toContain("can't be undone")
    expect(BULK_DELETE.indicators.description).toContain('Symbols and volume are kept')
    expect(BULK_DELETE.indicators.description).toContain("can't be undone")
  })
})
