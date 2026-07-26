import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { TIMEFRAMES, type DateRange, type Timeframe } from '@shared/types'
import type { Core, OhlcvOutcome } from '../core'
import { FmpHttpError } from '../providers/FmpProvider'
import {
  formatCacheStatus, formatCompanyInfo, formatEpoch, formatQuote, formatSymbolResults,
  formatWorkspaceDetail, formatWorkspaceList, isIntraday, parseIsoToEpoch,
  summaryLine, toCsv, unmetRangeNotes, DEFAULT_LIMIT, MAX_LIMIT, ok, fail
} from './format'
import { buildMutationTools } from './mutations'
import { buildWorkspaceTools } from './workspaceTools'

export type ToolCore = Pick<
  Core, 'ohlcv' | 'symbols' | 'quote' | 'company' | 'workspaces' | 'capabilities' | 'cacheStatus' | 'uiRefresh'
>

export type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }
export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>
export type ToolDef = {
  name: string
  description: string
  schema: z.ZodObject<z.ZodRawShape>
  handler: ToolHandler
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z)?$/

// A bare date means midnight UTC, same as parseIsoToEpoch.
const normIso = (v: string): string => (v.length === 10 ? `${v}T00:00:00Z` : v)
// DATE_RE only checks the shape: Date.parse rolls 2026-02-30 over to March 2 (wrong range, no
// warning) and returns NaN for 2026-99-01, which would throw out of the handler as a protocol
// error instead of an isError result. Round-trip the parse to reject both.
const isRealDate = (v: string): boolean => {
  const ms = Date.parse(normIso(v))
  return !Number.isNaN(ms) && new Date(ms).toISOString().startsWith(v.slice(0, 10))
}

const symbolArg = z.string().min(1).describe('Ticker symbol, e.g. NVDA. Case-insensitive.')
const dateArg = z.string()
  .regex(DATE_RE, 'Use YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ (UTC).')
  .refine(isRealDate, 'Not a real calendar date.')

const BARE_DATE_HINT = 'A bare YYYY-MM-DD means 00:00:00Z, so pass a full timestamp on intraday timeframes.'

const searchArgs = z.object({ query: z.string().min(1).describe('Ticker fragment or company name.') })
const symbolOnlyArgs = z.object({ symbol: symbolArg })
const companyArgs = z.object({
  symbol: symbolArg,
  force: z.boolean().optional().describe('Ignore the 24-hour cache and refetch. Costs up to 7 API requests.')
})
const workspaceArgs = z.object({
  name: z.string().min(1).optional()
    .describe('Exact workspace name, as listed by get_workspaces. Omit for the one the user has open.')
})
const cacheStatusArgs = z.object({
  symbol: symbolArg.optional().describe('Restrict to one symbol. Omit for every cached symbol.')
})
const ohlcvArgs = z.object({
  symbol: symbolArg,
  timeframe: z.enum(TIMEFRAMES).describe("Bar size. '1w' and '1M' are derived from cached daily bars."),
  from: dateArg.optional().describe(`Oldest bar to return (inclusive), UTC. ${BARE_DATE_HINT}`),
  to: dateArg.optional().describe(`Newest bar to return (inclusive), UTC. ${BARE_DATE_HINT}`),
  limit: z.number().int().positive().optional()
    .describe(`Maximum bars to return, counted back from the newest. Default ${DEFAULT_LIMIT}, capped at ${MAX_LIMIT}.`),
  force: z.boolean().optional()
    .describe('Fetch the newest bars from FMP before answering. Costs one API request EVERY call — omit it unless you specifically need up-to-the-minute data.')
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
    const limit = Math.min(parsed.data.limit ?? DEFAULT_LIMIT, MAX_LIMIT)

    const fromSec = from ? parseIsoToEpoch(from) : undefined
    const toSec = to ? parseIsoToEpoch(to) : undefined
    // Checked here rather than as a schema refinement: zod runs object-level refinements even when
    // a field already failed, and parseIsoToEpoch would then throw a protocol error out of the
    // handler instead of returning an isError result the model can act on.
    if (fromSec !== undefined && toSec !== undefined && fromSec > toSec) return fail('from must not be after to.')
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
      schema: searchArgs,
      handler: async (raw) => {
        const parsed = searchArgs.safeParse(raw)
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
      schema: symbolOnlyArgs,
      handler: async (raw) => {
        const parsed = symbolOnlyArgs.safeParse(raw)
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
      schema: companyArgs,
      handler: async (raw) => {
        const parsed = companyArgs.safeParse(raw)
        if (!parsed.success) return fail(parsed.error.issues[0].message)
        const { symbol, force } = parsed.data
        try {
          // CompanyInfoService flags the row it fell back to; formatCompanyInfo prints the warning.
          return ok(formatCompanyInfo(await core.company.info(symbol, force ? { force: true } : undefined)))
        } catch (err) {
          return fail(messageForError(err))
        }
      }
    },
    {
      name: 'get_workspaces',
      description: 'List the saved workspaces (name, whether it is active, watchlist size, grid shape). No API request. Use get_workspace for the per-cell detail.',
      schema: z.object({}),
      handler: async () => ok(formatWorkspaceList(core.workspaces.get().collection))
    },
    {
      name: 'get_workspace',
      description: 'Full detail of one workspace — watchlist, grid shape, and every cell with its symbol, timeframe, and indicators. Defaults to the workspace the user currently has open. No API request.',
      schema: workspaceArgs,
      handler: async (raw) => {
        const parsed = workspaceArgs.safeParse(raw)
        if (!parsed.success) return fail(parsed.error.issues[0].message)
        const { collection } = core.workspaces.get()
        const name = parsed.data.name ?? collection.active
        const found = collection.workspaces.find((w) => w.name === name)
        if (!found) {
          return fail(`No workspace named "${name}". Available: ${collection.workspaces.map((w) => w.name).join(', ')}`)
        }
        return ok(formatWorkspaceDetail(found, found.name === collection.active))
      }
    },
    {
      name: 'get_cache_status',
      description: 'What OHLCV is already on disk: bar count and period per symbol and timeframe, plus each timeframe\'s availability on the current FMP plan. No API request. Call this before get_ohlcv to see which requests are free.',
      schema: cacheStatusArgs,
      handler: async (raw) => {
        const parsed = cacheStatusArgs.safeParse(raw)
        if (!parsed.success) return fail(parsed.error.issues[0].message)
        const { symbol } = parsed.data
        return ok(formatCacheStatus(core.cacheStatus.summarize(symbol), core.capabilities.get(), symbol))
      }
    },
    ...buildMutationTools(core),
    ...buildWorkspaceTools(core)
  ]
}

export function registerTools(server: McpServer, core: ToolCore, now: () => number = () => Date.now()): void {
  for (const def of buildTools(core, now)) {
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: def.schema.shape },
      async (args: Record<string, unknown>) => def.handler(args ?? {})
    )
  }
}
