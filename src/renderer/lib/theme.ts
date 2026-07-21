import type { Theme } from '@shared/ipc'

// Pure resolution — testable without a DOM.
export function resolveDark(theme: Theme, systemPrefersDark: boolean): boolean {
  return theme === 'dark' || (theme === 'system' && systemPrefersDark)
}

// Toggle the .dark class on <html> for the given theme. 'system' resolves via matchMedia.
// ponytail: startup-resolve only — no live OS-change listener (spec §YAGNI); add a change
// listener if that's needed later.
export function applyTheme(theme: Theme): void {
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.classList.toggle('dark', resolveDark(theme, systemPrefersDark))
}
