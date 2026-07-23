import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore, selectActiveItems } from '../../src/renderer/store'
import type { Layout } from '../../src/shared/types'

describe('useAppStore grid shape logic', () => {
  beforeEach(() => {
    // Reset to a known 1x1 AAPL+SMA state before each test (module-level nextId keeps climbing
    // across tests — hydrate now additionally reseeds it past any loaded workspace's ids, see
    // the "hydrate reseeds nextId" tests below for the regression this guards against).
    const { cells, activeCellId } = useAppStore.getState()
    useAppStore.setState({
      cells: [cells.find((c) => c.id === activeCellId) ?? cells[0]],
      shape: { rows: 1, cols: 1 },
      activeCellId
    })
  })

  it('expand adds empty (null-symbol) cells — no copy of the active cell (copy is a separate feature)', () => {
    useAppStore.getState().setActiveSymbol('AAPL')
    useAppStore.getState().addIndicator('ma')
    const before = useAppStore.getState()
    const activeCell = before.cells.find((c) => c.id === before.activeCellId)!

    useAppStore.getState().setShape({ rows: 2, cols: 2 })

    const state = useAppStore.getState()
    expect(state.cells).toHaveLength(4)
    const added = state.cells.slice(1)
    for (const cell of added) {
      expect(cell.id).not.toBe(activeCell.id)
      expect(cell.symbol).toBeNull()
      // only the fixed Volume seed, nothing copied from the active cell
      expect(cell.indicators.map((i) => i.type)).toEqual(['volume'])
    }
    // all ids (cells + indicators) are distinct
    const allIds = state.cells.flatMap((c) => [c.id, ...c.indicators.map((i) => i.id)])
    expect(new Set(allIds).size).toBe(allIds.length)
  })

  it('shrink retains hidden cell configs so re-expand restores them (no re-duplication)', () => {
    useAppStore.getState().setShape({ rows: 2, cols: 2 })
    const cell1Id = useAppStore.getState().cells[1].id
    useAppStore.getState().setActiveCell(cell1Id)
    useAppStore.getState().setActiveSymbol('MSFT')

    useAppStore.getState().setShape({ rows: 1, cols: 1 })
    // shrink must not delete cells
    expect(useAppStore.getState().cells).toHaveLength(4)

    useAppStore.getState().setShape({ rows: 2, cols: 2 })
    const state = useAppStore.getState()
    expect(state.cells).toHaveLength(4)
    const cell1 = state.cells.find((c) => c.id === cell1Id)!
    expect(cell1.symbol).toBe('MSFT')
  })

  it('moves active cell to cell 0 when the active cell falls outside the shrunk range', () => {
    useAppStore.getState().setShape({ rows: 2, cols: 2 })
    const cell2Id = useAppStore.getState().cells[2].id
    useAppStore.getState().setActiveCell(cell2Id)

    useAppStore.getState().setShape({ rows: 1, cols: 1 })

    expect(useAppStore.getState().activeCellId).toBe(useAppStore.getState().cells[0].id)
  })

  it('expands to a full 3x3 (9 cells) with unique ids', () => {
    useAppStore.getState().setShape({ rows: 3, cols: 3 })
    const state = useAppStore.getState()
    expect(state.cells).toHaveLength(9)
    const allIds = state.cells.flatMap((c) => [c.id, ...c.indicators.map((i) => i.id)])
    expect(new Set(allIds).size).toBe(allIds.length)
  })

  it('setCrosshair only updates the given cell, leaving other cells isolated', () => {
    useAppStore.getState().setCrosshair('cellA', { price: { open: 1, high: 2, low: 0, close: 1 } })
    useAppStore.getState().setCrosshair('cellB', { price: { open: 5, high: 6, low: 4, close: 5 } })

    useAppStore.getState().setCrosshair('cellA', { price: { open: 9, high: 9, low: 9, close: 9 } })

    const { crosshairByCell } = useAppStore.getState()
    expect(crosshairByCell['cellA']).toEqual({ price: { open: 9, high: 9, low: 9, close: 9 } })
    expect(crosshairByCell['cellB']).toEqual({ price: { open: 5, high: 6, low: 4, close: 5 } })
  })

  describe('hydrate reseeds nextId past restored ids (Phase 5 review: nextId collision bug)', () => {
    it('addIndicator after hydrate mints an id greater than every restored id, never colliding', () => {
      const ws: Layout = {
        schemaVersion: 1,
        shape: { rows: 1, cols: 1 },
        activeCellId: 'c1',
        cells: [
          {
            id: 'c1',
            symbol: 'AAPL',
            timeframe: '1d',
            indicators: [
              { id: '500', type: 'ma', params: {}, colors: {}, visible: true }
            ]
          }
        ]
      }

      useAppStore.getState().hydrate(ws)
      useAppStore.getState().addIndicator('ma', 'c1')

      const cell = useAppStore.getState().cells.find((c) => c.id === 'c1')!
      const ids = cell.indicators.map((i) => i.id)
      // must be unique (this is what fails pre-fix: nextId restarts at 3 every module load, so
      // the newly minted id collides with the restored "500" once nextId happens to reach it —
      // but more importantly it must always be numerically past the loaded max, not just unique
      // by luck)
      expect(new Set(ids).size).toBe(ids.length)
      const newInstance = cell.indicators[cell.indicators.length - 1]
      expect(Number(newInstance.id)).toBeGreaterThan(500)
    })

    it('setShape expand after hydrate mints a fresh cell id that does not collide with a restored high cell id', () => {
      const ws: Layout = {
        schemaVersion: 1,
        shape: { rows: 1, cols: 1 },
        activeCellId: '900',
        cells: [
          { id: '900', symbol: 'AAPL', timeframe: '1d', indicators: [] }
        ]
      }

      useAppStore.getState().hydrate(ws)
      useAppStore.getState().setShape({ rows: 2, cols: 2 })

      const { cells } = useAppStore.getState()
      expect(cells).toHaveLength(4)
      const ids = cells.map((c) => c.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const cell of cells.slice(1)) {
        expect(Number(cell.id)).toBeGreaterThan(900)
      }
    })

    it('hydrate re-seeds the always-on fixed Volume for a cell restored without it', () => {
      const ws: Layout = {
        schemaVersion: 1,
        shape: { rows: 1, cols: 1 },
        activeCellId: '900',
        // volume-less cell (e.g. saved by an older build whose clearCell wiped all indicators)
        cells: [{ id: '900', symbol: 'AAPL', timeframe: '1d', indicators: [] }]
      }

      useAppStore.getState().hydrate(ws)

      const cell = useAppStore.getState().cells.find((c) => c.id === '900')!
      const volume = cell.indicators.find((i) => i.type === 'volume')
      expect(volume).toBeDefined()
      expect(volume!.fixed).toBe(true)
      expect(Number(volume!.id)).toBeGreaterThan(900) // fresh id past the reseeded counter
    })

    it('hydrate leaves an existing Volume untouched (no duplicate)', () => {
      const ws: Layout = {
        schemaVersion: 1,
        shape: { rows: 1, cols: 1 },
        activeCellId: 'c9',
        cells: [{
          id: 'c9',
          symbol: 'AAPL',
          timeframe: '1d',
          indicators: [{ id: 'v9', type: 'volume', params: {}, colors: {}, visible: true, fixed: true }]
        }]
      }

      useAppStore.getState().hydrate(ws)

      const cell = useAppStore.getState().cells.find((c) => c.id === 'c9')!
      expect(cell.indicators.filter((i) => i.type === 'volume')).toHaveLength(1)
      expect(cell.indicators[0].id).toBe('v9')
    })
  })

  describe('clearCell', () => {
    it('empties a cell: symbol null, user indicators cleared but fixed Volume kept, crosshair removed', () => {
      // Seed a deterministic cell with the always-on fixed Volume + a user-added indicator
      // (beforeEach can't guarantee volume — the preceding hydrate tests leave volume-less cells).
      const id = 'clear-target'
      useAppStore.setState({
        cells: [{
          id,
          symbol: 'AAPL',
          timeframe: '1d',
          indicators: [
            { id: 'vol1', type: 'volume', params: {}, colors: {}, visible: true, fixed: true },
            { id: 'ma1', type: 'ma', params: {}, colors: {}, visible: true }
          ]
        }],
        activeCellId: id,
        shape: { rows: 1, cols: 1 }
      })
      useAppStore.getState().setCrosshair(id, { price: { open: 1, high: 1, low: 1, close: 1 } })

      useAppStore.getState().clearCell(id)

      const cell = useAppStore.getState().cells.find((c) => c.id === id)!
      expect(cell.symbol).toBeNull()
      // the always-on fixed Volume survives (so re-searching a symbol still shows volume); the
      // user-added 'ma' is gone.
      expect(cell.indicators.every((i) => i.fixed)).toBe(true)
      expect(cell.indicators.map((i) => i.type)).toEqual(['volume'])
      expect(useAppStore.getState().crosshairByCell[id]).toBeUndefined()
      // active cell unchanged
      expect(useAppStore.getState().activeCellId).toBe(id)
    })

    it('only clears the target cell, leaving others intact', () => {
      useAppStore.getState().setShape({ rows: 2, cols: 2 })
      const [c0, c1] = useAppStore.getState().cells
      useAppStore.getState().clearCell(c0.id)
      const after = useAppStore.getState().cells
      expect(after.find((c) => c.id === c0.id)!.symbol).toBeNull()
      expect(after.find((c) => c.id === c1.id)!.symbol).toBe(c1.symbol)
    })
  })

  describe('workspaces (unified list + layout)', () => {
    const L = (symbol: string | null, id = 'x1') => ({
      schemaVersion: 1,
      cells: [{ id, symbol, timeframe: '1d' as const, indicators: [] }],
      shape: { rows: 1, cols: 1 } as const,
      activeCellId: id
    })

    beforeEach(() => {
      useAppStore.setState({
        cells: L('AAPL', 'c1').cells,
        shape: { rows: 1, cols: 1 },
        activeCellId: 'c1',
        workspaces: [{ name: 'Workspace 1', items: [], layout: L('AAPL', 'c1') }],
        activeWorkspace: 'Workspace 1'
      })
    })

    const items = () => selectActiveItems(useAppStore.getState())

    it('addToWatchlist dedupes and scopes to the active workspace', () => {
      const a = { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }
      useAppStore.getState().addToWatchlist(a)
      useAppStore.getState().addToWatchlist(a)
      expect(items()).toEqual([a])
    })

    it('removeFromWatchlist removes only the matching symbol in the active workspace', () => {
      const a = { symbol: 'AAPL', name: 'Apple', exchange: 'NASDAQ' }
      const m = { symbol: 'MSFT', name: 'Microsoft', exchange: 'NASDAQ' }
      useAppStore.getState().addToWatchlist(a)
      useAppStore.getState().addToWatchlist(m)
      useAppStore.getState().removeFromWatchlist('AAPL')
      expect(items()).toEqual([m])
    })

    it('reorderWatchlist DOWN inserts before the target row', () => {
      const [a, b, c] = [
        { symbol: 'A', name: 'A', exchange: 'NYSE' },
        { symbol: 'B', name: 'B', exchange: 'NYSE' },
        { symbol: 'C', name: 'C', exchange: 'NYSE' }
      ]
      useAppStore.setState({ workspaces: [{ name: 'Workspace 1', items: [a, b, c], layout: L('AAPL') }], activeWorkspace: 'Workspace 1' })
      useAppStore.getState().reorderWatchlist(0, 2)
      expect(items()).toEqual([b, a, c])
    })

    it('reorderWatchlist to length moves the item to the last slot', () => {
      const [a, b, c] = [
        { symbol: 'A', name: 'A', exchange: 'NYSE' },
        { symbol: 'B', name: 'B', exchange: 'NYSE' },
        { symbol: 'C', name: 'C', exchange: 'NYSE' }
      ]
      useAppStore.setState({ workspaces: [{ name: 'Workspace 1', items: [a, b, c], layout: L('AAPL') }], activeWorkspace: 'Workspace 1' })
      useAppStore.getState().reorderWatchlist(0, 3)
      expect(items()).toEqual([b, c, a])
    })

    it('switchWorkspace snapshots the current grid into the old workspace and loads the target layout', () => {
      useAppStore.setState({
        cells: L('MSFT', 'c1').cells, shape: { rows: 1, cols: 1 }, activeCellId: 'c1',
        workspaces: [
          { name: 'Workspace 1', items: [], layout: L('MSFT', 'c1') },
          { name: 'Scan', items: [], layout: { schemaVersion: 1, cells: [{ id: 'd1', symbol: 'GOOG', timeframe: '1h', indicators: [] }], shape: { rows: 1, cols: 1 }, activeCellId: 'd1' } }
        ],
        activeWorkspace: 'Workspace 1'
      })
      useAppStore.getState().setActiveSymbol('TSLA')
      useAppStore.getState().switchWorkspace('Scan')

      const s = useAppStore.getState()
      expect(s.activeWorkspace).toBe('Scan')
      expect(s.cells[0].symbol).toBe('GOOG')
      expect(s.cells[0].timeframe).toBe('1h')
      expect(s.workspaces.find((w) => w.name === 'Workspace 1')!.layout.cells[0].symbol).toBe('TSLA')
    })

    it('createWorkspace adds an empty workspace, switches to it, and loads an empty grid', () => {
      useAppStore.getState().setActiveSymbol('AAPL')
      expect(useAppStore.getState().createWorkspace('B')).toEqual({ ok: true })
      const s = useAppStore.getState()
      expect(s.activeWorkspace).toBe('B')
      expect(s.cells[0].symbol).toBeNull()
      expect(s.workspaces.find((w) => w.name === 'Workspace 1')!.layout.cells[0].symbol).toBe('AAPL')
      expect(useAppStore.getState().createWorkspace('B').ok).toBe(false)
      expect(useAppStore.getState().createWorkspace('   ').ok).toBe(false)
    })

    it('duplicateWorkspace copies the current grid and active items into a new active workspace', () => {
      const a = { symbol: 'AAPL', name: 'Apple', exchange: 'NASDAQ' }
      useAppStore.setState({
        cells: L('AAPL', 'c1').cells, shape: { rows: 1, cols: 1 }, activeCellId: 'c1',
        workspaces: [{ name: 'A', items: [a], layout: L('AAPL', 'c1') }],
        activeWorkspace: 'A'
      })
      expect(useAppStore.getState().duplicateWorkspace('A copy')).toEqual({ ok: true })
      const copy = useAppStore.getState().workspaces.find((w) => w.name === 'A copy')!
      expect(useAppStore.getState().activeWorkspace).toBe('A copy')
      expect(copy.items).toEqual([a])
      expect(copy.layout.cells[0].symbol).toBe('AAPL')
    })

    it('renameWorkspace renames and moves the active pointer; rejects duplicates', () => {
      useAppStore.getState().createWorkspace('Tech')
      expect(useAppStore.getState().renameWorkspace('Tech', 'Growth')).toEqual({ ok: true })
      expect(useAppStore.getState().activeWorkspace).toBe('Growth')
      expect(useAppStore.getState().renameWorkspace('Growth', 'Workspace 1').ok).toBe(false)
    })

    it('deleteWorkspace protects the last workspace and re-points active to the first survivor', () => {
      useAppStore.setState({
        cells: L('AAPL', 'c1').cells, shape: { rows: 1, cols: 1 }, activeCellId: 'c1',
        workspaces: [
          { name: 'A', items: [], layout: L('AAPL', 'a1') },
          { name: 'B', items: [], layout: L('MSFT', 'b1') }
        ],
        activeWorkspace: 'A'
      })
      useAppStore.getState().deleteWorkspace('A')
      expect(useAppStore.getState().workspaces.map((w) => w.name)).toEqual(['B'])
      expect(useAppStore.getState().activeWorkspace).toBe('B')
      expect(useAppStore.getState().cells[0].symbol).toBe('MSFT')
      useAppStore.getState().deleteWorkspace('B')
      expect(useAppStore.getState().workspaces).toHaveLength(1)
    })

    it('reorderWorkspaces moves a workspace without touching the active pointer; rejects bad indices', () => {
      useAppStore.setState({
        workspaces: [
          { name: 'A', items: [], layout: L(null) },
          { name: 'B', items: [], layout: L(null) },
          { name: 'C', items: [], layout: L(null) }
        ],
        activeWorkspace: 'A'
      })
      expect(useAppStore.getState().reorderWorkspaces(0, 1)).toEqual({ ok: true })
      expect(useAppStore.getState().workspaces.map((w) => w.name)).toEqual(['B', 'A', 'C'])
      expect(useAppStore.getState().activeWorkspace).toBe('A')
      expect(useAppStore.getState().reorderWorkspaces(0, 5).ok).toBe(false)
      expect(useAppStore.getState().reorderWorkspaces(1, 1).ok).toBe(false)
    })

    it('hydrateWorkspaces loads the collection and the active workspace layout', () => {
      useAppStore.getState().hydrateWorkspaces({
        version: 3,
        active: 'Two',
        workspaces: [
          { name: 'One', items: [], layout: L('AAPL', 'o1') },
          { name: 'Two', items: [], layout: L('NVDA', 't1') }
        ]
      })
      expect(useAppStore.getState().activeWorkspace).toBe('Two')
      expect(useAppStore.getState().cells[0].symbol).toBe('NVDA')
    })
  })

  describe('workspace duplication mints fresh ids', () => {
    beforeEach(() => {
      useAppStore.getState().hydrateWorkspaces({
        version: 3, active: 'Src',
        workspaces: [{
          name: 'Src', items: [],
          layout: {
            schemaVersion: 1,
            cells: [{ id: 'srcC', symbol: 'AAPL', timeframe: '1d', indicators: [{ id: 'srcI', type: 'volume', params: {}, colors: {}, visible: true, fixed: true }] }],
            shape: { rows: 1, cols: 1 }, activeCellId: 'srcC'
          }
        }]
      })
    })

    it('duplicate shares no cell or indicator id with its source', () => {
      useAppStore.getState().duplicateWorkspace('Copy')
      const wss = useAppStore.getState().workspaces
      const src = wss.find((w) => w.name === 'Src')!
      const copy = wss.find((w) => w.name === 'Copy')!
      const srcIds = src.layout.cells.flatMap((c) => [c.id, ...c.indicators.map((i) => i.id)])
      const copyIds = copy.layout.cells.flatMap((c) => [c.id, ...c.indicators.map((i) => i.id)])
      expect(srcIds.some((id) => copyIds.includes(id))).toBe(false)
      // copy's activeCellId points at a real cell in the copy
      expect(copy.layout.cells.some((c) => c.id === copy.layout.activeCellId)).toBe(true)
    })
  })
})
