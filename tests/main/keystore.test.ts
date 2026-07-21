import { describe, it, expect } from 'vitest'
import { maskKey } from '../../src/main/keystore'

describe('maskKey', () => {
  it('shows the last 4 chars real, the rest as dots, total length == key length', () => {
    const masked = maskKey('ABCD1234WXYZ') // length 12
    expect(masked).toBe('••••••••WXYZ')
    expect(masked.length).toBe(12)
  })

  it('masks the whole thing when the key is 4 chars or shorter', () => {
    expect(maskKey('AB')).toBe('••')
    expect(maskKey('WXYZ')).toBe('••••')
  })
})
