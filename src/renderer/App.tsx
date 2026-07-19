import React, { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, qk } from './api'
import { AddIndicatorMenu } from './components/AddIndicatorMenu'
import { Chart } from './components/Chart'
import { SearchBar } from './components/SearchBar'
import { SettingsDialog } from './components/SettingsDialog'
import { TimeframeRow, TF_LABELS } from './components/TimeframeRow'
import { TooltipProvider } from './components/ui/tooltip'
import { Toaster } from './components/ui/sonner'
import { useAppStore } from './store'
import type { Timeframe } from '@shared/types'

export default function App(): React.JSX.Element {
  const activeSymbol = useAppStore((s) => s.activeSymbol)
  const setActiveSymbol = useAppStore((s) => s.setActiveSymbol)
  const [timeframe, setTimeframe] = useState<Timeframe>('1d') // D-12: default is always D
  const queryClient = useQueryClient()
  const toastedFor = useRef<string | null>(null) // single-flight guard: one toast per rate-limit transition

  useEffect(() => {
    void api.settings.getLastSymbol().then((last) => setActiveSymbol(last ?? 'AAPL')) // D-06/D-07
  }, [setActiveSymbol])
  useEffect(() => {
    setTimeframe('1d') // never persisted per-symbol (D-12)
  }, [activeSymbol])

  // Reuses Chart's own query key/cache entry — no extra fetch — purely to observe rate-limit errors
  // on the currently-viewed timeframe (D-15). Never clears the chart's cached data.
  const ohlcvQ = useQuery({
    queryKey: qk.ohlcv(activeSymbol ?? '', timeframe),
    queryFn: () => api.ohlcv.get(activeSymbol ?? '', timeframe, undefined),
    enabled: !!activeSymbol
  })
  // Shares the ['capabilities'] cache entry with TimeframeRow's own useQuery — no extra fetch either.
  const capsQ = useQuery({ queryKey: qk.capabilities(), queryFn: () => api.capabilities.get() })

  useEffect(() => {
    // Eager one-time probe (user override of D-21): grey gated intraday timeframes from startup
    // instead of only after a click. Only probes tfs still 'unknown' for the current key, so it runs
    // once per key — main persists the verdict (sticky requires-plan / available) and later launches
    // read it as non-unknown and skip. A key change resets the map to 'unknown' → re-probes the new key.
    if (!activeSymbol || !capsQ.data) return
    const intraday: Timeframe[] = ['1m', '5m', '15m', '1h']
    const unknown = intraday.filter((tf) => capsQ.data?.[tf] === 'unknown')
    if (unknown.length === 0) return
    void Promise.allSettled(unknown.map((tf) => api.ohlcv.get(activeSymbol, tf, undefined)))
      .then(() => queryClient.invalidateQueries({ queryKey: qk.capabilities() }))
  }, [activeSymbol, capsQ.data, queryClient])

  useEffect(() => {
    // main's ohlcv:get handler already classifies+persists the capability status before rethrowing,
    // so an error here means the capabilities map may be stale — refresh it so the row re-gates.
    if (ohlcvQ.isError) void queryClient.invalidateQueries({ queryKey: qk.capabilities() })
  }, [ohlcvQ.isError, queryClient])

  useEffect(() => {
    // Phase goal: a gated timeframe must show *why* (greyed button + Lock badge), never a broken
    // chart. A tf is only discovered gated after its first click (lazy probe → requires-plan); snap
    // the view back to D so the daily chart stays visible while the now-disabled button explains it.
    // '1d' is never requires-plan, so no loop. (rate-limited is left alone — D-15 keeps cached bars.)
    if (capsQ.data?.[timeframe] === 'requires-plan') setTimeframe('1d')
  }, [capsQ.data, timeframe])

  useEffect(() => {
    // Driven off the capabilities map (not just ohlcvQ.isError) so this also catches a rate limit
    // recorded by main during a pan-induced gap-fetch (Chart.tsx runGapFetch), which fails on its
    // own ['ohlcv-gap', ...] query key and never flips ohlcvQ.isError for the active tf.
    const transitionKey = `${activeSymbol}:${timeframe}`
    const isRateLimited = capsQ.data?.[timeframe] === 'rate-limited'
    if (isRateLimited && toastedFor.current !== transitionKey) {
      toastedFor.current = transitionKey
      toast(`Rate limit reached for ${TF_LABELS[timeframe]}. Showing cached data — new bars will load once the limit resets.`)
    }
    if (!isRateLimited) toastedFor.current = null
  }, [capsQ.data, activeSymbol, timeframe])

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <header className="flex items-center gap-4 border-b border-border bg-card px-8 py-4">
          <span className="text-2xl font-semibold">{activeSymbol ?? '—'}</span>
          <div className="ml-auto flex items-center gap-4">
            <SearchBar />
            <SettingsDialog />
          </div>
        </header>
        <main className="flex-1">
          {activeSymbol
            ? (
              <div className="flex h-full flex-col gap-4">
                <div className="flex items-center gap-4">
                  <TimeframeRow value={timeframe} onChange={setTimeframe} />
                  <AddIndicatorMenu />
                </div>
                <div className="flex-1">
                  <Chart symbol={activeSymbol} timeframe={timeframe} />
                </div>
              </div>
              )
            : <div className="p-6 text-muted-foreground">Search a symbol to begin.</div>}
        </main>
      </div>
      <Toaster />
    </TooltipProvider>
  )
}
