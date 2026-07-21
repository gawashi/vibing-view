import React, { useEffect, useRef, useState } from 'react'
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

  const INITIAL = 15
  const STEP = 15
  const [visibleCount, setVisibleCount] = useState(INITIAL)
  const listRef = useRef<HTMLUListElement>(null)

  // Reset the reveal window whenever a new result set arrives (new search).
  useEffect(() => {
    setVisibleCount(INITIAL)
    if (listRef.current) listRef.current.scrollTop = 0
  }, [results])

  // Reveal +15 more when scrolled near the bottom. Capped at results.length in the render slice —
  // no additional network (all rows already fetched into `results`).
  const onScroll = (e: React.UIEvent<HTMLUListElement>): void => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) {
      setVisibleCount((c) => Math.min(c + STEP, results.length))
    }
  }
  return (
    <ul ref={listRef} onScroll={onScroll} className="max-h-[280px] overflow-y-auto rounded-md border border-border bg-card">
      {results.slice(0, visibleCount).map((r) => {
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
