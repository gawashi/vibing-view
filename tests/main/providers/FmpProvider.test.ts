import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { FmpProvider } from '../../../src/main/providers/FmpProvider'

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
})

describe('FmpProvider.searchSymbols', () => {
  it('maps search results to SymbolResult, preferring the exchange short code', async () => {
    const results = await provider(fx('fmp-search.json')).searchSymbols('AAPL')
    expect(results[0]).toEqual({ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' })
    expect(results).toHaveLength(2)
  })
})
