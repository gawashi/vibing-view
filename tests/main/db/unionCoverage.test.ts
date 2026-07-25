import { describe, it, expect } from 'vitest'
import { unionCoverage } from '../../../src/main/db/barStore'

describe('unionCoverage', () => {
  it('takes the min oldest and max newest of both ranges', () => {
    expect(unionCoverage({ oldestTime: 100, newestTime: 200 }, { oldestTime: 180, newestTime: 300 }))
      .toEqual({ oldestTime: 100, newestTime: 300 })
  })
  it('preserves the wider range when one contains the other', () => {
    expect(unionCoverage({ oldestTime: 100, newestTime: 500 }, { oldestTime: 200, newestTime: 300 }))
      .toEqual({ oldestTime: 100, newestTime: 500 })
  })
  it('extends only the right edge for a differential merge', () => {
    // existing history + a right-edge differential must keep oldestTime
    expect(unionCoverage({ oldestTime: 100, newestTime: 200 }, { oldestTime: 200, newestTime: 260 }))
      .toEqual({ oldestTime: 100, newestTime: 260 })
  })
})
