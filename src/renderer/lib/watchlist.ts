import type { QueryClient } from '@tanstack/react-query'
import { qk } from '@/api'
import { useAppStore, selectActiveItems } from '@/store'
import type { SymbolResult } from '@shared/types'

// Single source of truth for "toggle this symbol in the active workspace's watchlist".
// Shared by FavoriteStar, ChartContextMenu, and the keyboard shortcut so all three stay in sync.
// Profile name/exchange are read from the query cache (SymbolLabel already populates it) — no fetch.
export function toggleWatchlist(symbol: string, queryClient: QueryClient): void {
  const state = useAppStore.getState()
  const watched = selectActiveItems(state).some((w) => w.symbol === symbol)
  if (watched) {
    state.removeFromWatchlist(symbol)
  } else {
    const p = queryClient.getQueryData<SymbolResult>(qk.profile(symbol))
    state.addToWatchlist({ symbol, name: p?.name ?? symbol, exchange: p?.exchange ?? '' })
  }
}
