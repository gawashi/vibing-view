// Pure — no I/O, no electron. Single centralized place to classify an FMP response into a
// capability verdict (DESIGN-ADDENDUM §7). Order matters: HTTP status first, then message sniff.

function messageOf(body: unknown): string {
  if (typeof body === 'string') return body
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    const msg = b['Error Message'] ?? b['error'] ?? b['message']
    if (typeof msg === 'string') return msg
  }
  return ''
}

export function classify(status: number, body: unknown): 'requires-plan' | 'rate-limited' | 'available' {
  if (status === 429) return 'rate-limited'
  // 402 Payment Required + 403 Forbidden are FMP's plan-gating responses (402 is what the free tier
  // returns for intraday endpoints; body is often null so this must be status-driven, not message).
  if (status === 402 || status === 403) return 'requires-plan'

  const msg = messageOf(body).toLowerCase()

  // ponytail: MEDIUM-confidence response shapes — single tuning point, verify against a real FMP key (DESIGN-ADDENDUM §7)
  if (/limit reach|rate limit|too many requests/.test(msg)) return 'rate-limited'
  // ponytail: MEDIUM-confidence response shapes — single tuning point, verify against a real FMP key (DESIGN-ADDENDUM §7)
  if (/premium|exclusive|legacy|invalid api key/.test(msg)) return 'requires-plan'

  return 'available'
}
