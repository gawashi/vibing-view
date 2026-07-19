import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { FmpProvider, FmpHttpError } from '../../../src/main/providers/FmpProvider'
import { classify } from '../../../src/main/capabilityClassifier'

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
})
