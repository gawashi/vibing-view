import React, { useEffect, useRef, useState } from 'react'
import { Loader2, Star } from 'lucide-react'
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
  const INITIAL = 15
  const STEP = 15
  const LOAD_DELAY_MS = 600
  const [visibleCount, setVisibleCount] = useState(INITIAL)
  const [loadingMore, setLoadingMore] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset the reveal window whenever a new result set arrives (new search). Also cancel any in-flight
  // "load more" so a pending reveal from the previous query can't fire against the new results.
  useEffect(() => {
    setVisibleCount(INITIAL)
    setLoadingMore(false)
    if (timer.current) clearTimeout(timer.current)
    if (listRef.current) listRef.current.scrollTop = 0
  }, [results])

  // Cancel a pending timer on unmount (the list closes on select / click-outside).
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const total = results?.length ?? 0
  const hasMore = visibleCount < total

  // Twitter-style reveal: on reaching the bottom, show a brief spinner, then append the next batch.
  // The delay is purely cosmetic — every row is already fetched, so there is no network here.
  // ponytail: fixed 600ms feel-delay; tune the constant if it drags.
  const onScroll = (e: React.UIEvent<HTMLUListElement>): void => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 48 && hasMore && !loadingMore) {
      setLoadingMore(true)
      timer.current = setTimeout(() => {
        setVisibleCount((c) => Math.min(c + STEP, total))
        setLoadingMore(false)
      }, LOAD_DELAY_MS)
    }
  }

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
      {loadingMore && (
        <li className="flex items-center justify-center gap-2 px-2 py-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading…
        </li>
      )}
    </ul>
  )
}
