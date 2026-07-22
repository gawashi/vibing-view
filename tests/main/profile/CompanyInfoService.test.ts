import { describe, it, expect, vi } from 'vitest'
import { createCompanyInfoService } from '../../../src/main/profile/CompanyInfoService'
import type { CompanyProfileData } from '@shared/types'

const DATA: CompanyProfileData = {
  symbol: 'AAPL', companyName: 'Apple Inc.', image: null, exchange: 'NASDAQ',
  sector: 'Technology', industry: 'Consumer Electronics', country: 'US',
  marketCap: 3.4e12, ceo: 'Tim Cook', fullTimeEmployees: 164000, ipoDate: '1980-12-12',
  website: 'https://apple.com', description: 'desc', beta: 1.24, range: '164-260',
  volume: 41000000, averageVolume: 55000000, lastDividend: 1
}

const NOW = 1_000_000 // epoch seconds (fixed clock)

function fakeStore(initial: { data: CompanyProfileData; fetchedAt: number } | null = null) {
  let stored = initial
  return {
    getCompanyProfile: vi.fn(() => stored),
    upsertCompanyProfile: vi.fn((_s: string, data: CompanyProfileData, fetchedAt: number) => {
      stored = { data, fetchedAt }
    })
  }
}

describe('CompanyInfoService.getInfo', () => {
  it('returns the cached row without fetching when fresh (within TTL)', async () => {
    const store = fakeStore({ data: DATA, fetchedAt: NOW - 100 })
    const fetch = vi.fn()
    const svc = createCompanyInfoService({ store, fetch, now: () => NOW })
    const info = await svc.getInfo('AAPL')
    expect(fetch).not.toHaveBeenCalled()
    expect(info).toEqual({ ...DATA, fetchedAt: NOW - 100 })
  })

  it('refetches and upserts when the row is stale (past TTL)', async () => {
    const store = fakeStore({ data: DATA, fetchedAt: NOW - 90_000 }) // > 86400
    const fetch = vi.fn(async () => DATA)
    const svc = createCompanyInfoService({ store, fetch, now: () => NOW })
    const info = await svc.getInfo('AAPL')
    expect(fetch).toHaveBeenCalledOnce()
    expect(store.upsertCompanyProfile).toHaveBeenCalledWith('AAPL', DATA, NOW)
    expect(info).toEqual({ ...DATA, fetchedAt: NOW })
  })

  it('fetches and upserts on a cache miss (no row)', async () => {
    const store = fakeStore(null)
    const fetch = vi.fn(async () => DATA)
    const svc = createCompanyInfoService({ store, fetch, now: () => NOW })
    const info = await svc.getInfo('AAPL')
    expect(fetch).toHaveBeenCalledOnce()
    expect(store.upsertCompanyProfile).toHaveBeenCalledWith('AAPL', DATA, NOW)
    expect(info).toEqual({ ...DATA, fetchedAt: NOW })
  })

  it('falls back to a stale row when the fetch fails', async () => {
    const store = fakeStore({ data: DATA, fetchedAt: NOW - 90_000 })
    const fetch = vi.fn(async () => { throw new Error('rate limited') })
    const svc = createCompanyInfoService({ store, fetch, now: () => NOW })
    const info = await svc.getInfo('AAPL')
    expect(info).toEqual({ ...DATA, fetchedAt: NOW - 90_000 })
  })

  it('rethrows when the fetch fails and there is no row', async () => {
    const store = fakeStore(null)
    const fetch = vi.fn(async () => { throw new Error('down') })
    const svc = createCompanyInfoService({ store, fetch, now: () => NOW })
    await expect(svc.getInfo('AAPL')).rejects.toThrow('down')
  })
})
