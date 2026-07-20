import React, { useEffect, useState } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { api } from './api'
import { Button } from './components/ui/button'
import { GridHost } from './components/GridHost'
import { GridShapeRow } from './components/GridShapeRow'
import { LayoutMenu } from './components/LayoutMenu'
import { SearchBar } from './components/SearchBar'
import { SettingsDialog } from './components/SettingsDialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/ui/tooltip'
import { Toaster } from './components/ui/sonner'
import { Watchlist } from './components/Watchlist'
import { useAppStore } from './store'
import { parseWorkspace } from './workspace'

export default function App(): React.JSX.Element {
  // Sidebar open/closed (D-63) — UI chrome, persisted separately from the Workspace/named-layout
  // model via settings.json (see api.settings.get/setSidebarOpen), NOT via layout.setCurrent.
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // One-time startup restore (D-59/LAYOUT-04): replaces the old getLastSymbol restore. main is a
  // dumb persister — parseWorkspace owns the trust boundary and never throws (T-05-01). A null
  // result (first-ever launch or corrupt file) leaves the store's own default (1x1 + AAPL).
  useEffect(() => {
    void api.layout.getCurrent().then((raw) => {
      const ws = parseWorkspace(raw)
      if (ws) useAppStore.getState().hydrate(ws)
    })
    void api.watchlist.get().then((items) => {
      for (const item of items) useAppStore.getState().addToWatchlist(item)
    })
    void api.settings.getSidebarOpen().then((open) => {
      if (open !== null) setSidebarOpen(open)
    })
  }, [])

  // Persist-on-change for the watchlist (debounced, mirrors the layout auto-save below) — separate
  // JSON file (watchlist.json via IPC), never bundled into the Workspace snapshot.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = useAppStore.subscribe(
      (s) => s.watchlist,
      (watchlist) => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => { void api.watchlist.set(watchlist) }, 500)
      }
    )
    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [])

  const toggleSidebar = (): void => {
    setSidebarOpen((prev) => {
      const next = !prev
      void api.settings.setSidebarOpen(next)
      return next
    })
  }

  // Debounced auto-save (~500ms, ponytail: avoids write-thrash on rapid param edits) — persists
  // only the serializable workspace fields, NEVER crosshair (that stays session-only, D-60).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = useAppStore.subscribe(
      (s) => [s.cells, s.shape, s.activeCellId] as const, // never crosshairByCell (D-60)
      () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          // Single source of truth for workspace serialization (store.currentWorkspace) — reused
          // by switchToLayout/saveLayoutAs so there is never a second, divergent serialization.
          void api.layout.setCurrent(useAppStore.getState().currentWorkspace())
        }, 500)
      },
      // Default equalityFn is Object.is on the whole tuple, which is a fresh array every call —
      // without this, a crosshair-only update (rAF-throttled mousemove) would still reset the
      // debounce timer on every hover tick. Compare the three fields by reference instead.
      { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] }
    )
    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [])

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
          <GridShapeRow />
          <LayoutMenu />
          <div className="ml-auto flex items-center gap-4">
            <SearchBar />
            <SettingsDialog />
          </div>
        </header>
        <div className="flex flex-1 overflow-hidden">
          <Watchlist open={sidebarOpen} />
          <main className="flex-1 overflow-hidden">
            <GridHost />
          </main>
        </div>
      </div>
      <Toaster />
    </TooltipProvider>
  )
}
