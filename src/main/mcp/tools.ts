import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { DateRange, Timeframe } from '@shared/types'
import type { Core, OhlcvOutcome } from '../core'
import { FmpHttpError } from '../providers/FmpProvider'
import {
  clampLimit, formatCacheStatus, formatCompanyInfo, formatEpoch, formatQuote, formatSymbolResults,
  formatWorkspaceDetail, formatWorkspaceList, interpretationNote, isIntraday, parseIsoToEpoch,
  summaryLine, toCsv, unmetRangeNotes, DEFAULT_LIMIT, MAX_LIMIT
} from './format'

export type ToolCore = Pick<
  Core, 'ohlcv' | 'symbols' | 'quote' | 'company' | 'workspaces' | 'capabilities' | 'cacheStatus'
>

export type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }
export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>
export type ToolDef = { name: string; description: string; schema: z.ZodTypeAny; handler: ToolHandler }

const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] })
// Tool-level failures are reported as isError results, never thrown: a protocol error tells the
// model "the call broke", an isError result tells it *what to do differently*.
const fail = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true })

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '1d', '1w', '1M'] as const
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z)?$/

const symbolArg = z.string().min(1).describe('Ticker symbol, e.g. NVDA. Case-insensitive.')
const dateArg = z.string().regex(DATE_RE, 'Use YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ (UTC).')

const ohlcvArgs = z
  .object({
    symbol: symbolArg,
    timeframe: z.enum(TIMEFRAMES).describe("Bar size. '1w' and '1M' are derived from cached daily bars."),
    from: dateArg.optional().describe('Oldest bar to return (inclusive), UTC.'),
    to: dateArg.optional().describe('Newest bar to return (inclusive), UTC.'),
    limit: z.number().int().positive().optional()
      .describe(`Maximum bars to return, counted back from the newest. Default ${DEFAULT_LIMIT}, capped at ${MAX_LIMIT}.`),
    force: z.boolean().optional()
      .describe('Fetch the newest bars from FMP before answering. Costs one API request EVERY call — omit it unless you specifically need up-to-the-minute data.')
  })
  .refine((a) => !(a.from && a.to) || parseIsoToEpoch(a.from) <= parseIsoToEpoch(a.to), {
    message: 'from must not be after to.'
  })

const OHLCV_DESCRIPTION = [
  'Return cached OHLCV candles for a symbol as CSV.',
  'Bars already cached on disk cost no API request; a symbol/timeframe that is not cached yet triggers an FMP fetch,',
  'so call get_cache_status first if you want to know what is free.',
  "Weekly ('1w') and monthly ('1M') bars are derived from the cached daily series — the daily coverage IS their coverage.",
  'The first line of the response summarises how many bars were returned, the period they span, and how many API requests it cost.',
  'Read that line: when the returned period does not cover what you asked for, a note explains why.'
].join(' ')

function messageForError(err: unknown, timeframe?: Timeframe): string {
  if (err instanceof Error && err.message === 'NO_API_KEY') {
    return "FMP API key is not configured. Set it in Vibing View's settings dialog."
  }
  if (err instanceof FmpHttpError) {
    if (err.status === 429) return 'FMP daily request limit reached. Try again tomorrow.'
    if (err.status === 402 || err.status === 403) {
      return timeframe && isIntraday(timeframe)
        ? 'This timeframe is not available on the current FMP plan.'
        : "No data available — the symbol may be outside the current plan's coverage."
    }
  }
  return `Unexpected error: ${err instanceof Error ? err.message : String(err)}`
}

export function buildTools(core: ToolCore, now: () => number): ToolDef[] {
  // Shared symbol -> coverage-timeframe -> cached row lookup. W/M coverage IS the daily coverage.
  const coverageRow = (symbol: string, timeframe: Timeframe) => {
    const covTf = timeframe === '1w' || timeframe === '1M' ? '1d' : timeframe
    return { covTf, row: core.cacheStatus.summarize(symbol).find((r) => r.timeframe === covTf) }
  }

  // Coverage sentence reused by the empty-range paths — the model needs to know what IS there.
  const coverageSentence = (symbol: string, timeframe: Timeframe): string => {
    const { covTf, row } = coverageRow(symbol, timeframe)
    return row
      ? `Cached coverage is ${formatEpoch(row.oldestTime, covTf)} to ${formatEpoch(row.newestTime, covTf)}.`
      : `Nothing is cached for ${symbol} ${covTf}.`
  }

  const getOhlcv: ToolHandler = async (raw) => {
    const parsed = ohlcvArgs.safeParse(raw)
    if (!parsed.success) return fail(parsed.error.issues[0].message)
    const { symbol, timeframe, from, to, force } = parsed.data

    const notes: string[] = []
    const { limit, note: limitNote } = clampLimit(parsed.data.limit)
    if (limitNote) notes.push(limitNote)
    for (const [label, value] of [['from', from], ['to', to]] as const) {
      const n = value ? interpretationNote(label, value, timeframe) : null
      if (n) notes.push(n)
    }

    const fromSec = from ? parseIsoToEpoch(from) : undefined
    const toSec = to ? parseIsoToEpoch(to) : undefined
    // M-14: a lone `to` gets no synthetic `from` — epoch 0 on a minute series would ask FMP for
    // decades. Fetch the cached window and filter the output instead. A lone `from` gets a
    // synthetic `to` capped at the cached newest bar (falling back to `now` only when nothing is
    // cached yet): a right edge beyond coverage makes CacheService treat an otherwise fully-cached
    // range as a miss and refetch the entire history (every bar is always older than `now`).
    const range: DateRange = fromSec === undefined
      ? undefined
      : { from: fromSec, to: toSec ?? coverageRow(symbol, timeframe).row?.newestTime ?? Math.floor(now() / 1000) }

    let outcome: OhlcvOutcome
    try {
      outcome = force ? await core.ohlcv.refresh(symbol, timeframe) : await core.ohlcv.get(symbol, timeframe, range)
    } catch (err) {
      return fail(messageForError(err, timeframe))
    }

    if (outcome.kind === 'out-of-plan') return fail("No data available — the symbol may be outside the current plan's coverage.")
    if (outcome.kind === 'unknown-symbol') return fail('No results. Use search_symbols to find the correct ticker.')
    if (outcome.kind === 'empty-range') return fail(`No bars in that range. ${coverageSentence(symbol, timeframe)}`)

    // `force` (and the lone-`to` case) can return bars outside the requested window — narrow here.
    const full = outcome.bars.filter(
      (b) => (fromSec === undefined || b.time >= fromSec) && (toSec === undefined || b.time <= toSec)
    )
    if (full.length === 0) {
      const hint = fromSec === undefined && toSec !== undefined ? ' Pass `from` as well to fetch older history.' : ''
      return fail(`No bars in that range. ${coverageSentence(symbol, timeframe)}${hint}`)
    }

    notes.push(...unmetRangeNotes({ from, to }, full, timeframe))
    const shown = full.slice(-limit)
    return ok([
      summaryLine({ symbol, timeframe, shown, total: full.length, apiCalls: outcome.apiCalls }),
      ...notes,
      toCsv(shown, timeframe)
    ].join('\n'))
  }

  return [
    {
      name: 'search_symbols',
      description: 'Search FMP for tickers by symbol or company name. Costs one API request unless the same query was searched in the last 5 minutes.',
      schema: z.object({ query: z.string().min(1).describe('Ticker fragment or company name.') }),
      handler: async (raw) => {
        const parsed = z.object({ query: z.string().min(1) }).safeParse(raw)
        if (!parsed.success) return fail(parsed.error.issues[0].message)
        try {
          return ok(formatSymbolResults(await core.symbols.search(parsed.data.query)))
        } catch (err) {
          return fail(messageForError(err))
        }
      }
    },
    { name: 'get_ohlcv', description: OHLCV_DESCRIPTION, schema: ohlcvArgs, handler: getOhlcv },
    {
      name: 'get_quote',
      description: 'Current price, day range, and change for a symbol. Always costs one API request (quotes are never cached).',
      schema: z.object({ symbol: symbolArg }),
      handler: async (raw) => {
        const parsed = z.object({ symbol: symbolArg }).safeParse(raw)
        if (!parsed.success) return fail(parsed.error.issues[0].message)
        try {
          return ok(formatQuote(parsed.data.symbol, await core.quote.get(parsed.data.symbol)))
        } catch (err) {
          return fail(messageForError(err))
        }
      }
    },
    {
      name: 'get_company_info',
      description: 'Valuation, financials, analyst consensus, growth, and earnings schedule for a symbol. Cached for 24 hours; a cache miss costs up to 7 API requests. Groups that FMP did not return are shown as "not available".',
      schema: z.object({
        symbol: symbolArg,
        force: z.boolean().optional().describe('Ignore the 24-hour cache and refetch. Costs up to 7 API requests.')
      }),
      handler: async (raw) => {
        const parsed = z.object({ symbol: symbolArg, force: z.boolean().optional() }).safeParse(raw)
        if (!parsed.success) return fail(parsed.error.issues[0].message)
        const { symbol, force } = parsed.data
        try {
          const info = await core.company.info(symbol, force ? { force: true } : undefined)
          // CompanyInfoService returns the stale row when a forced refetch fails; fetchedAt then
          // stays old. Anything older than a minute after a forced call means the fetch failed.
          const stale = force === true && Math.floor(now() / 1000) - info.fetchedAt > 60
          return ok(formatCompanyInfo(info, stale))
        } catch (err) {
          return fail(messageForError(err))
        }
      }
    },
    {
      name: 'get_workspaces',
      description: 'List the saved workspaces (name, whether it is active, watchlist size, grid shape). No API request. Use get_workspace or get_active_workspace for the per-cell detail.',
      schema: z.object({}),
      handler: async () => ok(formatWorkspaceList(core.workspaces.get().collection))
    },
    {
      name: 'get_active_workspace',
      description: 'Full detail of the workspace the user currently has open: watchlist, grid shape, and every cell with its symbol, timeframe, and indicators. No API request.',
      schema: z.object({}),
      handler: async () => {
        const { collection } = core.workspaces.get()
        const active = collection.workspaces.find((w) => w.name === collection.active)
        if (!active) return fail(`No active workspace. Available: ${collection.workspaces.map((w) => w.name).join(', ')}`)
        return ok(formatWorkspaceDetail(active, true))
      }
    },
    {
      name: 'get_workspace',
      description: 'Full detail of one workspace by name. No API request.',
      schema: z.object({ name: z.string().min(1).describe('Exact workspace name, as listed by get_workspaces.') }),
      handler: async (raw) => {
        const parsed = z.object({ name: z.string().min(1) }).safeParse(raw)
        if (!parsed.success) return fail(parsed.error.issues[0].message)
        const { collection } = core.workspaces.get()
        const found = collection.workspaces.find((w) => w.name === parsed.data.name)
        if (!found) {
          return fail(`No workspace named "${parsed.data.name}". Available: ${collection.workspaces.map((w) => w.name).join(', ')}`)
        }
        return ok(formatWorkspaceDetail(found, found.name === collection.active))
      }
    },
    {
      name: 'get_cache_status',
      description: 'What OHLCV is already on disk: bar count and period per symbol and timeframe, plus each timeframe\'s availability on the current FMP plan. No API request. Call this before get_ohlcv to see which requests are free.',
      schema: z.object({ symbol: symbolArg.optional().describe('Restrict to one symbol. Omit for every cached symbol.') }),
      handler: async (raw) => {
        const parsed = z.object({ symbol: z.string().min(1).optional() }).safeParse(raw)
        if (!parsed.success) return fail(parsed.error.issues[0].message)
        const { symbol } = parsed.data
        return ok(formatCacheStatus(core.cacheStatus.summarize(symbol), core.capabilities.get(), symbol))
      }
    }
  ]
}

export function registerTools(server: McpServer, core: ToolCore, now: () => number = () => Date.now()): void {
  for (const def of buildTools(core, now)) {
    const shape = def.schema instanceof z.ZodObject ? def.schema.shape : (def.schema as z.ZodEffects<z.ZodObject<z.ZodRawShape>>).innerType().shape
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: shape },
      async (args: Record<string, unknown>) => def.handler(args ?? {})
    )
  }
}
