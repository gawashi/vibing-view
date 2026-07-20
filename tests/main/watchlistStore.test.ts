import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { WatchlistItem } from '@shared/types'

let userDataDir: string

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir }
}))

const watchlistStore = await import('../../src/main/watchlistStore')

const items: WatchlistItem[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', exchange: 'NASDAQ' }
]

describe('watchlistStore', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'watchliststore-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('getWatchlist returns [] before anything is ever saved', () => {
    expect(watchlistStore.getWatchlist()).toEqual([])
  })

  it('round-trips items through setWatchlist → getWatchlist', () => {
    watchlistStore.setWatchlist(items)
    expect(watchlistStore.getWatchlist()).toEqual(items)
  })

  it('leaves no residual .tmp file after a write', () => {
    watchlistStore.setWatchlist(items)
    expect(existsSync(join(userDataDir, 'watchlist.json.tmp'))).toBe(false)
    expect(existsSync(join(userDataDir, 'watchlist.json'))).toBe(true)
  })

  it('is stored separately from layouts.json', () => {
    watchlistStore.setWatchlist(items)
    expect(existsSync(join(userDataDir, 'layouts.json'))).toBe(false)
  })

  it('falls back to [] (never throws) when watchlist.json is corrupt', () => {
    writeFileSync(join(userDataDir, 'watchlist.json'), '{not valid json')
    expect(() => watchlistStore.getWatchlist()).not.toThrow()
    expect(watchlistStore.getWatchlist()).toEqual([])
  })

  it('drops malformed entries instead of throwing', () => {
    writeFileSync(
      join(userDataDir, 'watchlist.json'),
      JSON.stringify([{ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }, { symbol: 'BAD' }, 'nonsense', null])
    )
    expect(watchlistStore.getWatchlist()).toEqual([{ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }])
  })
})
