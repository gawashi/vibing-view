import { describe, it, expect, vi } from 'vitest'
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
  it('maps the first row to CompanyProfileData, coercing string numbers', async () => {
    const c = await provider(fx('fmp-profile.json')).getCompanyProfile('AAPL')
    expect(c.symbol).toBe('AAPL')
    expect(c.companyName).toBe('Apple Inc.')
    expect(c.exchange).toBe('NASDAQ')
    expect(c.marketCap).toBe(3400000000000)
    expect(c.fullTimeEmployees).toBe(164000) // "164000" string coerced to number
    expect(c.beta).toBe(1.24)
    expect(c.image).toBe('https://images.financialmodelingprep.com/symbol/AAPL.png')
  })

  it('calls /stable/profile with the symbol', async () => {
    const httpGetJson = vi.fn(async (_url: string) => fx('fmp-profile.json'))
    await new FmpProvider({ apiKey: 'k', httpGetJson }).getCompanyProfile('AAPL')
    expect(httpGetJson.mock.calls[0][0]).toContain('/profile?symbol=AAPL')
  })

  it('throws FmpHttpError(200) on an empty array', async () => {
    let caught: unknown
    try { await provider([]).getCompanyProfile('AAPL') } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(FmpHttpError)
    expect((caught as FmpHttpError).status).toBe(200)
  })

  it('wraps an error-shaped 200 payload as FmpHttpError(200)', async () => {
    await expect(provider(fx('fmp-error.json')).getCompanyProfile('AAPL')).rejects.toThrow()
  })
})
