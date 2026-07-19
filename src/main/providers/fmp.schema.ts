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
