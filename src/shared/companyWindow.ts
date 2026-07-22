// Company-info windows reuse the main renderer bundle; the target symbol rides in the URL hash
// (#company=SYMBOL). main.tsx branches on parseCompanySymbol; main-process index.ts builds the URL
// with buildCompanyHash. Shared here so both sides agree on the exact format.
export function buildCompanyHash(symbol: string): string {
  return `company=${encodeURIComponent(symbol)}`
}

export function parseCompanySymbol(hash: string): string | null {
  const q = hash.startsWith('#') ? hash.slice(1) : hash
  return new URLSearchParams(q).get('company')
}
