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

export type DateRange = { from: number; to: number } | undefined
