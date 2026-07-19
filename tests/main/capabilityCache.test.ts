import { describe, it, expect } from 'vitest'
import { resolveStatus, hashApiKey } from '../../src/main/capabilityCache'

const DAY1 = Date.UTC(2026, 6, 19) // 2026-07-19T00:00:00Z
const DAY2 = Date.UTC(2026, 6, 20)

describe('resolveStatus', () => {
  it('an unseen timeframe resolves to unknown', () => {
    expect(resolveStatus(undefined, DAY1)).toBe('unknown')
  })

  it('requires-plan never expires, even probed yesterday', () => {
    expect(resolveStatus({ status: 'requires-plan', probedAt: DAY1 - 1000 }, DAY2 + 1000)).toBe('requires-plan')
  })

  it('rate-limited before today UTC 00:00 expires to unknown', () => {
    expect(resolveStatus({ status: 'rate-limited', probedAt: DAY1 + 1000 }, DAY2 + 1000)).toBe('unknown')
  })

  it('rate-limited probed earlier today (UTC) is still valid', () => {
    expect(resolveStatus({ status: 'rate-limited', probedAt: DAY1 + 1000 }, DAY1 + 5000)).toBe('rate-limited')
  })

  it('available and unknown pass through unchanged', () => {
    expect(resolveStatus({ status: 'available', probedAt: DAY1 }, DAY2)).toBe('available')
  })
})

describe('hashApiKey', () => {
  it('produces different hashes for different keys', () => {
    expect(hashApiKey('key-a')).not.toBe(hashApiKey('key-b'))
  })

  it('never contains the raw key string', () => {
    const hash = hashApiKey('super-secret-fmp-key')
    expect(hash).not.toContain('super-secret-fmp-key')
  })

  it('is deterministic for the same key', () => {
    expect(hashApiKey('same-key')).toBe(hashApiKey('same-key'))
  })
})
