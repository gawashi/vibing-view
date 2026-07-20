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
import { api } from '../api'
import { useAppStore } from '../store'

type NameDialogState = { mode: 'save' | 'rename'; value: string; error: string | null }

// Header layout menu (05-03/D-56): save/save-as/rename/delete a named layout, plus a scrollable
// list of saved layouts to switch between. Uses shadcn DropdownMenu (keyboard nav, separators,
// disabled + destructive items, max-height scroll) — AddIndicatorMenu's plain inline menu isn't
// enough here, per the approved UI-SPEC.
export function LayoutMenu(): React.JSX.Element {
  const [layouts, setLayouts] = useState<string[]>([])
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const activeLayoutName = useAppStore((s) => s.activeLayoutName)
  const saveLayoutAs = useAppStore((s) => s.saveLayoutAs)
  const saveActiveLayout = useAppStore((s) => s.saveActiveLayout)
  const renameActiveLayout = useAppStore((s) => s.renameActiveLayout)
  const deleteLayout = useAppStore((s) => s.deleteLayout)
  const switchToLayout = useAppStore((s) => s.switchToLayout)

  const refreshLayouts = (): void => {
    void api.layout.list().then(setLayouts)
  }

  const confirmNameDialog = async (): Promise<void> => {
    if (!nameDialog) return
    const name = nameDialog.value.trim()
    if (name.length === 0) return
    const result =
      nameDialog.mode === 'save' ? await saveLayoutAs(name) : await renameActiveLayout(name)
    if (!result.ok) {
      setNameDialog({ ...nameDialog, error: result.error })
      return
    }
    setNameDialog(null)
    refreshLayouts()
  }

  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return
    await deleteLayout(deleteTarget)
    setDeleteTarget(null)
    refreshLayouts()
  }

  return (
    <>
      {/* modal={false}: a modal DropdownMenu locks <body> with pointer-events:none and a focus
          scope; opening a Dialog from one of its items (Save As/Rename/Delete) races that teardown
          and leaves the lock stuck → the whole window becomes unclickable ("freeze"). Non-modal
          menu doesn't lock the body; the Dialog stays modal and cleans up its own overlay. */}
      <DropdownMenu modal={false} onOpenChange={(open) => open && refreshLayouts()}>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">
            Layout
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onClick={() => {
              if (activeLayoutName) void saveActiveLayout()
              else setNameDialog({ mode: 'save', value: '', error: null })
            }}
          >
            Save
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setNameDialog({ mode: 'save', value: '', error: null })}>
            Save As New…
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!activeLayoutName}
            onClick={() => setNameDialog({ mode: 'rename', value: activeLayoutName ?? '', error: null })}
          >
            Rename…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!activeLayoutName}
            className="text-destructive focus:text-destructive"
            onClick={() => activeLayoutName && setDeleteTarget(activeLayoutName)}
          >
            Delete…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {layouts.length === 0 ? (
            <DropdownMenuItem disabled className="text-muted-foreground">
              No saved layouts yet
            </DropdownMenuItem>
          ) : (
            layouts.map((name) => (
              <DropdownMenuItem
                key={name}
                title={name}
                className="max-w-[240px] truncate"
                onClick={() => void switchToLayout(name)}
              >
                {name}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={nameDialog !== null}
        onOpenChange={(open) => {
          if (!open) setNameDialog(null)
        }}
      >
        <DialogContent className="p-6">
          <DialogHeader>
            <DialogTitle>{nameDialog?.mode === 'rename' ? 'Rename layout' : 'Save layout as'}</DialogTitle>
          </DialogHeader>
          <div className="mt-4 flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="layout-name">
              Name
            </label>
            <Input
              id="layout-name"
              value={nameDialog?.value ?? ''}
              placeholder="e.g. Morning watch"
              onChange={(e) =>
                setNameDialog((prev) => (prev ? { ...prev, value: e.target.value, error: null } : prev))
              }
            />
            {nameDialog?.error && <p className="text-sm text-destructive">{nameDialog.error}</p>}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setNameDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void confirmNameDialog()}
              disabled={nameDialog?.value.trim().length === 0}
            >
              {nameDialog?.mode === 'rename' ? 'Rename' : 'Save'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <DialogContent className="p-6">
          <DialogHeader>
            <DialogTitle>Delete layout?</DialogTitle>
          </DialogHeader>
          <p className="mt-2 text-sm text-muted-foreground">
            This removes the saved layout "{deleteTarget}". This can't be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
