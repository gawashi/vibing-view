import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { api } from '@/api'
import { parseWorkspaceCollection } from '@shared/workspace'
import type { WorkspaceCollection } from '@shared/types'

// Module-scope guard: true only while we're applying a remote/get collection. The store notifies
// subscribers synchronously inside set(), so the save subscriber below sees this true during the
// remote hydrate and skips scheduling an echo save. One window per renderer → one hook instance.
let applyingRemote = false

// Startup hydrate + debounced persist + cross-window sync, shared by App and ChartWindow. Both
// windows are views over the SAME persisted workspace collection; this hook is the whole sync.
export function useWorkspaceSync(): void {
  useEffect(() => {
    let mounted = true
    let lastRev = -1
    let timer: ReturnType<typeof setTimeout> | null = null

    const apply = (collection: WorkspaceCollection, rev: number): void => {
      if (rev <= lastRev) return // stale / out-of-order (also drops a get that lost the startup race)
      lastRev = rev
      if (timer) { clearTimeout(timer); timer = null } // a pending local save is now stale — cancel it
      applyingRemote = true
      useAppStore.getState().hydrateWorkspaces(collection)
      applyingRemote = false
    }

    void api.workspaces.get().then((p) => {
      if (mounted) apply(parseWorkspaceCollection(p.collection), p.rev)
    })

    const off = api.workspaces.onChanged((p) => {
      apply(parseWorkspaceCollection(p.collection), p.rev)
    })

    const unsubscribe = useAppStore.subscribe(
      (s) => [s.cells, s.shape, s.activeCellId, s.workspaces, s.activeWorkspace] as const,
      () => {
        if (applyingRemote) return
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          void api.workspaces.set(useAppStore.getState().collectionSnapshot())
        }, 500)
      },
      { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] }
    )

    return () => {
      mounted = false
      if (timer) clearTimeout(timer)
      off()
      unsubscribe()
    }
  }, [])
}
