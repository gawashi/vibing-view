import React, { useEffect } from 'react'
import { api } from '@/api'
import { useAppStore } from '@/store'
import { applyTheme } from '@/lib/theme'
import { useWorkspaceSync } from '@/hooks/useWorkspaceSync'
import { ChartPanel } from './GridHost'
import { TooltipProvider } from './ui/tooltip'
import { Toaster } from './ui/sonner'

// Standalone enlarge-chart window. Shares the workspace collection with every other window via
// useWorkspaceSync, so edits here (timeframe / indicators) sync to the source grid cell and back.
// Follows the active workspace: if its cell leaves the active hot grid (workspace switched away),
// it shows a placeholder and auto-restores when the workspace becomes active again.
export function ChartWindow({ cellId }: { cellId: string }): React.JSX.Element {
  useWorkspaceSync()
  useEffect(() => { void api.settings.getTheme().then(applyTheme) }, [])

  const cell = useAppStore((s) => s.cells.find((c) => c.id === cellId))
  useEffect(() => { document.title = cell?.symbol ?? 'Chart' }, [cell?.symbol])

  // One TooltipProvider/Toaster around every branch: ChartPanel renders Radix Tooltips (SymbolLabel,
  // TimeframeRow) which throw without a provider ancestor, and gating toasts need somewhere to render.
  const msg = !cell
    ? 'This chart is not in the current workspace. Switch back to its workspace to see it again.'
    : !cell.symbol
      ? 'This chart has no symbol set.'
      : null
  const content = msg
    ? (
      <div className="flex h-screen items-center justify-center bg-background p-8 text-center text-muted-foreground">
        {msg}
      </div>
    )
    : (
      <div className="flex h-screen min-h-0 min-w-0 flex-col gap-4 bg-background p-4 text-foreground">
        <ChartPanel cell={cell!} />
      </div>
    )

  return (
    <TooltipProvider>
      {content}
      <Toaster />
    </TooltipProvider>
  )
}
