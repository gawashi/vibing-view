import { describe, it, expect, vi } from 'vitest'
import { createProfileService } from '../../../src/main/profile/ProfileService'
import type { SymbolResult } from '@shared/types'

function fakeStore(initial: SymbolResult | null = null) {
  let stored = initial
  return {
    getProfile: vi.fn(() => stored),
    upsertProfile: vi.fn((p: SymbolResult) => { stored = p })
  }
}

const AAPL: SymbolResult = { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }

describe('ProfileService.getProfile', () => {
  it('returns cached profile with NO search call on a hit', async () => {
    const store = fakeStore(AAPL)
    const search = vi.fn()
    const svc = createProfileService({ store, search })

    const p = await svc.getProfile('AAPL')

    expect(search).not.toHaveBeenCalled()
    expect(p).toEqual(AAPL)
  })

  it('fetches and caches the exact-symbol match on a miss', async () => {
    const store = fakeStore(null)
    const search = vi.fn(async () => [
      { symbol: 'AAPLX', name: 'Something Else', exchange: 'NYSE' },
      AAPL
    ])
    const svc = createProfileService({ store, search })

    const p = await svc.getProfile('AAPL')

    expect(search).toHaveBeenCalledOnce()
    expect(search).toHaveBeenCalledWith('AAPL')
    expect(store.upsertProfile).toHaveBeenCalledWith(AAPL)
    expect(p).toEqual(AAPL)
  })

  it('matches the symbol case-insensitively', async () => {
    const store = fakeStore(null)
    const search = vi.fn(async () => [AAPL])
    const svc = createProfileService({ store, search })

    const p = await svc.getProfile('aapl')

    expect(p).toEqual(AAPL)
    expect(store.upsertProfile).toHaveBeenCalledWith(AAPL)
  })

  it('caches a fallback when a successful response has no exact match', async () => {
    const store = fakeStore(null)
    const search = vi.fn(async () => [
      { symbol: 'ZZZZ', name: 'Zzz Corp', exchange: 'NYSE' }
    ])
    const svc = createProfileService({ store, search })

    const p = await svc.getProfile('NOPE')

    expect(p).toEqual({ symbol: 'NOPE', name: 'NOPE', exchange: '' })
    expect(store.upsertProfile).toHaveBeenCalledWith({ symbol: 'NOPE', name: 'NOPE', exchange: '' })
  })

  it('returns a fallback WITHOUT caching on a transient failure (search throws)', async () => {
    const store = fakeStore(null)
    const search = vi.fn(async () => { throw new Error('NO_API_KEY') })
    const svc = createProfileService({ store, search })

    const p = await svc.getProfile('AAPL')

    expect(p).toEqual({ symbol: 'AAPL', name: 'AAPL', exchange: '' })
    expect(store.upsertProfile).not.toHaveBeenCalled()
  })
})
