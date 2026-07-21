import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, Loader2, Star } from 'lucide-react'
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
  const PULL_THRESHOLD = 150 // extra wheel overscroll (px) past the bottom needed to load more
  const [visibleCount, setVisibleCount] = useState(INITIAL)
  const [loadingMore, setLoadingMore] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pull = useRef(0) // accumulated overscroll since last reaching the bottom

  // Reset the reveal window whenever a new result set arrives (new search). Also cancel any in-flight
  // "load more" so a pending reveal from the previous query can't fire against the new results.
  useEffect(() => {
    setVisibleCount(INITIAL)
    setLoadingMore(false)
    pull.current = 0
    if (timer.current) clearTimeout(timer.current)
    if (listRef.current) listRef.current.scrollTop = 0
  }, [results])

  // Cancel a pending timer on unmount (the list closes on select / click-outside).
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const total = results?.length ?? 0
  const hasMore = visibleCount < total

  // Append the next batch after a brief spinner. The delay is purely cosmetic — every row is already
  // fetched, so there is no network here. ponytail: fixed 600ms feel-delay; tune the constant if it drags.
  const revealMore = (): void => {
    if (!hasMore || loadingMore) return
    setLoadingMore(true)
    timer.current = setTimeout(() => {
      setVisibleCount((c) => Math.min(c + STEP, total))
      setLoadingMore(false)
    }, LOAD_DELAY_MS)
  }

  // Pull-to-load: don't reveal automatically on reaching the bottom — only once the user keeps
  // scrolling PAST it (accumulated wheel overscroll beyond PULL_THRESHOLD). Scrolling up or away
  // from the bottom resets the accumulator.
  const onWheel = (e: React.WheelEvent<HTMLUListElement>): void => {
    const el = e.currentTarget
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 4
    if (e.deltaY > 0 && atBottom && hasMore && !loadingMore) {
      pull.current += e.deltaY
      if (pull.current >= PULL_THRESHOLD) {
        pull.current = 0
        revealMore()
      }
    } else if (e.deltaY < 0 || !atBottom) {
      pull.current = 0
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
    <ul ref={listRef} onWheel={onWheel} className="max-h-[280px] overflow-y-auto rounded-md border border-border bg-card">
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
      {loadingMore ? (
        <li className="flex items-center justify-center gap-2 px-2 py-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading…
        </li>
      ) : hasMore ? (
        <li className="flex items-center justify-center gap-1 px-2 py-2 text-xs text-muted-foreground">
          <ChevronDown className="size-3" />
          Pull to load more
        </li>
      ) : null}
    </ul>
  )
}
