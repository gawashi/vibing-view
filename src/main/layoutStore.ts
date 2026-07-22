import { app } from 'electron'
import { join } from 'path'
import { readJsonFile, writeJsonFile } from './jsonStore'
import type { Layout } from '@shared/types'

// ponytail: same one-small-JSON-under-userData pattern as settings.ts, separate file per LAYOUT-03.
const layoutsPath = (): string => join(app.getPath('userData'), 'layouts.json')

type LayoutsFile = { current: unknown; named: Record<string, unknown> }

const read = (): LayoutsFile => readJsonFile(layoutsPath(), { current: null, named: {} })

// Raw/opaque — main does not validate the Layout shape. The renderer's parseLayout owns
// that trust boundary; main stays a dumb persister.
export function getCurrent(): unknown {
  return read().current
}

export function setCurrent(ws: Layout): void {
  writeJsonFile(layoutsPath(), { ...read(), current: ws })
}

export function listLayouts(): string[] {
  return Object.keys(read().named)
}

export function getLayout(name: string): unknown {
  return read().named[name] ?? null
}

// Read-modify-atomic-write of the whole file — every mutation below follows this shape so a crash
// mid-write never leaves layouts.json partially written (T-05-L1).
export function saveLayout(name: string, ws: Layout): void {
  const file = read()
  writeJsonFile(layoutsPath(), { ...file, named: { ...file.named, [name]: ws } })
}

export function deleteLayout(name: string): void {
  const file = read()
  const named = { ...file.named }
  delete named[name]
  writeJsonFile(layoutsPath(), { ...file, named })
}

export function renameLayout(from: string, to: string): void {
  const file = read()
  const named = { ...file.named }
  named[to] = named[from]
  delete named[from]
  writeJsonFile(layoutsPath(), { ...file, named })
}
