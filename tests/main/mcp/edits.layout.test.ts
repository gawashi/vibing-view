import { describe, it, expect } from 'vitest'
import { makeIdMinter, pickWorkspace, setChart, visibleCells } from '../../../src/main/mcp/edits'
import type { Cell, IndicatorInstance, WorkspaceCollection } from '@shared/types'

const vol = (id: string): IndicatorInstance =>
  ({ id, type: 'volume', params: {}, colors: {}, visible: true, fixed: true })
const ma = (id: string): IndicatorInstance =>
  ({ id, type: 'ma', params: { period: 20 }, colors: { line: '#fff' }, visible: true })

const cell = (id: string, symbol: string | null, indicators: IndicatorInstance[] = [vol(`v${id}`)]): Cell =>
  ({ id, symbol, timeframe: '1d', indicators })

// 2 visible cells (1x2) plus one hidden cell kept in the array — the shape the grid uses when the
// user shrinks a 2x2 back down.
const collection = (): WorkspaceCollection => ({
  version: 3,
  active: 'Main',
  workspaces: [
    {
      name: 'Main',
      items: [],
      layout: {
        schemaVersion: 1,
        shape: { rows: 1, cols: 2 },
        activeCellId: '1',
        cells: [cell('1', 'NVDA'), cell('2', null), cell('3', 'AMD')]
      }
    },
    {
      name: 'Other',
      items: [],
      layout: {
        schemaVersion: 1, shape: { rows: 1, cols: 1 }, activeCellId: '10', cells: [cell('10', 'TSLA')]
      }
    }
  ]
})

describe('makeIdMinter', () => {
  it('starts past the highest numeric id anywhere in the collection', () => {
    const mint = makeIdMinter(collection())
    // ids present: cells 1,2,3,10 and volume ids v1,v2,v3,v10 (non-numeric, ignored)
    expect(mint()).toBe('11')
    expect(mint()).toBe('12')
  })

  it('ignores non-numeric ids instead of throwing', () => {
    const c = collection()
    c.workspaces[0].layout.cells[0].id = 'abc'
    expect(makeIdMinter(c)()).toBe('11')
  })
})

describe('pickWorkspace / visibleCells', () => {
  it('defaults to the active workspace', () => {
    expect(pickWorkspace(collection())?.name).toBe('Main')
  })

  it('returns undefined for an unknown name', () => {
    expect(pickWorkspace(collection(), 'Nope')).toBeUndefined()
  })

  // MW-08: cells past rows*cols are kept in the array but are not visible.
  it('slices the visible cells off the front', () => {
    const w = pickWorkspace(collection())!
    expect(visibleCells(w).map((x) => x.id)).toEqual(['1', '2'])
  })
})

describe('setChart', () => {
  it('sets the symbol of one cell and leaves the others alone', () => {
    const res = setChart(collection(), { cell: '2', symbol: 'AAPL' })
    if (!res.ok) throw new Error(res.message)
    const cells = res.collection.workspaces[0].layout.cells
    expect(cells.map((x) => x.symbol)).toEqual(['NVDA', 'AAPL', 'AMD'])
  })

  it('sets the timeframe without touching the symbol', () => {
    const res = setChart(collection(), { cell: '1', timeframe: '5m' })
    if (!res.ok) throw new Error(res.message)
    const target = res.collection.workspaces[0].layout.cells[0]
    expect(target).toMatchObject({ symbol: 'NVDA', timeframe: '5m' })
  })

  // Parity with the UI's clearCell: user indicators go, the always-on fixed Volume stays (D-34).
  it('clearing a cell drops user indicators but keeps the fixed volume', () => {
    const c = collection()
    c.workspaces[0].layout.cells[0].indicators = [vol('v1'), ma('m1')]
    const res = setChart(c, { cell: '1', symbol: null })
    if (!res.ok) throw new Error(res.message)
    const target = res.collection.workspaces[0].layout.cells[0]
    expect(target.symbol).toBeNull()
    expect(target.indicators.map((i) => i.id)).toEqual(['v1'])
  })

  // MW-08: "all" means the VISIBLE cells only — cell 3 is off-grid at 1x2.
  it('cell "all" only touches the visible cells', () => {
    const res = setChart(collection(), { cell: 'all', timeframe: '1h' })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.workspaces[0].layout.cells.map((x) => x.timeframe)).toEqual(['1h', '1h', '1d'])
  })

  it('targets a named workspace instead of the active one', () => {
    const res = setChart(collection(), { workspace: 'Other', cell: '10', symbol: 'MSFT' })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.workspaces[1].layout.cells[0].symbol).toBe('MSFT')
    expect(res.collection.workspaces[0].layout.cells[0].symbol).toBe('NVDA')
  })

  it('reports an unknown cell with the ids that do exist', () => {
    const res = setChart(collection(), { cell: '9', symbol: 'AAPL' })
    expect(res).toEqual({ ok: false, message: 'No cell "9" in workspace "Main". Cells: 1, 2, 3.' })
  })

  it('reports an unknown workspace with the names that do exist', () => {
    const res = setChart(collection(), { workspace: 'Nope', cell: '1', symbol: 'AAPL' })
    expect(res).toEqual({ ok: false, message: 'No workspace named "Nope". Available: Main, Other' })
  })

  // MW-09: writing to an off-grid cell is allowed but must be reported, or the model leaves a
  // chart nobody can see and calls it done.
  it('flags a write to a cell outside the visible grid', () => {
    const res = setChart(collection(), { cell: '3', symbol: 'AAPL' })
    if (!res.ok) throw new Error(res.message)
    expect(res.value.hidden).toBe(true)
  })

  it('does not flag a write to a visible cell', () => {
    const res = setChart(collection(), { cell: '1', symbol: 'AAPL' })
    if (!res.ok) throw new Error(res.message)
    expect(res.value.hidden).toBe(false)
  })
})
