import { describe, it, expect } from 'vitest'
import {
  INDICATOR_TYPES, defaultParams, indicatorCatalog, paramFields, validateParams
} from '../../src/shared/indicators/validate'

describe('paramFields', () => {
  // MW-15: `color` is a FieldDesc but NOT a param — it writes instance.colors via a separate path.
  it('drops the color field', () => {
    expect(paramFields('ma').map((f) => f.key)).toEqual(['period', 'kind', 'source'])
  })

  it('is empty for a module with no editable params', () => {
    expect(paramFields('volume')).toEqual([])
  })
})

describe('defaultParams', () => {
  it('returns a copy of the module defaults', () => {
    const a = defaultParams('ma')
    a.period = 999
    expect(defaultParams('ma').period).toBe(20)
  })
})

describe('validateParams', () => {
  it('accepts a valid patch', () => {
    expect(validateParams('ma', { period: 50 })).toEqual({ ok: true, params: { period: 50 } })
  })

  it('rejects an unknown key and lists the real ones', () => {
    expect(validateParams('ma', { length: 50 })).toEqual({
      ok: false,
      message: '"length" is not a parameter of ma. Parameters: period, kind, source.'
    })
  })

  // MW-15: silently storing a `color` param would write a key the renderer never reads.
  it('rejects color with a pointer to the right argument', () => {
    expect(validateParams('ma', { color: '#ffffff' })).toEqual({
      ok: false,
      message: 'color is not a parameter — use the color argument of update_indicator.'
    })
  })

  it('rejects a non-numeric number field', () => {
    expect(validateParams('ma', { period: 'abc' })).toEqual({
      ok: false, message: 'period must be a number >= 1.'
    })
  })

  it('rejects a number below min', () => {
    expect(validateParams('ma', { period: 0 })).toEqual({
      ok: false, message: 'period must be a number >= 1.'
    })
  })

  it('rejects a value outside a select field options', () => {
    expect(validateParams('ma', { kind: 'WMA' })).toEqual({
      ok: false, message: 'kind must be one of SMA, EMA.'
    })
  })

  it('rejects an unknown source', () => {
    expect(validateParams('ma', { source: 'vwap' })).toEqual({
      ok: false, message: 'source must be one of close, open, high, low, hl2, hlc3.'
    })
  })

  it('rejects an unknown indicator type', () => {
    expect(validateParams('sma', { period: 5 })).toEqual({
      ok: false,
      message: `Unknown indicator "sma". Available: ${INDICATOR_TYPES.join(', ')}.`
    })
  })
})

describe('indicatorCatalog', () => {
  it('lists every registered type with its parameter names', () => {
    const text = indicatorCatalog()
    expect(text).toContain('ma(period, kind, source)')
    expect(text).toContain('volume()')
    for (const type of INDICATOR_TYPES) expect(text).toContain(type)
  })
})
