import React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import { useAppStore, selectActiveItems } from '@/store'
import { toggleWatchlist } from '@/lib/watchlist'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator
} from './ui/context-menu'

// The shared right-click menu for a chart cell. Wraps `children` (the cell's populated ChartPanel
// OR its empty placeholder) so both the grid (GridCell) and the enlarge window (ChartWindow) get an
// identical menu — including on empty cells, so a Paste (or paste-back after a Cut) has a target.
export function ChartContextMenu({ cellId, children }: { cellId: string; children: React.ReactNode }): React.JSX.Element {
  const queryClient = useQueryClient()
  const symbol = useAppStore((s) => s.cells.find((c) => c.id === cellId)?.symbol ?? null)
  const watched = useAppStore((s) => (symbol ? selectActiveItems(s).some((w) => w.symbol === symbol) : false))
  const hasClipboard = useAppStore((s) => s.chartClipboard !== null)
  const copyCell = useAppStore((s) => s.copyCell)
  const cutCell = useAppStore((s) => s.cutCell)
  const pasteCell = useAppStore((s) => s.pasteCell)
  const clearCell = useAppStore((s) => s.clearCell)

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
            <ContextMenuItem onSelect={() => symbol && toggleWatchlist(symbol, queryClient)}>
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
