import { describe, it, expect } from 'vitest'
import { shouldRefreshData } from '@/lib/autoRefresh'

describe('shouldRefreshData', () => {
  it('manual always proceeds (open)', () => {
    expect(shouldRefreshData('manual', true)).toBe(true)
  })
  it('manual always proceeds (closed) — 手動はクローズでも確定日足を取りに行く', () => {
    expect(shouldRefreshData('manual', false)).toBe(true)
  })
  it('auto proceeds when market open', () => {
    expect(shouldRefreshData('auto', true)).toBe(true)
  })
  it('auto stops when market closed — API 節約', () => {
    expect(shouldRefreshData('auto', false)).toBe(false)
  })
})
