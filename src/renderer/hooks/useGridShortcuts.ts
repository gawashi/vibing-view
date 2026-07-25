import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/store'
import { toggleWatchlist } from '@/lib/watchlist'
import { handleGridShortcut } from '@/lib/gridShortcuts'

// Mounts the single main-window keydown listener. `reload` is App's local closure, so it's passed
// in and kept in a ref to avoid re-subscribing on every App render.
export function useGridShortcuts(reload: () => void): void {
  const queryClient = useQueryClient()
  const reloadRef = useRef(reload)
  reloadRef.current = reload

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const store = useAppStore.getState()
      const handled = handleGridShortcut(e, {
        reload: () => reloadRef.current(),
        copyCell: store.copyCell,
        cutCell: store.cutCell,
        pasteCell: store.pasteCell,
        clearCell: store.clearCell,
        toggleWatchlist: (sym) => toggleWatchlist(sym, queryClient),
        getActiveCellId: () => useAppStore.getState().activeCellId,
        getActiveSymbol: () => {
          const s = useAppStore.getState()
          return s.cells.find((c) => c.id === s.activeCellId)?.symbol ?? null
        },
        hasSelection: () => (window.getSelection()?.toString().length ?? 0) > 0
      })
      if (handled) e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [queryClient])
}
