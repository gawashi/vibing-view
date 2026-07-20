import { readFileSync, existsSync, writeFileSync, renameSync } from 'fs'

// ponytail: shared "read userData JSON, {} on missing/corrupt" — the one pattern settings.ts and
// capabilityCache.ts both hand-rolled. Next write heals a corrupt file.
export function readJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

// Atomic write: write to a sibling temp path, then rename over the target. rename is atomic on
// the same volume, so an interrupted write never truncates/corrupts the existing file.
export function writeJsonFile(path: string, data: unknown): void {
  const tmpPath = `${path}.tmp`
  writeFileSync(tmpPath, JSON.stringify(data))
  renameSync(tmpPath, path)
}
