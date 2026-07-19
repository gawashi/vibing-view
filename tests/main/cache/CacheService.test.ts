import { describe, it, expect, vi } from 'vitest'
import { createCacheService } from '../../../src/main/cache/CacheService'
import type { Bar } from '@shared/types'

const bar = (time: number): Bar => ({ time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 })

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
})
