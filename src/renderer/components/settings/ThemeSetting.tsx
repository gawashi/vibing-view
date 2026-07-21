import React, { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api } from '@/api'
import { applyTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import type { Theme } from '@shared/ipc'

const OPTIONS: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' }
]

export function ThemeSetting(): React.JSX.Element {
  const [theme, setTheme] = useState<Theme>('system')

  useEffect(() => {
    void api.settings.getTheme().then(setTheme)
  }, [])

  const select = (t: Theme): void => {
    setTheme(t)
    applyTheme(t)
    void api.settings.setTheme(t)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-medium">Theme</div>
      <div className="flex gap-2">
        {OPTIONS.map((o) => (
          <Button
            key={o.value}
            variant={theme === o.value ? 'default' : 'secondary'}
            size="sm"
            onClick={() => select(o.value)}
            aria-pressed={theme === o.value}
            className={cn(theme === o.value && 'ring-1 ring-ring')}
          >
            {o.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
