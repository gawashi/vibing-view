// IND-09 correctness gate: cross-indicator golden fixture harness.
//
// Dispatches every checkpoint in fixtures/golden.ts to the matching math.ts function and reads
// the value at (atIndex, key). Checkpoints with `expected === null` register as `it.todo` (empty
// pass — no code change needed). The moment a real TradingView number replaces `null`, that
// checkpoint flips to a real enforcing `it` using the literal `Math.abs(actual - expected)` +
// `.toBeLessThan(0.01)` form (DD-2/D-49) — never `toBeCloseTo`.
//
// Two structural assertions below are ALWAYS-ON (not gated by the fixture): they pin conventions
// math.ts already implements (BB population stddev, EMA SMA-seed) and would fail if either
// convention silently regressed to the wrong formula.
import { describe, it, expect } from 'vitest'
import { sma, ema, bollinger, rsi, macd } from '../../src/shared/indicators/math'
import { goldenBars, goldenCheckpoints, type GoldenCheckpoint } from './fixtures/golden'

const closes = goldenBars.map((b) => b.close)

// Dispatch a checkpoint to the right math.ts function and read the (atIndex, key) value.
function computeActual(cp: GoldenCheckpoint): number | undefined {
  switch (cp.indicator) {
    case 'sma':
      return sma(closes, cp.params.period)[cp.atIndex]
    case 'ema':
      return ema(closes, cp.params.period)[cp.atIndex]
    case 'rsi':
      return rsi(closes, cp.params.period)[cp.atIndex]
    case 'bb': {
      const bands = bollinger(closes, cp.params.period, cp.params.mult)
      return bands[cp.key as 'upper' | 'middle' | 'lower'][cp.atIndex]
    }
    case 'macd': {
      const result = macd(closes, cp.params.fast, cp.params.slow, cp.params.signal)
      return result[cp.key as 'macd' | 'signal' | 'histogram'][cp.atIndex]
    }
  }
}

describe('golden fixture — all five indicators (IND-09)', () => {
  for (const cp of goldenCheckpoints) {
    const label = `${cp.indicator}(${JSON.stringify(cp.params)}).${cp.key}[${cp.atIndex}]`

    if (cp.expected === null) {
      // Empty-pass: no TradingView value filled in yet. Suite stays green; nothing to enforce.
      it.todo(`${label} matches TradingView (TODO: fill expected in golden.ts)`)
    } else {
      // Enforcing: a real TradingView number has been dropped into golden.ts. This checkpoint
      // now gates on it — no code change was needed to flip from todo to enforcing (D-49).
      const expected = cp.expected
      it(`${label} matches TradingView`, () => {
        const actual = computeActual(cp) as number
        expect(actual).toBeDefined()
        expect(Math.abs(actual - expected)).toBeLessThan(0.01)
      })
    }
  }
})

describe('structural conventions (always-on, falsifiable)', () => {
  it('bollinger() uses POPULATION stddev (÷period), not sample stddev (÷period-1)', () => {
    // vals = [2, 4, 6, 8], period = 4, mult = 1
    // mean = 5
    // squared deviations: (2-5)^2=9, (4-5)^2=1, (6-5)^2=1, (8-5)^2=9 → sumSq = 20
    // population variance = 20/4 = 5 → population stddev = sqrt(5) ≈ 2.2360679...
    // sample variance = 20/(4-1) = 6.6667 → sample stddev ≈ 2.5820 (WOULD differ if math.ts
    // used sample convention — this assertion is falsifiable against that wrong formula)
    const vals = [2, 4, 6, 8]
    const result = bollinger(vals, 4, 1)
    const mid = result.middle[3]!
    const populationStddev = Math.sqrt(5)
    expect(mid).toBeCloseTo(5)
    expect(result.upper[3]!).toBeCloseTo(mid + populationStddev, 5)
    expect(result.lower[3]!).toBeCloseTo(mid - populationStddev, 5)
    // Would FAIL under sample stddev: mid + 2.5820 !== mid + 2.2361
    expect(Math.abs(result.upper[3]! - (mid + 2.581988897))).toBeGreaterThan(0.1)
  })

  it("ema()'s first defined value equals the SMA of the first `period` values (SMA-seed)", () => {
    const vals = [10, 12, 14, 16, 18, 20, 22]
    const period = 4
    const emaResult = ema(vals, period)
    const smaResult = sma(vals, period)
    // ema[period-1] must be seeded with sma[period-1] exactly (within float tolerance) —
    // would FAIL if ema() were seeded any other way (e.g. first raw value, or period 0 EMA).
    expect(Math.abs(emaResult[period - 1]! - smaResult[period - 1]!)).toBeLessThan(1e-9)
  })
})
