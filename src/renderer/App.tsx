import React, { useEffect, useRef, useState } from 'react'
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
import { shouldRefreshData, type ReloadSource } from './lib/autoRefresh'

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
  const inFlight = useRef(false)
  const [refreshState, setRefreshState] = useState<{
    status: 'idle' | 'ok' | 'failed' | 'paused-closed'
    lastRefreshedAt: number | null
  }>({ status: 'idle', lastRefreshedAt: null })

  const reload = async (opts: { source: ReloadSource }): Promise<void> => {
    if (inFlight.current) return // 同期ガード: 手動と auto tick の二重実行を防ぐ（state のラグに依存しない）
    const state = useAppStore.getState()
    const { cells, shape } = state
    const caps = queryClient.getQueryData<Record<Timeframe, CapabilityStatus>>(qk.capabilities())
    const watchlistSymbols = sidebarOpen ? selectActiveItems(state).map((w) => w.symbol) : []
    const targets = refreshTargets(cells, shape, caps, watchlistSymbols)

    inFlight.current = true
    setReloading(true)
    try {
      // market status を先に取得。auto はクローズ中フェッチを打ち切る（API 節約）。
      let isOpen = false
      try {
        const status = await api.market.status()
        queryClient.setQueryData(qk.marketStatus(), status)
        isOpen = status.isOpen
      } catch {
        // status 不明 → 手動は続行、auto は closed 扱いで下の判定によりスキップ。
      }
      if (!shouldRefreshData(opts.source, isOpen)) {
        setRefreshState((s) => ({ status: 'paused-closed', lastRefreshedAt: s.lastRefreshedAt }))
        return
      }
      const results = await Promise.allSettled(
        targets.map(async (t) => {
          const bars = await api.ohlcv.refresh(t.symbol, t.timeframe)
          queryClient.setQueryData(qk.ohlcv(t.symbol, t.timeframe), bars)
        })
      )
      // Capability verdicts may have changed (a refresh re-probes the fetched tf); re-gate the row.
      void queryClient.invalidateQueries({ queryKey: qk.capabilities() })
      if (isOpen) {
        const syms = quoteSymbols(cells, shape, watchlistSymbols)
        await Promise.allSettled(
          syms.map(async (s) => {
            const quote = await api.quote.get(s)
            queryClient.setQueryData(qk.quote(s), quote)
          })
        )
      }
      const failed = results.some((r) => r.status === 'rejected')
      if (failed) toast('Some charts couldn’t be refreshed. Check your connection or FMP plan.')
      setRefreshState({ status: failed ? 'failed' : 'ok', lastRefreshedAt: Date.now() })
    } finally {
      inFlight.current = false
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
                  onClick={() => void reload({ source: 'manual' })}
                  disabled={reloading}
                  aria-label="Reload visible charts"
                >
                  <RefreshCw className={cn('size-4', reloading && 'animate-spin')} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reload visible charts</TooltipContent>
            </Tooltip>
            {refreshState.status === 'paused-closed' && (
              <span className="text-xs text-muted-foreground" title="Market closed — auto-refresh paused">
                Paused
              </span>
            )}
            {refreshState.status === 'failed' && (
              <span className="text-xs text-red-500" title="Some charts couldn’t be refreshed">
                Update failed
              </span>
            )}
            {refreshState.status === 'ok' && refreshState.lastRefreshedAt && (
              <span className="text-xs text-muted-foreground">
                Updated {new Date(refreshState.lastRefreshedAt).toLocaleTimeString()}
              </span>
            )}
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
