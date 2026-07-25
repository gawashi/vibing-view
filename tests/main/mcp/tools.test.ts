import { describe, it, expect, vi } from 'vitest'
import { buildTools, type ToolCore } from '../../../src/main/mcp/tools'
import { FmpHttpError } from '../../../src/main/providers/FmpProvider'
import type { Bar, WorkspaceCollection } from '@shared/types'

const at = (iso: string): number => Math.floor(Date.parse(iso) / 1000)
const bar = (time: number): Bar => ({ time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 })
const NOW = Date.parse('2026-07-25T00:00:00Z')

const days = (from: string, count: number): Bar[] =>
  Array.from({ length: count }, (_, i) => bar(at(`${from}T00:00:00Z`) + i * 86400))

const collection: WorkspaceCollection = {
  version: 3,
  active: 'Main',
  workspaces: [
    { name: 'Main', items: [], layout: { schemaVersion: 1, shape: { rows: 1, cols: 1 }, activeCellId: 'c1', cells: [{ id: 'c1', symbol: 'NVDA', timeframe: '1d', indicators: [] }] } },
    { name: 'Scratch', items: [], layout: { schemaVersion: 1, shape: { rows: 1, cols: 1 }, activeCellId: 'c2', cells: [{ id: 'c2', symbol: null, timeframe: '1d', indicators: [] }] } }
  ]
}

function fakeCore(over: Partial<ToolCore> = {}): ToolCore {
  return {
    ohlcv: {
      get: vi.fn(async () => ({ kind: 'ok' as const, bars: days('2026-01-01', 10), apiCalls: 0 })),
      refresh: vi.fn(async () => ({ kind: 'ok' as const, bars: days('2026-01-01', 10), apiCalls: 1 }))
    },
    symbols: { search: vi.fn(async () => []), profile: vi.fn() },
    quote: { get: vi.fn() },
    company: { info: vi.fn() },
    workspaces: { get: vi.fn(() => ({ collection, rev: 1 })), set: vi.fn() },
    capabilities: {
      get: vi.fn(() => ({ '1m': 'unknown', '5m': 'available', '15m': 'unknown', '1h': 'unknown', '1d': 'available', '1w': 'available', '1M': 'available' }) as const)
    },
    cacheStatus: { summarize: vi.fn(() => []) },
    ...over
  } as ToolCore
}

const tool = (core: ToolCore, name: string) => {
  const def = buildTools(core, () => NOW).find((t) => t.name === name)
  if (!def) throw new Error(`no tool named ${name}`)
  return def
}

describe('get_ohlcv range handling', () => {
  it('passes both bounds straight through', async () => {
    const core = fakeCore()
    await tool(core, 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '1d', from: '2026-01-01', to: '2026-01-05' })
    expect(core.ohlcv.get).toHaveBeenCalledWith('NVDA', '1d', { from: at('2026-01-01T00:00:00Z'), to: at('2026-01-05T00:00:00Z') })
  })

  it('fills `to` with now when only `from` is given and nothing is cached', async () => {
    const core = fakeCore()
    await tool(core, 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '1d', from: '2026-01-01' })
    expect(core.ohlcv.get).toHaveBeenCalledWith('NVDA', '1d', { from: at('2026-01-01T00:00:00Z'), to: Math.floor(NOW / 1000) })
  })

  // A right edge beyond coverage makes CacheService treat a fully-cached range as a miss and
  // refetch the entire history — every bar is always older than `now`, so a naive to=now would
  // burn one FMP request on EVERY lone-`from` call against an already-cached series.
  it('a range fully inside coverage costs zero provider calls even when `to` would be in the future', async () => {
    const core = fakeCore({
      cacheStatus: {
        summarize: vi.fn(() => [
          { symbol: 'NVDA', timeframe: '1d' as const, count: 10, oldestTime: at('2026-01-01T00:00:00Z'), newestTime: at('2026-01-10T00:00:00Z') }
        ])
      }
    } as Partial<ToolCore>)
    await tool(core, 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '1d', from: '2026-01-01' })
    expect(core.ohlcv.get).toHaveBeenCalledWith('NVDA', '1d', { from: at('2026-01-01T00:00:00Z'), to: at('2026-01-10T00:00:00Z') })
  })

  it('passes undefined when only `to` is given, and filters the output instead', async () => {
    const core = fakeCore()
    const res = await tool(core, 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '1d', to: '2026-01-03' })
    expect(core.ohlcv.get).toHaveBeenCalledWith('NVDA', '1d', undefined)
    expect(res.content[0].text).toContain('2026-01-03')
    expect(res.content[0].text).not.toContain('2026-01-04')
  })

  it('passes undefined when neither bound is given', async () => {
    const core = fakeCore()
    await tool(core, 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '1d' })
    expect(core.ohlcv.get).toHaveBeenCalledWith('NVDA', '1d', undefined)
  })

  it('rejects from > to', async () => {
    const core = fakeCore()
    const res = await tool(core, 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '1d', from: '2026-02-01', to: '2026-01-01' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('from must not be after to')
    expect(core.ohlcv.get).not.toHaveBeenCalled()
  })
})

describe('get_ohlcv output', () => {
  it('returns a summary line plus CSV', async () => {
    const res = await tool(fakeCore(), 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '1d' })
    const lines = res.content[0].text.split('\n')
    expect(lines[0]).toBe('NVDA 1d — 10 of 10 cached bars, 2026-01-01 to 2026-01-10 (cache hit, no API call)')
    expect(lines[1]).toBe('time,open,high,low,close,volume')
    expect(lines).toHaveLength(12)
  })

  it('limits to the newest bars without changing what was fetched', async () => {
    const core = fakeCore()
    const res = await tool(core, 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '1d', limit: 2 })
    expect(core.ohlcv.get).toHaveBeenCalledWith('NVDA', '1d', undefined) // limit never reaches the core
    const text = res.content[0].text
    expect(text).toContain('2 of 10 cached bars, 2026-01-09 to 2026-01-10')
    expect(text).not.toContain('2026-01-08')
  })

  it('caps an over-large limit and says so', async () => {
    const res = await tool(fakeCore(), 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '1d', limit: 9999 })
    expect(res.content[0].text).toContain('note: limit was capped at 2000 (requested 9999).')
  })

  it('routes force=true to refresh', async () => {
    const core = fakeCore()
    await tool(core, 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '1d', force: true })
    expect(core.ohlcv.refresh).toHaveBeenCalledWith('NVDA', '1d')
    expect(core.ohlcv.get).not.toHaveBeenCalled()
  })
})

describe('get_ohlcv error mapping', () => {
  const failWith = (outcome: unknown) => fakeCore({ ohlcv: { get: vi.fn(async () => outcome), refresh: vi.fn() } } as Partial<ToolCore>)

  it('maps out-of-plan', async () => {
    const res = await tool(failWith({ kind: 'out-of-plan' }), 'get_ohlcv').handler({ symbol: 'X', timeframe: '1d' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe("No data available — the symbol may be outside the current plan's coverage.")
  })

  it('maps unknown-symbol', async () => {
    const res = await tool(failWith({ kind: 'unknown-symbol' }), 'get_ohlcv').handler({ symbol: 'X', timeframe: '1d' })
    expect(res.content[0].text).toBe('No results. Use search_symbols to find the correct ticker.')
  })

  it('maps empty-range and quotes the cached coverage', async () => {
    const core = fakeCore({
      ohlcv: { get: vi.fn(async () => ({ kind: 'empty-range' as const })), refresh: vi.fn() },
      cacheStatus: { summarize: vi.fn(() => [{ symbol: 'NVDA', timeframe: '1d' as const, count: 5, oldestTime: at('2026-01-01T00:00:00Z'), newestTime: at('2026-01-05T00:00:00Z') }]) }
    } as Partial<ToolCore>)
    const res = await tool(core, 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '1d', from: '2020-01-01', to: '2020-02-01' })
    expect(res.content[0].text).toBe('No bars in that range. Cached coverage is 2026-01-01 to 2026-01-05.')
  })

  it('maps a missing API key', async () => {
    const core = fakeCore({ ohlcv: { get: vi.fn(async () => { throw new Error('NO_API_KEY') }), refresh: vi.fn() } } as Partial<ToolCore>)
    const res = await tool(core, 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '1d' })
    expect(res.content[0].text).toBe("FMP API key is not configured. Set it in Vibing View's settings dialog.")
  })

  it('maps a 402 on an intraday timeframe to a plan message', async () => {
    const core = fakeCore({ ohlcv: { get: vi.fn(async () => { throw new FmpHttpError(402, null) }), refresh: vi.fn() } } as Partial<ToolCore>)
    const res = await tool(core, 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '5m' })
    expect(res.content[0].text).toBe('This timeframe is not available on the current FMP plan.')
  })

  it('maps a 429 to the daily-limit message', async () => {
    const core = fakeCore({ ohlcv: { get: vi.fn(async () => { throw new FmpHttpError(429, null) }), refresh: vi.fn() } } as Partial<ToolCore>)
    const res = await tool(core, 'get_ohlcv').handler({ symbol: 'NVDA', timeframe: '1d' })
    expect(res.content[0].text).toBe('FMP daily request limit reached. Try again tomorrow.')
  })
})

describe('workspace tools', () => {
  it('get_workspaces lists them', async () => {
    const res = await tool(fakeCore(), 'get_workspaces').handler({})
    expect(res.content[0].text).toContain('Workspaces (2) — active: Main')
  })

  it('get_active_workspace details the active one', async () => {
    const res = await tool(fakeCore(), 'get_active_workspace').handler({})
    expect(res.content[0].text).toContain('Workspace: Main (active)')
  })

  it('get_workspace finds one by name', async () => {
    const res = await tool(fakeCore(), 'get_workspace').handler({ name: 'Scratch' })
    expect(res.content[0].text).toContain('Workspace: Scratch')
    expect(res.content[0].text).not.toContain('(active)')
  })

  it('get_workspace lists the available names on a miss', async () => {
    const res = await tool(fakeCore(), 'get_workspace').handler({ name: 'Nope' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('No workspace named "Nope". Available: Main, Scratch')
  })
})

describe('get_cache_status', () => {
  it('passes the symbol filter to the core', async () => {
    const core = fakeCore()
    await tool(core, 'get_cache_status').handler({ symbol: 'NVDA' })
    expect(core.cacheStatus.summarize).toHaveBeenCalledWith('NVDA')
  })
})
