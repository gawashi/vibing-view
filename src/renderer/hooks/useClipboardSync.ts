import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { api } from '@/api'
import type { ClipboardCell } from '@shared/types'

// Module-scope guard: true only while applying a remote/get clipboard, so the store subscriber
// below doesn't echo that value straight back to main. One window per renderer → one hook instance.
let applyingRemote = false

// Cross-window chart-clipboard sync, shared by App and ChartWindow. Main is the source of truth;
// this mirrors useWorkspaceSync's rev-guard (drops stale/out-of-order + startup race) but needs no
// debounce — copy/cut are discrete user actions, not a stream.
export function useClipboardSync(): void {
  useEffect(() => {
    let mounted = true
    let lastRev = -1

    const apply = (clipboard: ClipboardCell | null, rev: number): void => {
      if (rev <= lastRev) return // stale / out-of-order (also drops a get that lost the startup race)
      lastRev = rev
      applyingRemote = true
      try {
        useAppStore.getState().setClipboard(clipboard)
      } finally {
        applyingRemote = false
      }
    }

    void api.clipboard.get().then((p) => {
      if (mounted) apply(p.clipboard, p.rev)
    })

    const off = api.clipboard.onChanged((p) => apply(p.clipboard, p.rev))

    const unsubscribe = useAppStore.subscribe(
      (s) => s.chartClipboard,
      (clipboard) => {
        if (applyingRemote) return
        // Advance lastRev with the rev main assigns this write, so a slower startup get() can't
        // resolve afterward and overwrite a local copy/cut (esp. a cut, whose source is cleared).
        void api.clipboard.set(clipboard).then((rev) => {
          if (rev > lastRev) lastRev = rev
        })
      }
    )

    return () => {
      mounted = false
      off()
      unsubscribe()
    }
  }, [])
}
