export type Timeframe = '1m' | '5m' | '15m' | '1h' | '1d' | '1w' | '1M'

export type Bar = {
  time: number // UTC epoch seconds
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type SymbolResult = {
  symbol: string
  name: string
  exchange: string
}

export type WatchlistItem = { symbol: string; name: string; exchange: string }

export type DateRange = { from: number; to: number } | undefined

export type Params = Record<string, number | string>

export type IndicatorInstance = {
  id: string
  type: string
  params: Params
  colors: Record<string, string>
  visible: boolean
  // Always-on, user-immutable instance (Volume, D-34) — removeIndicator ignores it and its
  // legend hides the eye/gear/× affordances. ma/bb/rsi instances omit it (undefined = false).
  fixed?: boolean
}

export type GridShape = '1x1' | '2x1' | '2x2'

export type Cell = {
  id: string
  symbol: string | null
  timeframe: Timeframe
  indicators: IndicatorInstance[]
}

export type Workspace = {
  schemaVersion: number
  cells: Cell[]
  shape: GridShape
  activeCellId: string
}
