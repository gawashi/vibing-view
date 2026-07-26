// 経済カレンダーウィンドウは main の renderer バンドルを使い回し、対象は #economic=1 で判別する。
// main.tsx が parseEconomicWindow で分岐し、main プロセスの index.ts が buildEconomicHash で URL を
// 組む。companyWindow.ts の双子。週は renderer state なので hash には乗せない（EC-09/EC-10）。
export function buildEconomicHash(): string {
  return 'economic=1'
}

export function parseEconomicWindow(hash: string): boolean {
  const q = hash.startsWith('#') ? hash.slice(1) : hash
  return new URLSearchParams(q).get('economic') !== null
}
