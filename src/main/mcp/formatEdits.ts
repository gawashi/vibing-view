import type { Cell, GridShape, IndicatorInstance, WatchlistItem } from '@shared/types'
import { formatCellLine } from './format'

export function formatCells(workspaceName: string, cells: Cell[]): string {
  return [`Workspace "${workspaceName}":`, ...cells.map((c) => `- ${formatCellLine(c)}`)].join('\n')
}

export function formatGrid(workspaceName: string, shape: GridShape, visible: Cell[]): string {
  return [
    `Workspace "${workspaceName}" grid is now ${shape.rows} rows x ${shape.cols} cols.`,
    ...visible.map((c) => `- ${formatCellLine(c)}`)
  ].join('\n')
}

export function formatInstanceDetail(cellId: string, i: IndicatorInstance): string {
  const colors = Object.entries(i.colors).map(([k, v]) => `${k}=${v}`).join(', ')
  return [
    `[${i.id}] ${i.type} on cell [${cellId}]`,
    `params: ${Object.entries(i.params).map(([k, v]) => `${k}=${v}`).join(', ') || '(none)'}`,
    `visible: ${i.visible}`,
    `colors: ${colors || '(none)'}`
  ].join('\n')
}

export function formatWatchlist(workspaceName: string, items: WatchlistItem[]): string {
  if (items.length === 0) return `Workspace "${workspaceName}" watchlist is empty.`
  return [
    `Workspace "${workspaceName}" watchlist (${items.length}):`,
    ...items.map((i) => `- ${i.symbol} — ${i.name} (${i.exchange})`)
  ].join('\n')
}
