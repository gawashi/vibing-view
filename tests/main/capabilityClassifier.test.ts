import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { classify } from '../../src/main/capabilityClassifier'
import { defaultHttpGetJson, FmpHttpError } from '../../src/main/providers/FmpProvider'

const fx = (name: string) => JSON.parse(readFileSync(join(__dirname, '../fixtures', name), 'utf8'))

describe('classify', () => {
  it('classifies HTTP 429 as rate-limited', () => {
    expect(classify(429, {})).toBe('rate-limited')
  })

  it('classifies HTTP 403 as requires-plan', () => {
    expect(classify(403, {})).toBe('requires-plan')
  })

  it('classifies HTTP 402 (Payment Required, null body) as requires-plan', () => {
    expect(classify(402, null)).toBe('requires-plan')
  })

  it('classifies an HTTP-200 error-shaped payload (zod-parse-failure signal) as requires-plan', () => {
    expect(classify(200, fx('fmp-error.json'))).toBe('requires-plan')
  })

  it('classifies an HTTP-200 rate-limit-worded payload as rate-limited', () => {
    expect(classify(200, fx('fmp-ratelimit.json'))).toBe('rate-limited')
  })

  it('classifies a valid bar row payload as available', () => {
    expect(classify(200, [{ date: '2024-01-02', open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }])).toBe(
      'available'
    )
  })

  it('classifies a 200 with premium/exclusive/legacy wording as requires-plan', () => {
    expect(classify(200, { 'Error Message': 'This endpoint is a premium feature' })).toBe('requires-plan')
  })
})

describe('defaultHttpGetJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('surfaces status and body via FmpHttpError on a non-2xx response', async () => {
    const body = { 'Error Message': 'Limit Reach . Please upgrade your plan' }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 429, json: async () => body }))
    )
    await expect(defaultHttpGetJson('https://example.test')).rejects.toMatchObject({
      status: 429,
      body
    })
    await expect(defaultHttpGetJson('https://example.test')).rejects.toBeInstanceOf(FmpHttpError)
  })

  it('returns the parsed body unchanged on a 2xx response', async () => {
    const body = [{ date: '2024-01-02', open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => body }))
    )
    await expect(defaultHttpGetJson('https://example.test')).resolves.toEqual(body)
  })
})
