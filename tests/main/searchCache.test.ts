import { describe, it, expect } from 'vitest'
import { createSearchCache } from '../../src/main/searchCache'
import type { SymbolResult } from '@shared/types'

const results: SymbolResult[] = [{ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }]

describe('createSearchCache', () => {
  it('returns undefined for an unknown query', () => {
    const cache = createSearchCache({ ttlMs: 1000, now: () => 0 })
    expect(cache.get('AAPL')).toBeUndefined()
  })
  it('returns cached results within the TTL window', () => {
    let t = 0
    const cache = createSearchCache({ ttlMs: 1000, now: () => t })
    cache.set('AAPL', results)
    t = 999
    expect(cache.get('AAPL')).toEqual(results)
  })
  it('expires results after the TTL window', () => {
    let t = 0
    const cache = createSearchCache({ ttlMs: 1000, now: () => t })
    cache.set('AAPL', results)
    t = 1001
    expect(cache.get('AAPL')).toBeUndefined()
  })
  it('normalizes query casing and whitespace', () => {
    const cache = createSearchCache({ ttlMs: 1000, now: () => 0 })
    cache.set('  aapl ', results)
    expect(cache.get('AAPL')).toEqual(results)
  })
})
