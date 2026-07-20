import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '../../src/renderer/store'
import type { Workspace } from '../../src/shared/types'

describe('useAppStore grid shape logic', () => {
  beforeEach(() => {
    // Reset to a known 1x1 AAPL+SMA state before each test (module-level nextId keeps climbing
    // across tests — hydrate now additionally reseeds it past any loaded workspace's ids, see
    // the "hydrate reseeds nextId" tests below for the regression this guards against).
    const { cells, activeCellId } = useAppStore.getState()
    useAppStore.setState({
      cells: [cells.find((c) => c.id === activeCellId) ?? cells[0]],
      shape: '1x1',
      activeCellId
    })
  })

  it('expand duplicates the active cell into new slots with fresh instance ids', () => {
    useAppStore.getState().setActiveSymbol('AAPL')
    useAppStore.getState().addIndicator('ma')
    const before = useAppStore.getState()
    const activeCell = before.cells.find((c) => c.id === before.activeCellId)!

    useAppStore.getState().setShape('2x2')

    const state = useAppStore.getState()
    expect(state.cells).toHaveLength(4)
    const duplicates = state.cells.slice(1)
    for (const dup of duplicates) {
      expect(dup.id).not.toBe(activeCell.id)
      expect(dup.symbol).toBe(activeCell.symbol)
      expect(dup.timeframe).toBe(activeCell.timeframe)
      expect(dup.indicators.map((i) => i.type)).toEqual(activeCell.indicators.map((i) => i.type))
      // fresh instance ids — no id shared with the source cell or with each other
      const dupIds = dup.indicators.map((i) => i.id)
      const srcIds = activeCell.indicators.map((i) => i.id)
      for (const id of dupIds) expect(srcIds).not.toContain(id)
    }
    // duplicate cells' indicator ids are also distinct from one another
    const allDupIndicatorIds = duplicates.flatMap((d) => d.indicators.map((i) => i.id))
    expect(new Set(allDupIndicatorIds).size).toBe(allDupIndicatorIds.length)
  })

  it('shrink retains hidden cell configs so re-expand restores them (no re-duplication)', () => {
    useAppStore.getState().setShape('2x2')
    const cell1Id = useAppStore.getState().cells[1].id
    useAppStore.getState().setActiveCell(cell1Id)
    useAppStore.getState().setActiveSymbol('MSFT')

    useAppStore.getState().setShape('1x1')
    // shrink must not delete cells
    expect(useAppStore.getState().cells).toHaveLength(4)

    useAppStore.getState().setShape('2x2')
    const state = useAppStore.getState()
    expect(state.cells).toHaveLength(4)
    const cell1 = state.cells.find((c) => c.id === cell1Id)!
    expect(cell1.symbol).toBe('MSFT')
  })

  it('moves active cell to cell 0 when the active cell falls outside the shrunk range', () => {
    useAppStore.getState().setShape('2x2')
    const cell2Id = useAppStore.getState().cells[2].id
    useAppStore.getState().setActiveCell(cell2Id)

    useAppStore.getState().setShape('1x1')

    expect(useAppStore.getState().activeCellId).toBe(useAppStore.getState().cells[0].id)
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
      const ws: Workspace = {
        schemaVersion: 1,
        shape: '1x1',
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
      const ws: Workspace = {
        schemaVersion: 1,
        shape: '1x1',
        activeCellId: '900',
        cells: [
          { id: '900', symbol: 'AAPL', timeframe: '1d', indicators: [] }
        ]
      }

      useAppStore.getState().hydrate(ws)
      useAppStore.getState().setShape('2x2')

      const { cells } = useAppStore.getState()
      expect(cells).toHaveLength(4)
      const ids = cells.map((c) => c.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const cell of cells.slice(1)) {
        expect(Number(cell.id)).toBeGreaterThan(900)
      }
    })

    it('hydrate re-seeds the always-on fixed Volume for a cell restored without it', () => {
      const ws: Workspace = {
        schemaVersion: 1,
        shape: '1x1',
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
      const ws: Workspace = {
        schemaVersion: 1,
        shape: '1x1',
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
        shape: '1x1'
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
      useAppStore.getState().setShape('2x2')
      const [c0, c1] = useAppStore.getState().cells
      useAppStore.getState().clearCell(c0.id)
      const after = useAppStore.getState().cells
      expect(after.find((c) => c.id === c0.id)!.symbol).toBeNull()
      expect(after.find((c) => c.id === c1.id)!.symbol).toBe(c1.symbol)
    })
  })

  describe('watchlist', () => {
    beforeEach(() => {
      useAppStore.setState({ watchlist: [] })
    })

    it('addToWatchlist twice with the same symbol yields one entry (WATCH-01 dedupe)', () => {
      const item = { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }
      useAppStore.getState().addToWatchlist(item)
      useAppStore.getState().addToWatchlist(item)

      expect(useAppStore.getState().watchlist).toEqual([item])
    })

    it('removeFromWatchlist removes only the matching symbol', () => {
      const a = { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }
      const m = { symbol: 'MSFT', name: 'Microsoft Corp.', exchange: 'NASDAQ' }
      useAppStore.getState().addToWatchlist(a)
      useAppStore.getState().addToWatchlist(m)

      useAppStore.getState().removeFromWatchlist('AAPL')

      expect(useAppStore.getState().watchlist).toEqual([m])
    })

    it('reorderWatchlist(0, 2) moves the item and preserves the rest in order', () => {
      const a = { symbol: 'A', name: 'A Inc.', exchange: 'NYSE' }
      const b = { symbol: 'B', name: 'B Inc.', exchange: 'NYSE' }
      const c = { symbol: 'C', name: 'C Inc.', exchange: 'NYSE' }
      useAppStore.setState({ watchlist: [a, b, c] })

      useAppStore.getState().reorderWatchlist(0, 2)

      expect(useAppStore.getState().watchlist).toEqual([b, c, a])
    })
  })
})
