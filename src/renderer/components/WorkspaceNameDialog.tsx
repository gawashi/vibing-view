import React, { useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { useAppStore } from '../store'

export type NameDialogMode = 'create' | 'rename' | 'duplicate'

export type WorkspaceNameDialogProps = {
  mode: NameDialogMode
  initialValue: string
  target: string
  onClose: () => void
}

// ワークスペース名を入力する共用ダイアログ。create=新規 / duplicate=target の複製 / rename=target の改名。
// 成功で onClose、失敗はインラインでエラー表示（ダイアログは開いたまま）。
export function WorkspaceNameDialog({ mode, initialValue, target, onClose }: WorkspaceNameDialogProps): React.JSX.Element {
  const createWorkspace = useAppStore((s) => s.createWorkspace)
  const duplicateWorkspace = useAppStore((s) => s.duplicateWorkspace)
  const renameWorkspace = useAppStore((s) => s.renameWorkspace)

  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)

  const title = mode === 'rename' ? 'Rename workspace' : mode === 'duplicate' ? 'Duplicate workspace' : 'New workspace'
  const cta = mode === 'rename' ? 'Rename' : mode === 'duplicate' ? 'Duplicate' : 'Create'

  const confirm = (): void => {
    const result =
      mode === 'create'
        ? createWorkspace(value)
        : mode === 'duplicate'
          ? duplicateWorkspace(value, target)
          : renameWorkspace(target, value)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="p-6">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="mt-4 flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="workspace-name">Name</label>
          <Input
            id="workspace-name"
            value={value}
            placeholder="e.g. Morning watch"
            autoFocus
            onChange={(e) => { setValue(e.target.value); setError(null) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && value.trim().length > 0) {
                e.preventDefault()
                confirm()
              }
            }}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm} disabled={value.trim().length === 0}>{cta}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
