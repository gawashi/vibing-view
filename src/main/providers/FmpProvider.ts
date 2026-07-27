import { subDays, subMonths, subYears } from 'date-fns'
import { fromZonedTime } from 'date-fns-tz'
import type { Bar, SymbolResult, Timeframe, DateRange, Quote, MarketStatus, CompanyProfileData, EconomicEvent, EconomicImpact } from '@shared/types'
import {
  fmpHistoricalResponse, fmpSearchResponse, fmpQuoteResponse, fmpMarketHoursResponse, fmpProfileResponse,
  fmpRatiosTtmResponse, fmpKeyMetricsTtmResponse, fmpGradesConsensusResponse,
  fmpPriceTargetConsensusResponse, fmpFinancialGrowthResponse, fmpEarningsResponse, fmpEconomicCalendarResponse
} from './fmp.schema'

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

// FMP の /economic-calendar の `date` は "2026-07-14 12:30:00" 形式でタイムゾーンマーカーを持たない。
// 実測で確定済み（2026-07-26）: 米 CPI = 08:30 ET は夏週で 12:30Z、冬週で 13:30Z と一致し、
// DST の切り替わりに追従している — つまりこの文字列はすでに UTC。
// これが SQLite の economic_days のキー（UTC 日）を決めるので、基準を変えるときは client.ts で
// DROP TABLE economic_days する — 1 週 1 リクエストの安いキャッシュなので捨てるほうが小さい。
function economicDateToEpochSeconds(s: string): number {
  const t = Date.parse(`${s.replace(' ', 'T')}Z`)
  // 未知の date 形式は行を通さない（economic_days のキーが壊れる）
  if (Number.isNaN(t)) throw new FmpHttpError(200, s)
  return Math.floor(t / 1000)
}

// 'YYYY-MM-DD' を UTC 日で n 日ずらす。date-fns の addDays はローカル時刻基準で DST をまたぐと
// 24h にならないので使わない。
function shiftUtcDay(day: string, n: number): string {
  return ymd(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000))
}

// Map なので 'constructor' のような prototype 由来のキーが引っかからない（未知の値は 'Low'）。
const ECONOMIC_IMPACT = new Map<string, EconomicImpact>([['high', 'High'], ['medium', 'Medium'], ['low', 'Low']])

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

  async getQuote(symbol: string): Promise<Quote> {
    const url = `${BASE}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${this.apiKey}`
    const rows = this.parseOrThrowHttpError(fmpQuoteResponse, await this.httpGetJson(url))
    const r = rows[0]
    if (!r) throw new FmpHttpError(200, rows)
    return {
      price: r.price, open: r.open, dayHigh: r.dayHigh, dayLow: r.dayLow,
      previousClose: r.previousClose, changePercentage: r.changePercentage,
      timestamp: r.timestamp, exchange: r.exchange
    }
  }

  async getMarketStatus(exchange = 'NASDAQ'): Promise<MarketStatus> {
    const url = `${BASE}/exchange-market-hours?exchange=${encodeURIComponent(exchange)}&apikey=${this.apiKey}`
    const rows = this.parseOrThrowHttpError(fmpMarketHoursResponse, await this.httpGetJson(url))
    const r = rows[0]
    if (!r) throw new FmpHttpError(200, rows)
    return { isOpen: r.isMarketOpen }
  }

  async getCompanyProfile(symbol: string): Promise<CompanyProfileData> {
    const sym = encodeURIComponent(symbol)
    // Required anchor: throws (FmpHttpError) on failure/empty → existing not-covered / error path.
    const profileRows = this.parseOrThrowHttpError(fmpProfileResponse, await this.httpGetJson(`${BASE}/profile?symbol=${sym}&apikey=${this.apiKey}`))
    const r = profileRows[0]
    if (!r) throw new FmpHttpError(200, profileRows)

    // Optional groups: fetch in parallel, never let one failure sink another. A rejected fetch,
    // an empty array, or a parse miss all collapse to a null group (→ "Not available" tab).
    const opt = async <T>(path: string, schema: { parse(v: unknown): T[] }): Promise<T | null> => {
      try {
        const rows = schema.parse(await this.httpGetJson(`${BASE}/${path}?symbol=${sym}&apikey=${this.apiKey}`))
        return rows[0] ?? null
      } catch {
        return null
      }
    }

    const [ratios, keyMetrics, grades, targets, growthRows, earnings] = await Promise.all([
      opt('ratios-ttm', fmpRatiosTtmResponse),
      opt('key-metrics-ttm', fmpKeyMetricsTtmResponse),
      opt('grades-consensus', fmpGradesConsensusResponse),
      opt('price-target-consensus', fmpPriceTargetConsensusResponse),
      // financial-growth returns newest-first; opt() already takes [0] = latest annual period.
      opt('financial-growth', fmpFinancialGrowthResponse),
      // earnings needs the whole array (next vs last), so fetch it raw and pick below.
      (async () => {
        try { return fmpEarningsResponse.parse(await this.httpGetJson(`${BASE}/earnings?symbol=${sym}&apikey=${this.apiKey}`)) }
        catch { return null }
      })()
    ])

    const valuation = ratios || keyMetrics ? {
      peRatio: ratios?.priceToEarningsRatioTTM ?? null,
      pbRatio: ratios?.priceToBookRatioTTM ?? null,
      psRatio: ratios?.priceToSalesRatioTTM ?? null,
      pegRatio: ratios?.priceToEarningsGrowthRatioTTM ?? null,
      dividendYield: ratios?.dividendYieldTTM ?? null,
      evToEbitda: keyMetrics?.evToEBITDATTM ?? null,
      earningsYield: keyMetrics?.earningsYieldTTM ?? null,
      fcfYield: keyMetrics?.freeCashFlowYieldTTM ?? null
    } : null

    const financials = ratios ? {
      roe: ratios.returnOnEquityTTM ?? null,
      roa: ratios.returnOnAssetsTTM ?? null,
      netMargin: ratios.netProfitMarginTTM ?? null,
      operatingMargin: ratios.operatingProfitMarginTTM ?? null,
      grossMargin: ratios.grossProfitMarginTTM ?? null,
      debtToEquity: ratios.debtToEquityRatioTTM ?? null,
      currentRatio: ratios.currentRatioTTM ?? null,
      quickRatio: ratios.quickRatioTTM ?? null
    } : null

    const analyst = grades || targets ? {
      strongBuy: grades?.strongBuy ?? null,
      buy: grades?.buy ?? null,
      hold: grades?.hold ?? null,
      sell: grades?.sell ?? null,
      strongSell: grades?.strongSell ?? null,
      consensus: grades?.consensus ?? null,
      targetHigh: targets?.targetHigh ?? null,
      targetLow: targets?.targetLow ?? null,
      targetMedian: targets?.targetMedian ?? null,
      targetConsensus: targets?.targetConsensus ?? null
    } : null

    const growth = growthRows ? {
      asOfDate: growthRows.date ?? null,
      revenueGrowth: growthRows.revenueGrowth ?? null,
      netIncomeGrowth: growthRows.netIncomeGrowth ?? null,
      epsGrowth: growthRows.epsgrowth ?? null
    } : null

    // Upcoming earnings carry epsActual === null, but historical rows can too (FMP gaps),
    // so require the date to be today or later before treating it as the next event.
    const today = new Date().toISOString().slice(0, 10)
    const upcoming = (earnings ?? [])
      .filter((e) => e.epsActual == null && e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))[0]
    // Future-dated rows can carry epsActual too — bound by today so they aren't shown as the last report.
    const reported = (earnings ?? [])
      .filter((e) => e.epsActual != null && e.date <= today)
      .sort((a, b) => b.date.localeCompare(a.date))[0]
    const schedule = earnings ? {
      nextEarningsDate: upcoming?.date ?? null,
      lastEarningsDate: reported?.date ?? null,
      lastEpsActual: reported?.epsActual ?? null,
      lastEpsEstimated: reported?.epsEstimated ?? null
    } : null

    return {
      symbol: r.symbol,
      companyName: r.companyName,
      image: r.image ?? null,
      exchange: r.exchange ?? null,
      sector: r.sector ?? null,
      industry: r.industry ?? null,
      country: r.country ?? null,
      marketCap: r.marketCap ?? null,
      ceo: r.ceo ?? null,
      fullTimeEmployees: r.fullTimeEmployees ?? null,
      ipoDate: r.ipoDate ?? null,
      website: r.website ?? null,
      description: r.description ?? null,
      beta: r.beta ?? null,
      range: r.range ?? null,
      volume: r.volume ?? null,
      averageVolume: r.averageVolume ?? null,
      lastDividend: r.lastDividend ?? null,
      price: r.price ?? null,
      valuation, financials, analyst, growth, schedule
    }
  }

  // from/to は UTC 日の 'YYYY-MM-DD'。範囲を両端 1 日広げる: UTC 日の端が欠ける可能性に備える
  // （実測では端の日は返っている、EC-02）。広げてもリクエストは 1 本のままで、範囲外の日は
  // EconomicCalendarService が捨てる。
  async getEconomicCalendar(from: string, to: string): Promise<EconomicEvent[]> {
    const url = `${BASE}/economic-calendar?from=${shiftUtcDay(from, -1)}&to=${shiftUtcDay(to, 1)}&apikey=${this.apiKey}`
    const rows = this.parseOrThrowHttpError(fmpEconomicCalendarResponse, await this.httpGetJson(url))
    return rows
      .map((r) => ({
        time: economicDateToEpochSeconds(r.date),
        country: r.country,
        currency: r.currency ?? null,
        event: r.event,
        impact: ECONOMIC_IMPACT.get((r.impact ?? '').toLowerCase()) ?? 'Low',
        previous: r.previous ?? null,
        estimate: r.estimate ?? null,
        actual: r.actual ?? null
      }))
      .sort((a, b) => a.time - b.time)
  }
}
