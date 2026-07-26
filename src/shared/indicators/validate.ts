import { registry } from './registry'
import type { FieldDesc, Source } from './types'
import type { Params } from '@shared/types'

export const SOURCES = ['close', 'open', 'high', 'low', 'hl2', 'hlc3'] as const satisfies readonly Source[]

export const INDICATOR_TYPES = Object.keys(registry)

// MW-15: a `kind: 'color'` FieldDesc describes instance.colors, not params — ParamFields skips it
// and no module's `defaults` contains it. Treating it as a param would write a key nothing reads.
export function paramFields(type: string): FieldDesc[] {
  return (registry[type]?.params ?? []).filter((f) => f.kind !== 'color')
}

export function defaultParams(type: string): Params {
  return { ...(registry[type]?.defaults ?? {}) }
}

const unknownType = (type: string): string =>
  `Unknown indicator "${type}". Available: ${INDICATOR_TYPES.join(', ')}.`

export type ParamCheck = { ok: true; params: Params } | { ok: false; message: string }

// Validates a PARTIAL patch: only the keys present are checked, so update_indicator can merge.
// Values are rejected rather than coerced — `period: "abc"` would render as NaN and read to the
// model as a success.
export function validateParams(type: string, patch: Params): ParamCheck {
  if (!registry[type]) return { ok: false, message: unknownType(type) }
  const fields = paramFields(type)
  const names = fields.map((f) => f.key)
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'color') {
      return { ok: false, message: 'color is not a parameter — use the color argument of update_indicator.' }
    }
    const field = fields.find((f) => f.key === key)
    if (!field) {
      return { ok: false, message: `"${key}" is not a parameter of ${type}. Parameters: ${names.join(', ')}.` }
    }
    if (field.kind === 'number') {
      const min = field.min ?? Number.NEGATIVE_INFINITY
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
        const bound = field.min === undefined ? '' : ` >= ${field.min}`
        return { ok: false, message: `${key} must be a number${bound}.` }
      }
    }
    if (field.kind === 'select' && !field.options.includes(String(value))) {
      return { ok: false, message: `${key} must be one of ${field.options.join(', ')}.` }
    }
    if (field.kind === 'source' && !(SOURCES as readonly string[]).includes(String(value))) {
      return { ok: false, message: `${key} must be one of ${SOURCES.join(', ')}.` }
    }
  }
  return { ok: true, params: patch }
}

// Generated from the registry so the tool description never drifts from the modules (MW-06).
export function indicatorCatalog(): string {
  return INDICATOR_TYPES.map((type) => `${type}(${paramFields(type).map((f) => f.key).join(', ')})`).join(', ')
}
