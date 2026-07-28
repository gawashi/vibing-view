import { describe, it, expect, vi } from 'vitest'
import { createCore, type CoreDeps } from '../../../src/main/core'
import { CH } from '@shared/ipc'
import type { WorkspaceCollection } from '@shared/types'

const collection = (name: string): WorkspaceCollection => ({
  version: 3,
  active: name,
  workspaces: [{ name, items: [], layout: { schemaVersion: 1, cells: [], shape: { rows: 1, cols: 1 }, activeCellId: '1' } }]
})

function deps(over: Partial<CoreDeps> = {}): CoreDeps {
  const base: CoreDeps = {
    broadcast: vi.fn(),
    barStore: {
      getCoverage: vi.fn(() => null),
      getBars: vi.fn(() => []),
      upsertBarsAndCoverage: vi.fn(),
      summarizeBars: vi.fn(() => [
        { symbol: 'AAPL', timeframe: '1d' as const, count: 10, oldestTime: 1, newestTime: 2 },
        { symbol: 'NVDA', timeframe: '5m' as const, count: 20, oldestTime: 3, newestTime: 4 }
      ])
    },
    profileStore: { getProfile: vi.fn(() => null), upsertProfile: vi.fn() },
    companyProfileStore: { getCompanyProfile: vi.fn(() => null), upsertCompanyProfile: vi.fn() },
    economicDayStore: { getDays: vi.fn(() => []), upsertDays: vi.fn() },
    economicIndicatorStore: { getIndicator: vi.fn(() => null), upsertIndicator: vi.fn() },
    workspaceStore: { getWorkspaces: vi.fn(() => collection('W')), setWorkspaces: vi.fn() },
    capabilityCache: { getStatus: vi.fn(() => 'requires-plan' as const), setStatus: vi.fn(), clearForKeyChange: vi.fn() },
    keystore: {
      getApiKey: vi.fn(() => 'KEY'),
      setApiKey: vi.fn(() => ({ ok: true, encryptionAvailable: true })),
      getKeyStatus: vi.fn(() => ({ hasKey: true, encryptionAvailable: true })),
      clearApiKey: vi.fn()
    },
    makeProvider: vi.fn(() => ({
      getOHLCV: vi.fn(async () => []),
      searchSymbols: vi.fn(async () => [{ symbol: 'NVDA', name: 'NVIDIA', exchange: 'NASDAQ' }]),
      getQuote: vi.fn(async () => ({ price: 1, open: 1, dayHigh: 1, dayLow: 1, previousClose: 1, changePercentage: 0, timestamp: 0, exchange: 'NASDAQ' })),
      getMarketStatus: vi.fn(async () => ({ isOpen: true })),
      getCompanyProfile: vi.fn(),
      getEconomicCalendar: vi.fn(),
      getEconomicIndicator: vi.fn()
    })),
    nowSec: () => 1_000
  }
  return { ...base, ...over }
}

describe('core.symbols.search', () => {
  it('caches results and seeds the profile store', async () => {
    const d = deps()
    const core = createCore(d)

    const first = await core.symbols.search('nvda')
    const second = await core.symbols.search('NVDA ') // same key after trim+lowercase

    expect(first).toEqual([{ symbol: 'NVDA', name: 'NVIDIA', exchange: 'NASDAQ' }])
    expect(second).toEqual(first)
    expect(d.makeProvider).toHaveBeenCalledOnce() // second hit came from the 5-minute cache
    expect(d.profileStore.upsertProfile).toHaveBeenCalledWith({ symbol: 'NVDA', name: 'NVIDIA', exchange: 'NASDAQ' })
  })

  it('throws NO_API_KEY without a key', async () => {
    const d = deps()
    d.keystore.getApiKey = vi.fn(() => null)
    await expect(createCore(d).symbols.search('nvda')).rejects.toThrow('NO_API_KEY')
  })
})

describe('core.workspaces', () => {
  it('stamps a monotonic rev and broadcasts to everyone except the sender', () => {
    const d = deps()
    const core = createCore(d)
    const c = collection('Main')

    expect(core.workspaces.get().rev).toBe(0)
    core.workspaces.set(c, 7)

    expect(d.workspaceStore.setWorkspaces).toHaveBeenCalledWith(c)
    expect(d.broadcast).toHaveBeenCalledWith(CH.workspacesChanged, { collection: c, rev: 1 }, 7)
    expect(core.workspaces.get().rev).toBe(1)
  })
})

describe('core.clipboard', () => {
  it('holds the value, returns the authoritative rev, and broadcasts', () => {
    const d = deps()
    const core = createCore(d)
    const cell = { symbol: 'NVDA', timeframe: '1d' as const, indicators: [] }

    expect(core.clipboard.get()).toEqual({ clipboard: null, rev: 0 })
    expect(core.clipboard.set(cell, 3)).toBe(1)

    expect(d.broadcast).toHaveBeenCalledWith(CH.clipboardChanged, { clipboard: cell, rev: 1 }, 3)
    expect(core.clipboard.get()).toEqual({ clipboard: cell, rev: 1 })
  })
})

describe('core.capabilities.get', () => {
  it('always reports derived timeframes as available and consults the cache for the rest', () => {
    const core = createCore(deps())
    expect(core.capabilities.get()).toEqual({
      '1m': 'requires-plan', '5m': 'requires-plan', '15m': 'requires-plan', '1h': 'requires-plan',
      '1d': 'requires-plan', '1w': 'available', '1M': 'available'
    })
  })

  it('reports unknown for real timeframes when there is no API key', () => {
    const d = deps()
    d.keystore.getApiKey = vi.fn(() => null)
    expect(createCore(d).capabilities.get()['1d']).toBe('unknown')
  })
})

describe('core.cacheStatus.summarize', () => {
  it('returns every series when no symbol is given', () => {
    expect(createCore(deps()).cacheStatus.summarize()).toHaveLength(2)
  })

  it('filters to one symbol, case-insensitively', () => {
    const rows = createCore(deps()).cacheStatus.summarize('nvda')
    expect(rows.map((r) => r.symbol)).toEqual(['NVDA'])
  })
})

describe('core.quote / core.market', () => {
  it('reaches the provider directly (never the SQLite cache)', async () => {
    const core = createCore(deps())
    expect((await core.quote.get('NVDA')).price).toBe(1)
    expect(await core.market.status()).toEqual({ isOpen: true })
  })
})
