import { z } from 'zod'

export const fmpHistoricalRow = z.object({
  date: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number()
})

// FMP stable `historical-price-eod/full` returns a flat array (no { symbol, historical } wrapper).
// `historical-chart/{interval}` (intraday) returns the same flat-array shape — reuse this schema;
// intraday `date` is just a datetime string (e.g. "2024-01-02 09:30:00", exchange-local).
export const fmpHistoricalResponse = z.array(fmpHistoricalRow)

export const fmpSearchRow = z.object({
  symbol: z.string(),
  name: z.string().nullable().optional(),
  exchange: z.string().nullable().optional(),
  exchangeFullName: z.string().nullable().optional()
})

export const fmpSearchResponse = z.array(fmpSearchRow)

// /stable/quote returns a flat array; we consume element [0]. Fields verified against a live key
// (2026-07-21). A missing/null field fails the parse → FmpHttpError(200) → silent daily-close fallback.
export const fmpQuoteRow = z.object({
  symbol: z.string(),
  price: z.number(),
  open: z.number(),
  dayHigh: z.number(),
  dayLow: z.number(),
  previousClose: z.number(),
  changePercentage: z.number(),
  timestamp: z.number(),
  exchange: z.string()
})
export const fmpQuoteResponse = z.array(fmpQuoteRow)

// /stable/exchange-market-hours returns a flat array; element [0] carries isMarketOpen.
export const fmpMarketHoursRow = z.object({
  exchange: z.string(),
  isMarketOpen: z.boolean()
})
export const fmpMarketHoursResponse = z.array(fmpMarketHoursRow)

// /stable/profile returns a flat array; we consume element [0]. Only the fields the dialog shows
// are typed — everything else is passthrough (CUSIP/ISIN/address/phone etc. are out of scope).
// Numeric fields are z.coerce.number() because FMP mixes string/number (e.g. fullTimeEmployees).
// .nullable() short-circuits null BEFORE coercion, so a real null stays null (not coerced to 0).
export const fmpProfileRow = z.object({
  symbol: z.string(),
  companyName: z.string(),
  image: z.string().nullable().optional(),
  exchange: z.string().nullable().optional(),
  sector: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  marketCap: z.coerce.number().nullable().optional(),
  ceo: z.string().nullable().optional(),
  fullTimeEmployees: z.coerce.number().nullable().optional(),
  ipoDate: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  beta: z.coerce.number().nullable().optional(),
  range: z.string().nullable().optional(),
  volume: z.coerce.number().nullable().optional(),
  averageVolume: z.coerce.number().nullable().optional(),
  lastDividend: z.coerce.number().nullable().optional(),
  price: z.coerce.number().nullable().optional()
}).passthrough()
export const fmpProfileResponse = z.array(fmpProfileRow)

// Investment-metric endpoints. All numeric fields tolerate FMP field-name drift and bad values:
// .catch(null) turns a malformed present value (wrong type, unparseable) into null rather than
// throwing out the whole row. .passthrough() ignores the many fields we don't surface.
// FMP returns single-element arrays for the *-ttm / consensus endpoints; we take element [0].
const num = () => z.coerce.number().nullable().optional().catch(null)

export const fmpRatiosTtmResponse = z.array(z.object({
  priceToEarningsRatioTTM: num(),
  priceToBookRatioTTM: num(),
  priceToSalesRatioTTM: num(),
  priceToEarningsGrowthRatioTTM: num(),
  dividendYieldTTM: num(),
  returnOnEquityTTM: num(),
  returnOnAssetsTTM: num(),
  netProfitMarginTTM: num(),
  operatingProfitMarginTTM: num(),
  grossProfitMarginTTM: num(),
  currentRatioTTM: num(),
  quickRatioTTM: num(),
  debtToEquityRatioTTM: num()
}).passthrough())

export const fmpKeyMetricsTtmResponse = z.array(z.object({
  // FMP has used both spellings across versions; try evToEBITDATTM, fall back handled in provider.
  evToEBITDATTM: num(),
  enterpriseValueOverEBITDATTM: num(),
  earningsYieldTTM: num(),
  freeCashFlowYieldTTM: num()
}).passthrough())

export const fmpGradesConsensusResponse = z.array(z.object({
  strongBuy: num(),
  buy: num(),
  hold: num(),
  sell: num(),
  strongSell: num(),
  consensus: z.string().nullable().optional().catch(null)
}).passthrough())

export const fmpPriceTargetConsensusResponse = z.array(z.object({
  targetHigh: num(),
  targetLow: num(),
  targetMedian: num(),
  targetConsensus: num()
}).passthrough())

export const fmpFinancialGrowthResponse = z.array(z.object({
  // FMP field names for growth; loose so a rename degrades to null, not a throw.
  revenueGrowth: num(),
  growthRevenue: num(),
  netIncomeGrowth: num(),
  growthNetIncome: num(),
  epsgrowth: num(),
  growthEPS: num()
}).passthrough())

export const fmpEarningsResponse = z.array(z.object({
  date: z.string(),
  epsActual: num(),
  epsEstimated: num()
}).passthrough())
