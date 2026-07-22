import { describe, it, expect } from 'vitest'
import { defaultLayout, parseLayout, newCellSeed, SCHEMA_VERSION } from '../../src/renderer/workspace'
import type { Layout } from '@shared/types'

describe('parseLayout', () => {
  it('round-trips a freshly-built default workspace', () => {
    const ws = defaultLayout('cell-1', 'vol-1')
    expect(parseLayout(ws)).toEqual(ws)
  })

  it('never throws on malformed JSON input, returns null', () => {
    expect(parseLayout('{bad json' as unknown)).toBeNull()
  })

  it('never throws on an empty object, returns null (no cells to recover)', () => {
    expect(parseLayout({})).toBeNull()
  })

  it('fills defaults for a partial workspace (missing shape/activeCellId/indicators)', () => {
    const raw = { cells: [{ id: 'c1', symbol: 'MSFT' }] }
    const parsed = parseLayout(raw)
    expect(parsed).toEqual({
      schemaVersion: SCHEMA_VERSION,
      cells: [{ id: 'c1', symbol: 'MSFT', timeframe: '1d', indicators: [] }],
      shape: '1x1',
      activeCellId: 'c1'
    })
  })

  it('assumption-delta: two cells with distinct symbol/timeframe/indicators survive serialize→parse independently', () => {
    const cellA = { ...newCellSeed('a', 'a-vol'), symbol: 'AAPL', timeframe: '1h' as const }
    const cellB = {
      ...newCellSeed('b', 'b-vol'),
      symbol: 'TSLA',
      timeframe: '15m' as const,
      indicators: [
        ...newCellSeed('b', 'b-vol').indicators,
        { id: 'b-sma', type: 'ma', params: { length: 20 }, colors: { ma: '#F5A623' }, visible: true }
      ]
    }
    const ws: Layout = { schemaVersion: SCHEMA_VERSION, cells: [cellA, cellB], shape: '2x1', activeCellId: 'b' }

    const roundTripped = parseLayout(JSON.parse(JSON.stringify(ws)))
    expect(roundTripped).toEqual(ws)

    const a = roundTripped!.cells.find((c) => c.id === 'a')!
    const b = roundTripped!.cells.find((c) => c.id === 'b')!
    // Each cell's fields are independent — editing one never bleeds into the other's assertions.
    expect(a.symbol).toBe('AAPL')
    expect(a.timeframe).toBe('1h')
    expect(a.indicators).toHaveLength(1) // just the fixed volume seed
    expect(b.symbol).toBe('TSLA')
    expect(b.timeframe).toBe('15m')
    expect(b.indicators).toHaveLength(2) // volume seed + the extra SMA
    expect(b.indicators.some((i) => i.type === 'ma')).toBe(true)
    expect(a.indicators.some((i) => i.type === 'ma')).toBe(false)
  })
})
