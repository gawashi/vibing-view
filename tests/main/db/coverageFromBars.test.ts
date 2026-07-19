import { describe, it, expect } from 'vitest'
import { coverageFromBars } from '../../../src/main/db/barStore'
import type { Bar } from '@shared/types'

const bar = (time: number): Bar => ({ time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 })

describe('coverageFromBars', () => {
  it('returns null for empty input', () => {
    expect(coverageFromBars([])).toBeNull()
  })
  it('returns min and max time regardless of order', () => {
    expect(coverageFromBars([bar(300), bar(100), bar(200)])).toEqual({ oldestTime: 100, newestTime: 300 })
  })
})
