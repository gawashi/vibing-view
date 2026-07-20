import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { GripVertical, X } from 'lucide-react'
import { api, qk } from '@/api'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import type { Bar, WatchlistItem } from '@shared/types'

function Row({
  item,
  index,
  isOver,
  setOverIndex
}: {
  item: WatchlistItem
  index: number
  isOver: boolean
  setOverIndex: (i: number | null) => void
}): React.JSX.Element {
  const setActiveSymbol = useAppStore((s) => s.setActiveSymbol)
  const removeFromWatchlist = useAppStore((s) => s.removeFromWatchlist)

  // Cached-only latest close (D-64) — `enabled: false` means queryFn is NEVER called (no fetch,
  // ever), but the observer still subscribes to this key's cache entry, so the row re-renders when
  // Chart/GridHost later populates it (unlike a bare getQueryData() read, which is a one-shot with
  // no subscription and would stay stuck blank until an unrelated re-render).
  const { data: bars } = useQuery<Bar[]>({
    queryKey: qk.ohlcv(item.symbol, '1d'),
    queryFn: () => api.ohlcv.get(item.symbol, '1d', undefined),
    enabled: false,
    staleTime: Infinity
  })
  const lastClose = bars && bars.length > 0 ? bars[bars.length - 1].close : undefined

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={() => setActiveSymbol(item.symbol)}
      onKeyDown={(e) => { if (e.key === 'Enter') setActiveSymbol(item.symbol) }}
      // Whole row is the drop target — dragOver must preventDefault or the browser shows the
      // not-allowed cursor and never fires drop. Drag is only *initiated* from the grip (D-66).
      onDragOver={(e) => { e.preventDefault(); setOverIndex(index) }}
      onDrop={(e) => {
        e.preventDefault()
        const from = Number(e.dataTransfer.getData('text/plain'))
        if (!Number.isNaN(from) && index >= 0) useAppStore.getState().reorderWatchlist(from, index)
        setOverIndex(null)
      }}
      // border-t-2 always reserved (transparent) so the accent insertion marker never shifts layout.
      className={cn(
        'group flex items-center gap-1 border-t-2 border-transparent px-2 py-2 hover:bg-secondary',
        isOver && 'border-primary'
      )}
    >
      <span
        draggable
        onDragStart={(e) => {
          e.stopPropagation()
          const from = useAppStore.getState().watchlist.findIndex((w) => w.symbol === item.symbol)
          e.dataTransfer.setData('text/plain', String(from))
        }}
        onDragEnd={() => setOverIndex(null)}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Reorder ${item.symbol}`}
        className="invisible shrink-0 cursor-grab text-muted-foreground group-hover:visible"
      >
        <GripVertical className="size-4" />
      </span>
      <span className="font-semibold">{item.symbol}</span>
      <span className="truncate text-xs text-muted-foreground" title={item.name}>{item.name}</span>
      <span className="ml-auto shrink-0 text-sm">{lastClose !== undefined ? lastClose.toFixed(2) : ''}</span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          removeFromWatchlist(item.symbol)
        }}
        aria-label={`Remove ${item.symbol} from watchlist`}
        className="invisible shrink-0 text-muted-foreground hover:text-destructive group-hover:visible"
      >
        <X className="size-4" />
      </button>
    </li>
  )
}

export function Watchlist({ open }: { open: boolean }): React.JSX.Element {
  const watchlist = useAppStore((s) => s.watchlist)
  const [overIndex, setOverIndex] = React.useState<number | null>(null)

  return (
    <aside
      className={cn(
        'h-full overflow-hidden border-r border-border bg-background transition-[width]',
        open ? 'w-[240px]' : 'w-0'
      )}
    >
      <div className="h-full w-[240px] overflow-y-auto">
        {watchlist.length === 0
          ? (
            <div className="p-2 text-sm text-muted-foreground">
              Your watchlist is empty. Add symbols from search results.
            </div>
            )
          : (
            <ul onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverIndex(null) }}>
              {watchlist.map((item, i) => (
                <Row
                  key={item.symbol}
                  item={item}
                  index={i}
                  isOver={overIndex === i}
                  setOverIndex={setOverIndex}
                />
              ))}
            </ul>
            )}
      </div>
    </aside>
  )
}
