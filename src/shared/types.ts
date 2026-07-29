// 表示順そのまま。Timeframe 型はこの配列から導出するので、増やすときはここだけ触る。
export const TIMEFRAMES = ['1m', '5m', '15m', '1h', '1d', '1w', '1M'] as const
export type Timeframe = (typeof TIMEFRAMES)[number]
// '1w'/'1M' は日足から導出するだけで自前の行を持たない（D-17）。能力ゲートも常に available。
export const DERIVED_TIMEFRAMES: readonly Timeframe[] = ['1w', '1M']
export const DAILY_BACKED_TIMEFRAMES: readonly Timeframe[] = ['1d', '1w', '1M']

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
export type ClipboardCell = {
  symbol: string
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
  // Investment metrics (added 2026-07-23). Optional so pre-existing cached rows (which lack
  // these keys and parse back as undefined) stay valid. A fresh fetch always sets each group,
  // to null if its endpoint failed. Consumers must test `group == null` (undefined OR null).
  price?: number | null // from /profile, for the Analyst price-target comparison
  valuation?: {
    peRatio: number | null
    pbRatio: number | null
    psRatio: number | null
    pegRatio: number | null
    dividendYield: number | null
    evToEbitda: number | null
    earningsYield: number | null
    fcfYield: number | null
  } | null
  financials?: {
    roe: number | null
    roa: number | null
    netMargin: number | null
    operatingMargin: number | null
    grossMargin: number | null
    debtToEquity: number | null
    currentRatio: number | null
    quickRatio: number | null
  } | null
  analyst?: {
    strongBuy: number | null
    buy: number | null
    hold: number | null
    sell: number | null
    strongSell: number | null
    consensus: string | null
    targetHigh: number | null
    targetLow: number | null
    targetMedian: number | null
    targetConsensus: number | null
  } | null
  // asOfDate (growth's fiscal period end) / lastEarningsDate are optional: blobs cached
  // before 2026-07-25 lack the key and parse back as undefined.
  growth?: {
    asOfDate?: string | null
    revenueGrowth: number | null
    netIncomeGrowth: number | null
    epsGrowth: number | null
  } | null
  schedule?: {
    nextEarningsDate: string | null
    lastEarningsDate?: string | null
    lastEpsActual: number | null
    lastEpsEstimated: number | null
  } | null
}

// fetchedAt は列で持ちダイアログの「as of YYYY-MM-DD」表記に使う（blob には含めない）。
// stale は「取得に失敗してキャッシュを返した」フラグ。永続化はしない（blob 外）。
export type CompanyInfo = CompanyProfileData & { fetchedAt: number; stale?: boolean }

// ── 経済カレンダー ──────────────────────────────────────────────────────────
export type EconomicImpact = 'High' | 'Medium' | 'Low'

export type EconomicEvent = {
  time: number            // UTC epoch 秒（Bar.time と同じ規約）
  country: string         // 'US' など、FMP が返すコードそのまま
  currency: string | null
  event: string           // 指標名。FMP は説明文を返さない
  impact: EconomicImpact
  previous: number | null
  estimate: number | null
  actual: number | null   // 未発表なら null
}

// getRange の戻り。fetchedAt は要求した日のうち最も古い取得時刻（一番古い情報がいつのものか）。
// stale は「古い行を返した、再取得は失敗した」— fetchedAt だけでは区別できない（CompanyInfo と同じ）。
// events は常に要求範囲の全日をカバーする（欠けがあれば throw、EC-18）。部分的な範囲は返らない。
export type EconomicRange = { events: EconomicEvent[]; fetchedAt: number; stale?: boolean }

// 国フィルタは単一選択のプリセット（EC-11）。データ由来の動的な国リストは持たない。
export type EconomicCountryPreset = 'us' | 'major' | 'all'
// settings.json の economicFilter。テキストフィルタは永続化しない（EC-13）。
export type EconomicFilterPref = { countries: EconomicCountryPreset; impacts: EconomicImpact[] }

// ── 統計指標（経済データ） ──────────────────────────────────────────────────────────
// 統計指標（/economic-indicators）。date は 'YYYY-MM-DD' の日付のみで、epoch に変換しない —
// API が時刻を返さないので、UTC/ET のどちらで解釈しても同じ日を指す（economic-calendar とは異なる）。
export type EconomicIndicatorPoint = { date: string; value: number }

// 取得地平。エンドポイントが 90 日窓しか返さないので（EI-01）、全履歴は現実的な回数で取れない。
// 1Y = 約 5 リクエスト、5Y = 約 22 リクエスト。10Y / Max は落とした。
// service / IPC / renderer が同じ値集合を見るので shared に置く。
export type EconomicIndicatorYears = 1 | 5

// fetchedAt は返した points の取得時刻（データの古さ）。stale は「古い points を返した、更新は
// できなかった」— fetchedAt だけでは区別できない（CompanyInfo と同じ理由）。
// coveredFrom は遡って取得済みの下限 'YYYY-MM-DD'。「表示中の地平が実際にどこまで埋まっているか」を
// As of 行に出すために持つ（renderer が再取得の判断をするためではない）。
export type EconomicIndicatorSeries = {
  name: string
  points: EconomicIndicatorPoint[] // date 昇順
  coveredFrom: string
  fetchedAt: number
  stale?: boolean
}
