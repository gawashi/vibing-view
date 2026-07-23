import React, { useEffect } from 'react'
import { api } from '@/api'
import { useAppStore } from '@/store'
import { applyTheme } from '@/lib/theme'
import { useWorkspaceSync } from '@/hooks/useWorkspaceSync'
import { useClipboardSync } from '@/hooks/useClipboardSync'
import { ChartPanel } from './GridHost'
import { ChartContextMenu } from './ChartContextMenu'
import { TooltipProvider } from './ui/tooltip'
import { Toaster } from './ui/sonner'

// Standalone enlarge-chart window. Shares the workspace collection with every other window via
// useWorkspaceSync, so edits here (timeframe / indicators) sync to the source grid cell and back.
// Follows the active workspace: if its cell leaves the active hot grid (workspace switched away),
// it shows a placeholder and auto-restores when the workspace becomes active again.
export function ChartWindow({ cellId }: { cellId: string }): React.JSX.Element {
  useWorkspaceSync()
  useClipboardSync()
  useEffect(() => { void api.settings.getTheme().then(applyTheme) }, [])

  const cell = useAppStore((s) => s.cells.find((c) => c.id === cellId))
  const isCut = useAppStore((s) => s.chartClipboard?.cutSourceCellId === cellId)
  useEffect(() => { document.title = cell?.symbol ?? 'Chart' }, [cell?.symbol])

  // One TooltipProvider/Toaster around every branch: ChartPanel renders Radix Tooltips (SymbolLabel,
  // TimeframeRow) which throw without a provider ancestor, and gating toasts need somewhere to render.
  const content = !cell
    ? (
      <div className="flex h-screen items-center justify-center bg-background p-8 text-center text-muted-foreground">
        This chart is not in the current workspace. Switch back to its workspace to see it again.
      </div>
      )
    : (
      // Wrap in the shared menu even when empty (no symbol) so a Paste — or paste-back after a Cut
      // in this window — has a target.
      <ChartContextMenu cellId={cellId}>
        {cell.symbol
          ? (
            <div className={`flex h-screen min-h-0 min-w-0 flex-col gap-4 bg-background p-4 text-foreground${isCut ? ' opacity-40' : ''}`}>
              <ChartPanel cell={cell} />
            </div>
            )
          : (
            <div className="flex h-screen items-center justify-center bg-background p-8 text-center text-muted-foreground">
              This chart has no symbol set.
            </div>
            )}
      </ChartContextMenu>
      )

  return (
    <TooltipProvider>
      {content}
      <Toaster />
    </TooltipProvider>
  )
}
