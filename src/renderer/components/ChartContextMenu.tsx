import React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, qk } from '@/api'
import { useAppStore, selectActiveItems } from '@/store'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator
} from './ui/context-menu'
import type { SymbolResult } from '@shared/types'

// The shared right-click menu for a chart cell. Wraps `children` (the cell's populated ChartPanel
// OR its empty placeholder) so both the grid (GridCell) and the enlarge window (ChartWindow) get an
// identical menu — including on empty cells, so a Paste (or paste-back after a Cut) has a target.
export function ChartContextMenu({ cellId, children }: { cellId: string; children: React.ReactNode }): React.JSX.Element {
  const queryClient = useQueryClient()
  const symbol = useAppStore((s) => s.cells.find((c) => c.id === cellId)?.symbol ?? null)
  const watched = useAppStore((s) => (symbol ? selectActiveItems(s).some((w) => w.symbol === symbol) : false))
  const hasClipboard = useAppStore((s) => s.chartClipboard !== null)
  const addToWatchlist = useAppStore((s) => s.addToWatchlist)
  const removeFromWatchlist = useAppStore((s) => s.removeFromWatchlist)
  const copyCell = useAppStore((s) => s.copyCell)
  const cutCell = useAppStore((s) => s.cutCell)
  const pasteCell = useAppStore((s) => s.pasteCell)
  const clearCell = useAppStore((s) => s.clearCell)

  const toggleWatchlist = (): void => {
    if (!symbol) return
    if (watched) {
      removeFromWatchlist(symbol)
    } else {
      // Reuse the same profile→name/exchange fallback as FavoriteStar. The profile is virtually
      // always already cached (SymbolLabel renders it), so read it from the query cache — no fetch.
      const p = queryClient.getQueryData<SymbolResult>(qk.profile(symbol))
      addToWatchlist({ symbol, name: p?.name ?? symbol, exchange: p?.exchange ?? '' })
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {symbol && (
          <>
            <ContextMenuItem onSelect={() => void api.company.openWindow(symbol)}>
              Show company info
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={toggleWatchlist}>
              {watched ? 'Remove from watchlist' : 'Add to watchlist'}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem disabled={!symbol} onSelect={() => copyCell(cellId)}>Copy chart</ContextMenuItem>
        <ContextMenuItem disabled={!symbol} onSelect={() => cutCell(cellId)}>Cut chart</ContextMenuItem>
        <ContextMenuItem disabled={!hasClipboard} onSelect={() => pasteCell(cellId)}>Paste chart</ContextMenuItem>
        {symbol && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => clearCell(cellId)}>Remove from chart</ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
