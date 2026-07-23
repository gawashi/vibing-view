import React, { useState } from 'react'
import { ChevronDown, ChevronUp, Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { useAppStore } from '../store'
import { WorkspaceNameDialog, type NameDialogMode } from './WorkspaceNameDialog'

// ヘッダーの統合切替器。ワークスペース（= リスト + グリッド）の切替・並べ替え・rename・delete と、
// 新規作成／現在の複製。切り替えるとサイドバーの銘柄リストとグリッドが一緒に変わる。
export function WorkspaceSwitcher(): React.JSX.Element {
  const workspaces = useAppStore((s) => s.workspaces)
  const activeWorkspace = useAppStore((s) => s.activeWorkspace)
  const deleteWorkspace = useAppStore((s) => s.deleteWorkspace)
  const switchWorkspace = useAppStore((s) => s.switchWorkspace)
  const reorderWorkspaces = useAppStore((s) => s.reorderWorkspaces)

  const [menuOpen, setMenuOpen] = useState(false)
  const [nameDialog, setNameDialog] = useState<{ mode: NameDialogMode; value: string; target: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  return (
    <>
      {/* modal={false}: メニュー項目から Dialog を開くときの body ロック競合を避ける（旧 LayoutMenu と同じ）。 */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className="max-w-[220px]">
            <span className="truncate" title={activeWorkspace}>{activeWorkspace}</span>
            <ChevronDown className="shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[60vh] overflow-y-auto">
          {workspaces.map((w, i) => (
            <div
              key={w.name}
              className={`group flex items-center gap-1 rounded-sm px-2 py-1.5 text-sm ${
                w.name === activeWorkspace ? 'bg-accent text-accent-foreground' : ''
              }`}
            >
              <button
                type="button"
                title={w.name}
                className="min-w-0 flex-1 truncate text-left"
                onClick={() => { switchWorkspace(w.name); setMenuOpen(false) }}
              >
                {w.name}
              </button>
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  type="button"
                  aria-label="Move up"
                  disabled={i === 0}
                  className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
                  onClick={(e) => { e.stopPropagation(); reorderWorkspaces(i, i - 1) }}
                >
                  <ChevronUp className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  disabled={i === workspaces.length - 1}
                  className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
                  onClick={(e) => { e.stopPropagation(); reorderWorkspaces(i, i + 1) }}
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
                    setNameDialog({ mode: 'rename', value: w.name, target: w.name })
                  }}
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Delete"
                  disabled={workspaces.length <= 1}
                  className="rounded p-0.5 text-destructive hover:bg-muted disabled:opacity-30"
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setDeleteTarget(w.name) }}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setNameDialog({ mode: 'create', value: '', target: '' })}>
            <Plus className="size-4" /> New workspace…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setNameDialog({ mode: 'duplicate', value: `${activeWorkspace} copy`, target: activeWorkspace })}>
            <Copy className="size-4" /> Duplicate current…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {nameDialog && (
        <WorkspaceNameDialog
          mode={nameDialog.mode}
          initialValue={nameDialog.value}
          target={nameDialog.target}
          onClose={() => setNameDialog(null)}
        />
      )}

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent className="p-6">
          <DialogHeader>
            <DialogTitle>Delete workspace?</DialogTitle>
          </DialogHeader>
          <p className="mt-2 text-sm text-muted-foreground">
            This removes the workspace "{deleteTarget}", its watchlist, and its layout. This can't be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { if (deleteTarget) deleteWorkspace(deleteTarget); setDeleteTarget(null) }}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
