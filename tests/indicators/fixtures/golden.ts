// Self-contained golden fixture for the IND-09 correctness gate (DD-1: NO FMP/network import —
// `goldenBars` is a hand-generated placeholder OHLCV series, not fetched data).
//
// TODO: replace with real TradingView AAPL daily OHLC (fixed symbol/range, D-49). Every
// `expected` below is `null` until then — the gate test (math.golden.test.ts) passes empty
// via `it.todo` and flips to enforcing the moment real numbers are dropped in, no code change.
import type { Bar } from '../../../src/shared/types'

// 60 placeholder daily bars, valid OHLC (high >= max(open,close), low <= min(open,close),
// positive volume), plausible AAPL-daily-shaped random walk starting near $150.
export const goldenBars: Bar[] = [
  { time: 1700000000, open: 150.16, high: 151.66, low: 149.12, close: 150.28, volume: 45061624 },
  { time: 1700086400, open: 150.66, high: 151.01, low: 150.59, close: 150.79, volume: 34526306 },
  { time: 1700172800, open: 150.36, high: 152.98, low: 149.35, close: 151.91, volume: 37237735 },
  { time: 1700259200, open: 151.42, high: 152.77, low: 149.02, close: 150.3, volume: 46795056 },
  { time: 1700345600, open: 150.2, high: 151.46, low: 149.54, close: 149.6, volume: 45322040 },
  { time: 1700432000, open: 150.53, high: 151.68, low: 150.03, close: 151.51, volume: 42991149 },
  { time: 1700518400, open: 150.62, high: 151.38, low: 148.83, close: 149.98, volume: 35427651 },
  { time: 1700604800, open: 150.02, high: 150.88, low: 147.75, close: 148.59, volume: 43029289 },
  { time: 1700691200, open: 148.99, high: 151.33, low: 148.65, close: 150.11, volume: 46718674 },
  { time: 1700777600, open: 149.97, high: 151.49, low: 148.7, close: 151.28, volume: 35798163 },
  { time: 1700864000, open: 150.32, high: 150.38, low: 150.08, close: 150.34, volume: 48741679 },
  { time: 1700950400, open: 149.82, high: 150.75, low: 148.26, close: 149.36, volume: 41693366 },
  { time: 1701036800, open: 149.97, high: 151.29, low: 149.84, close: 150.36, volume: 35388463 },
  { time: 1701123200, open: 149.52, high: 152.24, low: 149.16, close: 150.78, volume: 46283332 },
  { time: 1701209600, open: 150.22, high: 150.33, low: 150.01, close: 150.05, volume: 32938894 },
  { time: 1701296000, open: 149.76, high: 151.44, low: 149.12, close: 149.95, volume: 37594242 },
  { time: 1701382400, open: 149.66, high: 150.73, low: 149.62, close: 150.11, volume: 45141736 },
  { time: 1701468800, open: 149.97, high: 151.28, low: 148.95, close: 151.02, volume: 40596950 },
  { time: 1701555200, open: 151.55, high: 152.72, low: 150.92, close: 151.99, volume: 34688756 },
  { time: 1701641600, open: 151.02, high: 151.83, low: 150.13, close: 150.56, volume: 49759266 },
  { time: 1701728000, open: 151.21, high: 151.71, low: 149.78, close: 151.56, volume: 41698291 },
  { time: 1701814400, open: 151.75, high: 151.89, low: 149.44, close: 150.68, volume: 43390474 },
  { time: 1701900800, open: 150.61, high: 152.48, low: 149.31, close: 151.51, volume: 36739244 },
  { time: 1701987200, open: 150.77, high: 150.87, low: 149.35, close: 150.7, volume: 36851735 },
  { time: 1702073600, open: 151.12, high: 151.3, low: 150.98, close: 151.2, volume: 40768980 },
  { time: 1702160000, open: 151.1, high: 152.55, low: 149.68, close: 152.51, volume: 48710823 },
  { time: 1702246400, open: 152.73, high: 153.94, low: 152.04, close: 153.15, volume: 40323486 },
  { time: 1702332800, open: 152.62, high: 152.76, low: 151.34, close: 151.83, volume: 49814956 },
  { time: 1702419200, open: 152.1, high: 153.16, low: 150.92, close: 151.36, volume: 44146593 },
  { time: 1702505600, open: 152.13, high: 152.22, low: 150.64, close: 151.46, volume: 45350013 },
  { time: 1702592000, open: 151.74, high: 152.89, low: 149.62, close: 151.03, volume: 33401825 },
  { time: 1702678400, open: 150.09, high: 150.36, low: 148.7, close: 149.38, volume: 34824944 },
  { time: 1702764800, open: 149.92, high: 150, low: 148.96, close: 149.26, volume: 36842085 },
  { time: 1702851200, open: 148.35, high: 149.38, low: 147.04, close: 149.37, volume: 31434803 },
  { time: 1702937600, open: 149.77, high: 150.94, low: 148.43, close: 148.91, volume: 37582202 },
  { time: 1703024000, open: 149.01, high: 150.05, low: 147.77, close: 148.85, volume: 43420959 },
  { time: 1703110400, open: 148.67, high: 149.58, low: 146.98, close: 148.17, volume: 48296046 },
  { time: 1703196800, open: 147.95, high: 148.06, low: 145.34, close: 146.68, volume: 41141615 },
  { time: 1703283200, open: 146.82, high: 149.31, low: 145.57, close: 148.07, volume: 47332258 },
  { time: 1703369600, open: 147.17, high: 147.77, low: 146.86, close: 146.92, volume: 39458922 },
  { time: 1703456000, open: 147.27, high: 148.94, low: 146.26, close: 147.67, volume: 43287959 },
  { time: 1703542400, open: 146.72, high: 148.59, low: 146.26, close: 147.74, volume: 33255229 },
  { time: 1703628800, open: 147.08, high: 147.36, low: 144.63, close: 145.69, volume: 31524544 },
  { time: 1703715200, open: 145.02, high: 145.84, low: 144.76, close: 145.64, volume: 30075535 },
  { time: 1703801600, open: 144.93, high: 147.14, low: 144.41, close: 146.02, volume: 37609453 },
  { time: 1703888000, open: 146.4, high: 147.34, low: 144.86, close: 146.1, volume: 43315706 },
  { time: 1703974400, open: 145.92, high: 145.99, low: 144.44, close: 144.49, volume: 37075753 },
  { time: 1704060800, open: 144.53, high: 145.65, low: 142.6, close: 143.63, volume: 37798274 },
  { time: 1704147200, open: 142.82, high: 143.45, low: 141.13, close: 142.21, volume: 33261833 },
  { time: 1704233600, open: 142.49, high: 144.27, low: 141.18, close: 143.61, volume: 32496011 },
  { time: 1704320000, open: 144.01, high: 145.47, low: 142.09, close: 142.88, volume: 44850085 },
  { time: 1704406400, open: 142.49, high: 143.85, low: 141.05, close: 142.79, volume: 31346772 },
  { time: 1704492800, open: 141.92, high: 142.53, low: 141.4, close: 142.08, volume: 33915267 },
  { time: 1704579200, open: 142.32, high: 142.72, low: 140.55, close: 141.41, volume: 38490114 },
  { time: 1704665600, open: 140.89, high: 141.57, low: 140.68, close: 140.84, volume: 42939699 },
  { time: 1704752000, open: 141.3, high: 142.4, low: 140.01, close: 142.33, volume: 47307055 },
  { time: 1704838400, open: 142.8, high: 143.92, low: 142.65, close: 143.33, volume: 48096955 },
  { time: 1704924800, open: 143.58, high: 145.45, low: 142.59, close: 145.07, volume: 38635759 },
  { time: 1705011200, open: 145.96, high: 147.91, low: 145.86, close: 146.99, volume: 42795382 },
  { time: 1705097600, open: 147.93, high: 148.16, low: 145.65, close: 146.6, volume: 31832933 },
]

export type GoldenIndicator = 'sma' | 'ema' | 'bb' | 'rsi' | 'macd'
export type GoldenKey = 'line' | 'upper' | 'middle' | 'lower' | 'macd' | 'signal' | 'histogram'

export type GoldenCheckpoint = {
  indicator: GoldenIndicator
  params: Record<string, number>
  atIndex: number
  key: GoldenKey
  expected: number | null
}

// At least one checkpoint per indicator (sma/ema/bb/rsi/macd). Every macd `atIndex` >= 33
// (12/26/9 alignment — signal/histogram first defined at slow-1+(signal-1) = 25+8 = 33).
export const goldenCheckpoints: GoldenCheckpoint[] = [
  {
    indicator: 'sma',
    params: { period: 20 },
    atIndex: 40,
    key: 'line',
    expected: null, // TODO: fill from TradingView
  },
  {
    indicator: 'ema',
    params: { period: 20 },
    atIndex: 40,
    key: 'line',
    expected: null, // TODO: fill from TradingView
  },
  {
    indicator: 'bb',
    params: { period: 20, mult: 2 },
    atIndex: 40,
    key: 'middle',
    expected: null, // TODO: fill from TradingView
  },
  {
    indicator: 'bb',
    params: { period: 20, mult: 2 },
    atIndex: 40,
    key: 'upper',
    expected: null, // TODO: fill from TradingView
  },
  {
    indicator: 'rsi',
    params: { period: 14 },
    atIndex: 40,
    key: 'line',
    expected: null, // TODO: fill from TradingView
  },
  {
    indicator: 'macd',
    params: { fast: 12, slow: 26, signal: 9 },
    atIndex: 40,
    key: 'macd',
    expected: null, // TODO: fill from TradingView
  },
  {
    indicator: 'macd',
    params: { fast: 12, slow: 26, signal: 9 },
    atIndex: 40,
    key: 'signal',
    expected: null, // TODO: fill from TradingView
  },
  {
    indicator: 'macd',
    params: { fast: 12, slow: 26, signal: 9 },
    atIndex: 40,
    key: 'histogram',
    expected: null, // TODO: fill from TradingView
  },
]
