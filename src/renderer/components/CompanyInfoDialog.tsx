import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, qk } from '@/api'
import { useAppStore } from '@/store'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import type { CompanyInfo } from '@shared/types'

const fmtCompact = (n: number): string =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n)

// 値が null/空なら行ごと出さない（未取得フィールドで空ラベルが並ぶのを防ぐ）。
function Attr({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element | null {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  )
}

function CompanyInfoBody({ symbol }: { symbol: string }): React.JSX.Element {
  const q = useQuery<CompanyInfo>({
    queryKey: qk.companyInfo(symbol),
    queryFn: () => api.company.info(symbol)
  })

  if (q.isLoading) {
    return <div className="p-2 text-muted-foreground">Loading company info…</div>
  }
  if (q.isError || !q.data) {
    // Chart と同じ文言方針: HTTP 40x（プラン外/未カバー）は専用文言、それ以外は汎用エラー。
    const notCovered = /FMP HTTP 40[0-9]/.test(String((q.error as Error)?.message))
    return (
      <div className="p-2 text-center text-muted-foreground">
        {notCovered
          ? 'Company info isn’t available on your current FMP plan.'
          : 'Couldn’t load company info. Check your connection or your FMP API key in Settings.'}
      </div>
    )
  }

  const c = q.data
  const asOf = new Date(c.fetchedAt * 1000).toISOString().slice(0, 10)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {c.image && <img src={c.image} alt="" className="h-10 w-10 shrink-0 rounded" />}
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-base font-semibold">{c.companyName}</span>
          <span className="text-sm text-muted-foreground">
            {c.symbol}{c.exchange ? ` · ${c.exchange}` : ''}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3">
        <Attr label="Sector" value={c.sector} />
        <Attr label="Industry" value={c.industry} />
        <Attr label="Country" value={c.country} />
        <Attr label="Market cap" value={c.marketCap === null ? null : fmtCompact(c.marketCap)} />
        <Attr label="CEO" value={c.ceo} />
        <Attr label="Employees" value={c.fullTimeEmployees === null ? null : fmtCompact(c.fullTimeEmployees)} />
        <Attr label="IPO date" value={c.ipoDate} />
        <Attr label="Beta" value={c.beta === null ? null : c.beta.toFixed(2)} />
        <Attr label="52-week range" value={c.range} />
        <Attr label="Volume" value={c.volume === null ? null : fmtCompact(c.volume)} />
        <Attr label="Avg volume" value={c.averageVolume === null ? null : fmtCompact(c.averageVolume)} />
        <Attr label="Last dividend" value={c.lastDividend === null ? null : c.lastDividend.toFixed(2)} />
      </div>

      {c.description && (
        <p className="line-clamp-4 text-sm text-muted-foreground">{c.description}</p>
      )}

      <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
        {c.website
          ? <a href={c.website} target="_blank" rel="noreferrer" className="truncate text-primary hover:underline">{c.website}</a>
          : <span />}
        <span className="shrink-0">As of {asOf}</span>
      </div>
    </div>
  )
}

export function CompanyInfoDialog(): React.JSX.Element {
  const symbol = useAppStore((s) => s.companyInfoSymbol)
  const closeCompanyInfo = useAppStore((s) => s.closeCompanyInfo)
  return (
    <Dialog open={!!symbol} onOpenChange={(open) => { if (!open) closeCompanyInfo() }}>
      <DialogContent className="max-w-xl">
        <DialogHeader className="mb-1">
          <DialogTitle>Company info</DialogTitle>
        </DialogHeader>
        {symbol && <CompanyInfoBody symbol={symbol} />}
      </DialogContent>
    </Dialog>
  )
}
