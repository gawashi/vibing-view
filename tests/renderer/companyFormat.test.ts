import { describe, it, expect } from 'vitest'
import { fmtRatio, fmtPct, fmtMoney } from '../../src/renderer/components/CompanyWindow'

describe('company metric formatters', () => {
  it('fmtRatio: 2 decimals, null-safe', () => {
    expect(fmtRatio(24.312)).toBe('24.31')
    expect(fmtRatio(null)).toBeNull()
    expect(fmtRatio(undefined)).toBeNull()
  })
  it('fmtPct: ratio → percent, 1 decimal', () => {
    expect(fmtPct(0.184)).toBe('18.4%')
    expect(fmtPct(1.47)).toBe('147.0%')
    expect(fmtPct(null)).toBeNull()
  })
  it('fmtMoney: $ + 2 decimals', () => {
    expect(fmtMoney(258.4)).toBe('$258.40')
    expect(fmtMoney(null)).toBeNull()
  })
})
