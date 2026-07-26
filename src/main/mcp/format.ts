import {
  TIMEFRAMES, DERIVED_TIMEFRAMES, DAILY_BACKED_TIMEFRAMES,
  type Bar, type Timeframe, type SymbolResult, type Quote, type CompanyInfo,
  type Workspace, type WorkspaceCollection
} from '@shared/types'
import type { CapabilityStatus } from '@shared/ipc'
import type { BarSummary } from '../core'
import type { ToolResult } from './tools'

export const DEFAULT_LIMIT = 300
export const MAX_LIMIT = 2000

export const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] })
// Tool-level failures are reported as isError results, never thrown: a protocol error tells the
// model "the call broke", an isError result tells it *what to do differently*.
export const fail = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true })

export function isIntraday(tf: Timeframe): boolean {
  return !DAILY_BACKED_TIMEFRAMES.includes(tf)
}

// Bar.time is epoch seconds internally, but models mis-handle epochs — every MCP boundary speaks
// ISO (M-08). A bare date is midnight UTC; intraday callers may pass a full timestamp.
export function parseIsoToEpoch(value: string): number {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) throw new Error(`Invalid date "${value}". Use YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ.`)
  return Math.floor(ms / 1000)
}

export function formatEpoch(time: number, tf: Timeframe): string {
  const iso = new Date(time * 1000).toISOString()
  return isIntraday(tf) ? `${iso.slice(0, 19)}Z` : iso.slice(0, 10)
}

// CacheService only backfills the LEFT edge; right-edge gaps and interior holes are never filled
// (coverage stores min/max only, so interior holes aren't even detectable). The renderer never
// trips over that because it refreshes the right edge, but MCP callers pass arbitrary ranges —
// so say plainly whenever the answer does not cover what was asked for.
export function unmetRangeNotes(req: { from?: string; to?: string }, full: Bar[], tf: Timeframe): string[] {
  if (full.length === 0) return []
  const notes: string[] = []
  const oldest = full[0].time
  const newest = full[full.length - 1].time
  if (req.from && oldest > parseIsoToEpoch(req.from)) {
    const reason = isIntraday(tf)
      ? 'the FMP plan may not carry intraday history that far back'
      : 'the cache does not go back that far'
    notes.push(
      `note: requested from=${req.from} but the oldest bar returned is ${formatEpoch(oldest, tf)} — ` +
      `${reason}. This is NOT the complete history for that range.`
    )
  }
  if (req.to && newest < parseIsoToEpoch(req.to)) {
    notes.push(
      `note: requested to=${req.to} but the newest bar returned is ${formatEpoch(newest, tf)} — ` +
      'pass force=true to fetch newer bars from FMP.'
    )
  }
  return notes
}

export function summaryLine(a: {
  symbol: string
  timeframe: Timeframe
  shown: Bar[]
  total: number
  apiCalls: number
}): string {
  const first = formatEpoch(a.shown[0].time, a.timeframe)
  const last = formatEpoch(a.shown[a.shown.length - 1].time, a.timeframe)
  const cost = a.apiCalls === 0
    ? 'cache hit, no API call'
    : `${a.apiCalls} API call${a.apiCalls === 1 ? '' : 's'}`
  return `${a.symbol} ${a.timeframe} — ${a.shown.length} of ${a.total} cached bars, ${first} to ${last} (${cost})`
}

// CSV, not JSON: a few thousand daily bars as JSON objects costs tens of thousands of tokens (M-05).
export function toCsv(bars: Bar[], tf: Timeframe): string {
  const rows = bars.map((b) => [formatEpoch(b.time, tf), b.open, b.high, b.low, b.close, b.volume].join(','))
  return ['time,open,high,low,close,volume', ...rows].join('\n')
}

export function formatCacheStatus(
  rows: BarSummary[], capabilities: Record<Timeframe, CapabilityStatus>, symbol?: string
): string {
  const capLine = 'Timeframe capability: ' + TIMEFRAMES.map((tf) => `${tf} ${capabilities[tf]}`).join(', ')
  if (rows.length === 0) {
    const head = symbol ? `Nothing cached for ${symbol}.` : 'Nothing is cached yet.'
    return [head, capLine].join('\n')
  }
  const sorted = [...rows].sort((a, b) =>
    a.symbol.localeCompare(b.symbol) || TIMEFRAMES.indexOf(a.timeframe) - TIMEFRAMES.indexOf(b.timeframe)
  )
  const lines = sorted.map((r) => {
    const range = `${formatEpoch(r.oldestTime, r.timeframe)} to ${formatEpoch(r.newestTime, r.timeframe)}`
    // W/M hold no rows of their own — they are derived from these same daily bars (D-17/M-13),
    // so the daily row's coverage IS their coverage.
    const derived = r.timeframe === '1d' ? ` (also serves ${DERIVED_TIMEFRAMES.join(', ')})` : ''
    return `${r.symbol} ${r.timeframe} — ${r.count} bars, ${range}${derived}`
  })
  const symbols = new Set(sorted.map((r) => r.symbol)).size
  const head = symbol
    ? `Cache status for ${symbol} — ${sorted.length} series`
    : `Cache status — ${symbols} symbols, ${sorted.length} series`
  return [head, ...lines, capLine].join('\n')
}

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export function formatWorkspaceList(collection: WorkspaceCollection): string {
  const head = `Workspaces (${collection.workspaces.length}) — active: ${collection.active}`
  const lines = collection.workspaces.map((w) => {
    const active = w.name === collection.active ? ' (active)' : ''
    const { rows, cols } = w.layout.shape
    return `- ${w.name}${active} — ${plural(w.items.length, 'watchlist symbol')}, ${rows}x${cols} grid, ${plural(w.layout.cells.length, 'cell')}`
  })
  return [head, ...lines].join('\n')
}

// MW-12: the instance id is printed because update_indicator / remove_indicator take it. `colors`
// and `fixed` stay out: colour is echoed by update_indicator's own response, and `fixed` is
// explained by remove_indicator's error when it refuses.
export const formatIndicator = (i: {
  id: string; type: string; params: Record<string, number | string>; visible: boolean
}): string => {
  const parts = Object.entries(i.params).map(([k, v]) => `${k}=${v}`)
  if (!i.visible) parts.push('hidden')
  return parts.length > 0 ? `[${i.id}] ${i.type}(${parts.join(', ')})` : `[${i.id}] ${i.type}`
}

// The one cell-line format, shared by get_workspace and every mutation response (set_chart,
// set_grid_layout, ...) so a mutation reply reads like the slice of get_workspace it just changed.
export function formatCellLine(cell: {
  id: string; symbol: string | null; timeframe: string; indicators: Parameters<typeof formatIndicator>[0][]
}): string {
  const indicators = cell.indicators.length === 0
    ? 'no indicators'
    : cell.indicators.map(formatIndicator).join(', ')
  return `[${cell.id}] ${cell.symbol ?? '(empty)'} ${cell.timeframe} — ${indicators}`
}

export function formatWorkspaceDetail(w: Workspace, isActive: boolean): string {
  const { rows, cols } = w.layout.shape
  const watchlist = w.items.length === 0
    ? ['Watchlist: empty']
    : [`Watchlist (${w.items.length}):`, ...w.items.map((i) => `- ${i.symbol} — ${i.name} (${i.exchange})`)]
  const cells = w.layout.cells.map((c) => `- ${formatCellLine(c)}`)
  return [
    `Workspace: ${w.name}${isActive ? ' (active)' : ''}`,
    `Grid: ${rows} rows x ${cols} cols, active cell: ${w.layout.activeCellId}`,
    ...watchlist,
    `Cells (${w.layout.cells.length}):`,
    ...cells
  ].join('\n')
}

export function formatSymbolResults(results: SymbolResult[]): string {
  if (results.length === 0) return 'No matches.'
  return [
    `${results.length} match${results.length === 1 ? '' : 'es'}:`,
    ...results.map((r) => `- ${r.symbol} — ${r.name} (${r.exchange})`)
  ].join('\n')
}

export function formatQuote(symbol: string, q: Quote): string {
  return [
    `${symbol} — ${q.price} (${q.changePercentage >= 0 ? '+' : ''}${q.changePercentage}%) as of ${new Date(q.timestamp * 1000).toISOString()}`,
    `open ${q.open}, day high ${q.dayHigh}, day low ${q.dayLow}, previous close ${q.previousClose}`,
    `exchange: ${q.exchange}`
  ].join('\n')
}

const num = (v: number | null | undefined): string => (v == null ? '—' : String(v))

// Optional company-info endpoints collapse any failure (402/429/parse) to null (FmpProvider.opt),
// so a missing group is normal. Print the group as "not available" rather than omitting it —
// an omitted section reads as "this company has no such data".
function group(label: string, obj: Record<string, number | string | null | undefined> | null | undefined): string {
  if (obj == null) return `${label}: not available`
  const body = Object.entries(obj)
    .map(([k, v]) => `${k}=${v == null ? '—' : v}`)
    .join(', ')
  return `${label}: ${body}`
}

export function formatCompanyInfo(info: CompanyInfo): string {
  const head = `${info.symbol} — ${info.companyName} (as of ${new Date(info.fetchedAt * 1000).toISOString()})`
  const stale = info.stale ? ['stale: fetch failed, showing cached'] : []
  return [
    head,
    ...stale,
    `sector: ${info.sector ?? '—'}, industry: ${info.industry ?? '—'}, country: ${info.country ?? '—'}`,
    `market cap: ${num(info.marketCap)}, price: ${num(info.price)}, beta: ${num(info.beta)}, employees: ${num(info.fullTimeEmployees)}`,
    group('valuation', info.valuation),
    group('financials', info.financials),
    group('analyst', info.analyst),
    group('growth', info.growth),
    group('schedule', info.schedule)
  ].join('\n')
}
