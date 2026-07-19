import { describe, it, expect, vi } from 'vitest'
import { createCacheService } from '../../../src/main/cache/CacheService'
import { deriveWeekly, deriveMonthly } from '../../../src/main/aggregate'
import type { Bar } from '@shared/types'

const bar = (time: number): Bar => ({ time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 })

const day = (dateStr: string): number => Math.floor(Date.parse(`${dateStr}T00:00:00Z`) / 1000)

function fakeStore(initialBars: Bar[] = [], cov: { oldestTime: number; newestTime: number } | null = null) {
  let stored = [...initialBars]
  let coverage = cov
  return {
    getCoverage: vi.fn(() => coverage),
    getBars: vi.fn(() => [...stored].sort((a, b) => a.time - b.time)),
    upsertBarsAndCoverage: vi.fn((_s: string, _tf: string, bars: Bar[]) => {
      stored = bars
      coverage = { oldestTime: Math.min(...bars.map((b) => b.time)), newestTime: Math.max(...bars.map((b) => b.time)) }
    })
  }
}

describe('CacheService.getOHLCV', () => {
  it('fetches from provider and writes cache on a miss (no coverage)', async () => {
    const store = fakeStore()
    const provider = { getOHLCV: vi.fn(async () => [bar(100), bar(200)]), searchSymbols: vi.fn() }
    const svc = createCacheService({ provider, store })

    const bars = await svc.getOHLCV('AAPL', '1d', undefined)

    expect(provider.getOHLCV).toHaveBeenCalledOnce()
    expect(store.upsertBarsAndCoverage).toHaveBeenCalledOnce()
    expect(bars.map((b) => b.time)).toEqual([100, 200])
  })

  it('serves from cache with NO provider call when coverage exists (undefined range)', async () => {
    const store = fakeStore([bar(100), bar(200)], { oldestTime: 100, newestTime: 200 })
    const provider = { getOHLCV: vi.fn(), searchSymbols: vi.fn() }
    const svc = createCacheService({ provider, store })

    const bars = await svc.getOHLCV('AAPL', '1d', undefined)

    expect(provider.getOHLCV).not.toHaveBeenCalled()
    expect(bars.map((b) => b.time)).toEqual([100, 200])
  })

  it('serves from cache when requested range is inside coverage', async () => {
    const store = fakeStore([bar(100), bar(150), bar(200)], { oldestTime: 100, newestTime: 200 })
    const provider = { getOHLCV: vi.fn(), searchSymbols: vi.fn() }
    const svc = createCacheService({ provider, store })

    await svc.getOHLCV('AAPL', '1d', { from: 120, to: 180 })

    expect(provider.getOHLCV).not.toHaveBeenCalled()
  })

  it('fetches only the missing left sub-range when coverage exists but not to the left (D-16)', async () => {
    const store = fakeStore([bar(200), bar(300)], { oldestTime: 200, newestTime: 300 })
    const provider = { getOHLCV: vi.fn(async () => [bar(100)]), searchSymbols: vi.fn() }
    const svc = createCacheService({ provider, store })

    await svc.getOHLCV('AAPL', '1d', { from: 100, to: 300 })

    expect(provider.getOHLCV).toHaveBeenCalledOnce()
    expect(provider.getOHLCV).toHaveBeenCalledWith('AAPL', '1d', { from: 100, to: 199 })
  })

  it('falls back to a full fetch (not an inverted range) on a right-edge-only miss', async () => {
    const store = fakeStore([bar(100), bar(200)], { oldestTime: 100, newestTime: 200 })
    const provider = { getOHLCV: vi.fn(async () => [bar(300)]), searchSymbols: vi.fn() }
    const svc = createCacheService({ provider, store })

    await svc.getOHLCV('AAPL', '1d', { from: 100, to: 300 })

    expect(provider.getOHLCV).toHaveBeenCalledOnce()
    expect(provider.getOHLCV).toHaveBeenCalledWith('AAPL', '1d', undefined)
  })

  it('derives \'1w\' from cached daily bars with NO provider call', async () => {
    const dailyBars = [
      { time: day('2024-01-01'), open: 10, high: 12, low: 9, close: 11, volume: 100 },
      { time: day('2024-01-05'), open: 9, high: 16, low: 6, close: 18, volume: 500 }
    ]
    const store = fakeStore(dailyBars, { oldestTime: dailyBars[0].time, newestTime: dailyBars[1].time })
    const provider = { getOHLCV: vi.fn(), searchSymbols: vi.fn() }
    const svc = createCacheService({ provider, store })

    const bars = await svc.getOHLCV('AAPL', '1w', undefined)

    expect(provider.getOHLCV).not.toHaveBeenCalled()
    expect(store.upsertBarsAndCoverage).not.toHaveBeenCalled()
    expect(bars).toEqual(deriveWeekly(dailyBars))
  })

  it('derives \'1M\' from cached daily bars with NO provider call', async () => {
    const dailyBars = [
      { time: day('2024-01-01'), open: 10, high: 12, low: 9, close: 11, volume: 100 },
      { time: day('2024-02-01'), open: 9, high: 16, low: 6, close: 18, volume: 500 }
    ]
    const store = fakeStore(dailyBars, { oldestTime: dailyBars[0].time, newestTime: dailyBars[1].time })
    const provider = { getOHLCV: vi.fn(), searchSymbols: vi.fn() }
    const svc = createCacheService({ provider, store })

    const bars = await svc.getOHLCV('AAPL', '1M', undefined)

    expect(provider.getOHLCV).not.toHaveBeenCalled()
    expect(store.upsertBarsAndCoverage).not.toHaveBeenCalled()
    expect(bars).toEqual(deriveMonthly(dailyBars))
  })

  it('fetches daily once then derives \'1w\' when no daily coverage exists yet', async () => {
    const dailyBars = [
      { time: day('2024-01-01'), open: 10, high: 12, low: 9, close: 11, volume: 100 },
      { time: day('2024-01-05'), open: 9, high: 16, low: 6, close: 18, volume: 500 }
    ]
    const store = fakeStore() // no coverage yet
    const provider = { getOHLCV: vi.fn(async () => dailyBars), searchSymbols: vi.fn() }
    const svc = createCacheService({ provider, store })

    const bars = await svc.getOHLCV('AAPL', '1w', undefined)

    expect(provider.getOHLCV).toHaveBeenCalledOnce()
    expect(provider.getOHLCV).toHaveBeenCalledWith('AAPL', '1d', undefined)
    expect(bars).toEqual(deriveWeekly(dailyBars))
  })
})
