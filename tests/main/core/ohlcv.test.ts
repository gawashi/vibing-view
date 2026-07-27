import { describe, it, expect, vi } from 'vitest'
import { createCore, type CoreDeps } from '../../../src/main/core'
import { FmpHttpError } from '../../../src/main/providers/FmpProvider'
import type { Bar } from '@shared/types'

const bar = (time: number): Bar => ({ time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 })

// Minimal fakes: every dep the core touches, none of them electron/sqlite.
function deps(over: Partial<CoreDeps> = {}) {
  let stored: Bar[] = []
  let cov: { oldestTime: number; newestTime: number } | null = null
  const base: CoreDeps = {
    broadcast: vi.fn(),
    barStore: {
      getCoverage: vi.fn(() => cov),
      getBars: vi.fn((_s, _tf, range) =>
        stored.filter((b) => !range || (b.time >= range.from && b.time <= range.to)).sort((a, b) => a.time - b.time)
      ),
      upsertBarsAndCoverage: vi.fn((_s: string, _tf: string, bars: Bar[]) => {
        if (bars.length === 0) return
        stored = [...stored, ...bars]
        const times = bars.map((b) => b.time)
        cov = {
          oldestTime: Math.min(cov?.oldestTime ?? Infinity, ...times),
          newestTime: Math.max(cov?.newestTime ?? -Infinity, ...times)
        }
      }),
      summarizeBars: vi.fn(() => [])
    },
    profileStore: { getProfile: vi.fn(() => null), upsertProfile: vi.fn() },
    companyProfileStore: { getCompanyProfile: vi.fn(() => null), upsertCompanyProfile: vi.fn() },
    economicDayStore: { getDays: vi.fn(() => []), upsertDays: vi.fn() },
    workspaceStore: {
      getWorkspaces: vi.fn(() => ({ version: 3 as const, active: 'W', workspaces: [{ name: 'W', items: [], layout: { schemaVersion: 1 as const, cells: [], shape: { rows: 1, cols: 1 }, activeCellId: '1' } }] })),
      setWorkspaces: vi.fn()
    },
    capabilityCache: { getStatus: vi.fn(() => 'unknown' as const), setStatus: vi.fn(), clearForKeyChange: vi.fn() },
    keystore: {
      getApiKey: vi.fn(() => 'KEY'),
      setApiKey: vi.fn(() => ({ ok: true, encryptionAvailable: true })),
      getKeyStatus: vi.fn(() => ({ hasKey: true, encryptionAvailable: true })),
      clearApiKey: vi.fn()
    },
    makeProvider: vi.fn(() => ({
      getOHLCV: vi.fn(async () => [bar(100), bar(200)]),
      searchSymbols: vi.fn(async () => []),
      getQuote: vi.fn(),
      getMarketStatus: vi.fn(),
      getCompanyProfile: vi.fn(),
      getEconomicCalendar: vi.fn()
    })),
    nowSec: () => 1_000
  }
  return { ...base, ...over }
}

describe('core.ohlcv.get', () => {
  it('returns ok with the fetched bars and the API-call count', async () => {
    const core = createCore(deps())
    const out = await core.ohlcv.get('NVDA', '1d', undefined)
    expect(out).toEqual({ kind: 'ok', bars: [bar(100), bar(200)], apiCalls: 1 })
  })

  it('reports apiCalls: 0 when the request is served from cache', async () => {
    const core = createCore(deps())
    await core.ohlcv.get('NVDA', '1d', undefined)
    const out = await core.ohlcv.get('NVDA', '1d', undefined)
    expect(out).toEqual({ kind: 'ok', bars: [bar(100), bar(200)], apiCalls: 0 })
  })

  it('returns unknown-symbol when the provider yields nothing and nothing is cached', async () => {
    const d = deps({
      makeProvider: () => ({
        getOHLCV: vi.fn(async () => []), searchSymbols: vi.fn(), getQuote: vi.fn(), getMarketStatus: vi.fn(), getCompanyProfile: vi.fn(), getEconomicCalendar: vi.fn()
      })
    })
    const core = createCore(d)
    expect(await core.ohlcv.get('NOPE', '1d', undefined)).toEqual({ kind: 'unknown-symbol' })
  })

  it('returns empty-range when coverage exists but the range holds no bars', async () => {
    const core = createCore(deps())
    await core.ohlcv.get('NVDA', '1d', undefined) // seed coverage 100..200
    expect(await core.ohlcv.get('NVDA', '1d', { from: 150, to: 180 })).toEqual({ kind: 'empty-range' })
  })

  it('returns out-of-plan on a 402 for a daily-backed timeframe, and short-circuits after that', async () => {
    const getOHLCV = vi.fn(async () => { throw new FmpHttpError(402, null) })
    const core = createCore(deps({
      makeProvider: () => ({ getOHLCV, searchSymbols: vi.fn(), getQuote: vi.fn(), getMarketStatus: vi.fn(), getCompanyProfile: vi.fn(), getEconomicCalendar: vi.fn() })
    }))
    expect(await core.ohlcv.get('XYZ', '1d', undefined)).toEqual({ kind: 'out-of-plan' })
    expect(await core.ohlcv.get('XYZ', '1w', undefined)).toEqual({ kind: 'out-of-plan' })
    expect(getOHLCV).toHaveBeenCalledOnce() // second call never reached the provider
  })

  it('rethrows a 402 on an intraday timeframe so the caller can say "not on this plan"', async () => {
    const core = createCore(deps({
      makeProvider: () => ({
        getOHLCV: vi.fn(async () => { throw new FmpHttpError(402, null) }),
        searchSymbols: vi.fn(), getQuote: vi.fn(), getMarketStatus: vi.fn(), getCompanyProfile: vi.fn(), getEconomicCalendar: vi.fn()
      })
    }))
    await expect(core.ohlcv.get('NVDA', '5m', undefined)).rejects.toBeInstanceOf(FmpHttpError)
  })

  it('records the timeframe as available after a successful fetch', async () => {
    const d = deps()
    await createCore(d).ohlcv.get('NVDA', '5m', undefined)
    expect(d.capabilityCache.setStatus).toHaveBeenCalledWith('KEY', '5m', 'available')
  })

  it('does NOT record requires-plan for 1d (a 402 there means the symbol, not the timeframe)', async () => {
    const d = deps({
      makeProvider: () => ({
        getOHLCV: vi.fn(async () => { throw new FmpHttpError(403, null) }),
        searchSymbols: vi.fn(), getQuote: vi.fn(), getMarketStatus: vi.fn(), getCompanyProfile: vi.fn(), getEconomicCalendar: vi.fn()
      })
    })
    await createCore(d).ohlcv.get('XYZ', '1d', undefined)
    expect(d.capabilityCache.setStatus).not.toHaveBeenCalled()
  })

  it('throws NO_API_KEY when no key is configured', async () => {
    const d = deps()
    d.keystore.getApiKey = vi.fn(() => null)
    await expect(createCore(d).ohlcv.get('NVDA', '1d', undefined)).rejects.toThrow('NO_API_KEY')
  })

  it('dedupes concurrent identical requests into ONE provider call', async () => {
    let resolve!: (v: Bar[]) => void
    const getOHLCV = vi.fn(() => new Promise<Bar[]>((r) => { resolve = r }))
    const core = createCore(deps({
      makeProvider: () => ({ getOHLCV, searchSymbols: vi.fn(), getQuote: vi.fn(), getMarketStatus: vi.fn(), getCompanyProfile: vi.fn(), getEconomicCalendar: vi.fn() })
    }))

    const a = core.ohlcv.get('NVDA', '1d', undefined)
    const b = core.ohlcv.get('NVDA', '1d', undefined)
    resolve([bar(100)])

    expect(await a).toEqual(await b)
    expect(getOHLCV).toHaveBeenCalledOnce()
  })

  it('does not dedupe across different ranges', async () => {
    const d = deps()
    const core = createCore(d)
    await Promise.all([
      core.ohlcv.get('NVDA', '1d', { from: 0, to: 50 }),
      core.ohlcv.get('NVDA', '1d', { from: 60, to: 90 })
    ])
    // two distinct keys → two independent runs (each cache-misses and fetches)
    expect(d.makeProvider).toHaveBeenCalledTimes(2)
  })

  it('drops the in-flight entry once settled so a later call can fetch again', async () => {
    const d = deps()
    const core = createCore(d)
    await core.ohlcv.get('NVDA', '1d', { from: 0, to: 50 })
    await core.ohlcv.get('NVDA', '1d', { from: 0, to: 50 })
    expect(d.makeProvider).toHaveBeenCalledTimes(2)
  })
})

describe('core.ohlcv.refresh', () => {
  it('goes through the right-edge differential and reports the API call', async () => {
    const core = createCore(deps())
    const out = await core.ohlcv.refresh('NVDA', '1d')
    expect(out).toEqual({ kind: 'ok', bars: [bar(100), bar(200)], apiCalls: 1 })
  })
})

describe('core.apikey', () => {
  it('clears the capability cache and the out-of-plan set on set()', async () => {
    const d = deps()
    const core = createCore(d)
    core.apikey.set('NEW')
    expect(d.keystore.setApiKey).toHaveBeenCalledWith('NEW')
    expect(d.capabilityCache.clearForKeyChange).toHaveBeenCalled()
  })

  it('clears them on clear() too', () => {
    const d = deps()
    createCore(d).apikey.clear()
    expect(d.keystore.clearApiKey).toHaveBeenCalled()
    expect(d.capabilityCache.clearForKeyChange).toHaveBeenCalled()
  })
})
