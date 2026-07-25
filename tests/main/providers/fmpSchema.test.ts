import { describe, it, expect } from 'vitest'
import {
  fmpRatiosTtmResponse, fmpEarningsResponse, fmpGradesConsensusResponse
} from '../../../src/main/providers/fmp.schema'

describe('fmp investment-metric schemas', () => {
  it('parses a well-formed ratios-ttm row', () => {
    const parsed = fmpRatiosTtmResponse.parse([{ priceToEarningsRatioTTM: 24.3, returnOnEquityTTM: 0.18 }])
    expect(parsed[0].priceToEarningsRatioTTM).toBe(24.3)
    expect(parsed[0].returnOnEquityTTM).toBe(0.18)
  })

  it('degrades a malformed present numeric field to null instead of throwing (.catch)', () => {
    const parsed = fmpRatiosTtmResponse.parse([{ priceToEarningsRatioTTM: 'oops', returnOnEquityTTM: 0.18 }])
    expect(parsed[0].priceToEarningsRatioTTM).toBeNull()
    expect(parsed[0].returnOnEquityTTM).toBe(0.18)
  })

  it('ignores unknown fields (passthrough) and tolerates missing ones', () => {
    const parsed = fmpGradesConsensusResponse.parse([{ buy: 12, sell: 1, somethingElse: 'x' }])
    expect(parsed[0].buy).toBe(12)
    expect(parsed[0].hold ?? null).toBeNull()
  })

  it('parses an earnings array with mixed actual/null rows', () => {
    const parsed = fmpEarningsResponse.parse([
      { date: '2026-10-30', epsActual: null, epsEstimated: 1.5 },
      { date: '2026-07-31', epsActual: 1.4, epsEstimated: 1.35 }
    ])
    expect(parsed).toHaveLength(2)
    expect(parsed[0].epsActual).toBeNull()
    expect(parsed[1].epsActual).toBe(1.4)
  })
})
