# My Crypto

A private-by-design crypto portfolio tracker: effective cost, current value and P/L, running entirely on your device. A minimal, mobile-first PWA with live prices, **multi-currency display (14 currencies)**, real coin logos, a trend-colored portfolio chart with range filters and buy/sell annotations, an allocation donut, per-asset historical charts and price alerts — backed by a strict-FIFO cost engine in JavaScript.

**Live site:** https://54y7jys5zr-coder.github.io/My-Crypto/

## Features

- **Overview** — live portfolio value (All Holdings / Invested Only) with a **currency toggle** (14 currencies; EUR/PLN default pair), a stat strip with Net invested, value-weighted **24h change**, Realized and the **top 24h mover**, and a net-worth banner. The inline value chart offers **1Y / 1M / 1W / All range filters** — the line and gradient are colored by trend, **buy/sell events from your ledger are annotated** on the timeline, and **scrubbing** shows any day's value and P/L. Stats below include current value, range high/low and best/worst day.
- **Portfolio** — a searchable, sortable flat list (by value, profit/loss, return % or name) with **real coin logos** (colored initial as fallback) and a per-asset **24h % change** on each row. Tapping an asset opens a detail sheet with a **range-selectable historical chart (1W / 1M / 1Y / All)**, **7d and 30d change**, price-flash on live moves, full cost breakdown and **price alerts** (bell badge on the row when a target is set, "hit" state when crossed).
- **Tables** — full cost-basis table with sortable columns (All Holdings / Invested Only), currency conversion, EUR-flows summary, **CSV export** and share-snapshot.
- **Settings** — CSV import (Balances / Ledger / Trades) feeding a **strict-FIFO engine** that recomputes everything locally; text-size, auto-refresh and currency controls, plus an **optional CoinGecko demo API key** (stored on-device only) for higher rate limits.
- **Auto-refresh** every 60s + manual refresh; live CoinGecko prices, FX from ECB data via frankfurter.dev.
- **Offline-capable PWA** — installable to the home screen, works without a connection, keeps your imported data.

## Run locally

```bash
python3 -m http.server 8000
```

Open http://localhost:8000 — the service worker needs localhost (or HTTPS).

## Deploy on GitHub Pages

1. Push this folder to the root of a GitHub repo's `main` branch.
2. Repo **Settings → Pages** → Source: `main` branch, folder `/ (root)`.
3. Open https://\<user\>.github.io/\<repo\>/ — HTTPS is required for PWAs.

### Install on iPhone (Safari)

- Open the URL in **Safari** → **Share** → **Add to Home Screen**.
- Launch from the home-screen icon: runs full-screen, works offline, keeps your imported data.
- Note (iOS): installed PWAs get limited storage and unused data can be evicted after ~7 days. Keep your CSV exports as the source of truth.

## Files

- `index.html`, `styles.css`, `app.js` — UI (bottom nav, overview, portfolio, tables, settings)
- `engine.js` — strict-FIFO cost engine (JS)
- `chart.umd.min.js` — self-hosted charting library (no CDN)
- `data.json` — starter dataset (empty in the repo; import your own CSVs in Settings)
- `manifest.webmanifest`, `sw.js`, `icons/` — PWA install + offline shell

## Data / method notes

- Balances are ground truth; strict-FIFO builds the cost basis; staking rewards, gifts and airdrops are zero-cost and dilute the average.
- Prices: CoinGecko (EUR). FX: frankfurter.dev (ECB rates) with a CoinGecko fallback. Values are converted into your chosen display currency (default EUR/PLN pair).
- The value chart is an approximation — current holdings applied across historical daily prices; buy/sell markers are derived from your ledger timeline.
- The optional CoinGecko **demo API key** is a free, public key offered by CoinGecko for evaluation. It is stored in your browser, sent only to `api.coingecko.com` (as an `x-cg-demo-api-key` header) and never leaves the device in any other way.

**Analysis/accounting tool — not tax or investment advice.**

## Security posture

Static, client-side app with **no backend, no accounts, and no PII**. All computation runs on your device; the only outbound calls are read-only price/FX lookups (plus logo images, and your optional demo key if you add one).

Hardening applied before deployment:

- **Content-Security-Policy** (meta tag): `default-src 'self'`; scripts only from self (no inline scripts, no eval); images only from self / data / `coin-images.coingecko.com` / `assets.coingecko.com`; network limited to `api.coingecko.com` and `api.frankfurter.dev`.
- **Output escaping**: all untrusted strings (CSV asset symbols, API fields) are HTML-escaped before rendering, preventing DOM-XSS from a crafted CSV.
- **No CDN**: the chart library is self-hosted (no third-party script trust; fully offline).
- **URL encoding**: asset IDs are `encodeURIComponent`-ed into API URLs.
- **Service worker** caches only the app shell, never API responses.

What leaves your device: the CoinGecko coin IDs you hold (in the price query string), a currency-pair request for FX, logo image fetches from `coin-images.coingecko.com`, and — only if you added one — your demo API key in a header to `api.coingecko.com`. Quantities, cost basis and P/L never leave the browser.

Residual considerations:

- Holdings, last prices and your optional API key are stored in the browser's `localStorage`/cache — anyone with access to the unlocked device could open the app. Don't keep secrets in it, and use only a **demo** (public) CoinGecko key, not a paid one.
- GitHub Pages can't set HTTP security headers; the CSP ships via the meta tag. On a host that supports headers, also send CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and HSTS.
- Third-party APIs (CoinGecko, frankfurter.dev) are trusted for price data only; their responses are treated as untrusted input (escaped, numeric-parsed).

## License

MIT — see [LICENSE](LICENSE).