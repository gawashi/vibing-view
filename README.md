# Vibing View

A personal, unlimited charting desktop app — a vibe-coded TradingView alternative.

No limits, no ads, no login. Pulls US stock and crypto price data from [Financial Modeling Prep](https://financialmodelingprep.com/) (bring your own API key), caches it locally, and lets you stack as many charts and indicators as you like.

## Contributing

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
