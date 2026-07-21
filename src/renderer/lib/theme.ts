import type { Theme } from '@shared/ipc'

// Pure resolution — testable without a DOM.
export function resolveDark(theme: Theme, systemPrefersDark: boolean): boolean {
  return theme === 'dark' || (theme === 'system' && systemPrefersDark)
}

// Toggle the .dark class on <html> for the given theme. 'system' resolves via matchMedia.
// ponytail: startup-resolve only — no live OS-change listener (spec §YAGNI); add a change
// listener if that's needed later.
export function applyTheme(theme: Theme): void {
  // Mirror the choice to localStorage so index.html's pre-paint inline script can resolve the
  // theme synchronously on the next launch (avoids a dark→light flash before this async apply runs).
  try {
    localStorage.setItem('vv-theme', theme)
  } catch {
    // localStorage unavailable — the flash is cosmetic, never block theme apply on the mirror.
  }
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.classList.toggle('dark', resolveDark(theme, systemPrefersDark))
}
