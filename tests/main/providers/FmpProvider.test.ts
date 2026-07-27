import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { FmpProvider, FmpHttpError } from '../../../src/main/providers/FmpProvider'
import { classify } from '../../../src/main/capabilityClassifier'
import { fmpQuoteResponse, fmpMarketHoursResponse } from '../../../src/main/providers/fmp.schema'

const fx = (name: string) => JSON.parse(readFileSync(join(__dirname, '../../fixtures', name), 'utf8'))
const provider = (payload: unknown) =>
  new FmpProvider({ apiKey: 'k', httpGetJson: async () => payload })

describe('FmpProvider.getOHLCV', () => {
  it('maps historical bars to ascending epoch-seconds Bars', async () => {
    const bars = await provider(fx('fmp-historical.json')).getOHLCV('AAPL', '1d', undefined)
    expect(bars).toHaveLength(2)
    expect(bars[0].time).toBe(Math.floor(Date.parse('2024-01-02T00:00:00Z') / 1000))
    expect(bars[1].time).toBe(Math.floor(Date.parse('2024-01-03T00:00:00Z') / 1000))
    expect(bars[0].time).toBeLessThan(bars[1].time) // ascending
    expect(bars[1].close).toBe(184.25)
  })
  it('throws on an error-shaped 200 payload, never returning bars', async () => {
    await expect(provider(fx('fmp-error.json')).getOHLCV('AAPL', '1d', undefined)).rejects.toThrow()
  })

  it('wraps an error-shaped 200 payload as FmpHttpError(200, body) so the capability cache can classify it', async () => {
    const body = fx('fmp-error.json')
    let caught: unknown
    try {
      await provider(body).getOHLCV('AAPL', '1d', undefined)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(FmpHttpError)
    const httpErr = caught as FmpHttpError
    expect(httpErr.status).toBe(200)
    expect(httpErr.body).toEqual(body)
    expect(classify(httpErr.status, httpErr.body)).toBe('requires-plan')
  })
})

describe('FmpProvider.getOHLCV — intraday', () => {
  it.each([
    ['1m', '1min'],
    ['5m', '5min'],
    ['15m', '15min'],
    ['1h', '1hour']
  ] as const)('tf %s calls historical-chart/%s with from= and to=', async (tf, path) => {
    const httpGetJson = vi.fn(async (_url: string) => fx('fmp-intraday.json'))
    const p = new FmpProvider({ apiKey: 'k', httpGetJson })
    await p.getOHLCV('AAPL', tf, undefined)
    expect(httpGetJson).toHaveBeenCalledTimes(1)
    const url = httpGetJson.mock.calls[0][0]
    expect(url).toContain(`historical-chart/${path}`)
    expect(url).toMatch(/from=\d{4}-\d{2}-\d{2}/)
    expect(url).toMatch(/to=\d{4}-\d{2}-\d{2}/)
  })

  it('maps NY-local timestamps to UTC epoch and sorts ascending', async () => {
    const bars = await provider(fx('fmp-intraday.json')).getOHLCV('AAPL', '1h', undefined)
    expect(bars).toHaveLength(2)
    // "2024-01-02 09:30:00" is NY-local (EST, UTC-5 in January) -> 14:30Z, not 00:00Z.
    expect(bars[0].time).toBe(Math.floor(Date.parse('2024-01-02T14:30:00Z') / 1000))
    expect(bars[1].time).toBe(Math.floor(Date.parse('2024-01-02T14:31:00Z') / 1000))
    expect(bars[0].time).toBeLessThan(bars[1].time) // fixture is newest-first; output must be ascending
  })

  it.each(['1w', '1M'] as const)('tf %s throws and never calls httpGetJson', async (tf) => {
    const httpGetJson = vi.fn(async (_url: string) => fx('fmp-intraday.json'))
    const p = new FmpProvider({ apiKey: 'k', httpGetJson })
    await expect(p.getOHLCV('AAPL', tf, undefined)).rejects.toThrow()
    expect(httpGetJson).not.toHaveBeenCalled()
  })
})

describe('FmpProvider.searchSymbols', () => {
  it('maps search results to SymbolResult, preferring the exchange short code', async () => {
    const results = await provider(fx('fmp-search.json')).searchSymbols('AAPL')
    expect(results[0]).toEqual({ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' })
    expect(results).toHaveLength(2)
  })

  it('queries both search-symbol and search-name, merging and deduping by symbol', async () => {
    const httpGetJson = vi.fn(async (url: string) => {
      if (url.includes('search-symbol')) return [{ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }]
      if (url.includes('search-name')) return [
        { symbol: 'AAPL', name: 'Apple Inc. (dup)', exchange: 'NASDAQ' }, // dup — search-symbol wins
        { symbol: 'APLE', name: 'Apple Hospitality REIT', exchange: 'NYSE' }
      ]
      throw new Error(`unexpected url ${url}`)
    })
    const results = await new FmpProvider({ apiKey: 'k', httpGetJson }).searchSymbols('apple')
    expect(httpGetJson).toHaveBeenCalledTimes(2)
    expect(httpGetJson.mock.calls.some((c) => c[0].includes('search-symbol'))).toBe(true)
    expect(httpGetJson.mock.calls.some((c) => c[0].includes('search-name'))).toBe(true)
    expect(results.map((r) => r.symbol)).toEqual(['AAPL', 'APLE'])
    expect(results[0].name).toBe('Apple Inc.') // search-symbol wins the dup
  })

  it('requests limit=50 on both endpoints', async () => {
    const httpGetJson = vi.fn(async (_url: string) => [])
    await new FmpProvider({ apiKey: 'k', httpGetJson }).searchSymbols('x')
    expect(httpGetJson.mock.calls.every((c) => c[0].includes('limit=50'))).toBe(true)
  })

  it('returns the surviving endpoint results when the other fails', async () => {
    const httpGetJson = vi.fn(async (url: string) => {
      if (url.includes('search-symbol')) throw new Error('rate limited')
      return [{ symbol: 'APLE', name: 'Apple Hospitality REIT', exchange: 'NYSE' }]
    })
    const results = await new FmpProvider({ apiKey: 'k', httpGetJson }).searchSymbols('apple')
    expect(results.map((r) => r.symbol)).toEqual(['APLE'])
  })

  it('throws only when both endpoints fail', async () => {
    const httpGetJson = vi.fn(async (_url: string) => { throw new Error('down') })
    await expect(new FmpProvider({ apiKey: 'k', httpGetJson }).searchSymbols('apple')).rejects.toThrow()
  })
})

describe('FmpProvider.getQuote', () => {
  it('maps the first quote row to a Quote', async () => {
    const q = await provider(fx('fmp-quote.json')).getQuote('AAPL')
    expect(q).toEqual({
      price: 326.59, open: 333.025, dayHigh: 333.71, dayLow: 323.7,
      previousClose: 333.74, changePercentage: -2.14239, timestamp: 1784577600, exchange: 'NASDAQ'
    })
  })
  it('calls /stable/quote with the symbol', async () => {
    const httpGetJson = vi.fn(async (_url: string) => fx('fmp-quote.json'))
    await new FmpProvider({ apiKey: 'k', httpGetJson }).getQuote('AAPL')
    expect(httpGetJson.mock.calls[0][0]).toContain('/quote?symbol=AAPL')
  })
  it('wraps an error-shaped 200 payload as FmpHttpError(200) so it classifies to requires-plan', async () => {
    let caught: unknown
    try { await provider(fx('fmp-error.json')).getQuote('AAPL') } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(FmpHttpError)
    expect(classify((caught as FmpHttpError).status, (caught as FmpHttpError).body)).toBe('requires-plan')
  })
})

describe('FmpProvider.getMarketStatus', () => {
  it('reads isMarketOpen from the first row', async () => {
    const s = await provider(fx('fmp-market-hours.json')).getMarketStatus()
    expect(s).toEqual({ isOpen: false })
  })
  it('defaults to the NASDAQ exchange', async () => {
    const httpGetJson = vi.fn(async (_url: string) => fx('fmp-market-hours.json'))
    await new FmpProvider({ apiKey: 'k', httpGetJson }).getMarketStatus()
    expect(httpGetJson.mock.calls[0][0]).toContain('exchange-market-hours?exchange=NASDAQ')
  })
})

describe('FmpProvider.getCompanyProfile', () => {
  // Earnings selection compares against `new Date()`; pin it so the fixture's
  // past/future rows keep their meaning as real time moves on.
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-07-25T00:00:00Z') }) })
  afterEach(() => { vi.useRealTimers() })

  // URL-routed fake: /profile + 6 optional endpoints. Mirrors the searchSymbols multi-endpoint pattern.
  const routed = (over: Record<string, unknown> = {}) => {
    const map: Record<string, string> = {
      '/profile': 'fmp-profile.json',
      'ratios-ttm': 'fmp-ratios-ttm.json',
      'key-metrics-ttm': 'fmp-key-metrics-ttm.json',
      'grades-consensus': 'fmp-grades-consensus.json',
      'price-target-consensus': 'fmp-price-target-consensus.json',
      'financial-growth': 'fmp-financial-growth.json',
      'earnings': 'fmp-earnings.json'
    }
    return new FmpProvider({ apiKey: 'k', httpGetJson: async (url: string) => {
      for (const key of Object.keys(over)) if (url.includes(key)) {
        const v = over[key]
        if (v instanceof Error) throw v
        return v
      }
      for (const [key, file] of Object.entries(map)) if (url.includes(key)) return fx(file)
      throw new Error(`unexpected url ${url}`)
    } })
  }

  it('merges profile + all six optional groups on the happy path', async () => {
    const c = await routed().getCompanyProfile('AAPL')
    expect(c.symbol).toBe('AAPL')
    expect(c.price).toBe(245.5)
    expect(c.valuation?.peRatio).toBe(24.31)
    expect(c.valuation?.dividendYield).toBe(0.0045)
    expect(c.valuation?.evToEbitda).toBe(26.4)
    expect(c.financials?.roe).toBe(1.47)
    expect(c.financials?.debtToEquity).toBe(1.87)
    expect(c.analyst?.buy).toBe(21)
    expect(c.analyst?.consensus).toBe('Buy')
    expect(c.analyst?.targetConsensus).toBe(258.4)
    expect(c.growth?.revenueGrowth).toBe(0.08) // latest (element [0]) fiscal year
    expect(c.growth?.asOfDate).toBe('2025-09-27') // fiscal period end of element [0]
    expect(c.schedule?.nextEarningsDate).toBe('2026-10-30') // soonest row with epsActual == null
    // 2026-07-31 also carries an epsActual but is in the future, so 2026-05-01 is the last report.
    expect(c.schedule?.lastEarningsDate).toBe('2026-05-01')
    expect(c.schedule?.lastEpsActual).toBe(1.52)
    expect(c.schedule?.lastEpsEstimated).toBe(1.5)
  })

  it('nulls the whole last-report trio when no earnings row is both reported and past', async () => {
    const c = await routed({ 'earnings': [
      { date: '2026-10-30', epsActual: null, epsEstimated: 1.55 },
      { date: '2026-07-31', epsActual: 1.4, epsEstimated: 1.35 }
    ] }).getCompanyProfile('AAPL')
    expect(c.schedule?.lastEarningsDate).toBeNull()
    expect(c.schedule?.lastEpsActual).toBeNull()
    expect(c.schedule?.lastEpsEstimated).toBeNull()
    expect(c.schedule?.nextEarningsDate).toBe('2026-10-30') // upcoming still resolves
  })

  it('keeps a partial valuation from key-metrics when ratios-ttm fails, but nulls financials', async () => {
    const c = await routed({ 'ratios-ttm': new Error('rate limited') }).getCompanyProfile('AAPL')
    expect(c.valuation).not.toBeNull()
    expect(c.valuation?.peRatio).toBeNull() // ratios source failed
    expect(c.valuation?.evToEbitda).toBe(26.4) // key-metrics source succeeded
    expect(c.financials).toBeNull() // financials has no key-metrics source
    expect(c.analyst?.buy).toBe(21) // unaffected
    expect(c.symbol).toBe('AAPL')
  })

  it('still throws when /profile itself fails (no partial anchor)', async () => {
    await expect(routed({ '/profile': [] }).getCompanyProfile('AAPL')).rejects.toBeInstanceOf(FmpHttpError)
  })

  it('calls /stable/profile with the symbol', async () => {
    const httpGetJson = vi.fn(async (url: string) => (url.includes('/profile') ? fx('fmp-profile.json') : []))
    await new FmpProvider({ apiKey: 'k', httpGetJson }).getCompanyProfile('AAPL')
    expect(httpGetJson.mock.calls.some((cc) => cc[0].includes('/profile?symbol=AAPL'))).toBe(true)
  })
})

describe('FmpProvider.getEconomicCalendar', () => {
  // 夏週/冬週の米 CPI の暦日。Task 1 の fixture から転記（08:30 ET 発表という事実で epoch を固定する）。
  const CPI_SUMMER_DAY = '2026-07-14' // ← fixture の date の先頭 10 文字に合わせる
  const CPI_WINTER_DAY = '2026-01-13' // ← 同上（winter fixture）

  const cpiOf = (events: { time: number; event: string; country: string }[]) =>
    events.find((e) => e.country === 'US' && /CPI/i.test(e.event))!

  it('maps the summer CPI row to 08:30 America/New_York (= 12:30Z under EDT)', async () => {
    const events = await provider(fx('fmp-economic-calendar.json')).getEconomicCalendar('2026-07-13', '2026-07-17')
    expect(cpiOf(events).time).toBe(Math.floor(Date.parse(`${CPI_SUMMER_DAY}T12:30:00Z`) / 1000))
  })

  it('maps the winter CPI row to 08:30 America/New_York (= 13:30Z under EST)', async () => {
    const events = await provider(fx('fmp-economic-calendar-winter.json')).getEconomicCalendar('2026-01-12', '2026-01-16')
    expect(cpiOf(events).time).toBe(Math.floor(Date.parse(`${CPI_WINTER_DAY}T13:30:00Z`) / 1000))
  })

  it('returns events sorted ascending by time', async () => {
    const events = await provider(fx('fmp-economic-calendar.json')).getEconomicCalendar('2026-07-13', '2026-07-17')
    expect(events.length).toBeGreaterThan(1)
    expect(events.map((e) => e.time)).toEqual([...events.map((e) => e.time)].sort((a, b) => a - b))
  })

  // 要求範囲を両端 1 日広げる（EC-02）。端が欠ける可能性への備え。リクエスト数は変わらない。
  it('widens the requested range by one day on each end', async () => {
    const httpGetJson = vi.fn(async (_url: string) => fx('fmp-economic-calendar.json'))
    await new FmpProvider({ apiKey: 'k', httpGetJson }).getEconomicCalendar('2026-07-13', '2026-07-17')
    expect(httpGetJson).toHaveBeenCalledTimes(1)
    const url = httpGetJson.mock.calls[0][0]
    expect(url).toContain('/economic-calendar?')
    expect(url).toContain('from=2026-07-12')
    expect(url).toContain('to=2026-07-18')
  })

  // DST 境界回帰: shiftUtcDay が addDays（ローカル時刻基準）だと America/New_York 等で 1 日ずれる。
  // UTC 固定演算なら実行環境の TZ によらず常に成立する。
  it('widens correctly across a DST-transition week (regression)', async () => {
    const httpGetJson = vi.fn(async (_url: string) => fx('fmp-economic-calendar.json'))
    await new FmpProvider({ apiKey: 'k', httpGetJson }).getEconomicCalendar('2026-03-02', '2026-03-08')
    const url = httpGetJson.mock.calls[0][0]
    expect(url).toContain('from=2026-03-01')
    expect(url).toContain('to=2026-03-09')
  })

  // 以下 3 件は手書きの合成行。fixture には入れない（実レスポンスの verbatim 性を保つため）。
  it('normalizes an unknown impact to Low (EC-03)', async () => {
    const rows = [
      { date: '2026-07-14 12:30:00', country: 'US', currency: 'USD', event: 'A', previous: 1, estimate: 2, actual: 3, impact: '' },
      { date: '2026-07-14 13:30:00', country: 'US', currency: 'USD', event: 'B', previous: 1, estimate: 2, actual: 3, impact: 'None' },
      { date: '2026-07-14 14:30:00', country: 'US', currency: 'USD', event: 'C', previous: 1, estimate: 2, actual: 3, impact: 'Holiday' },
      { date: '2026-07-14 15:30:00', country: 'US', currency: 'USD', event: 'D', previous: 1, estimate: 2, actual: 3, impact: null }
    ]
    const events = await provider(rows).getEconomicCalendar('2026-07-14', '2026-07-14')
    expect(events.map((e) => e.impact)).toEqual(['Low', 'Low', 'Low', 'Low'])
  })

  it('keeps High/Medium/Low case-insensitively', async () => {
    const rows = ['high', 'Medium', 'LOW'].map((impact, i) => ({
      date: `2026-07-14 1${i}:00:00`, country: 'US', currency: 'USD', event: `E${i}`,
      previous: null, estimate: null, actual: null, impact
    }))
    const events = await provider(rows).getEconomicCalendar('2026-07-14', '2026-07-14')
    expect(events.map((e) => e.impact)).toEqual(['High', 'Medium', 'Low'])
  })

  it('passes through nulls: unreleased actual, and the all-null FOMC shape', async () => {
    const rows = [
      { date: '2026-07-14 12:30:00', country: 'US', currency: 'USD', event: 'CPI MoM', previous: 0.2, estimate: 0.3, actual: null, impact: 'High' },
      { date: '2026-07-14 18:00:00', country: 'US', currency: null, event: 'FOMC Rate Decision', previous: null, estimate: null, actual: null, impact: 'High' }
    ]
    const events = await provider(rows).getEconomicCalendar('2026-07-14', '2026-07-14')
    expect(events[0]).toMatchObject({ event: 'CPI MoM', previous: 0.2, estimate: 0.3, actual: null })
    expect(events[1]).toMatchObject({ event: 'FOMC Rate Decision', currency: null, previous: null, estimate: null, actual: null })
  })

  it('wraps an error-shaped 200 payload as FmpHttpError(200) so core can classify it', async () => {
    let caught: unknown
    try { await provider(fx('fmp-error.json')).getEconomicCalendar('2026-07-13', '2026-07-17') } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(FmpHttpError)
    expect(classify((caught as FmpHttpError).status, (caught as FmpHttpError).body)).toBe('requires-plan')
  })

  // 未知の date 形式は NaN ではなく FmpHttpError にする（economic_days のキーを壊さない）。
  it('throws FmpHttpError instead of yielding time: NaN for an unparseable date', async () => {
    const rows = [
      { date: 'All Day', country: 'US', currency: 'USD', event: 'Bank Holiday', previous: null, estimate: null, actual: null, impact: 'Low' }
    ]
    let caught: unknown
    try { await provider(rows).getEconomicCalendar('2026-07-14', '2026-07-14') } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(FmpHttpError)
  })
})
