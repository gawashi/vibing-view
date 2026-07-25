import React, { useState } from 'react'
import { Settings as SettingsIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ThemeSetting } from './settings/ThemeSetting'
import { ApiKeySetting } from './settings/ApiKeySetting'
import { McpSetting } from './settings/McpSetting'

export function SettingsDialog(): React.JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Both triggers wrap the Button directly (Slot merges onto it). DialogTrigger's child must be
          the Button, NOT the Tooltip root — a Tooltip root renders no DOM, so the open-onClick would
          never reach the button and the dialog wouldn't open. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Settings">
              <SettingsIcon className="size-4" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Settings</TooltipContent>
      </Tooltip>
      <DialogContent className="max-w-lg p-6">
        <DialogHeader className="mb-3">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-6">
          <ThemeSetting />
          <ApiKeySetting />
          <McpSetting />
        </div>
      </DialogContent>
    </Dialog>
  )
}
