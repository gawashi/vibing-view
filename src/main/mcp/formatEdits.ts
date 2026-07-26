import type { Cell, GridShape, IndicatorInstance, WatchlistItem } from '@shared/types'
import { formatIndicator } from './format'

// Same shape as formatWorkspaceDetail's cell line so a mutation response reads like the slice of
// get_workspace it just changed.
export function formatCellLine(cell: Cell): string {
  const indicators = cell.indicators.length === 0
    ? 'no indicators'
    : cell.indicators.map(formatIndicator).join(', ')
  return `[${cell.id}] ${cell.symbol ?? '(empty)'} ${cell.timeframe} — ${indicators}`
}

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
