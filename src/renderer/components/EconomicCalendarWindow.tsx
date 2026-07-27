// src/renderer/components/EconomicCalendarWindow.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { addDays, addWeeks, format, isSameDay, startOfWeek } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { ChevronDown, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { api, qk } from '@/api'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { applyFilter, eventsInWeek, groupByLocalDay, nowMarker, weekUtcDays } from '@/lib/economicWeek'
import type { EconomicCountryPreset, EconomicEvent, EconomicImpact, EconomicRange } from '@shared/types'

const IMPACTS: EconomicImpact[] = ['High', 'Medium', 'Low']
const IMPACT_DOT: Record<EconomicImpact, string> = {
  High: 'bg-red-500', Medium: 'bg-amber-500', Low: 'bg-gray-500'
}
const COUNTRY_LABEL: Record<EconomicCountryPreset, string> = { us: 'US only', major: 'Major', all: 'All' }
const COUNTRY_PRESETS: EconomicCountryPreset[] = ['us', 'major', 'all']

const fmtValue = (n: number | null): string => (n == null ? '—' : String(n))

// 主時刻はローカル、右に小さく ET（EC-04: 変換は表示時だけ）。
// 過去/未来で行の見た目は変えない — 以前は過去行を opacity で落としていたが、透明度は文字の
// コントラストごと下げるので、過去の行でいちばん見たい act（実績値）まで読みにくくなっていた。
// 区別は NowMarker の線 1 本に任せる。
function EventRow({ e }: { e: EconomicEvent }): React.JSX.Element {
  const d = new Date(e.time * 1000)
  const hasValues = e.previous != null || e.estimate != null || e.actual != null
  return (
    <div className="flex flex-col gap-0.5 px-3 py-1.5">
      <div className="flex items-center gap-2 text-sm">
        <span className="w-11 shrink-0 tabular-nums">{format(d, 'HH:mm')}</span>
        <span className="w-16 shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatInTimeZone(d, 'America/New_York', 'HH:mm')} ET
        </span>
        <span className={cn('size-2 shrink-0 rounded-full', IMPACT_DOT[e.impact])} title={e.impact} />
        <span className="w-8 shrink-0 text-xs text-muted-foreground">{e.country}</span>
        <span className="truncate" title={e.event}>{e.event}</span>
      </div>
      {hasValues && (
        <div className="ml-[7.75rem] flex gap-4 text-xs tabular-nums text-muted-foreground">
          <span>prev {fmtValue(e.previous)}</span>
          <span>est {fmtValue(e.estimate)}</span>
          <span>act {fmtValue(e.actual)}</span>
        </div>
      )}
    </div>
  )
}

// 過去と未来の境界。行を装飾する代わりにこれ 1 本で示す。
function NowMarker({ now }: { now: Date }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 px-3 py-1" aria-label={`Current time ${format(now, 'HH:mm')}`}>
      <div className="h-px flex-1 bg-primary" />
      <span className="text-[11px] font-medium tabular-nums text-primary">now {format(now, 'HH:mm')}</span>
      <div className="h-px flex-1 bg-primary" />
    </div>
  )
}

// company.info と同じ分岐方針。IPC 越しの message から判定するので新しい型は増やさない（EC-15）。
function errorMessage(err: unknown): string {
  const m = String((err as Error)?.message ?? '')
  if (/NO_API_KEY/.test(m)) return 'Set your FMP API key in Settings.'
  if (/FMP HTTP 401/.test(m)) return 'Your FMP API key was rejected. Check it in Settings.'
  if (/FMP HTTP 429/.test(m)) return 'FMP request limit reached. Wait a moment and try again.'
  if (/FMP HTTP (200|40[0-9])/.test(m)) return 'The economic calendar isn’t available on your current FMP plan.'
  return 'Couldn’t load the economic calendar. Check your connection.'
}

export function EconomicCalendarWindow(): React.JSX.Element {
  useEffect(() => { document.title = 'Economic calendar' }, [])
  const qc = useQueryClient()
  // 週の位置は永続化しない。開いたら常に今週（EC-10）。起点は月曜。
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [countries, setCountries] = useState<EconomicCountryPreset>('us')
  const [impacts, setImpacts] = useState<EconomicImpact[]>(['High', 'Medium'])
  // テキストフィルタは永続化しない（EC-13）— 前回の検索語が残るとデータの都合か絞り込みか分からない。
  const [text, setText] = useState('')
  // now ライン用。表示は分単位なので 1 分ごとに進めれば足りる。レンダー時の new Date() だけだと
  // 窓を開いたままにしたときに線と時刻表示が固まる（今日の見出しも日付が変わって追従しなくなる）。
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    void api.settings.getEconomicFilter().then((f) => {
      setCountries(f.countries)
      setImpacts(f.impacts)
    })
  }, [])

  const days = useMemo(() => weekUtcDays(weekStart), [weekStart])
  const from = days[0]
  const to = days[days.length - 1]

  const q = useQuery<EconomicRange>({
    queryKey: qk.economicCalendar(from, to),
    queryFn: () => api.economic.getRange(from, to)
  })
  const reload = useMutation({
    mutationFn: () => api.economic.getRange(from, to, { force: true }),
    onSuccess: (data) => qc.setQueryData(qk.economicCalendar(from, to), data)
  })

  const saveCountries = (next: EconomicCountryPreset): void => {
    setCountries(next)
    void api.settings.setEconomicFilter({ countries: next, impacts })
  }
  const saveImpacts = (next: EconomicImpact[]): void => {
    setImpacts(next)
    void api.settings.setEconomicFilter({ countries, impacts: next })
  }

  const inWeek = useMemo(() => eventsInWeek(q.data?.events ?? [], weekStart), [q.data, weekStart])
  const groups = useMemo(
    () => groupByLocalDay(applyFilter(inWeek, { countries, impacts, text })),
    [inWeek, countries, impacts, text]
  )

  const nowSec = Math.floor(now.getTime() / 1000)
  const marker = useMemo(() => nowMarker(groups, nowSec, weekStart), [groups, nowSec, weekStart])
  const weekLabel = `${format(weekStart, 'MMM d')} – ${format(addDays(weekStart, 6), 'MMM d, yyyy')}`
  // fetchedAt は週の全日のうち最も古い取得時刻なので、過去の週では今日の日付ではないことが多い
  // （EC-06 の確定行）。同日なら時刻だけ、そうでなければ日付を添えて古さが伝わるようにする。
  const asOfDate = q.data ? new Date(q.data.fetchedAt * 1000) : null
  const asOf = asOfDate
    ? isSameDay(asOfDate, now) ? format(asOfDate, 'HH:mm') : format(asOfDate, 'yyyy-MM-dd HH:mm')
    : null

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setWeekStart((w) => addWeeks(w, -1))} aria-label="Previous week">
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-[11rem] text-center text-sm font-semibold tabular-nums">{weekLabel}</span>
          <Button variant="ghost" size="icon" onClick={() => setWeekStart((w) => addWeeks(w, 1))} aria-label="Next week">
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
            Today
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            {asOf ? `As of ${asOf}${q.data?.stale ? ' (update failed)' : ''}` : ''}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => reload.mutate()}
            disabled={reload.isPending}
            aria-label="Reload economic calendar"
            title="Reload economic calendar"
          >
            <RefreshCw className={cn('size-4', reload.isPending && 'animate-spin')} />
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="gap-1.5">
                {COUNTRY_LABEL[countries]}
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {COUNTRY_PRESETS.map((p) => (
                <DropdownMenuItem
                  key={p}
                  className={p === countries ? 'bg-accent text-accent-foreground' : ''}
                  onClick={() => saveCountries(p)}
                >
                  {COUNTRY_LABEL[p]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <ToggleGroup
            type="multiple"
            value={impacts}
            onValueChange={(v) => saveImpacts(v as EconomicImpact[])}
          >
            {IMPACTS.map((i) => (
              <ToggleGroupItem key={i} value={i} size="sm" aria-label={i}>
                <span className={cn('mr-1.5 size-2 rounded-full', IMPACT_DOT[i])} />{i}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Filter by country or event…"
            className="h-8 max-w-[16rem]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {q.isLoading && <div className="p-3 text-sm text-muted-foreground">Loading economic calendar…</div>}
        {q.isError && <div className="p-3 text-center text-sm text-muted-foreground">{errorMessage(q.error)}</div>}
        {/* EC-14: フィルタ前の件数を併記して、データが無いのかフィルタで消えたのかを区別できるようにする */}
        {!q.isLoading && !q.isError && groups.length === 0 && (
          <div className="p-3 text-center text-sm text-muted-foreground">
            No matching events. ({inWeek.length} {inWeek.length === 1 ? 'event' : 'events'} this week before filters)
          </div>
        )}
        {groups.map((g) => {
          const day = new Date(`${g.key}T00:00:00`) // key はローカル日なので Z を付けない
          return (
            <section key={g.key}>
              <h2
                className={cn(
                  'sticky top-0 border-b border-border bg-card px-3 py-1.5 text-xs font-semibold',
                  isSameDay(day, now) ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                {format(day, 'EEE MMM d')}
              </h2>
              {g.events.map((e, i) => (
                <React.Fragment key={`${e.time}-${e.country}-${e.event}-${i}`}>
                  {marker?.key === g.key && marker.index === i && <NowMarker now={now} />}
                  <EventRow e={e} />
                </React.Fragment>
              ))}
            </section>
          )
        })}
        {/* 週内のイベントが全部終わっている場合の末尾（線が消えると判断に迷うので出す） */}
        {marker?.key === null && <NowMarker now={now} />}
      </div>
    </div>
  )
}
