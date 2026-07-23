import React, { useEffect, useState } from 'react'
import { PanelLeftClose, PanelLeftOpen, RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, qk } from './api'
import { Button } from './components/ui/button'
import { GridHost } from './components/GridHost'
import { GridShapePicker } from './components/GridShapePicker'
import { ApplyToAllToolbar } from './components/ApplyToAllToolbar'
import { WorkspaceSwitcher } from './components/WorkspaceSwitcher'
import { quoteSymbols } from './lib/quoteTargets'
import { refreshTargets } from './lib/refreshTargets'
import { cn } from './lib/utils'
import { SearchBar } from './components/SearchBar'
import { SettingsDialog } from './components/SettingsDialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/ui/tooltip'
import { Toaster } from './components/ui/sonner'
import { Watchlist } from './components/Watchlist'
import { useAppStore, selectActiveItems } from './store'
import { useWorkspaceSync } from './hooks/useWorkspaceSync'
import { useClipboardSync } from './hooks/useClipboardSync'
import { applyTheme } from './lib/theme'
import type { CapabilityStatus } from '@shared/ipc'
import type { Timeframe } from '@shared/types'

export default function App(): React.JSX.Element {
  // Sidebar open/closed (D-63) — UI chrome, persisted separately from the Workspace/named-layout
  // model via settings.json (see api.settings.get/setSidebarOpen), NOT via layout.setCurrent.
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(240)

  useWorkspaceSync()
  useClipboardSync()

  useEffect(() => {
    void api.settings.getTheme().then(applyTheme)
    void api.settings.getSidebarOpen().then((open) => {
      if (open !== null) setSidebarOpen(open)
    })
    void api.settings.getSidebarWidth().then((w) => {
      if (w !== null) setSidebarWidth(w)
    })
  }, [])

  // ponytail: React-state (not a store subscribe) so a plain 500ms debounced effect is enough.
  // The one redundant write of the default 240 on first mount (before load resolves) is harmless.
  useEffect(() => {
    const t = setTimeout(() => { void api.settings.setSidebarWidth(sidebarWidth) }, 500)
    return () => clearTimeout(t)
  }, [sidebarWidth])

  const toggleSidebar = (): void => {
    setSidebarOpen((prev) => {
      const next = !prev
      void api.settings.setSidebarOpen(next)
      return next
    })
  }

  const queryClient = useQueryClient()
  const [reloading, setReloading] = useState(false)

  const handleReload = async (): Promise<void> => {
    const state = useAppStore.getState()
    const { cells, shape } = state
    const caps = queryClient.getQueryData<Record<Timeframe, CapabilityStatus>>(qk.capabilities())
    // Also refresh the active watchlist's '1d' — but only when the sidebar is open, since those are
    // the rows actually on screen (and the only ones with a live query to update). de-dup + gating
    // are handled inside refreshTargets.
    const watchlistSymbols = sidebarOpen ? selectActiveItems(state).map((w) => w.symbol) : []
    const targets = refreshTargets(cells, shape, caps, watchlistSymbols)
    if (targets.length === 0) return
    setReloading(true)
    try {
      const results = await Promise.allSettled(
        targets.map(async (t) => {
          const bars = await api.ohlcv.refresh(t.symbol, t.timeframe)
          queryClient.setQueryData(qk.ohlcv(t.symbol, t.timeframe), bars)
        })
      )
      // Capability verdicts may have changed (a refresh re-probes the fetched tf); re-gate the row.
      void queryClient.invalidateQueries({ queryKey: qk.capabilities() })
      // Latest-price: fetch market status once; only when open, one quote per visible/watchlist
      // symbol. Closed → skip quotes entirely (consumers fall back to daily close). A gated/failed
      // quote or market-status is swallowed here so it never blocks the OHLCV reload.
      try {
        const status = await api.market.status()
        queryClient.setQueryData(qk.marketStatus(), status)
        if (status.isOpen) {
          const syms = quoteSymbols(cells, shape, watchlistSymbols)
          await Promise.allSettled(
            syms.map(async (s) => {
              const quote = await api.quote.get(s)
              queryClient.setQueryData(qk.quote(s), quote)
            })
          )
        }
      } catch {
        // market-status unavailable (e.g. plan-gated) → leave consumers on the daily-close fallback.
      }
      if (results.some((r) => r.status === 'rejected')) {
        toast('Some charts couldn’t be refreshed. Check your connection or FMP plan.')
      }
    } finally {
      setReloading(false)
    }
  }

  // Per-cell capability gating (eager intraday probe, requires-plan→snap-to-daily, rate-limit
  // toast) has moved into GridHost's GridCell (D-60) — each rendered cell now gates its own row off
  // its own symbol/timeframe instead of one App-level effect tied to a single active symbol.

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <header className="flex items-center gap-4 border-b border-border bg-card px-8 py-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebar}
                aria-label={sidebarOpen ? 'Hide watchlist' : 'Show watchlist'}
              >
                {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{sidebarOpen ? 'Hide watchlist' : 'Show watchlist'}</TooltipContent>
          </Tooltip>
          <GridShapePicker />
          <ApplyToAllToolbar />
          <WorkspaceSwitcher />
          <div className="ml-auto flex items-center gap-4">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleReload}
                  disabled={reloading}
                  aria-label="Reload visible charts"
                >
                  <RefreshCw className={cn('size-4', reloading && 'animate-spin')} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reload visible charts</TooltipContent>
            </Tooltip>
            <SearchBar />
            <SettingsDialog />
          </div>
        </header>
        <div className="flex flex-1 overflow-hidden">
          <Watchlist open={sidebarOpen} width={sidebarWidth} onWidthChange={setSidebarWidth} />
          <main className="flex-1 overflow-hidden">
            <GridHost />
          </main>
        </div>
      </div>
      <Toaster />
    </TooltipProvider>
  )
}
