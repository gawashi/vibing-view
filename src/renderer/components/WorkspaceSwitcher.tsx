import React, { useState } from 'react'
import { ChevronDown, Copy, Folders, Pencil, Plus } from 'lucide-react'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { useAppStore } from '../store'
import { WorkspaceNameDialog, type NameDialogMode } from './WorkspaceNameDialog'
import { WorkspaceEditDialog } from './WorkspaceEditDialog'

// ヘッダーのワークスペース切替器。クリックで切替、New で新規、Edit で管理モーダル（並べ替え/rename/
// delete/複製）を開く。管理操作そのものは WorkspaceEditDialog に集約（このメニューは切替専用）。
export function WorkspaceSwitcher(): React.JSX.Element {
  const workspaces = useAppStore((s) => s.workspaces)
  const activeWorkspace = useAppStore((s) => s.activeWorkspace)
  const switchWorkspace = useAppStore((s) => s.switchWorkspace)

  const [menuOpen, setMenuOpen] = useState(false)
  const [nameDialog, setNameDialog] = useState<{ mode: NameDialogMode; value: string; target: string } | null>(null)
  const [editOpen, setEditOpen] = useState(false)

  return (
    <>
      {/* modal={false}: メニュー項目から Dialog を開くときの body ロック競合を避ける。 */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className="max-w-[220px]">
            <Folders className="size-4 shrink-0" />
            <span className="truncate" title={activeWorkspace}>{activeWorkspace}</span>
            <ChevronDown className="shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[60vh] overflow-y-auto">
          {workspaces.map((w) => (
            <DropdownMenuItem
              key={w.name}
              className={w.name === activeWorkspace ? 'bg-accent text-accent-foreground' : ''}
              onClick={() => { switchWorkspace(w.name); setMenuOpen(false) }}
            >
              <span className="truncate" title={w.name}>{w.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setNameDialog({ mode: 'create', value: '', target: '' })}>
            <Plus className="size-4" /> New workspace…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setNameDialog({ mode: 'duplicate', value: `${activeWorkspace} copy`, target: activeWorkspace })}>
            <Copy className="size-4" /> Duplicate current…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Pencil className="size-4" /> Edit workspaces…
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

      <WorkspaceEditDialog open={editOpen} onOpenChange={setEditOpen} />
    </>
  )
}
