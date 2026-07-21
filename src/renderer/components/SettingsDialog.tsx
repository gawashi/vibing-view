import React, { useState } from 'react'
import { Settings as SettingsIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ThemeSetting } from './settings/ThemeSetting'
import { ApiKeySetting } from './settings/ApiKeySetting'

// Declarative registry. Add a category = one SECTIONS entry. Move an item between categories =
// change its `section` string. Order within a category = order in ITEMS. (spec: settings-dialog-structure)
const SECTIONS = [{ id: 'general', label: 'General' }] as const
type SectionId = (typeof SECTIONS)[number]['id']

const ITEMS: { id: string; section: SectionId; render: () => React.JSX.Element }[] = [
  { id: 'theme', section: 'general', render: () => <ThemeSetting /> },
  { id: 'apikey', section: 'general', render: () => <ApiKeySetting /> }
]

export function SettingsDialog(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<SectionId>(SECTIONS[0].id)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Settings">
              <SettingsIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
      </DialogTrigger>
      <DialogContent className="max-w-2xl p-0">
        <div className="flex min-h-[360px]">
          <nav className="w-40 shrink-0 border-r border-border p-3">
            <DialogHeader className="mb-3 px-1">
              <DialogTitle>Settings</DialogTitle>
            </DialogHeader>
            <ul className="flex flex-col gap-1">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setActive(s.id)}
                    className={cn(
                      'w-full rounded-md px-2 py-1.5 text-left text-sm',
                      active === s.id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                    )}
                  >
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex flex-1 flex-col gap-6 p-6">
            {ITEMS.filter((i) => i.section === active).map((i) => (
              <div key={i.id}>{i.render()}</div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
