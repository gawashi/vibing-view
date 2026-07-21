import { describe, it, expect } from 'vitest'
import { resolveDark } from '../../src/renderer/lib/theme'

describe('resolveDark', () => {
  it("'dark' is always dark regardless of system", () => {
    expect(resolveDark('dark', false)).toBe(true)
    expect(resolveDark('dark', true)).toBe(true)
  })
  it("'light' is always light regardless of system", () => {
    expect(resolveDark('light', true)).toBe(false)
    expect(resolveDark('light', false)).toBe(false)
  })
  it("'system' follows the system preference", () => {
    expect(resolveDark('system', true)).toBe(true)
    expect(resolveDark('system', false)).toBe(false)
  })
})
