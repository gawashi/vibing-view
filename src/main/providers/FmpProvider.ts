import { subDays, subMonths, subYears } from 'date-fns'
import { fromZonedTime } from 'date-fns-tz'
import type { Bar, SymbolResult, Timeframe, DateRange } from '@shared/types'
import { fmpHistoricalResponse, fmpSearchResponse } from './fmp.schema'

// FMP migrated off /api/v3 (now returns 403 for current keys) to the /stable surface.
const BASE = 'https://financialmodelingprep.com/stable'

const INTRADAY_PATH: Record<'1m' | '5m' | '15m' | '1h', string> = {
  '1m': '1min', '5m': '5min', '15m': '15min', '1h': '1hour'
}

export type HttpGetJson = (url: string) => Promise<unknown>

// Carries the HTTP status + response body of a non-2xx FMP response so the capability
// classifier can tell 403 (requires-plan) from 429 (rate-limited) instead of a discarded message.
export class FmpHttpError extends Error {
  constructor(public readonly status: number, public readonly body: unknown) {
    super(`FMP HTTP ${status}`)
    this.name = 'FmpHttpError'
  }
}

export const defaultHttpGetJson: HttpGetJson = async (url) => {
  const res = await fetch(url)
  if (!res.ok) {
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      // non-JSON error body — leave body null, status alone is still classifiable
    }
    throw new FmpHttpError(res.status, body)
  }
  return res.json()
}

function dateToEpochSeconds(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000)
}

// Intraday timestamps are exchange-local (e.g. "2024-01-02 09:30:00", no tz marker) — convert
// via America/New_York rather than treating them as UTC (§3).
function nyDateTimeToEpochSeconds(s: string): number {
  return Math.floor(fromZonedTime(s, 'America/New_York').getTime() / 1000)
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ponytail: 1m span approximated as 7 calendar days (covers "last 5 trading days" across a
// weekend); swap to an exchange-calendar trading-day count if coverage proves short (§4).
function intradayInitialRange(tf: '1m' | '5m' | '15m' | '1h'): { from: string; to: string } {
  const now = new Date()
  const from =
    tf === '1m' ? subDays(now, 7)
      : tf === '5m' ? subMonths(now, 1)
      : tf === '15m' ? subMonths(now, 3)
      : subYears(now, 1)
  return { from: ymd(from), to: ymd(now) }
}

export class FmpProvider {
  private readonly apiKey: string
  private readonly httpGetJson: HttpGetJson

  constructor(opts: { apiKey: string; httpGetJson?: HttpGetJson }) {
    this.apiKey = opts.apiKey
    this.httpGetJson = opts.httpGetJson ?? defaultHttpGetJson
  }

  // A zod parse failure on an HTTP-200 body IS the "error-shaped payload" requires-plan signal
  // (§7) — re-throw as FmpHttpError(200, rawBody) so ipc.ts's existing FmpHttpError branch
  // classifies it, instead of letting a bare ZodError propagate uncategorized.
  private parseOrThrowHttpError<T>(schema: { parse(v: unknown): T }, rawBody: unknown): T {
    try {
      return schema.parse(rawBody)
    } catch {
      throw new FmpHttpError(200, rawBody)
    }
  }

  async searchSymbols(query: string): Promise<SymbolResult[]> {
    const q = encodeURIComponent(query)
    const fetchEndpoint = async (endpoint: 'search-symbol' | 'search-name'): Promise<SymbolResult[]> => {
      const url = `${BASE}/${endpoint}?query=${q}&limit=50&apikey=${this.apiKey}`
      // zod .parse throws on error-shaped payloads → never surfaces bad data
      const rows = fmpSearchResponse.parse(await this.httpGetJson(url))
      return rows.map((r) => ({
        symbol: r.symbol,
        name: r.name ?? r.symbol,
        exchange: r.exchange ?? r.exchangeFullName ?? ''
      }))
    }

    // search-symbol (ticker) first so exact-ticker matches sort above name matches; dedup by symbol
    // with the earlier (search-symbol) entry winning. Tolerate one endpoint failing (rate-limit etc).
    const [bySymbol, byName] = await Promise.allSettled([
      fetchEndpoint('search-symbol'),
      fetchEndpoint('search-name')
    ])
    if (bySymbol.status === 'rejected' && byName.status === 'rejected') throw bySymbol.reason

    const seen = new Set<string>()
    const merged: SymbolResult[] = []
    for (const settled of [bySymbol, byName]) {
      if (settled.status !== 'fulfilled') continue
      for (const r of settled.value) {
        if (seen.has(r.symbol)) continue
        seen.add(r.symbol)
        merged.push(r)
      }
    }
    return merged
  }

  async getOHLCV(symbol: string, timeframe: Timeframe, range: DateRange): Promise<Bar[]> {
    if (timeframe === '1w' || timeframe === '1M') {
      // Derived-only (never fetched/cached) — aggregated from cached '1d' bars (§2/§6).
      throw new Error('DERIVED_TIMEFRAME_NOT_FETCHABLE')
    }

    if (timeframe === '1d') {
      // P1: daily EOD only, full history in one request (D-08).
      const url = `${BASE}/historical-price-eod/full?symbol=${encodeURIComponent(symbol)}&apikey=${this.apiKey}`
      const rawBody = await this.httpGetJson(url)
      const parsed = this.parseOrThrowHttpError(fmpHistoricalResponse, rawBody)
      return parsed
        .map((r) => ({
          time: dateToEpochSeconds(r.date),
          open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume
        }))
        .sort((a, b) => a.time - b.time) // FMP returns newest-first; charts need ascending
    }

    const { from, to } = range
      ? { from: ymd(new Date(range.from * 1000)), to: ymd(new Date(range.to * 1000)) }
      : intradayInitialRange(timeframe)
    const url = `${BASE}/historical-chart/${INTRADAY_PATH[timeframe]}?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&apikey=${this.apiKey}`
    const rawBody = await this.httpGetJson(url)
    const parsed = this.parseOrThrowHttpError(fmpHistoricalResponse, rawBody)
    return parsed
      .map((r) => ({
        time: nyDateTimeToEpochSeconds(r.date),
        open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume
      }))
      .sort((a, b) => a.time - b.time) // FMP returns newest-first; charts need ascending
  }
}
