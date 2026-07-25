import { describe, it, expect } from 'vitest'
import { tokenMatches, originAllowed } from '../../../src/main/mcp/auth'

describe('tokenMatches', () => {
  it('accepts the exact bearer token', () => {
    expect(tokenMatches('Bearer abc123', 'abc123')).toBe(true)
  })

  it('rejects a wrong token of the same length', () => {
    expect(tokenMatches('Bearer abc124', 'abc123')).toBe(false)
  })

  it('rejects a token of a different length without throwing', () => {
    expect(tokenMatches('Bearer short', 'a-much-longer-token')).toBe(false)
  })

  it('rejects a missing header', () => {
    expect(tokenMatches(undefined, 'abc123')).toBe(false)
  })

  it('rejects a non-Bearer scheme', () => {
    expect(tokenMatches('Basic abc123', 'abc123')).toBe(false)
  })
})

describe('originAllowed', () => {
  it('passes a request with no Origin header (non-browser clients send none)', () => {
    expect(originAllowed(undefined, 39100)).toBe(true)
  })

  it('allows loopback origins on the bound port', () => {
    expect(originAllowed('http://127.0.0.1:39100', 39100)).toBe(true)
    expect(originAllowed('http://localhost:39100', 39100)).toBe(true)
  })

  it('rejects another port', () => {
    expect(originAllowed('http://127.0.0.1:39101', 39100)).toBe(false)
  })

  it('rejects a remote origin', () => {
    expect(originAllowed('https://evil.example', 39100)).toBe(false)
  })
})
