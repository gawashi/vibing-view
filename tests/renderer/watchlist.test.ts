import { describe, it, expect, beforeEach } from 'vitest'
import { toggleWatchlist } from '../../src/renderer/lib/watchlist'
import { useAppStore, selectActiveItems } from '../../src/renderer/store'
import { qk } from '../../src/renderer/api'

// Minimal fake QueryClient — only getQueryData is used by toggleWatchlist.
function fakeQueryClient(profiles: Record<string, { name: string; exchange: string }>) {
  return {
    getQueryData: (key: readonly unknown[]) => {
      // qk.profile(sym) shape: match on the symbol appearing in the key
      const sym = key[key.length - 1] as string
      return profiles[sym]
    }
  } as any
}

describe('toggleWatchlist', () => {
  beforeEach(() => {
    const s = useAppStore.getState()
    // clear the active workspace's items
    useAppStore.setState({
      workspaces: s.workspaces.map((w) =>
        w.name === s.activeWorkspace ? { ...w, items: [] } : w
      )
    })
  })

  it('adds with profile name/exchange from the query cache when not watched', () => {
    const qc = fakeQueryClient({ AAPL: { name: 'Apple Inc.', exchange: 'NASDAQ' } })
    toggleWatchlist('AAPL', qc)
    const items = selectActiveItems(useAppStore.getState())
    expect(items).toContainEqual({ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' })
  })

  it('falls back to symbol/empty exchange when profile not cached', () => {
    const qc = fakeQueryClient({})
    toggleWatchlist('TSLA', qc)
    const items = selectActiveItems(useAppStore.getState())
    expect(items).toContainEqual({ symbol: 'TSLA', name: 'TSLA', exchange: '' })
  })

  it('removes when already watched', () => {
    const qc = fakeQueryClient({})
    toggleWatchlist('TSLA', qc) // add
    toggleWatchlist('TSLA', qc) // remove
    const items = selectActiveItems(useAppStore.getState())
    expect(items.some((i) => i.symbol === 'TSLA')).toBe(false)
  })

  // Guards against key-shape drift: the helper must read the same cache key SymbolLabel writes.
  it('reads the profile under qk.profile(symbol)', () => {
    expect(qk.profile('AAPL')[qk.profile('AAPL').length - 1]).toBe('AAPL')
  })
})
