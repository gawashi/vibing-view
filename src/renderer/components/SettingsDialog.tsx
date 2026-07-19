import React, { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { api } from '@/api'

export function SettingsDialog(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [status, setStatus] = useState<{ hasKey: boolean; encryptionAvailable: boolean } | null>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (open) void api.apikey.status().then(setStatus)
  }, [open])

  const save = async (): Promise<void> => {
    await api.apikey.set(key)
    setKey('')
    setStatus(await api.apikey.status())
    void queryClient.invalidateQueries({ queryKey: ['ohlcv'] })
    void queryClient.invalidateQueries({ queryKey: ['capabilities'] }) // SC4: paid key re-enables intraday, no code change
  }

  const clear = async (): Promise<void> => {
    if (!confirm("Remove your saved FMP API key? You'll need to re-enter it to fetch new data. Already-cached charts keep working offline.")) return
    await api.apikey.clear()
    setStatus(await api.apikey.status())
    void queryClient.invalidateQueries({ queryKey: ['capabilities'] })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Settings</Button>
      </DialogTrigger>
      <DialogContent className="p-6">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        {status && !status.encryptionAvailable && (
          <Alert variant="destructive">
            <AlertDescription>
              Your OS doesn't support secure credential storage. Your API key will be saved in plain text on this
              device — avoid using this app on a shared machine until this is resolved.
            </AlertDescription>
          </Alert>
        )}
        <div className="mt-4 flex flex-col gap-3">
          <Input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={status?.hasKey ? 'API key saved — enter a new key to replace' : 'Enter your FMP API key'}
          />
          <div className="flex gap-2">
            <Button onClick={save} disabled={key.length === 0}>Save API Key</Button>
            {status?.hasKey && (
              <Button variant="destructive" onClick={clear}>Remove API Key</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
