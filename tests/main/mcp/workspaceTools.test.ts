import { describe, it, expect, vi } from 'vitest'
import { buildTools, type ToolCore } from '../../../src/main/mcp/tools'
import type { WorkspaceCollection } from '@shared/types'

const NOW = Date.parse('2026-07-26T00:00:00Z')

const collection = (): WorkspaceCollection => ({
  version: 3,
  active: 'Main',
  workspaces: [
    {
      name: 'Main',
      items: [{ symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ' }],
      layout: {
        schemaVersion: 1, shape: { rows: 1, cols: 1 }, activeCellId: '1',
        cells: [{ id: '1', symbol: 'NVDA', timeframe: '1d', indicators: [] }]
      }
    },
    {
      name: 'Other',
      items: [],
      layout: {
        schemaVersion: 1, shape: { rows: 1, cols: 1 }, activeCellId: '2',
        cells: [{ id: '2', symbol: null, timeframe: '1d', indicators: [] }]
      }
    }
  ]
})

function fakeCore(): ToolCore & { current: () => WorkspaceCollection } {
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
    cacheStatus: { summarize: vi.fn(() => []) }
  } as unknown as ToolCore
  return Object.assign(core, { current: () => stored })
}

const tool = (core: ToolCore, name: string) => {
  const def = buildTools(core, () => NOW).find((t) => t.name === name)
  if (!def) throw new Error(`no tool named ${name}`)
  return def
}

describe('edit_watchlist', () => {
  it('resolves and adds, then prints the new list', async () => {
    const core = fakeCore()
    const res = await tool(core, 'edit_watchlist').handler({ add: ['amd'] })
    expect(core.current().workspaces[0].items.map((i) => i.symbol)).toEqual(['NVDA', 'AMD'])
    expect(res.content[0].text).toContain('- AMD —')
  })

  it('removes by symbol, case-insensitively', async () => {
    const core = fakeCore()
    await tool(core, 'edit_watchlist').handler({ remove: ['nvda'] })
    expect(core.current().workspaces[0].items).toEqual([])
  })

  // MW-13: all-or-nothing, so a typo never half-applies.
  it('changes nothing when one added symbol cannot be resolved', async () => {
    const core = fakeCore()
    const res = await tool(core, 'edit_watchlist').handler({ add: ['AMD', 'XYZ'] })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('Could not resolve "XYZ"')
    expect(core.workspaces.mutate).not.toHaveBeenCalled()
    expect(core.current().workspaces[0].items.map((i) => i.symbol)).toEqual(['NVDA'])
  })

  it('needs at least one of add / remove', async () => {
    const res = await tool(fakeCore(), 'edit_watchlist').handler({})
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('Pass add, remove, or both.')
  })
})

describe('create_workspace', () => {
  it('creates and activates by default', async () => {
    const core = fakeCore()
    await tool(core, 'create_workspace').handler({ name: 'Fresh' })
    expect(core.current().active).toBe('Fresh')
  })

  it('copies an existing workspace', async () => {
    const core = fakeCore()
    await tool(core, 'create_workspace').handler({ name: 'Copy', copyFrom: 'Main', activate: false })
    const copy = core.current().workspaces.find((w) => w.name === 'Copy')!
    expect(copy.layout.cells[0].symbol).toBe('NVDA')
    expect(copy.layout.cells[0].id).not.toBe('1')
  })

  it('rejects a duplicate name', async () => {
    const res = await tool(fakeCore(), 'create_workspace').handler({ name: 'Other' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('A workspace named "Other" already exists.')
  })
})

describe('rename_workspace', () => {
  it('renames', async () => {
    const core = fakeCore()
    await tool(core, 'rename_workspace').handler({ from: 'Other', to: 'Scratch' })
    expect(core.current().workspaces.map((w) => w.name)).toEqual(['Main', 'Scratch'])
  })
})

describe('delete_workspace', () => {
  it('reports what was deleted', async () => {
    const core = fakeCore()
    const res = await tool(core, 'delete_workspace').handler({ name: 'Main' })
    const text = res.content[0].text
    expect(text).toContain('Deleted workspace "Main"')
    expect(text).toContain('1 cell')
    expect(text).toContain('NVDA')
    expect(text).toContain('1 watchlist symbol')
    expect(text).toContain('cannot be undone')
    expect(core.current().active).toBe('Other')
  })

  it('refuses to delete the last one', async () => {
    const core = fakeCore()
    await tool(core, 'delete_workspace').handler({ name: 'Other' })
    const res = await tool(core, 'delete_workspace').handler({ name: 'Main' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('Cannot delete the only workspace.')
  })
})

describe('activate_workspace', () => {
  it('switches the active workspace', async () => {
    const core = fakeCore()
    await tool(core, 'activate_workspace').handler({ name: 'Other' })
    expect(core.current().active).toBe('Other')
  })

  it('reports an unknown name with the available ones', async () => {
    const res = await tool(fakeCore(), 'activate_workspace').handler({ name: 'Nope' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('No workspace named "Nope". Available: Main, Other')
  })
})
