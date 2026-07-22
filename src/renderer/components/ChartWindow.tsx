import React, { useEffect } from 'react'
import { api } from '@/api'
import { useAppStore } from '@/store'
import { applyTheme } from '@/lib/theme'
import { useWorkspaceSync } from '@/hooks/useWorkspaceSync'
import { ChartPanel } from './GridHost'

// Standalone enlarge-chart window. Shares the workspace collection with every other window via
// useWorkspaceSync, so edits here (timeframe / indicators) sync to the source grid cell and back.
// Follows the active workspace: if its cell leaves the active hot grid (workspace switched away),
// it shows a placeholder and auto-restores when the workspace becomes active again.
export function ChartWindow({ cellId }: { cellId: string }): React.JSX.Element {
  useWorkspaceSync()
  useEffect(() => { void api.settings.getTheme().then(applyTheme) }, [])

  const cell = useAppStore((s) => s.cells.find((c) => c.id === cellId))
  useEffect(() => { document.title = cell?.symbol ?? 'Chart' }, [cell?.symbol])

  if (!cell) {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-8 text-center text-muted-foreground">
        このチャートは現在のワークスペースにありません。元のワークスペースに戻すと再表示されます。
      </div>
    )
  }
  if (!cell.symbol) {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-8 text-center text-muted-foreground">
        このチャートには銘柄が設定されていません。
      </div>
    )
  }
  return (
    <div className="flex h-screen min-h-0 min-w-0 flex-col gap-4 bg-background p-4 text-foreground">
      <ChartPanel cell={cell} />
    </div>
  )
}
