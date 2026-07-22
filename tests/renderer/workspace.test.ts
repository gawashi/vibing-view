import { describe, it, expect } from 'vitest'
import {
  defaultLayout,
  parseLayout,
  newCellSeed,
  SCHEMA_VERSION,
  emptyLayout,
  parseWorkspaceCollection,
  defaultWorkspaceCollection,
  cellCount,
  parseShape
} from '../../src/shared/workspace'
import type { Layout } from '@shared/types'

const aapl = { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }

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
      shape: { rows: 1, cols: 1 },
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
    const ws: Layout = {
      schemaVersion: SCHEMA_VERSION,
      cells: [cellA, cellB],
      shape: { rows: 1, cols: 2 },
      activeCellId: 'b'
    }

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

describe('emptyLayout', () => {
  it('is a 1x1 grid with an empty (null-symbol) cell that keeps the fixed Volume', () => {
    const l = emptyLayout()
    expect(l.shape).toEqual({ rows: 1, cols: 1 })
    expect(l.cells).toHaveLength(1)
    expect(l.cells[0].symbol).toBeNull()
    const vol = l.cells[0].indicators.find((i) => i.type === 'volume')
    expect(vol?.fixed).toBe(true)
  })
})

describe('parseWorkspaceCollection', () => {
  it('returns the default single "Workspace 1" for non-object input', () => {
    expect(parseWorkspaceCollection(null)).toEqual(defaultWorkspaceCollection())
    expect(parseWorkspaceCollection(defaultWorkspaceCollection())).toEqual(defaultWorkspaceCollection())
  })

  it('round-trips a valid collection and preserves the active name', () => {
    const c = {
      version: 3,
      active: 'Scan',
      workspaces: [
        { name: 'Main', items: [aapl], layout: emptyLayout() },
        { name: 'Scan', items: [], layout: emptyLayout() }
      ]
    }
    expect(parseWorkspaceCollection(c)).toEqual(c)
  })

  it('falls back active to the first workspace when the stored active is missing', () => {
    const c = { version: 3, active: 'Gone', workspaces: [{ name: 'Main', items: [], layout: emptyLayout() }] }
    expect(parseWorkspaceCollection(c).active).toBe('Main')
  })

  it('replaces an invalid layout with emptyLayout instead of dropping the workspace', () => {
    const c = { version: 3, active: 'Main', workspaces: [{ name: 'Main', items: [], layout: 42 }] }
    const parsed = parseWorkspaceCollection(c)
    expect(parsed.workspaces[0].layout).toEqual(emptyLayout())
  })

  it('drops nameless workspaces and malformed items, defaulting when all drop', () => {
    const c = {
      version: 3,
      active: 'Main',
      workspaces: [
        { name: 'Main', items: [aapl, { symbol: 'BAD' }, null], layout: emptyLayout() },
        { items: [], layout: emptyLayout() }
      ]
    }
    const parsed = parseWorkspaceCollection(c)
    expect(parsed.workspaces).toHaveLength(1)
    expect(parsed.workspaces[0].items).toEqual([aapl])
    expect(parseWorkspaceCollection({ version: 3, active: 'x', workspaces: [] })).toEqual(defaultWorkspaceCollection())
  })
})

describe('parseShape', () => {
  it('parses new object form and clamps each dim to 1..3', () => {
    expect(parseShape({ rows: 2, cols: 3 })).toEqual({ rows: 2, cols: 3 })
    expect(parseShape({ rows: 5, cols: 0 })).toEqual({ rows: 3, cols: 1 })
    expect(parseShape({ rows: 2.9, cols: 1.2 })).toEqual({ rows: 2, cols: 1 })
  })

  it('parses legacy "col x row" strings preserving orientation', () => {
    expect(parseShape('1x1')).toEqual({ rows: 1, cols: 1 })
    expect(parseShape('2x1')).toEqual({ rows: 1, cols: 2 }) // 2 columns, 1 row = horizontal
    expect(parseShape('2x2')).toEqual({ rows: 2, cols: 2 })
  })

  it('falls back to 1x1 for unusable input', () => {
    expect(parseShape(null)).toEqual({ rows: 1, cols: 1 })
    expect(parseShape(42)).toEqual({ rows: 1, cols: 1 })
    expect(parseShape('garbage')).toEqual({ rows: 1, cols: 1 })
  })
})

describe('cellCount', () => {
  it('is rows * cols', () => {
    expect(cellCount({ rows: 1, cols: 1 })).toBe(1)
    expect(cellCount({ rows: 3, cols: 3 })).toBe(9)
    expect(cellCount({ rows: 1, cols: 2 })).toBe(2)
  })
})
