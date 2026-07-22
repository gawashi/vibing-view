import type {
  Cell,
  GridShape,
  IndicatorInstance,
  Timeframe,
  Layout,
  Workspace,
  WorkspaceCollection,
  WatchlistItem
} from '@shared/types'

// Bump when Layout's shape changes incompatibly. parseLayout stays forward-compatible
// (fills missing fields with defaults) so old-schema saved files still restore.
export const SCHEMA_VERSION = 1

// How many cells are visible for a given grid shape (05-02 grid expansion reads this too).
export const VISIBLE_COUNT: Record<GridShape, number> = { '1x1': 1, '2x1': 2, '2x2': 4 }

const GRID_SHAPES: GridShape[] = ['1x1', '2x1', '2x2']
const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '1d', '1w', '1M']

function isGridShape(v: unknown): v is GridShape {
  return typeof v === 'string' && (GRID_SHAPES as string[]).includes(v)
}

function isTimeframe(v: unknown): v is Timeframe {
  return typeof v === 'string' && (TIMEFRAMES as string[]).includes(v)
}

// Same literal shape store.ts seeds today for the always-on fixed Volume instance (D-34).
// Store owns id-gen (nextId) — caller passes in the fresh id so this stays pure.
export function newCellSeed(id: string, volId: string): Cell {
  return {
    id,
    symbol: null,
    timeframe: '1d',
    indicators: [{ id: volId, type: 'volume', params: {}, colors: {}, visible: true, fixed: true }]
  }
}

// First-ever-launch default: 1x1 grid, one empty cell (D-59).
export function defaultLayout(cellId: string, volId: string): Layout {
  const cell = newCellSeed(cellId, volId)
  return { schemaVersion: SCHEMA_VERSION, cells: [cell], shape: '1x1', activeCellId: cell.id }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function parseIndicator(raw: unknown): IndicatorInstance | null {
  if (!isRecord(raw)) return null
  const { id, type, params, colors, visible } = raw
  if (typeof id !== 'string' || typeof type !== 'string') return null
  const inst: IndicatorInstance = {
    id,
    type,
    params: isRecord(params) ? (params as IndicatorInstance['params']) : {},
    colors: isRecord(colors) ? (colors as Record<string, string>) : {},
    visible: typeof visible === 'boolean' ? visible : true
  }
  if (typeof raw.fixed === 'boolean') inst.fixed = raw.fixed
  return inst
}

function parseCell(raw: unknown): Cell | null {
  if (!isRecord(raw)) return null
  const { id } = raw
  if (typeof id !== 'string') return null
  const symbol = typeof raw.symbol === 'string' ? raw.symbol : null
  const timeframe = isTimeframe(raw.timeframe) ? raw.timeframe : '1d'
  const indicators = Array.isArray(raw.indicators)
    ? raw.indicators.map(parseIndicator).filter((i): i is IndicatorInstance => i !== null)
    : []
  return { id, symbol, timeframe, indicators }
}

// Validates/coerces arbitrary persisted or malformed JSON into a Layout. Never throws —
// unresolvable input (not an object at all) returns null; everything else is coerced/defaulted
// (forward-compatible partial-state restore, T-05-01).
export function parseLayout(raw: unknown): Layout | null {
  try {
    if (!isRecord(raw)) return null
    const shape = isGridShape(raw.shape) ? raw.shape : '1x1'
    const cells = Array.isArray(raw.cells)
      ? raw.cells.map(parseCell).filter((c): c is Cell => c !== null)
      : []
    if (cells.length === 0) return null
    const activeCellId =
      typeof raw.activeCellId === 'string' && cells.some((c) => c.id === raw.activeCellId)
        ? raw.activeCellId
        : cells[0].id
    const schemaVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : SCHEMA_VERSION
    return { schemaVersion, cells, shape, activeCellId }
  } catch {
    return null
  }
}

// 永続化シード用の静的id空レイアウト。store は hydrate 時に nextId を再シードし id を癒すので、
// 固定 id '1'/'2' が実行時に衝突することはない。
export function emptyLayout(): Layout {
  return defaultLayout('1', '2')
}

export const isWatchlistItem = (v: unknown): v is WatchlistItem =>
  isRecord(v) &&
  typeof v.symbol === 'string' &&
  typeof v.name === 'string' &&
  typeof v.exchange === 'string'

function parseWorkspaceEntry(raw: unknown): Workspace | null {
  if (!isRecord(raw) || typeof raw.name !== 'string') return null
  const items = Array.isArray(raw.items) ? raw.items.filter(isWatchlistItem) : []
  const layout = parseLayout(raw.layout) ?? emptyLayout()
  return { name: raw.name, items, layout }
}

export function defaultWorkspaceCollection(): WorkspaceCollection {
  return { version: 3, active: 'Workspace 1', workspaces: [{ name: 'Workspace 1', items: [], layout: emptyLayout() }] }
}

// never throws。workspaces は最低1件、active は必ず実在名に正規化。
export function parseWorkspaceCollection(raw: unknown): WorkspaceCollection {
  if (!isRecord(raw)) return defaultWorkspaceCollection()
  const workspaces = Array.isArray(raw.workspaces)
    ? raw.workspaces.map(parseWorkspaceEntry).filter((w): w is Workspace => w !== null)
    : []
  if (workspaces.length === 0) return defaultWorkspaceCollection()
  const active =
    typeof raw.active === 'string' && workspaces.some((w) => w.name === raw.active)
      ? raw.active
      : workspaces[0].name
  return { version: 3, active, workspaces }
}
