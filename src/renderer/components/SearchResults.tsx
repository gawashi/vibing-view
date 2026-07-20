import React from 'react'
import { Star } from 'lucide-react'
import type { SymbolResult } from '@shared/types'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { cn } from '@/lib/utils'

type Props = {
  loading: boolean
  error: boolean
  results: SymbolResult[] | undefined
  onSelect: (symbol: string) => void
  watchlistSymbols: string[]
  onAddToWatchlist: (result: SymbolResult) => void
  onRemoveFromWatchlist: (symbol: string) => void
}

export function SearchResults({ loading, error, results, onSelect, watchlistSymbols, onAddToWatchlist, onRemoveFromWatchlist }: Props): React.JSX.Element | null {
  if (loading) return <div className="p-2 text-sm text-muted-foreground">Searching…</div>
  if (error)
    return (
      <div className="p-2 text-sm text-destructive">
        Couldn't load chart data. Check your connection or your FMP API key in Settings, then try again.
      </div>
    )
  if (!results) return null
  if (results.length === 0)
    return (
      <div className="p-2">
        <div className="text-sm">No matches found</div>
        <div className="text-xs text-muted-foreground">
          Try a different ticker or company name. Search covers US stocks and crypto.
        </div>
      </div>
    )
  return (
    <ul className="max-h-[280px] overflow-y-auto rounded-md border border-border bg-card">
      {results.slice(0, 8).map((r) => {
        const watched = watchlistSymbols.includes(r.symbol)
        return (
          <li
            key={`${r.symbol}-${r.exchange}`}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(r.symbol)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSelect(r.symbol) }}
            className="flex w-full items-center gap-2 px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
          >
            <span className="font-semibold">{r.symbol}</span>
            <span className="truncate text-muted-foreground" title={r.name}>{r.name}</span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">{r.exchange}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (watched) onRemoveFromWatchlist(r.symbol)
                    else onAddToWatchlist(r)
                  }}
                  aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
                  className={cn('shrink-0 cursor-pointer', watched ? 'text-primary hover:text-muted-foreground' : 'text-muted-foreground hover:text-foreground')}
                >
                  <Star className={cn('size-4', watched && 'fill-current')} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{watched ? 'Remove from watchlist' : 'Add to watchlist'}</TooltipContent>
            </Tooltip>
          </li>
        )
      })}
    </ul>
  )
}
