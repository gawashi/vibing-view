import type { Cell, GridShape, IndicatorInstance, Timeframe, Workspace } from '@shared/types'

// Bump when Workspace's shape changes incompatibly. parseWorkspace stays forward-compatible
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
    symbol: 'AAPL',
    timeframe: '1d',
    indicators: [{ id: volId, type: 'volume', params: {}, colors: {}, visible: true, fixed: true }]
  }
}

// Deep copy of src with a fresh cell id and freshly-minted indicator instance ids (duplicated
// indicators must not share ids across cells, D-55). Caller (store) mints newId/newIndicatorIds
// so this stays pure/id-gen-free. newIndicatorIds must be parallel to src.indicators.
export function duplicateCell(src: Cell, newId: string, newIndicatorIds: string[]): Cell {
  return {
    ...src,
    id: newId,
    indicators: src.indicators.map((ind, i) => ({
      ...ind,
      id: newIndicatorIds[i],
      params: { ...ind.params },
      colors: { ...ind.colors }
    }))
  }
}

// First-ever-launch default: 1x1 grid, one AAPL cell (D-59).
export function defaultWorkspace(cellId: string, volId: string): Workspace {
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

// Validates/coerces arbitrary persisted or malformed JSON into a Workspace. Never throws —
// unresolvable input (not an object at all) returns null; everything else is coerced/defaulted
// (forward-compatible partial-state restore, T-05-01).
export function parseWorkspace(raw: unknown): Workspace | null {
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
