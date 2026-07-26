import { describe, it, expect } from 'vitest'
import { toBars } from '../../../src/main/core'
import type { Bar } from '@shared/types'

const bar: Bar = { time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }

describe('toBars', () => {
  it('passes bars through on ok', () => {
    expect(toBars({ kind: 'ok', bars: [bar], apiCalls: 1 })).toEqual([bar])
  })

  it.each(['out-of-plan', 'unknown-symbol', 'empty-range'] as const)(
    'folds %s to an empty array so the renderer contract is unchanged',
    (kind) => {
      expect(toBars({ kind })).toEqual([])
    }
  )
})
