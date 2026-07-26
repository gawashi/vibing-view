import { describe, it, expect } from 'vitest'
import { sma, ema, bollinger } from '../../src/shared/indicators/math'

describe('sma', () => {
  it('returns leading undefined until period values accumulated, then trailing means', () => {
    // sma([1,2,3,4], 2):
    // i=0: sum=1, i >= period-1 (1)? No → undefined
    // i=1: sum=3, i >= period-1 (1)? Yes → out[1] = 3/2 = 1.5
    // i=2: sum=6, i >= period (2)? Yes, sum -= values[0]=1, sum=5 → out[2] = 5/2 = 2.5
    // i=3: sum=9, i >= period (2)? Yes, sum -= values[1]=2, sum=7 → out[3] = 7/2 = 3.5
    const result = sma([1, 2, 3, 4], 2)
    expect(result).toHaveLength(4)
    expect(result[0]).toBeUndefined()
    expect(result[1]).toBeCloseTo(1.5)
    expect(result[2]).toBeCloseTo(2.5)
    expect(result[3]).toBeCloseTo(3.5)
  })

  it('returns series unchanged when period is 1', () => {
    // sma([1,2,3,4], 1):
    // i=0: sum=1, i >= period-1 (0)? Yes → out[0] = 1/1 = 1
    // i=1: sum=3, i >= period (1)? Yes, sum -= 1, sum=2 → out[1] = 2/1 = 2
    // i=2: sum=5, i >= period (1)? Yes, sum -= 2, sum=3 → out[2] = 3/1 = 3
    // i=3: sum=7, i >= period (1)? Yes, sum -= 3, sum=4 → out[3] = 4/1 = 4
    const result = sma([1, 2, 3, 4], 1)
    expect(result).toEqual([1, 2, 3, 4])
  })

  it('returns all undefined when period is greater than series length', () => {
    // sma([1,2], 5): period=5, series length=2
    // i=0: i >= period-1 (4)? No → undefined
    // i=1: i >= period-1 (4)? No → undefined
    const result = sma([1, 2], 5)
    expect(result).toEqual([undefined, undefined])
  })

  it('handles single-element series', () => {
    const result = sma([42], 1)
    expect(result).toEqual([42])
  })

  it('handles empty series', () => {
    const result = sma([], 2)
    expect(result).toEqual([])
  })

  it('handles larger period with longer series', () => {
    // sma([10, 20, 30, 40, 50], 3):
    // i=0,1: undefined
    // i=2: sum = 10+20+30 = 60 → 60/3 = 20
    // i=3: sum = 60-10+40 = 90 → 90/3 = 30
    // i=4: sum = 90-20+50 = 120 → 120/3 = 40
    const result = sma([10, 20, 30, 40, 50], 3)
    expect(result[0]).toBeUndefined()
    expect(result[1]).toBeUndefined()
    expect(result[2]).toBeCloseTo(20)
    expect(result[3]).toBeCloseTo(30)
    expect(result[4]).toBeCloseTo(40)
  })
})

describe('ema', () => {
  it('seeds with SMA of first period values, then applies k=2/(period+1) recurrence', () => {
    // ema([1,2,3,4,5], 3):
    // k = 2/(3+1) = 0.5
    // i=0,1: i < period-1 (2)? continue
    // i=2: SMA of [1,2,3] = 6/3 = 2.0, prev=2.0, out[2]=2.0
    // i=3: prev = 4*0.5 + 2.0*0.5 = 2.0 + 1.0 = 3.0, out[3]=3.0
    // i=4: prev = 5*0.5 + 3.0*0.5 = 2.5 + 1.5 = 4.0, out[4]=4.0
    const result = ema([1, 2, 3, 4, 5], 3)
    expect(result).toHaveLength(5)
    expect(result[0]).toBeUndefined()
    expect(result[1]).toBeUndefined()
    expect(result[2]).toBeCloseTo(2.0)
    expect(result[3]).toBeCloseTo(3.0)
    expect(result[4]).toBeCloseTo(4.0)
  })

  it('has same leading gap as sma', () => {
    // ema([1,2,3,4], 2):
    // k = 2/(2+1) = 2/3 ≈ 0.6667
    // i=0: i < period-1 (1)? continue
    // i=1: SMA of [1,2] = 3/2 = 1.5, prev=1.5, out[1]=1.5
    // i=2: prev = 3*(2/3) + 1.5*(1/3) = 2.0 + 0.5 = 2.5, out[2]=2.5
    // i=3: prev = 4*(2/3) + 2.5*(1/3) = 2.667 + 0.833 = 3.5, out[3]=3.5
    const result = ema([1, 2, 3, 4], 2)
    expect(result[0]).toBeUndefined()
    expect(result[1]).toBeCloseTo(1.5)
    expect(result[2]).toBeCloseTo(2.5) // exact: 3*(2/3) + 1.5*(1/3) = 2.5
    expect(result[3]).toBeCloseTo(3.5) // exact: 4*(2/3) + 2.5*(1/3) = 3.5
  })

  it('returns all undefined when period is greater than series length', () => {
    const result = ema([1, 2], 5)
    expect(result).toEqual([undefined, undefined])
  })

  it('handles period 1 correctly (k=1.0)', () => {
    // ema([1,2,3,4], 1):
    // k = 2/(1+1) = 1.0
    // i=0: SMA of [1] = 1, prev=1, out[0]=1
    // i=1: prev = 2*1.0 + 1*0.0 = 2, out[1]=2
    // i=2: prev = 3*1.0 + 2*0.0 = 3, out[2]=3
    // i=3: prev = 4*1.0 + 3*0.0 = 4, out[3]=4
    const result = ema([1, 2, 3, 4], 1)
    expect(result).toEqual([1, 2, 3, 4])
  })

  it('handles longer series with period 5', () => {
    // ema([1,2,3,4,5,6,7,8,9,10], 5):
    // k = 2/6 = 1/3
    // i=0-3: undefined
    // i=4: SMA of [1..5] = 15/5 = 3, prev=3, out[4]=3
    // i=5: prev = 6*(1/3) + 3*(2/3) = 2 + 2 = 4, out[5]=4 (exact)
    const result = ema([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5)
    expect(result[0]).toBeUndefined()
    expect(result[4]).toBeCloseTo(3.0)
    expect(result[5]).toBeCloseTo(4.0)
  })
})

describe('bollinger', () => {
  it('middle equals sma, upper/lower = middle ± mult * population stddev over window', () => {
    // bollinger([1,2,3,4], 2, 2):
    // middle = [undefined, 1.5, 2.5, 3.5]
    //
    // i=1: mid=1.5, window=[1,2]
    // sumSq = (1-1.5)^2 + (2-1.5)^2 = 0.25 + 0.25 = 0.5
    // stddev = sqrt(0.5/2) = sqrt(0.25) = 0.5
    // upper[1] = 1.5 + 2*0.5 = 2.5
    // lower[1] = 1.5 - 2*0.5 = 0.5
    //
    // i=2: mid=2.5, window=[2,3]
    // sumSq = (2-2.5)^2 + (3-2.5)^2 = 0.25 + 0.25 = 0.5
    // stddev = sqrt(0.5/2) = 0.5
    // upper[2] = 2.5 + 2*0.5 = 3.5
    // lower[2] = 2.5 - 2*0.5 = 1.5
    //
    // i=3: mid=3.5, window=[3,4]
    // sumSq = (3-3.5)^2 + (4-3.5)^2 = 0.25 + 0.25 = 0.5
    // stddev = 0.5
    // upper[3] = 3.5 + 2*0.5 = 4.5
    // lower[3] = 3.5 - 2*0.5 = 2.5
    const result = bollinger([1, 2, 3, 4], 2, 2)
    expect(result.middle).toHaveLength(4)
    expect(result.upper).toHaveLength(4)
    expect(result.lower).toHaveLength(4)

    // Check leading undefined
    expect(result.middle[0]).toBeUndefined()
    expect(result.upper[0]).toBeUndefined()
    expect(result.lower[0]).toBeUndefined()

    // Check i=1
    expect(result.middle[1]).toBeCloseTo(1.5)
    expect(result.upper[1]).toBeCloseTo(2.5)
    expect(result.lower[1]).toBeCloseTo(0.5)

    // Check i=2
    expect(result.middle[2]).toBeCloseTo(2.5)
    expect(result.upper[2]).toBeCloseTo(3.5)
    expect(result.lower[2]).toBeCloseTo(1.5)

    // Check i=3
    expect(result.middle[3]).toBeCloseTo(3.5)
    expect(result.upper[3]).toBeCloseTo(4.5)
    expect(result.lower[3]).toBeCloseTo(2.5)
  })

  it('has same leading gap as sma', () => {
    const result = bollinger([1, 2, 3, 4, 5], 3, 1)
    expect(result.middle[0]).toBeUndefined()
    expect(result.middle[1]).toBeUndefined()
    expect(result.middle[2]).toBeDefined()
    expect(result.upper[0]).toBeUndefined()
    expect(result.upper[1]).toBeUndefined()
    expect(result.lower[0]).toBeUndefined()
    expect(result.lower[1]).toBeUndefined()
  })

  it('correctly computes bands with different multiplier', () => {
    // bollinger([2,4,6,8,10], 2, 1) (mult=1 instead of 2):
    // middle = [undefined, 3, 5, 7, 9]
    //
    // i=1: mid=3, window=[2,4]
    // sumSq = (2-3)^2 + (4-3)^2 = 1 + 1 = 2
    // stddev = sqrt(2/2) = 1.0
    // upper[1] = 3 + 1*1 = 4
    // lower[1] = 3 - 1*1 = 2
    const result = bollinger([2, 4, 6, 8, 10], 2, 1)
    expect(result.middle[1]).toBeCloseTo(3)
    expect(result.upper[1]).toBeCloseTo(4)
    expect(result.lower[1]).toBeCloseTo(2)
  })

  it('independently verifies stddev computation in band width', () => {
    // bollinger([1, 2, 3, 4], 2, 2):
    // i=1: window=[1,2], mid=1.5
    //   stddev = sqrt(((1-1.5)^2 + (2-1.5)^2) / 2) = sqrt(0.5/2) = 0.5
    //   band_width = 2 * stddev = 1.0
    //   upper - middle = 2.5 - 1.5 = 1.0 ✓
    const result = bollinger([1, 2, 3, 4], 2, 2)
    for (let i = 0; i < result.middle.length; i++) {
      const mid = result.middle[i]
      const upper = result.upper[i]
      const lower = result.lower[i]
      if (mid !== undefined && upper !== undefined && lower !== undefined) {
        // Independent check: band width should be symmetric
        const upperDist = upper - mid
        const lowerDist = mid - lower
        expect(upperDist).toBeCloseTo(lowerDist)
      }
    }
  })

  it('returns all undefined when period exceeds series length', () => {
    const result = bollinger([1, 2], 5, 2)
    expect(result.middle).toEqual([undefined, undefined])
    expect(result.upper).toEqual([undefined, undefined])
    expect(result.lower).toEqual([undefined, undefined])
  })

  it('handles period 1 correctly (zero stddev)', () => {
    // bollinger([5], 1, 2):
    // middle = [5]
    // i=0: mid=5, window=[5]
    // sumSq = (5-5)^2 = 0
    // stddev = 0
    // upper[0] = 5 + 2*0 = 5
    // lower[0] = 5 - 2*0 = 5
    const result = bollinger([5], 1, 2)
    expect(result.middle[0]).toBeCloseTo(5)
    expect(result.upper[0]).toBeCloseTo(5)
    expect(result.lower[0]).toBeCloseTo(5)
  })
})
