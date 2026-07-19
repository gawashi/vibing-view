import { ma } from './ma'
import { bb } from './bb'
import type { IndicatorModule } from './types'

// The single registration point for indicator modules — iterated by AddIndicatorMenu and
// IndicatorEditForm (Plan 02, same wave). Plan 03 adds `bb` here (IND-01).
export const registry: Record<string, IndicatorModule> = { ma, bb }
