import { z } from 'zod'
import type { WatchlistItem } from '@shared/types'
import type { ToolCore, ToolDef, ToolHandler } from './tools'
import {
  activateWorkspace, createWorkspace, deleteWorkspace, editWatchlist, renameWorkspace
} from './edits'
import { formatWatchlist } from './formatEdits'
import { ok, fail, plural } from './format'
import { UNRESOLVED, workspaceArg } from './mutations'

const watchlistArgs = z.object({
  workspace: workspaceArg,
  add: z.array(z.string().min(1)).optional().describe('Tickers to add. Unknown tickers reject the whole call.'),
  remove: z.array(z.string().min(1)).optional().describe('Tickers to remove. Unknown tickers are ignored.')
})

const createArgs = z.object({
  name: z.string().min(1).describe('Name for the new workspace. Must not already exist.'),
  copyFrom: z.string().min(1).optional().describe('Copy this workspace instead of starting empty.'),
  activate: z.boolean().optional().describe('Switch to it after creating. Defaults to true.')
})

const renameArgs = z.object({
  from: z.string().min(1).describe('Current workspace name.'),
  to: z.string().min(1).describe('New name. Must not already exist.')
})

const nameArgs = z.object({ name: z.string().min(1).describe('Exact workspace name.') })

export function buildWorkspaceTools(core: ToolCore): ToolDef[] {
  const watchlistHandler: ToolHandler = async (raw) => {
    const parsed = watchlistArgs.safeParse(raw)
    if (!parsed.success) return fail(parsed.error.issues[0].message)
    const { workspace } = parsed.data
    const addSymbols = parsed.data.add ?? []
    const remove = parsed.data.remove ?? []
    if (addSymbols.length === 0 && remove.length === 0) return fail('Pass add, remove, or both.')

    // Resolve everything BEFORE mutating: one unresolved ticker rejects the whole call (MW-13),
    // and mutate is synchronous so no await may happen inside it (MW-04).
    const add: WatchlistItem[] = []
    for (const symbol of addSymbols) {
      const profile = await core.symbols.profile(symbol)
      if (profile.exchange === '') return fail(UNRESOLVED(symbol))
      add.push({ ...profile, symbol: profile.symbol.toUpperCase() })
    }

    const result = core.workspaces.mutate((c) => editWatchlist(c, { workspace, add, remove }))
    if (!result.ok) return fail(result.message)
    const { workspaceName, items, addedCount, removedCount } = result.value
    return ok([
      `Added ${addedCount}, removed ${removedCount}.`,
      formatWatchlist(workspaceName, items)
    ].join('\n'))
  }

  const createHandler: ToolHandler = async (raw) => {
    const parsed = createArgs.safeParse(raw)
    if (!parsed.success) return fail(parsed.error.issues[0].message)
    const { name, copyFrom } = parsed.data
    const activate = parsed.data.activate ?? true
    const result = core.workspaces.mutate((c) => createWorkspace(c, { name, copyFrom, activate }))
    if (!result.ok) return fail(result.message)
    const source = copyFrom ? ` (copied from "${copyFrom}")` : ''
    const active = activate ? ' It is now the active workspace.' : ''
    return ok(`Created workspace "${name}"${source}.${active}`)
  }

  const renameHandler: ToolHandler = async (raw) => {
    const parsed = renameArgs.safeParse(raw)
    if (!parsed.success) return fail(parsed.error.issues[0].message)
    const result = core.workspaces.mutate((c) => renameWorkspace(c, parsed.data))
    if (!result.ok) return fail(result.message)
    return ok(`Renamed workspace "${parsed.data.from}" to "${parsed.data.to}".`)
  }

  const deleteHandler: ToolHandler = async (raw) => {
    const parsed = nameArgs.safeParse(raw)
    if (!parsed.success) return fail(parsed.error.issues[0].message)
    const result = core.workspaces.mutate((c) => deleteWorkspace(c, parsed.data))
    if (!result.ok) return fail(result.message)
    const { name, cellCount, symbols, watchlistCount, activeNow } = result.value
    const charts = symbols.length > 0 ? ` holding ${symbols.join(', ')}` : ''
    return ok([
      `Deleted workspace "${name}": ${plural(cellCount, 'cell')}${charts}, ${plural(watchlistCount, 'watchlist symbol')}.`,
      `Active workspace is now "${activeNow}". This cannot be undone.`
    ].join('\n'))
  }

  const activateHandler: ToolHandler = async (raw) => {
    const parsed = nameArgs.safeParse(raw)
    if (!parsed.success) return fail(parsed.error.issues[0].message)
    const result = core.workspaces.mutate((c) => activateWorkspace(c, parsed.data))
    if (!result.ok) return fail(result.message)
    return ok(`Active workspace is now "${parsed.data.name}".`)
  }

  const forceReloadHandler: ToolHandler = async () => {
    const result = await core.uiRefresh.run()
    if (!result.ok) {
      return fail(result.reason === 'no-window'
        ? 'The app window is not available.'
        : 'Refresh timed out — it may still be running in the app.')
    }
    if (result.busy) return fail('A refresh is already in progress in the app.')
    const failed = result.failed > 0 ? `, ${result.failed} failed` : ''
    return ok(`Refreshed ${plural(result.refreshed, 'chart')}${failed}.`)
  }

  return [
    {
      name: 'edit_watchlist',
      description: "Add or remove symbols on a workspace's watchlist. Adding costs one API request per ticker that has never been resolved before; if any ticker cannot be resolved, nothing changes.",
      schema: watchlistArgs,
      handler: watchlistHandler
    },
    {
      name: 'create_workspace',
      description: 'Create a workspace, optionally copying an existing one (charts, indicators and watchlist come along with fresh ids). Activates it unless activate:false. No API request.',
      schema: createArgs,
      handler: createHandler
    },
    {
      name: 'rename_workspace',
      description: 'Rename a workspace. No API request.',
      schema: renameArgs,
      handler: renameHandler
    },
    {
      name: 'delete_workspace',
      description: 'Delete a workspace and everything in it. The app has no undo — the response lists what was removed so you can tell the user. The last remaining workspace cannot be deleted. No API request.',
      schema: nameArgs,
      handler: deleteHandler
    },
    {
      name: 'activate_workspace',
      description: 'Switch the app to a different workspace. No API request.',
      schema: nameArgs,
      handler: activateHandler
    },
    {
      name: 'force_reload',
      description: "Refetch every chart the user currently has on screen, exactly like the app's reload button: market status, the visible cells' bars, and quotes. Costs one API request per visible chart plus quotes, so use it only when the user asks for fresh data.",
      schema: z.object({}),
      handler: forceReloadHandler
    }
  ]
}
