// Renderer modules (e.g. src/renderer/api.ts) read `window.api` at import time.
// No jsdom dependency here — a bare stub is enough for tests that only import
// pure functions and never call `api.*`.
;(globalThis as any).window ??= globalThis
