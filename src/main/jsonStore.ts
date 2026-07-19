import { readFileSync, existsSync } from 'fs'

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
