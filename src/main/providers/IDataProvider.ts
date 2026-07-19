import type { Bar, SymbolResult, Timeframe, DateRange } from '@shared/types'

export interface IDataProvider {
  searchSymbols(query: string): Promise<SymbolResult[]>
  getOHLCV(symbol: string, timeframe: Timeframe, range: DateRange): Promise<Bar[]>
}
