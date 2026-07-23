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

// Copy/paste payload for a chart cell's config (no cell id — paste re-mints ids). Held in the
// main process and synced across windows; never persisted (SQLite = OHLCV / JSON = prefs only).
// `cutSourceCellId` is set only by a Cut (deferred move): the source cell stays visible/greyed
// until a paste, which then empties it. It rides inside the clipboard so cross-window sync carries
// the pending-cut marker for free. Undefined for a Copy.
export type ClipboardCell = {
  symbol: string
  timeframe: Timeframe
  indicators: IndicatorInstance[]
  cutSourceCellId?: string
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

// 会社情報ダイアログ用（既存 SymbolResult/profile とは別物 — company 名前空間）。
// nullable なのは FMP profile が欠損しうるため。数値は string 混在を coerce 済み。
export type CompanyProfileData = {
  symbol: string
  companyName: string
  image: string | null
  exchange: string | null
  sector: string | null
  industry: string | null
  country: string | null
  marketCap: number | null
  ceo: string | null
  fullTimeEmployees: number | null
  ipoDate: string | null
  website: string | null
  description: string | null
  beta: number | null
  range: string | null
  volume: number | null
  averageVolume: number | null
  lastDividend: number | null
}

// fetchedAt は列で持ちダイアログの「as of YYYY-MM-DD」表記に使う（blob には含めない）。
export type CompanyInfo = CompanyProfileData & { fetchedAt: number }
