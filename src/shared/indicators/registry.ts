import { ma } from './ma'
import { bb } from './bb'
import { rsi } from './rsi'
import { volume } from './volume'
import { macd } from './macd'
import type { IndicatorModule } from './types'

// The single registration point for indicator modules — iterated by AddIndicatorMenu and
// IndicatorEditForm. Adding a module here is all it takes to surface it end-to-end (IND-01).
export const registry: Record<string, IndicatorModule> = { ma, bb, rsi, volume, macd }

// D-34: Volume is seeded as an always-on fixed instance in every cell, so it is never user-addable.
// The single source for "what can be added" — the add menus, the apply-to-all picker and the MCP
// add_indicator tool all read this, so no surface can drift into offering a fixed indicator.
export const ADDABLE = Object.values(registry).filter((m) => m.type !== 'volume')
