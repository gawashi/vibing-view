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

// Relative Strength Index — Wilder smoothing. Operates on consecutive-close gain/loss diffs,
// seeded with the plain arithmetic mean of the first `period` gains and losses, then the Wilder
// recurrence (α = 1/period, NOT ema's 2/(period+1)). Because it needs `period` diffs from
// `period+1` closes, its first defined value lands at index `period` — one bar LATER than
// sma/ema's `period-1` (Landmine #6). Same Array<number|undefined> leading-gap alignment.
export function rsi(values: number[], period: number): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(values.length).fill(undefined)
  if (values.length <= period) return out

  let gainSum = 0
  let lossSum = 0
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1]
    if (diff >= 0) gainSum += diff
    else lossSum -= diff
  }
  let avgGain = gainSum / period
  let avgLoss = lossSum / period
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1]
    const gain = diff >= 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return out
}

// MACD. macdLine = ema(fast) − ema(slow) (defined from index slow−1). signal = EMA of macdLine —
// but macdLine has a leading gap of `slow−1` undefineds, and ema() only tolerates a gap on an
// otherwise-DENSE array, so we COMPACT the contiguous defined suffix into a dense number[], run the
// existing ema(compacted, signal), then RE-EXPAND offset by the stripped leading-undefined count
// (Landmine #5 — NEVER ema(macdLine) directly). signal/histogram defined from slow−1+(signal−1).
export function macd(
  values: number[],
  fast: number,
  slow: number,
  signal: number
): { macd: Array<number | undefined>; signal: Array<number | undefined>; histogram: Array<number | undefined> } {
  const emaFast = ema(values, fast)
  const emaSlow = ema(values, slow)
  const macdLine: Array<number | undefined> = values.map((_, i) => {
    const f = emaFast[i]
    const s = emaSlow[i]
    return f === undefined || s === undefined ? undefined : f - s
  })

  // Compact the contiguous defined suffix, ema() it densely, re-expand at the same offset.
  const offset = macdLine.findIndex((v) => v !== undefined)
  const signalLine: Array<number | undefined> = new Array(values.length).fill(undefined)
  if (offset !== -1) {
    const dense = macdLine.slice(offset) as number[]
    const denseSignal = ema(dense, signal)
    for (let i = 0; i < denseSignal.length; i++) signalLine[offset + i] = denseSignal[i]
  }

  const histogram: Array<number | undefined> = macdLine.map((m, i) => {
    const s = signalLine[i]
    return m === undefined || s === undefined ? undefined : m - s
  })
  return { macd: macdLine, signal: signalLine, histogram }
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
