# Vibing View

A personal, unlimited charting desktop app — a vibe-coded TradingView alternative.

No limits, no ads, no login. Pulls US stock and crypto price data from [Financial Modeling Prep](https://financialmodelingprep.com/) (bring your own API key), caches it locally, and lets you stack as many charts and indicators as you like.

## Contributing

### Development setup

Windows only. `better-sqlite3` publishes no prebuilt binary for Electron's ABI.

- **Node.js 22+**
- **Python 3.10+** — node-gyp drives the build with it
- **Visual Studio 2022 Build Tools**, "Desktop development with C++" workload

```bash
winget install Python.Python.3.13
winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

```bash
npm install   # postinstall rebuilds better-sqlite3 against Electron's Node ABI
npm run dev   # launches Electron with HMR
```

If `npm run dev` fails with `Error: Electron uninstall`, the Electron binary
itself never downloaded (`node_modules/electron/dist` is missing). Fetch it with
`node node_modules/electron/install.js`.

Other commands:

```bash
npm run typecheck   # tsc over both the main and renderer configs
npm test            # vitest, single run
npm run test:watch  # vitest, watch mode
npm run build       # production bundle into out/ (no installer)
npm start           # preview the built bundle
```

### Building a release binary

```bash
npm run dist
```

Produces a Windows installer at `release/vibing-view-setup-<version>.exe`. Hand
that file to users; each installs it and enters their own FMP key on first run
(nothing secret is baked into the binary).

**Notes**:

- Bump `version` in `package.json` before building a new release; the version
  appears in the installer filename.

## License

[MIT](./LICENSE) — Bundled third-party components keep their own licenses (see `NOTICE`).
