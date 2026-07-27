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
// always-on Volume indicator, so seeding the symbol is all it takes to have a full chart.
export function SymbolChartWindow({ symbol }: { symbol: string }): React.JSX.Element {
  useRefreshSync()
  useEffect(() => { void api.settings.getTheme().then(applyTheme) }, [])
  useEffect(() => { document.title = symbol }, [symbol])
  useEffect(() => { useAppStore.getState().setActiveSymbol(symbol) }, [symbol])

  const cell = useAppStore((s) => s.cells[0])

  return (
    <TooltipProvider>
      {/* The seed effect runs after the first commit, so the cell is symbol-less for one frame —
          render an empty backdrop rather than hitting ChartPanel's cell.symbol! assertion. */}
      {cell?.symbol
        ? (
          <div className="flex h-screen min-h-0 min-w-0 flex-col gap-4 bg-background p-4 text-foreground">
            <ChartPanel cell={cell} minimal />
          </div>
          )
        : <div className="h-screen bg-background" />}
      <Toaster />
    </TooltipProvider>
  )
}
