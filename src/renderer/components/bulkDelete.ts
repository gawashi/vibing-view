import type { AppState } from '../store'

export type BulkTarget = 'charts' | 'indicators'

// Only the two bulk actions are needed to run a delete — keep the selector param narrow so the
// config is trivially testable with a fake store (no full AppState needed).
type BulkActions = Pick<AppState, 'clearAllCells' | 'removeAllIndicators'>

// Single source of truth for both bulk-delete actions: confirm-dialog copy + which store mutation
// to run. `action` is a pure selector so the charts↔indicators binding is data, not a branch — a
// swap is caught by tests/renderer/bulkDelete.test.ts, not just at runtime.
export const BULK_DELETE: Record<
  BulkTarget,
  { title: string; description: string; action: (s: BulkActions) => () => void }
> = {
  charts: {
    title: 'Clear all charts?',
    description:
      "This removes the symbol and all user-added indicators from every cell in this workspace, including hidden cells. This can't be undone.",
    action: (s) => s.clearAllCells
  },
  indicators: {
    title: 'Clear all indicators?',
    description:
      "This removes all user-added indicators from every cell in this workspace, including hidden cells. Symbols and volume are kept. This can't be undone.",
    action: (s) => s.removeAllIndicators
  }
}
