import { describe, it, expect } from 'vitest'
import { addIndicator, removeIndicator, updateIndicator } from '../../../src/main/mcp/edits'
import { PALETTE } from '../../../src/shared/indicators/instance'
import type { Cell, IndicatorInstance, WorkspaceCollection } from '@shared/types'

const vol = (id: string): IndicatorInstance =>
  ({ id, type: 'volume', params: {}, colors: {}, visible: true, fixed: true })
const ma = (id: string): IndicatorInstance =>
  ({ id, type: 'ma', params: { kind: 'SMA', period: 20, source: 'close' }, colors: { line: PALETTE[0] }, visible: true })

const cell = (id: string, indicators: IndicatorInstance[]): Cell =>
  ({ id, symbol: 'NVDA', timeframe: '1d', indicators })

const collection = (): WorkspaceCollection => ({
  version: 3,
  active: 'Main',
  workspaces: [{
    name: 'Main',
    items: [],
    layout: {
      schemaVersion: 1,
      shape: { rows: 1, cols: 2 },
      activeCellId: '1',
      cells: [cell('1', [vol('4'), ma('5')]), cell('2', [vol('6')]), cell('3', [vol('7')])]
    }
  }]
})

describe('addIndicator', () => {
  it('appends an instance with a minted id and palette color', () => {
    const res = addIndicator(collection(), { cell: '2', type: 'rsi', params: { period: 14 } })
    if (!res.ok) throw new Error(res.message)
    const added = res.collection.workspaces[0].layout.cells[1].indicators[1]
    expect(added).toMatchObject({ id: '8', type: 'rsi', params: { period: 14 }, visible: true })
    expect(res.value.added).toEqual([{ cellId: '2', instance: added }])
  })

  // Parity with addIndicatorToAll: bulk adds skip a cell that already has the same type+params.
  it('cell "all" skips cells that already have the identical indicator', () => {
    const res = addIndicator(collection(), {
      cell: 'all', type: 'ma', params: { kind: 'SMA', period: 20, source: 'close' }
    })
    if (!res.ok) throw new Error(res.message)
    const cells = res.collection.workspaces[0].layout.cells
    expect(cells[0].indicators).toHaveLength(2) // already had that exact ma
    expect(cells[1].indicators).toHaveLength(2) // added
    expect(cells[2].indicators).toHaveLength(1) // off-grid at 1x2, untouched (MW-08)
    expect(res.value.skipped).toBe(1)
  })

  // Parity with addIndicator: a single-cell add never dedupes — two identical MAs are legal.
  it('a single-cell add does not dedupe', () => {
    const res = addIndicator(collection(), {
      cell: '1', type: 'ma', params: { kind: 'SMA', period: 20, source: 'close' }
    })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.workspaces[0].layout.cells[0].indicators).toHaveLength(3)
  })

  it('reports an unknown cell', () => {
    expect(addIndicator(collection(), { cell: '9', type: 'rsi', params: {} })).toEqual({
      ok: false, message: 'No cell "9" in workspace "Main". Cells: 1, 2, 3.'
    })
  })
})

describe('updateIndicator', () => {
  it('merges params, leaving untouched keys alone', () => {
    const res = updateIndicator(collection(), { indicator: '5', params: { period: 50 } })
    if (!res.ok) throw new Error(res.message)
    expect(res.value.instance.params).toEqual({ kind: 'SMA', period: 50, source: 'close' })
  })

  it('toggles visibility', () => {
    const res = updateIndicator(collection(), { indicator: '5', visible: false })
    if (!res.ok) throw new Error(res.message)
    expect(res.value.instance.visible).toBe(false)
  })

  // MW-16: the UI fans one colour across every output; writing only the first key would leave
  // MACD's lines mismatched against what the edit dialog produces.
  it('writes the color to every output key', () => {
    const c = collection()
    c.workspaces[0].layout.cells[0].indicators.push({
      id: '9', type: 'macd', params: { fast: 12, slow: 26, signal: 9 },
      colors: { macd: PALETTE[0], signal: PALETTE[1], histogram: PALETTE[0] }, visible: true
    })
    const res = updateIndicator(c, { indicator: '9', color: '#123456' })
    if (!res.ok) throw new Error(res.message)
    expect(res.value.instance.colors).toEqual({
      macd: '#123456', signal: '#123456', histogram: '#123456'
    })
  })

  it('finds an indicator in any cell of the workspace', () => {
    const res = updateIndicator(collection(), { indicator: '6', visible: false })
    if (!res.ok) throw new Error(res.message)
    expect(res.value.cellId).toBe('2')
  })

  it('reports an unknown indicator id', () => {
    expect(updateIndicator(collection(), { indicator: '99', visible: false })).toEqual({
      ok: false, message: 'No indicator "99". Use get_workspace to list indicator ids.'
    })
  })
})

describe('removeIndicator', () => {
  it('removes one instance by id', () => {
    const res = removeIndicator(collection(), { indicator: '5' })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.workspaces[0].layout.cells[0].indicators.map((i) => i.id)).toEqual(['4'])
    expect(res.value.removed).toBe(1)
  })

  // Volume is fixed (D-34): the UI's removeIndicator ignores it, so MCP must too.
  it('refuses to remove a fixed indicator', () => {
    const res = removeIndicator(collection(), { indicator: '4' })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.workspaces[0].layout.cells[0].indicators).toHaveLength(2)
    expect(res.value).toMatchObject({ removed: 0, keptFixed: 1 })
  })

  it('clears every user indicator in one cell', () => {
    const res = removeIndicator(collection(), { cell: '1' })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.workspaces[0].layout.cells[0].indicators.map((i) => i.id)).toEqual(['4'])
    expect(res.value).toMatchObject({ removed: 1, keptFixed: 1 })
  })

  it('cell "all" only clears the visible cells', () => {
    const c = collection()
    c.workspaces[0].layout.cells[2].indicators.push(ma('8'))
    const res = removeIndicator(c, { cell: 'all' })
    if (!res.ok) throw new Error(res.message)
    const cells = res.collection.workspaces[0].layout.cells
    expect(cells[0].indicators.map((i) => i.id)).toEqual(['4'])
    expect(cells[2].indicators.map((i) => i.id)).toEqual(['7', '8']) // off-grid, untouched
  })

  it('reports an unknown indicator id', () => {
    expect(removeIndicator(collection(), { indicator: '99' })).toEqual({
      ok: false, message: 'No indicator "99". Use get_workspace to list indicator ids.'
    })
  })
})
