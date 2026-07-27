import React, { useEffect } from 'react'
import { api } from '@/api'
import { useAppStore } from '@/store'
import { applyTheme } from '@/lib/theme'
import { useRefreshSync } from '@/hooks/useRefreshSync'
import { ChartPanel } from './GridHost'
import { TooltipProvider } from './ui/tooltip'
import { Toaster } from './ui/sonner'

// Standalone chart window for one watchlist symbol. Deliberately does NOT mount useWorkspaceSync or
// useClipboardSync: every BrowserWindow gets its own renderer store, so skipping the sync hooks is
// what makes this window isolated — its timeframe/indicator edits are never saved to the workspace
// collection and never reach the grid. A fresh store already holds exactly one 1x1 cell with the
// always-on Volume indicator, and main.tsx seeds the symbol into it before the first render.
export function SymbolChartWindow({ symbol }: { symbol: string }): React.JSX.Element {
  useRefreshSync()
  useEffect(() => { void api.settings.getTheme().then(applyTheme) }, [])
  useEffect(() => { document.title = symbol }, [symbol])

  const cell = useAppStore((s) => s.cells.find((c) => c.id === s.activeCellId))!

  return (
    <TooltipProvider>
      <div className="flex h-screen min-h-0 min-w-0 flex-col gap-4 bg-background p-4 text-foreground">
        <ChartPanel cell={cell} minimal />
      </div>
      <Toaster />
    </TooltipProvider>
  )
}
