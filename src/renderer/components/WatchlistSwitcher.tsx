import React, { useState } from 'react'
import { ChevronDown, ChevronUp, Pencil, Trash2 } from 'lucide-react'
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

type NameDialogState = { mode: 'create' | 'rename'; value: string; error: string | null; target: string }

// サイドバー上部のウォッチリスト切替＋管理。各行にホバー/フォーカスで現れる ↑↓✎🗑 を持たせ、
// アクティブに切り替えずに任意のリストを並び替え/rename/delete できる。
// リスト部分は Radix DropdownMenuItem ではなく素の行（行内ボタンとの捕捉競合を避けるため）。
export function WatchlistSwitcher(): React.JSX.Element {
  const watchlists = useAppStore((s) => s.watchlists)
  const activeWatchlist = useAppStore((s) => s.activeWatchlist)
  const createWatchlist = useAppStore((s) => s.createWatchlist)
  const renameWatchlist = useAppStore((s) => s.renameWatchlist)
  const deleteWatchlist = useAppStore((s) => s.deleteWatchlist)
  const switchWatchlist = useAppStore((s) => s.switchWatchlist)
  const reorderWatchlists = useAppStore((s) => s.reorderWatchlists)

  const [menuOpen, setMenuOpen] = useState(false)
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const confirmNameDialog = (): void => {
    if (!nameDialog) return
    const result =
      nameDialog.mode === 'create'
        ? createWatchlist(nameDialog.value)
        : renameWatchlist(nameDialog.target, nameDialog.value)
    if (!result.ok) {
      setNameDialog({ ...nameDialog, error: result.error })
      return
    }
    setNameDialog(null)
  }

  return (
    <>
      {/* modal={false}: メニュー項目/行から Dialog を開くときの body ロック競合を避ける (LayoutMenu と同じ)。 */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className="w-full justify-between">
            <span className="truncate" title={activeWatchlist}>{activeWatchlist}</span>
            <ChevronDown className="shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[60vh] overflow-y-auto">
          {watchlists.map((w, i) => (
            <div
              key={w.name}
              className={`group flex items-center gap-1 rounded-sm px-2 py-1.5 text-sm ${
                w.name === activeWatchlist ? 'bg-accent text-accent-foreground' : ''
              }`}
            >
              <button
                type="button"
                title={w.name}
                className="min-w-0 flex-1 truncate text-left"
                onClick={() => { switchWatchlist(w.name); setMenuOpen(false) }}
              >
                {w.name}
              </button>
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  type="button"
                  aria-label="Move up"
                  disabled={i === 0}
                  className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
                  onClick={(e) => { e.stopPropagation(); reorderWatchlists(i, i - 1) }}
                >
                  <ChevronUp className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  disabled={i === watchlists.length - 1}
                  className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
                  onClick={(e) => { e.stopPropagation(); reorderWatchlists(i, i + 1) }}
                >
                  <ChevronDown className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Rename"
                  className="rounded p-0.5 hover:bg-muted"
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuOpen(false)
                    setNameDialog({ mode: 'rename', value: w.name, error: null, target: w.name })
                  }}
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Delete"
                  disabled={watchlists.length <= 1}
                  className="rounded p-0.5 text-destructive hover:bg-muted disabled:opacity-30"
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setDeleteTarget(w.name) }}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setNameDialog({ mode: 'create', value: '', error: null, target: '' })}
          >
            New list…
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
