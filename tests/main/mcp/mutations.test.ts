import { describe, it, expect, vi } from 'vitest'
import { buildTools, type ToolCore } from '../../../src/main/mcp/tools'
import type { WorkspaceCollection } from '@shared/types'

const NOW = Date.parse('2026-07-26T00:00:00Z')

const collection = (): WorkspaceCollection => ({
  version: 3,
  active: 'Main',
  workspaces: [{
    name: 'Main',
    items: [],
    layout: {
      schemaVersion: 1,
      shape: { rows: 1, cols: 1 },
      activeCellId: '1',
      cells: [
        { id: '1', symbol: 'NVDA', timeframe: '1d', indicators: [{ id: '2', type: 'volume', params: {}, colors: {}, visible: true, fixed: true }] },
        { id: '3', symbol: null, timeframe: '1d', indicators: [] }
      ]
    }
  }]
})

// A core whose mutate really runs the editor against an in-memory collection, so the tests cover
// the tool + editor pair end to end (only the store and the network are faked).
function fakeCore(over: Partial<ToolCore> = {}): ToolCore & { current: () => WorkspaceCollection } {
  let stored = collection()
  const core = {
    ohlcv: { get: vi.fn(), refresh: vi.fn() },
    symbols: {
      search: vi.fn(async () => []),
      profile: vi.fn(async (symbol: string) =>
        symbol.toUpperCase() === 'XYZ'
          ? { symbol, name: symbol, exchange: '' }
          : { symbol: symbol.toUpperCase(), name: `${symbol} Inc.`, exchange: 'NASDAQ' })
    },
    quote: { get: vi.fn() },
    company: { info: vi.fn() },
    workspaces: {
      get: vi.fn(() => ({ collection: stored, rev: 1 })),
      set: vi.fn(),
      mutate: vi.fn((fn) => {
        const res = fn(stored)
        if (res.ok) stored = res.collection
        return res
      })
    },
    capabilities: { get: vi.fn() },
    cacheStatus: { summarize: vi.fn(() => []) },
    ...over
  } as unknown as ToolCore
  return Object.assign(core, { current: () => stored })
}

const tool = (core: ToolCore, name: string) => {
  const def = buildTools(core, () => NOW).find((t) => t.name === name)
  if (!def) throw new Error(`no tool named ${name}`)
  return def
}

describe('set_chart', () => {
  it('resolves the symbol and writes it into the cell', async () => {
    const core = fakeCore()
    const res = await tool(core, 'set_chart').handler({ cell: '1', symbol: 'amd' })
    expect(res.isError).toBeUndefined()
    expect(core.symbols.profile).toHaveBeenCalledTimes(1)
    expect(core.current().workspaces[0].layout.cells[0].symbol).toBe('AMD')
    expect(res.content[0].text).toContain('[1] AMD 1d')
  })

  it('rejects a symbol the profile lookup could not resolve', async () => {
    const core = fakeCore()
    const res = await tool(core, 'set_chart').handler({ cell: '1', symbol: 'XYZ' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe(
      'Could not resolve "XYZ" — check the ticker with search_symbols, or confirm the FMP API key is set.'
    )
    expect(core.workspaces.mutate).not.toHaveBeenCalled()
  })

  it('clears a cell without any profile lookup', async () => {
    const core = fakeCore()
    await tool(core, 'set_chart').handler({ cell: '1', symbol: null })
    expect(core.symbols.profile).not.toHaveBeenCalled()
    expect(core.current().workspaces[0].layout.cells[0].symbol).toBeNull()
  })

  it('needs at least one of symbol / timeframe', async () => {
    const res = await tool(fakeCore(), 'set_chart').handler({ cell: '1' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('Pass symbol, timeframe, or both.')
  })

  // MW-08/MW-09
  it('refuses a non-null symbol for cell "all"', async () => {
    const res = await tool(fakeCore(), 'set_chart').handler({ cell: 'all', symbol: 'AMD' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe(
      'cell: "all" cannot set a symbol — pass a cell id, or symbol: null to clear every chart.'
    )
  })

  it('warns when the target cell is off the visible grid', async () => {
    const core = fakeCore()
    const res = await tool(core, 'set_chart').handler({ cell: '3', symbol: 'AMD' })
    expect(res.content[0].text).toContain('call set_grid_layout to show it')
  })
})

describe('set_grid_layout', () => {
  it('resizes and lists the visible cells', async () => {
    const core = fakeCore()
    const res = await tool(core, 'set_grid_layout').handler({ rows: 1, cols: 2 })
    expect(core.current().workspaces[0].layout.shape).toEqual({ rows: 1, cols: 2 })
    expect(res.content[0].text).toContain('1 rows x 2 cols')
    expect(res.content[0].text).toContain('[1] NVDA 1d')
  })

  it('rejects an out-of-range grid', async () => {
    const res = await tool(fakeCore(), 'set_grid_layout').handler({ rows: 4, cols: 1 })
    expect(res.isError).toBe(true)
  })
})

describe('add_indicator', () => {
  it('fills the registry defaults when params are omitted', async () => {
    const core = fakeCore()
    const res = await tool(core, 'add_indicator').handler({ cell: '1', type: 'ma' })
    const added = core.current().workspaces[0].layout.cells[0].indicators[1]
    expect(added.params).toEqual({ kind: 'SMA', period: 20, source: 'close' })
    expect(res.content[0].text).toContain(`[${added.id}]`)
  })

  it('merges partial params over the defaults', async () => {
    const core = fakeCore()
    await tool(core, 'add_indicator').handler({ cell: '1', type: 'ma', params: { period: 50 } })
    const added = core.current().workspaces[0].layout.cells[0].indicators[1]
    expect(added.params).toEqual({ kind: 'SMA', period: 50, source: 'close' })
  })

  it('rejects an unknown type with the available list', async () => {
    const res = await tool(fakeCore(), 'add_indicator').handler({ cell: '1', type: 'sma' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('Unknown indicator "sma". Available:')
  })

  it('rejects a param value the FieldDesc forbids', async () => {
    const res = await tool(fakeCore(), 'add_indicator').handler({ cell: '1', type: 'ma', params: { kind: 'WMA' } })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('kind must be one of SMA, EMA.')
  })

  // MW-15
  it('rejects color inside params', async () => {
    const res = await tool(fakeCore(), 'add_indicator').handler({ cell: '1', type: 'ma', params: { color: '#fff' } })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('color is not a parameter — use the color argument of update_indicator.')
  })
})

describe('update_indicator', () => {
  it('writes the color to every output of the instance', async () => {
    const core = fakeCore()
    await tool(core, 'add_indicator').handler({ cell: '1', type: 'macd' })
    const id = core.current().workspaces[0].layout.cells[0].indicators[1].id
    await tool(core, 'update_indicator').handler({ indicator: id, color: '#123456' })
    const inst = core.current().workspaces[0].layout.cells[0].indicators[1]
    expect(inst.colors).toEqual({ macd: '#123456', signal: '#123456', histogram: '#123456' })
  })

  it('rejects a malformed color', async () => {
    const res = await tool(fakeCore(), 'update_indicator').handler({ indicator: '2', color: 'red' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('color must be a hex value like #1e90ff.')
  })

  it('needs at least one field to change', async () => {
    const res = await tool(fakeCore(), 'update_indicator').handler({ indicator: '2' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('Pass params, visible, or color.')
  })

  it('reports an unknown indicator id', async () => {
    const res = await tool(fakeCore(), 'update_indicator').handler({ indicator: '99', visible: false })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('No indicator "99". Use get_workspace to list indicator ids.')
  })
})

describe('remove_indicator', () => {
  it('says so when the only match was a fixed indicator', async () => {
    const core = fakeCore()
    const res = await tool(core, 'remove_indicator').handler({ indicator: '2' })
    expect(res.content[0].text).toContain('kept 1 fixed')
    expect(core.current().workspaces[0].layout.cells[0].indicators).toHaveLength(1)
  })

  it('requires exactly one of indicator / cell', async () => {
    const both = await tool(fakeCore(), 'remove_indicator').handler({ indicator: '2', cell: '1' })
    expect(both.isError).toBe(true)
    expect(both.content[0].text).toBe('Pass either indicator or cell, not both.')
    const neither = await tool(fakeCore(), 'remove_indicator').handler({})
    expect(neither.isError).toBe(true)
    expect(neither.content[0].text).toBe('Pass either indicator or cell.')
  })
})
