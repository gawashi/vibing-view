import { timingSafeEqual } from 'crypto'

const BEARER = /^Bearer (.+)$/

export function tokenMatches(authorization: string | undefined, token: string): boolean {
  const presented = authorization?.match(BEARER)?.[1]
  if (!presented) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(token)
  // timingSafeEqual throws on a length mismatch, so screen that first. Length is not a secret.
  return a.length === b.length && timingSafeEqual(a, b)
}

// MCP's DNS-rebinding guard. A browser always sends Origin; Claude Desktop and Claude Code are
// non-browser clients and send none, so a missing header must pass or nothing can connect (M-12).
export function originAllowed(origin: string | undefined, port: number): boolean {
  if (origin === undefined) return true
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`
}
