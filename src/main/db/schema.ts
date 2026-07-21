import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core'

export const bars = sqliteTable(
  'bars',
  {
    symbol: text('symbol').notNull(),
    timeframe: text('timeframe').notNull(),
    time: integer('time').notNull(), // UTC epoch seconds
    open: real('open').notNull(),
    high: real('high').notNull(),
    low: real('low').notNull(),
    close: real('close').notNull(),
    volume: real('volume').notNull()
  },
  (t) => ({ pk: primaryKey({ columns: [t.symbol, t.timeframe, t.time] }) })
)

export const coverage = sqliteTable(
  'coverage',
  {
    symbol: text('symbol').notNull(),
    timeframe: text('timeframe').notNull(),
    oldestTime: integer('oldest_time').notNull(),
    newestTime: integer('newest_time').notNull()
  },
  (t) => ({ pk: primaryKey({ columns: [t.symbol, t.timeframe] }) })
)

export const symbolProfiles = sqliteTable('symbol_profiles', {
  symbol: text('symbol').primaryKey(),
  name: text('name').notNull(),
  exchange: text('exchange').notNull()
})
