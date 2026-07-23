import React, { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { api, qk } from '@/api'
import { cn } from '@/lib/utils'
import type { CompanyInfo } from '@shared/types'

const fmtCompact = (n: number | null | undefined): string | null =>
  n == null ? null : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n)
export const fmtRatio = (n: number | null | undefined): string | null => (n == null ? null : n.toFixed(2))
export const fmtPct = (n: number | null | undefined): string | null => (n == null ? null : `${(n * 100).toFixed(1)}%`)
export const fmtMoney = (n: number | null | undefined): string | null => (n == null ? null : `$${n.toFixed(2)}`)

// 値が null/空なら行ごと出さない（未取得フィールドで空ラベルが並ぶのを防ぐ）。
function Attr({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element | null {
  if (value == null || value === '') return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  )
}

const Grid = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div className="grid grid-cols-2 gap-x-6 gap-y-3">{children}</div>
)

// group == null (undefined from old cached rows OR null from a failed endpoint) → neutral note.
const NotAvailable = (): React.JSX.Element => (
  <div className="p-2 text-center text-sm text-muted-foreground">Not available.</div>
)

const TABS = ['Overview', 'Valuation', 'Financials', 'Analyst', 'Growth', 'Schedule'] as const
type Tab = (typeof TABS)[number]

function OverviewTab({ c }: { c: CompanyInfo }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <Grid>
        <Attr label="Sector" value={c.sector} />
        <Attr label="Industry" value={c.industry} />
        <Attr label="Country" value={c.country} />
        <Attr label="Market cap" value={fmtCompact(c.marketCap)} />
        <Attr label="CEO" value={c.ceo} />
        <Attr label="Employees" value={fmtCompact(c.fullTimeEmployees)} />
        <Attr label="IPO date" value={c.ipoDate} />
        <Attr label="Beta" value={fmtRatio(c.beta)} />
        <Attr label="52-week range" value={c.range} />
        <Attr label="Volume" value={fmtCompact(c.volume)} />
        <Attr label="Avg volume" value={fmtCompact(c.averageVolume)} />
        <Attr label="Last dividend" value={fmtRatio(c.lastDividend)} />
      </Grid>
      {c.description && <p className="text-sm text-muted-foreground">{c.description}</p>}
      {c.website && (
        <a href={c.website} target="_blank" rel="noreferrer" className="truncate text-xs text-primary hover:underline">{c.website}</a>
      )}
    </div>
  )
}

function ValuationTab({ c }: { c: CompanyInfo }): React.JSX.Element {
  const v = c.valuation
  if (v == null) return <NotAvailable />
  return (
    <Grid>
      <Attr label="P/E" value={fmtRatio(v.peRatio)} />
      <Attr label="P/B" value={fmtRatio(v.pbRatio)} />
      <Attr label="P/S" value={fmtRatio(v.psRatio)} />
      <Attr label="PEG" value={fmtRatio(v.pegRatio)} />
      <Attr label="EV/EBITDA" value={fmtRatio(v.evToEbitda)} />
      <Attr label="Dividend yield" value={fmtPct(v.dividendYield)} />
      <Attr label="Earnings yield" value={fmtPct(v.earningsYield)} />
      <Attr label="FCF yield" value={fmtPct(v.fcfYield)} />
    </Grid>
  )
}

function FinancialsTab({ c }: { c: CompanyInfo }): React.JSX.Element {
  const f = c.financials
  if (f == null) return <NotAvailable />
  return (
    <Grid>
      <Attr label="ROE" value={fmtPct(f.roe)} />
      <Attr label="ROA" value={fmtPct(f.roa)} />
      <Attr label="Net margin" value={fmtPct(f.netMargin)} />
      <Attr label="Operating margin" value={fmtPct(f.operatingMargin)} />
      <Attr label="Gross margin" value={fmtPct(f.grossMargin)} />
      <Attr label="Debt / equity" value={fmtRatio(f.debtToEquity)} />
      <Attr label="Current ratio" value={fmtRatio(f.currentRatio)} />
      <Attr label="Quick ratio" value={fmtRatio(f.quickRatio)} />
    </Grid>
  )
}

function AnalystTab({ c }: { c: CompanyInfo }): React.JSX.Element {
  const a = c.analyst
  if (a == null) return <NotAvailable />
  const price = c.price
  const targetColor = (t: number | null): string =>
    price == null || t == null ? '' : t >= price ? 'text-green-500' : 'text-red-500'
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">Consensus</span>
        <span className="text-sm">{a.consensus ?? '—'}</span>
      </div>
      <Grid>
        <Attr label="Strong buy" value={a.strongBuy != null ? <span className="text-green-500">{a.strongBuy}</span> : null} />
        <Attr label="Buy" value={a.buy != null ? <span className="text-green-500">{a.buy}</span> : null} />
        <Attr label="Hold" value={a.hold} />
        <Attr label="Sell" value={a.sell != null ? <span className="text-red-500">{a.sell}</span> : null} />
        <Attr label="Strong sell" value={a.strongSell != null ? <span className="text-red-500">{a.strongSell}</span> : null} />
      </Grid>
      <Grid>
        <Attr label="Target high" value={a.targetHigh != null ? <span className={targetColor(a.targetHigh)}>{fmtMoney(a.targetHigh)}</span> : null} />
        <Attr label="Target median" value={a.targetMedian != null ? <span className={targetColor(a.targetMedian)}>{fmtMoney(a.targetMedian)}</span> : null} />
        <Attr label="Target consensus" value={a.targetConsensus != null ? <span className={targetColor(a.targetConsensus)}>{fmtMoney(a.targetConsensus)}</span> : null} />
        <Attr label="Target low" value={a.targetLow != null ? <span className={targetColor(a.targetLow)}>{fmtMoney(a.targetLow)}</span> : null} />
        <Attr label="Current price" value={fmtMoney(price ?? null)} />
      </Grid>
    </div>
  )
}

function GrowthTab({ c }: { c: CompanyInfo }): React.JSX.Element {
  const g = c.growth
  if (g == null) return <NotAvailable />
  return (
    <Grid>
      <Attr label="Revenue growth" value={fmtPct(g.revenueGrowth)} />
      <Attr label="Net income growth" value={fmtPct(g.netIncomeGrowth)} />
      <Attr label="EPS growth" value={fmtPct(g.epsGrowth)} />
    </Grid>
  )
}

function ScheduleTab({ c }: { c: CompanyInfo }): React.JSX.Element {
  const s = c.schedule
  if (s == null) return <NotAvailable />
  return (
    <Grid>
      <Attr label="Next earnings date" value={s.nextEarningsDate} />
      <Attr label="Last EPS (actual)" value={fmtRatio(s.lastEpsActual)} />
      <Attr label="Last EPS (estimate)" value={fmtRatio(s.lastEpsEstimated)} />
    </Grid>
  )
}

function CompanyInfoBody({ symbol }: { symbol: string }): React.JSX.Element {
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('Overview')
  const q = useQuery<CompanyInfo>({ queryKey: qk.companyInfo(symbol), queryFn: () => api.company.info(symbol) })
  const reload = useMutation({
    mutationFn: () => api.company.info(symbol, { force: true }),
    onSuccess: (data) => qc.setQueryData(qk.companyInfo(symbol), data)
  })

  if (q.isLoading) return <div className="p-2 text-muted-foreground">Loading company info…</div>
  if (q.isError || !q.data) {
    const notCovered = /FMP HTTP (200|40[0-9])/.test(String((q.error as Error)?.message))
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
          <span className="text-sm text-muted-foreground">{c.symbol}{c.exchange ? ` · ${c.exchange}` : ''}</span>
        </div>
        <button
          type="button"
          onClick={() => reload.mutate()}
          disabled={reload.isPending}
          aria-label="Reload company info"
          title="Reload company info"
          className="ml-auto shrink-0 rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn('size-4', reload.isPending && 'animate-spin')} />
        </button>
      </div>

      <div className="flex gap-1 border-b border-border text-sm">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'border-b-2 px-2 py-1',
              tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && <OverviewTab c={c} />}
      {tab === 'Valuation' && <ValuationTab c={c} />}
      {tab === 'Financials' && <FinancialsTab c={c} />}
      {tab === 'Analyst' && <AnalystTab c={c} />}
      {tab === 'Growth' && <GrowthTab c={c} />}
      {tab === 'Schedule' && <ScheduleTab c={c} />}

      <div className="text-right text-xs text-muted-foreground">As of {asOf}</div>
    </div>
  )
}

export function CompanyWindow({ symbol }: { symbol: string }): React.JSX.Element {
  useEffect(() => { document.title = symbol }, [symbol])
  return (
    <div className="h-screen overflow-auto bg-background p-6 text-foreground">
      <h1 className="mb-4 text-sm font-semibold text-muted-foreground">Company info</h1>
      <CompanyInfoBody symbol={symbol} />
    </div>
  )
}
