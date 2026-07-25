import React, { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/api'
import type { KeyStatus } from '@shared/ipc'

export function ApiKeySetting(): React.JSX.Element {
  const [key, setKey] = useState('')
  const [status, setStatus] = useState<KeyStatus | null>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    void api.apikey.status().then(setStatus)
  }, [])

  const save = async (): Promise<void> => {
    await api.apikey.set(key)
    setKey('')
    setStatus(await api.apikey.status())
    void queryClient.invalidateQueries({ queryKey: ['ohlcv'] })
    void queryClient.invalidateQueries({ queryKey: ['capabilities'] }) // SC4: paid key re-enables intraday, no code change
    void queryClient.invalidateQueries({ queryKey: ['profile'] }) // キー登録でヘッダー社名/取引所を再解決
  }

  const clear = async (): Promise<void> => {
    if (!confirm("Remove your saved FMP API key? You'll need to re-enter it to fetch new data. Already-cached charts keep working offline.")) return
    await api.apikey.clear()
    setStatus(await api.apikey.status())
    void queryClient.invalidateQueries({ queryKey: ['capabilities'] })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-medium">FMP API Key</div>
      {status && !status.encryptionAvailable && (
        <div role="alert" className="rounded-lg border border-destructive/50 p-4 text-sm text-destructive">
          Your OS doesn't support secure credential storage. Your API key will be saved in plain text on this
          device — avoid using this app on a shared machine until this is resolved.
        </div>
      )}
      {status?.maskedKey && (
        <div className="text-xs text-muted-foreground">Saved: {status.maskedKey}</div>
      )}
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
  )
}
