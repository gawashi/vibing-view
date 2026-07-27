import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { join } from 'path'

let _db: BetterSQLite3Database | null = null

export function getDb(): BetterSQLite3Database {
  if (_db) return _db
  // ponytail: lazy require — better-sqlite3 is a native binary bound to Electron's ABI
  // and `electron` only exists at app runtime; both must stay out of the static import
  // graph so Vitest (plain Node) can load this module's pure logic without them.
  const Database = require('better-sqlite3')
  const { app } = require('electron')
  const { drizzle } = require('drizzle-orm/better-sqlite3')
  const sqlite = new Database(join(app.getPath('userData'), 'cache.db'))
  sqlite.pragma('journal_mode = WAL')
  // ponytail: raw CREATE TABLE IF NOT EXISTS instead of drizzle-kit migrations — 2 fixed tables, no schema churn in P1
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS bars (
      symbol TEXT NOT NULL, timeframe TEXT NOT NULL, time INTEGER NOT NULL,
      open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL, volume REAL NOT NULL,
      PRIMARY KEY (symbol, timeframe, time)
    );
    CREATE TABLE IF NOT EXISTS coverage (
      symbol TEXT NOT NULL, timeframe TEXT NOT NULL,
      oldest_time INTEGER NOT NULL, newest_time INTEGER NOT NULL,
      PRIMARY KEY (symbol, timeframe)
    );
    CREATE TABLE IF NOT EXISTS symbol_profiles (
      symbol TEXT PRIMARY KEY, name TEXT NOT NULL, exchange TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS company_profiles (
      symbol TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS economic_days (
      date TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at INTEGER NOT NULL
    );
  `)
  _db = drizzle(sqlite) as BetterSQLite3Database
  return _db
}
