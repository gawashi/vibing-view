// Hand-written indicator math (CLAUDE.md indicator-computation-decision) — ZERO imports so
// tests/indicators/math.test.ts (Task 2) can import this module cleanly and in isolation.

// Trailing simple moving average. Aligned to `values`; entries before `period` values have
// accumulated are `undefined` (leading gap).
export function sma(values: number[], period: number): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(values.length).fill(undefined)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

// Exponential moving average. Seeded with the SMA of the first `period` values, then the
// standard k = 2/(period+1) recurrence. Aligned to `values` with the same leading gap as sma().
export function ema(values: number[], period: number): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(values.length).fill(undefined)
  const k = 2 / (period + 1)
  let prev: number | undefined
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue
    if (i === period - 1) {
      let sum = 0
      for (let j = i - period + 1; j <= i; j++) sum += values[j]
      prev = sum / period
    } else if (prev !== undefined) {
      prev = values[i] * k + prev * (1 - k)
    }
    out[i] = prev
  }
  return out
}

// Bollinger Bands. middle = sma(period); upper/lower = middle ± mult * population stddev over
// the trailing window. Aligned to `values` with the same leading gap as sma().
export function bollinger(
  values: number[],
  period: number,
  mult: number
): { upper: Array<number | undefined>; middle: Array<number | undefined>; lower: Array<number | undefined> } {
  const middle = sma(values, period)
  const upper: Array<number | undefined> = new Array(values.length).fill(undefined)
  const lower: Array<number | undefined> = new Array(values.length).fill(undefined)
  for (let i = 0; i < values.length; i++) {
    const mid = middle[i]
    if (mid === undefined) continue
    let sumSq = 0
    for (let j = i - period + 1; j <= i; j++) sumSq += (values[j] - mid) ** 2
    const stddev = Math.sqrt(sumSq / period)
    upper[i] = mid + mult * stddev
    lower[i] = mid - mult * stddev
  }
  return { upper, middle, lower }
}
