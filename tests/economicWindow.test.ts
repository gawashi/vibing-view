import { describe, it, expect } from 'vitest'
import { buildEconomicHash, parseEconomicWindow } from '../src/shared/economicWindow'

describe('economic window hash', () => {
  it('round-trips through build → parse', () => {
    expect(parseEconomicWindow('#' + buildEconomicHash())).toBe(true)
  })

  it('parses with and without a leading #', () => {
    expect(parseEconomicWindow('#economic=1')).toBe(true)
    expect(parseEconomicWindow('economic=1')).toBe(true)
  })

  it('is false for an empty hash or another window', () => {
    expect(parseEconomicWindow('')).toBe(false)
    expect(parseEconomicWindow('#company=AAPL')).toBe(false)
    expect(parseEconomicWindow('#chart=1-2')).toBe(false)
  })
})
