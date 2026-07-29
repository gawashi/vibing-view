// FMP の /stable/economic-indicators が受け付ける系列は固定で、API は単位も国も返さない（EI-01
// 実測で確認済み）。renderer（プルダウンとラベル）とカレンダー連携（キーワード表）が同じ表を
// 見るので shared に置く。全系列 US（FRED 由来）。
export type EconomicIndicatorCategory =
  'Growth' | 'Inflation' | 'Labor' | 'Rates' | 'Consumer' | 'Housing'

export type EconomicIndicatorMeta = {
  name: string
  label: string
  category: EconomicIndicatorCategory
  unit: string
}

export const DEFAULT_ECONOMIC_INDICATOR = 'CPI'

// unit は必須。API が単位を返さないので、これが無いと CPI の 322.1 と unemploymentRate の 4.2 が
// 同じ「数」に見える。同時にこれが水準値と変化率のミスマッチへの答えになる（カレンダーの
// 'CPI MoM' は前月比 % だが、CPI 系列は指数の水準値）。桁数は持たない — toLocaleString の
// 一律ルールで GDP(30000台) も unemploymentRate(4.2) も recession probability(0.03) も読める。
export const ECONOMIC_INDICATORS: EconomicIndicatorMeta[] = [
  { name: 'GDP', label: 'Gross Domestic Product', category: 'Growth', unit: 'Bil. $ (SAAR)' },
  { name: 'realGDP', label: 'Real GDP', category: 'Growth', unit: 'Bil. chained 2017 $' },
  { name: 'nominalPotentialGDP', label: 'Nominal Potential GDP', category: 'Growth', unit: 'Bil. $' },
  { name: 'realGDPPerCapita', label: 'Real GDP per Capita', category: 'Growth', unit: 'Chained 2017 $' },
  { name: 'industrialProductionTotalIndex', label: 'Industrial Production', category: 'Growth', unit: 'Index 2017=100' },
  { name: 'durableGoods', label: 'Durable Goods Orders', category: 'Growth', unit: 'Mil. $' },
  { name: 'totalVehicleSales', label: 'Total Vehicle Sales', category: 'Growth', unit: 'Mil. units (SAAR)' },
  { name: 'CPI', label: 'Consumer Price Index', category: 'Inflation', unit: 'Index 1982-84=100' },
  { name: 'inflationRate', label: 'Inflation Rate', category: 'Inflation', unit: '% YoY' },
  { name: 'inflation', label: 'Inflation', category: 'Inflation', unit: '%' },
  { name: 'unemploymentRate', label: 'Unemployment Rate', category: 'Labor', unit: '%' },
  { name: 'totalNonfarmPayroll', label: 'Nonfarm Payroll', category: 'Labor', unit: 'Thousands of persons' },
  { name: 'initialClaims', label: 'Initial Jobless Claims', category: 'Labor', unit: 'Claims' },
  { name: 'federalFunds', label: 'Federal Funds Rate', category: 'Rates', unit: '%' },
  { name: '3MonthOr90DayRatesAndYieldsCertificatesOfDeposit', label: '3-Month CD Rate', category: 'Rates', unit: '%' },
  { name: 'commercialBankInterestRateOnCreditCardPlansAllAccounts', label: 'Credit Card Interest Rate', category: 'Rates', unit: '%' },
  { name: '30YearFixedRateMortgageAverage', label: '30-Year Mortgage Rate', category: 'Rates', unit: '%' },
  { name: '15YearFixedRateMortgageAverage', label: '15-Year Mortgage Rate', category: 'Rates', unit: '%' },
  { name: 'consumerSentiment', label: 'Consumer Sentiment', category: 'Consumer', unit: 'Index 1966Q1=100' },
  { name: 'retailSales', label: 'Retail Sales', category: 'Consumer', unit: 'Mil. $' },
  { name: 'retailMoneyFunds', label: 'Retail Money Funds', category: 'Consumer', unit: 'Bil. $' },
  { name: 'smoothedUSRecessionProbabilities', label: 'Recession Probability', category: 'Consumer', unit: '%' },
  { name: 'newPrivatelyOwnedHousingUnitsStartedTotalUnits', label: 'Housing Starts', category: 'Housing', unit: 'Thousands of units (SAAR)' }
]

// プルダウンの見出し順。Set は挿入順を保つので、上の表の並びがそのまま表示順になり、
// 別立てのリストと同期を取る必要がない（空グループも構造上ありえない）。
export const ECONOMIC_INDICATOR_CATEGORIES: EconomicIndicatorCategory[] =
  [...new Set(ECONOMIC_INDICATORS.map((m) => m.category))]

export function indicatorMeta(name: string): EconomicIndicatorMeta | undefined {
  return ECONOMIC_INDICATORS.find((m) => m.name === name)
}

// カレンダーの event 文字列 → 系列名（EI-05）。上から順に最初に当たったものを返す。
// 除外ルール（name: null）を先に置くことが重要: FMP が持たない関連系列がイベント文字列で
// 当たると、下のルールにフォールスルーして別の指標を見せてしまう。
// - 'core': コア系列（食品・エネルギーを除く）。FMP はコア系列を持たないので、
//   'Core CPI' や 'Core Inflation Rate' をヘッドライン系列に飛ばすと別の指標を見せる。
// - 'continuing.*claims': Continuing Jobless Claims は別のシリーズ（~1.8M vs ~220K）。
//   FMP が持たないので、リンクを張るとヘッドライン初回請求数と混在する。
// - 'gdp price index|gdp deflator': GDP の価格指数。FMP が持たないので、レベル GDP と混在する。
// 完全一致テーブルにしないのは、実測できる event 文字列を網羅できず、FMP 側の表記が変わると
// 黙ってリンクが消えるため。部分一致なら 'CPI MoM' / 'CPI YoY' / 'CPI s.a' がまとめて当たる。
export const RULES: { match: RegExp; name: string | null }[] = [
  { match: /core/, name: null },
  { match: /continuing.*claims/, name: null },
  { match: /jobless claims|initial claims/, name: 'initialClaims' },
  { match: /nonfarm payroll/, name: 'totalNonfarmPayroll' },
  { match: /unemployment rate/, name: 'unemploymentRate' },
  { match: /cpi/, name: 'CPI' },
  { match: /inflation rate/, name: 'inflationRate' },
  { match: /interest rate decision|fed interest rate/, name: 'federalFunds' },
  { match: /gdp price index|gdp deflator/, name: null },
  { match: /gdp/, name: 'GDP' },
  { match: /retail sales/, name: 'retailSales' },
  { match: /consumer sentiment|michigan/, name: 'consumerSentiment' },
  { match: /durable goods/, name: 'durableGoods' },
  { match: /industrial production/, name: 'industrialProductionTotalIndex' },
  { match: /housing starts/, name: 'newPrivatelyOwnedHousingUnitsStartedTotalUnits' },
  { match: /total vehicle sales|car sales/, name: 'totalVehicleSales' }
]

// /economic-indicators は US 系列しか持たないので、US 以外の行にリンクは張れない。
export function resolveIndicator(event: string, country: string): string | null {
  if (country !== 'US') return null
  const e = event.toLowerCase()
  return RULES.find((r) => r.match.test(e))?.name ?? null
}
