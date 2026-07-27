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

// 会社情報キャッシュ。data は CompanyProfileData(fetchedAt 除く) の JSON blob 一本 —
// フィールド追加時のマイグレーションを不要にする。fetched_at は TTL 判定用の列。
export const companyProfiles = sqliteTable('company_profiles', {
  symbol: text('symbol').primaryKey(),
  data: text('data').notNull(),
  fetchedAt: integer('fetched_at').notNull()
})

// 経済カレンダーの日単位キャッシュ（EC-05）。date は UTC 日の 'YYYY-MM-DD'、data はその日の
// EconomicEvent[] の JSON blob（company_profiles と同じ blob 方針でマイグレーション不要）。
// 発表が無い日も '[]' の行を書く（EC-08）— 書かないと土日祝が毎回ミス判定になり API を空撃ちする。
export const economicDays = sqliteTable('economic_days', {
  date: text('date').primaryKey(),
  data: text('data').notNull(),
  fetchedAt: integer('fetched_at').notNull()
})
