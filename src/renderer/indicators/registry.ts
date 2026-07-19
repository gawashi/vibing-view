import { ma } from './ma'
import { bb } from './bb'
import { rsi } from './rsi'
import { volume } from './volume'
import { macd } from './macd'
import type { IndicatorModule } from './types'

// The single registration point for indicator modules — iterated by AddIndicatorMenu and
// IndicatorEditForm. Adding a module here is all it takes to surface it end-to-end (IND-01).
export const registry: Record<string, IndicatorModule> = { ma, bb, rsi, volume, macd }
