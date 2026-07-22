// Enlarge-chart windows reuse the main renderer bundle; the target cell rides in the URL hash
// (#chart=CELLID). main.tsx branches on parseChartCellId; main-process index.ts builds the URL with
// buildChartHash. Twin of companyWindow.ts — shared so both sides agree on the exact format.
export function buildChartHash(cellId: string): string {
  return `chart=${encodeURIComponent(cellId)}`
}

export function parseChartCellId(hash: string): string | null {
  const q = hash.startsWith('#') ? hash.slice(1) : hash
  return new URLSearchParams(q).get('chart')
}
