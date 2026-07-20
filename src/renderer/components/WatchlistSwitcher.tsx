import React, { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { useAppStore } from '../store'

type NameDialogState = { mode: 'create' | 'rename'; value: string; error: string | null }

// サイドバー上部のウォッチリスト切替。LayoutMenu と同じ shadcn DropdownMenu パターン
// (キーボードナビ / セパレータ / 破壊的項目 / max-height スクロール)。
export function WatchlistSwitcher(): React.JSX.Element {
  const watchlists = useAppStore((s) => s.watchlists)
  const activeWatchlist = useAppStore((s) => s.activeWatchlist)
  const createWatchlist = useAppStore((s) => s.createWatchlist)
  const renameWatchlist = useAppStore((s) => s.renameWatchlist)
  const deleteWatchlist = useAppStore((s) => s.deleteWatchlist)
  const switchWatchlist = useAppStore((s) => s.switchWatchlist)

  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const confirmNameDialog = (): void => {
    if (!nameDialog) return
    const result =
      nameDialog.mode === 'create'
        ? createWatchlist(nameDialog.value)
        : renameWatchlist(activeWatchlist, nameDialog.value)
    if (!result.ok) {
      setNameDialog({ ...nameDialog, error: result.error })
      return
    }
    setNameDialog(null)
  }

  return (
    <>
      {/* modal={false}: メニュー項目から Dialog を開くときの body ロック競合を避ける (LayoutMenu と同じ)。 */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className="w-full justify-between">
            <span className="truncate" title={activeWatchlist}>{activeWatchlist}</span>
            <ChevronDown className="shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[60vh] overflow-y-auto">
          {watchlists.map((w) => (
            <DropdownMenuItem
              key={w.name}
              title={w.name}
              className="max-w-[240px] truncate"
              onClick={() => switchWatchlist(w.name)}
            >
              {w.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setNameDialog({ mode: 'create', value: '', error: null })}>
            New list…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setNameDialog({ mode: 'rename', value: activeWatchlist, error: null })}>
            Rename…
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={watchlists.length <= 1}
            className="text-destructive focus:text-destructive"
            onClick={() => setDeleteTarget(activeWatchlist)}
          >
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={nameDialog !== null} onOpenChange={(open) => { if (!open) setNameDialog(null) }}>
        <DialogContent className="p-6">
          <DialogHeader>
            <DialogTitle>{nameDialog?.mode === 'rename' ? 'Rename watchlist' : 'New watchlist'}</DialogTitle>
          </DialogHeader>
          <div className="mt-4 flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="watchlist-name">Name</label>
            <Input
              id="watchlist-name"
              value={nameDialog?.value ?? ''}
              placeholder="e.g. Tech"
              onChange={(e) => setNameDialog((prev) => (prev ? { ...prev, value: e.target.value, error: null } : prev))}
            />
            {nameDialog?.error && <p className="text-sm text-destructive">{nameDialog.error}</p>}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setNameDialog(null)}>Cancel</Button>
            <Button onClick={confirmNameDialog} disabled={(nameDialog?.value ?? '').trim().length === 0}>
              {nameDialog?.mode === 'rename' ? 'Rename' : 'Create'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent className="p-6">
          <DialogHeader>
            <DialogTitle>Delete watchlist?</DialogTitle>
          </DialogHeader>
          <p className="mt-2 text-sm text-muted-foreground">
            This removes the watchlist "{deleteTarget}" and its symbols. This can't be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => { if (deleteTarget) deleteWatchlist(deleteTarget); setDeleteTarget(null) }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
