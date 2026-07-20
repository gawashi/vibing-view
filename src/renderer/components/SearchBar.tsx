import React, { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, qk } from '@/api'
import { useAppStore, selectActiveItems } from '@/store'
import { SearchResults } from './SearchResults'
import type { SymbolResult } from '@shared/types'

export function SearchBar(): React.JSX.Element {
  const [text, setText] = useState('')
  const [confirmed, setConfirmed] = useState('') // confirm-based search only (D-01)
  const rootRef = useRef<HTMLDivElement>(null)

  // Dismiss the open results on a click outside the search box (the list otherwise only closed on
  // select or clear+Enter). Only bound while results are showing.
  useEffect(() => {
    if (confirmed.length === 0) return
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setConfirmed('')
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [confirmed])
  const setActiveSymbol = useAppStore((s) => s.setActiveSymbol)
  const watchlist = useAppStore(selectActiveItems)
  const addToWatchlist = useAppStore((s) => s.addToWatchlist)
  const removeFromWatchlist = useAppStore((s) => s.removeFromWatchlist)

  const q = useQuery({
    queryKey: qk.search(confirmed),
    queryFn: () => api.symbols.search(confirmed),
    enabled: confirmed.length > 0
  })

  const onSelect = (symbol: string): void => {
    setActiveSymbol(symbol)
    void api.settings.setLastSymbol(symbol)
    setConfirmed('') // collapse the results list after selection
    setText('')
  }

  const onAddToWatchlist = (result: SymbolResult): void => {
    addToWatchlist({ symbol: result.symbol, name: result.name, exchange: result.exchange })
  }

  return (
    <div ref={rootRef} className="relative w-[420px]">
      <div className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setConfirmed(text.trim())
            else if (e.key === 'Escape') setConfirmed('')
          }}
          placeholder="Search ticker or company (press Enter)"
        />
        <Button onClick={() => setConfirmed(text.trim())}>Search</Button>
      </div>
      {confirmed.length > 0 && (
        <div className="absolute z-10 mt-1 w-full">
          <SearchResults
            loading={q.isLoading}
            error={q.isError}
            results={q.data}
            onSelect={onSelect}
            watchlistSymbols={watchlist.map((w) => w.symbol)}
            onAddToWatchlist={onAddToWatchlist}
            onRemoveFromWatchlist={removeFromWatchlist}
          />
        </div>
      )}
    </div>
  )
}
