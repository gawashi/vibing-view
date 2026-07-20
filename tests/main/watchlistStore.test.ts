import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { WatchlistItem, WatchlistCollection } from '@shared/types'

let userDataDir: string

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir }
}))

const watchlistStore = await import('../../src/main/watchlistStore')

const aapl: WatchlistItem = { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }
const msft: WatchlistItem = { symbol: 'MSFT', name: 'Microsoft Corp.', exchange: 'NASDAQ' }

describe('watchlistStore (collection)', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'watchliststore-test-'))
  })
  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('returns a default single "Watchlist" before anything is saved', () => {
    expect(watchlistStore.getWatchlists()).toEqual({
      version: 2,
      active: 'Watchlist',
      lists: [{ name: 'Watchlist', items: [] }]
    })
  })

  it('migrates an old flat-array watchlist.json into the default list', () => {
    writeFileSync(join(userDataDir, 'watchlist.json'), JSON.stringify([aapl, msft]))
    expect(watchlistStore.getWatchlists()).toEqual({
      version: 2,
      active: 'Watchlist',
      lists: [{ name: 'Watchlist', items: [aapl, msft] }]
    })
  })

  it('drops malformed items during migration instead of throwing', () => {
    writeFileSync(
      join(userDataDir, 'watchlist.json'),
      JSON.stringify([aapl, { symbol: 'BAD' }, null, 'nonsense'])
    )
    expect(watchlistStore.getWatchlists().lists[0].items).toEqual([aapl])
  })

  it('round-trips a v2 collection through set → get', () => {
    const c: WatchlistCollection = {
      version: 2,
      active: 'Tech',
      lists: [
        { name: 'Watchlist', items: [aapl] },
        { name: 'Tech', items: [msft] }
      ]
    }
    watchlistStore.setWatchlists(c)
    expect(watchlistStore.getWatchlists()).toEqual(c)
  })

  it('falls back to active=first list when stored active name is missing', () => {
    watchlistStore.setWatchlists({ version: 2, active: 'Gone', lists: [{ name: 'Watchlist', items: [] }] })
    expect(watchlistStore.getWatchlists().active).toBe('Watchlist')
  })

  it('falls back to the default collection when watchlist.json is corrupt', () => {
    writeFileSync(join(userDataDir, 'watchlist.json'), '{not valid json')
    expect(() => watchlistStore.getWatchlists()).not.toThrow()
    expect(watchlistStore.getWatchlists().lists).toEqual([{ name: 'Watchlist', items: [] }])
  })

  it('yields a default list when the stored collection has zero lists', () => {
    watchlistStore.setWatchlists({ version: 2, active: 'x', lists: [] })
    expect(watchlistStore.getWatchlists().lists).toEqual([{ name: 'Watchlist', items: [] }])
  })
})
