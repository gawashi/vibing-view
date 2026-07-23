import React, { useState } from 'react'
import { Copy, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { useAppStore } from '../store'
import { reorderTargetIndex } from '@shared/workspace'
import { WorkspaceNameDialog, type NameDialogMode } from './WorkspaceNameDialog'
import { cn } from '../lib/utils'

export type WorkspaceEditDialogProps = { open: boolean; onOpenChange: (open: boolean) => void }

// ワークスペース管理を1枚で完結させるモーダル。並べ替え(DnD)/rename/duplicate/delete/新規。
// 切替はしない（誤操作防止。切替はヘッダーのドロップダウン担当）。
export function WorkspaceEditDialog({ open, onOpenChange }: WorkspaceEditDialogProps): React.JSX.Element {
  const workspaces = useAppStore((s) => s.workspaces)
  const activeWorkspace = useAppStore((s) => s.activeWorkspace)
  const reorderWorkspaces = useAppStore((s) => s.reorderWorkspaces)
  const deleteWorkspace = useAppStore((s) => s.deleteWorkspace)

  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [nameDialog, setNameDialog] = useState<{ mode: NameDialogMode; value: string; target: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  // ドラッグ中に別ウィンドウ(useWorkspaceSync)が一覧を変えても正しい行を動かすため、payload は
  // インデックスでなくワークスペース名（安定 ID）で持ち、drop 時に最新の一覧から現在位置を引き直す。
  // 表示ドロップ位置 dropIndex（末尾ゾーンは length）を最新の workspaces に対して変換する。
  const handleDrop = (fromName: string, dropIndex: number): void => {
    const list = useAppStore.getState().workspaces
    const from = list.findIndex((w) => w.name === fromName)
    if (from === -1) { setOverIndex(null); return } // 別ウィンドウで消えた行はドロップを無視
    const to = reorderTargetIndex(from, dropIndex, list.length)
    reorderWorkspaces(from, to) // from===to は store 側で no-op
    setOverIndex(null)
  }

  const readName = (e: React.DragEvent): string | null => {
    const raw = e.dataTransfer.getData('text/plain')
    return raw === '' ? null : raw // 空 dataTransfer を弾く
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="p-6">
          <DialogHeader>
            <DialogTitle>Edit workspaces</DialogTitle>
          </DialogHeader>

          <ul className="mt-4 max-h-[60vh] overflow-y-auto">
            {workspaces.map((w, i) => (
              <li
                key={w.name}
                onDragOver={(e) => { e.preventDefault(); setOverIndex(i) }}
                onDrop={(e) => { e.preventDefault(); const name = readName(e); if (name !== null) handleDrop(name, i) }}
                className={cn(
                  'group flex items-center gap-1 border-t-2 border-transparent px-2 py-2',
                  w.name === activeWorkspace && 'bg-accent text-accent-foreground rounded-sm',
                  overIndex === i && 'border-primary'
                )}
              >
                <span
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', w.name) }}
                  onDragEnd={() => setOverIndex(null)}
                  aria-label={`Reorder ${w.name}`}
                  className="shrink-0 cursor-grab text-muted-foreground"
                >
                  <GripVertical className="size-4" />
                </span>
                <span className="min-w-0 flex-1 truncate" title={w.name}>{w.name}</span>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button" aria-label="Rename" className="rounded p-1 hover:bg-muted"
                    onClick={() => setNameDialog({ mode: 'rename', value: w.name, target: w.name })}
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button" aria-label="Duplicate" className="rounded p-1 hover:bg-muted"
                    onClick={() => setNameDialog({ mode: 'duplicate', value: `${w.name} copy`, target: w.name })}
                  >
                    <Copy className="size-4" />
                  </button>
                  <button
                    type="button" aria-label="Delete" disabled={workspaces.length <= 1}
                    className="rounded p-1 text-destructive hover:bg-muted disabled:opacity-30"
                    onClick={() => setDeleteTarget(w.name)}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </li>
            ))}
            {/* 末尾ドロップゾーン: dropIndex = length で末尾へ移動 */}
            <li
              onDragOver={(e) => { e.preventDefault(); setOverIndex(workspaces.length) }}
              onDrop={(e) => { e.preventDefault(); const name = readName(e); if (name !== null) handleDrop(name, workspaces.length) }}
              className={cn('h-3 border-t-2 border-transparent', overIndex === workspaces.length && 'border-primary')}
            />
          </ul>

          <div className="mt-4 flex items-center justify-between">
            <Button variant="secondary" onClick={() => setNameDialog({ mode: 'create', value: '', target: '' })}>
              <Plus className="size-4" /> New workspace…
            </Button>
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>

      {nameDialog && (
        <WorkspaceNameDialog
          mode={nameDialog.mode}
          initialValue={nameDialog.value}
          target={nameDialog.target}
          onClose={() => setNameDialog(null)}
        />
      )}

      <Dialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
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
