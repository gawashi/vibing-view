// Result of one App.reload() run. `busy` means the call was refused because another refresh was
// already running — the caller should retry, not treat zero counts as "nothing to do" (MW-14).
export type ReloadResult = { refreshed: number; failed: number; busy: boolean }

export const BUSY_RESULT: ReloadResult = { refreshed: 0, failed: 0, busy: true }

export function countOhlcv(
  results: PromiseSettledResult<unknown>[]
): { refreshed: number; failed: number } {
  let refreshed = 0
  let failed = 0
  for (const r of results) {
    if (r.status === 'fulfilled') refreshed += 1
    else failed += 1
  }
  return { refreshed, failed }
}
