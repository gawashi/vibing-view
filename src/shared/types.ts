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

export type WatchlistItem = SymbolResult

export type NamedWatchlist = { name: string; items: WatchlistItem[] }

// version は将来のスキーマ変更検知用。lists は最低1件を getWatchlists が保証する。
export type WatchlistCollection = {
  version: 2
  active: string
  lists: NamedWatchlist[]
}

export type Quote = {
  price: number
  open: number
  dayHigh: number
  dayLow: number
  previousClose: number
  changePercentage: number
  timestamp: number // epoch seconds
  exchange: string
}

export type MarketStatus = { isOpen: boolean }

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

export type GridShape = { rows: number; cols: number }

export type Cell = {
  id: string
  symbol: string | null
  timeframe: Timeframe
  indicators: IndicatorInstance[]
}

export type Layout = {
  schemaVersion: number
  cells: Cell[]
  shape: GridShape
  activeCellId: string
}

// 名前付き作業コンテキスト = ウォッチリスト + グリッドレイアウト
export type Workspace = {
  name: string
  items: WatchlistItem[]
  layout: Layout
}

export type WorkspaceCollection = {
  version: 3
  active: string
  workspaces: Workspace[]
}
