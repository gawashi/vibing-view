import { describe, it, expect } from 'vitest'
import { BUSY_RESULT, countOhlcv } from '../../src/renderer/lib/reloadResult'

describe('countOhlcv', () => {
  it('counts fulfilled and rejected separately', () => {
    const results: PromiseSettledResult<unknown>[] = [
      { status: 'fulfilled', value: 1 },
      { status: 'rejected', reason: new Error('x') },
      { status: 'fulfilled', value: 2 }
    ]
    expect(countOhlcv(results)).toEqual({ refreshed: 2, failed: 1 })
  })

  it('is all zeroes for an empty run', () => {
    expect(countOhlcv([])).toEqual({ refreshed: 0, failed: 0 })
  })
})

describe('BUSY_RESULT', () => {
  // MW-14: a request that arrives mid-refresh must still answer, or the MCP caller waits for the
  // 60s timeout instead of being told to retry.
  it('reports busy with no work done', () => {
    expect(BUSY_RESULT).toEqual({ refreshed: 0, failed: 0, busy: true })
  })
})
