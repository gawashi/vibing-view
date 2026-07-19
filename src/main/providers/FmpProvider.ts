import type { Bar, SymbolResult, Timeframe, DateRange } from '@shared/types'
import type { IDataProvider } from './IDataProvider'
import { fmpHistoricalResponse, fmpSearchResponse } from './fmp.schema'

// FMP migrated off /api/v3 (now returns 403 for current keys) to the /stable surface.
const BASE = 'https://financialmodelingprep.com/stable'

type HttpGetJson = (url: string) => Promise<unknown>

const defaultHttpGetJson: HttpGetJson = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`FMP HTTP ${res.status}`)
  return res.json()
}

function dateToEpochSeconds(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000)
}

export class FmpProvider implements IDataProvider {
  private readonly apiKey: string
  private readonly httpGetJson: HttpGetJson

  constructor(opts: { apiKey: string; httpGetJson?: HttpGetJson }) {
    this.apiKey = opts.apiKey
    this.httpGetJson = opts.httpGetJson ?? defaultHttpGetJson
  }

  async searchSymbols(query: string): Promise<SymbolResult[]> {
    const url = `${BASE}/search-symbol?query=${encodeURIComponent(query)}&limit=8&apikey=${this.apiKey}`
    // zod .parse throws on error-shaped payloads → never surfaces bad data
    const rows = fmpSearchResponse.parse(await this.httpGetJson(url))
    return rows.map((r) => ({
      symbol: r.symbol,
      name: r.name ?? r.symbol,
      exchange: r.exchange ?? r.exchangeFullName ?? ''
    }))
  }

  async getOHLCV(symbol: string, _timeframe: Timeframe, _range: DateRange): Promise<Bar[]> {
    // P1: daily EOD only, full history in one request (D-08). timeframe/range are the P2 seam.
    const url = `${BASE}/historical-price-eod/full?symbol=${encodeURIComponent(symbol)}&apikey=${this.apiKey}`
    const parsed = fmpHistoricalResponse.parse(await this.httpGetJson(url))
    return parsed
      .map((r) => ({
        time: dateToEpochSeconds(r.date),
        open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume
      }))
      .sort((a, b) => a.time - b.time) // FMP returns newest-first; charts need ascending
  }
}
