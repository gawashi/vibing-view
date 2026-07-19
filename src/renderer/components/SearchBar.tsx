import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, qk } from '@/api'
import { useAppStore } from '@/store'
import { SearchResults } from './SearchResults'

export function SearchBar(): React.JSX.Element {
  const [text, setText] = useState('')
  const [confirmed, setConfirmed] = useState('') // confirm-based search only (D-01)
  const setActiveSymbol = useAppStore((s) => s.setActiveSymbol)

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

  return (
    <div className="relative w-[420px]">
      <div className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setConfirmed(text.trim()) }}
          placeholder="Search ticker or company (press Enter)"
        />
        <Button onClick={() => setConfirmed(text.trim())}>Search</Button>
      </div>
      {confirmed.length > 0 && (
        <div className="absolute z-10 mt-1 w-full">
          <SearchResults loading={q.isLoading} error={q.isError} results={q.data} onSelect={onSelect} />
        </div>
      )}
    </div>
  )
}
