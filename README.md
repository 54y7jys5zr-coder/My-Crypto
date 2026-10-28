# My Crypto

A private-by-design crypto portfolio tracker for **Kraken** users. Import your Kraken CSV exports and see your real cost basis, value, profit/loss, staking yield and taxes — computed entirely on your device by a strict-FIFO cost engine. No account, no backend, nothing uploaded.

It's a mobile-first **installable PWA** (iPhone, Android, desktop) with live prices, 14 display currencies, a portfolio chart built from the coins you actually held each day, per-coin detail sheets, alerts, a watchlist, an optional Polish tax (PIT-38) helper, light/dark themes and offline support.

**Live site:** https://54y7jys5zr-coder.github.io/My-Crypto/

> An analysis and accounting tool — **not tax or investment advice.** The app only reads public market data; it can't place orders or move funds.

---

## Contents

- [Getting started](#getting-started)
- [Features](#features)
  - [Overview](#overview) · [Portfolio](#portfolio) · [Coin sheet](#coin-sheet) · [News](#news) · [Settings](#settings) · [Across the app](#across-the-app)
- [How the numbers are calculated](#how-the-numbers-are-calculated)
- [Data sources](#data-sources)
- [Privacy & security](#privacy--security)
- [What's stored on your device](#whats-stored-on-your-device)
- [Run, test and deploy](#run-test-and-deploy)
- [Files](#files)
- [Known limitations](#known-limitations)
- [License](#license)

---

## Getting started

1. On Kraken, export **Balances**, **Ledger** and **Trades** as CSV (Kraken › Documents › Export).
2. Open the app → **Settings › Kraken Data** → pick or drop all three files at once (each is recognised by its columns) → check the preview → **Import**.
3. Coins you hold outside Kraken that never went through it (for example a gift received straight into your own wallet) go under **Settings › Holdings Outside Kraken**.

Just looking? Tap **Try with Sample Data** on the empty screen — an invented portfolio, kept in memory only.

The CSVs are kept on the device (IndexedDB), so the portfolio recomputes whenever you add a holding or the app gains a new feature — you only re-import to bring in newer Kraken activity. A reminder appears when your import is more than two weeks old.

## Features

### Overview

- **Value and profit/loss** for the current view, with 24h / 7d / 30d change chips and one line with lifetime P/L, cash on Kraken and price freshness ("Live" while prices stream).
- **Two valuation views**, switchable everywhere: **All Holdings** (everything you own) and **Invested Only** (only coins you paid for — excludes gifts and staking rewards).
- **Value chart** — **1W / 1M / 1Y / All**. Each day uses the coins you actually held that day, drawn against a stepped **cost-basis line**, with buy/sell markers. *All* goes back to your first transaction (weekly points).
  - **Scrub** with a finger, the mouse or the arrow keys to see any day's value, cost basis, P/L and that day's market move.
  - **Compare With BTC / ETH** adds a dashed line: what the same euros would be worth if every purchase had bought BTC (or ETH) on the same day instead.
  - Stats under the chart: now, P/L change, high, low, best and worst day (market moves only — your own buys and sales don't count), and "vs BTC/ETH" when comparing.
- **Key stats** (net invested, 24h change, realized profit, top mover), a **market overview** (Fear & Greed index, BTC dominance, total crypto market cap), your **top 3 holdings** and a **tappable allocation bar**.

### Portfolio

Three layouts — **List**, **Table** and **Activity**:

- **List / Table** — searchable, sortable holdings (list sort and table headers stay in sync) with logos, price, 24h change, 7-day sparkline, value and return. **CSV export** and **Share** (a text summary).
- **Watchlist** (under the list) — follow coins you don't own: price, 24h/7d/30d change, chart and price alerts. Add by ticker or name (**Add Coin**), or from *Trending Today* on News.
- **Activity** — every transaction in one list: buys, sales, swaps, staking rewards, deposits, moves to your private wallet and entries you added. Filter by coin, type and year; search coins and notes; add your own **note** to any transaction (e.g. "DCA", "gift from Dad"); export the filtered list as CSV.

The **summary** below the list has collapsible sections:

| Section | What it shows |
|---|---|
| **Headline** | Value and return in both views, cost basis, value of free coins, staking rewards (value now), cash on Kraken, account value |
| **EUR Flows** | Deposited, withdrawn, net deposited, realized profit, trading fees |
| **Realized by Year** | FIFO profit per sale grouped by calendar year, with a per-sale CSV (EUR) |
| **Polish Tax (PIT-38)** | Optional, see [Settings](#settings) |
| **Performance** | Money-weighted annual return (XIRR — accounts for *when* you deposited), net gain (value + cash − net deposited), and "same buys in BTC / ETH" with how you compare |
| **Monthly Returns** | A heatmap of each month's gain from price moves and sales (deposits and purchases don't count); tap a month for the amount; *Load Earlier Months* for your full history |
| **Staking Rewards** | Per coin: rewards received, their value now, and the yield you actually earned over the last 12 months |
| **Rebalance** | Set a target mix (e.g. BTC 60 / ETH 30 / SOL 10); see each coin's drift, what to buy or sell to get back on target, and how to use your EUR cash without selling |

**Print Report** (bottom of the summary) opens a clean black-on-white report — summary, holdings, realized by year, PIT-38 and staking — to print or save as PDF for your records or an accountant.

### Coin sheet

Tap any coin (list, table, top holdings, allocation, watchlist or trending). Swipe sideways or use ‹ › / ← → to move between coins.

- **Hero**: value, P/L and return, price (and its source when it isn't CoinGecko), 24h / 7d / 30d change.
- **Price chart** (1W / 1M / 1Y / All) with your **break-even price** as a dashed line.
- **Avg buy price**, cost basis, break-even (with how far the price is from it) and realized profit.
- **Holdings** — invested vs free coins (staking rewards, gifts), **On Kraken** vs **In Private Wallet**, entries you added, the on-chain check for watched addresses, and — for BTC — what sending from your wallet costs right now.
- **Staking** — rewards received, last 12 months, last reward date, monthly reward bars and the yield you earned.
- **Sell Preview** — enter an amount (or 25% / 50% / All): proceeds at the current price, the FIFO cost of the coins that would be sold, and the realized profit. With the Polish tax helper on, also how much this year's PIT-38 tax would change. Uses the coins on Kraken only, before fees.
- **Transactions** — this coin's history, newest first, with your notes.
- **Price Alert** — rises to / falls to a price, or moves ±% in 24h.

Watched and trending coins open a lighter sheet: price, changes, chart, price alert, and Add to / Remove from Watchlist.

### News

- **Trending Today** — CoinGecko's trending coins with their 24h change; tap one to see it or add it to your watchlist.
- The latest headlines from **Cointelegraph, CoinDesk, Decrypt, The Block and Crypto Vision**, merged and deduplicated, cached for 15 minutes. Tap a story to read the original article.
- Optional **on-device headline sentiment** (Settings › Data & Extras): a small financial-news model (83 MB, downloaded once) tags each headline positive / negative / neutral **in your browser** — no text goes to an AI service. Adds a mood summary and a Positive / Negative filter.

### Settings

| Section | Contents |
|---|---|
| **Kraken Data** | One-step CSV import with preview, re-import, **Clear Imported Data** (with Undo) |
| **Holdings Outside Kraken** | Coins in a private wallet that never went through Kraken (gift, or bought elsewhere with its cost). **Watch-Only Addresses**: paste or scan a public BTC, ETH, LTC or DOGE address of your own wallet; its on-chain balance is compared with what the app has recorded as "In Private Wallet", and a difference can be recorded in one tap (you choose gift or bought, and the date). Seed phrases, private keys and xpubs are refused |
| **Alerts** | Every price alert in one list, plus an alert on your **portfolio total** |
| **Backup & Restore** | Export / restore a JSON backup, Undo, and **Erase Everything on This Device** |
| **CoinGecko API Key** | Optional free *demo* key for higher rate limits |
| **Data & Extras** | Live prices from CoinGecko or **Kraken** (Kraken streams live while the app is open), market overview, headline sentiment, **Polish Tax Helper (PIT-38)** |
| **Display** | Two currencies for the top toggle (14 available), text size, theme (Auto / Light / Dark), auto-refresh |
| **About** | Build number, method and data sources, reconciliation notes |

Each closed section shows a one-line status; the open/closed state is remembered.

**Polish tax helper** — follows the PIT-38 rules for virtual currencies: crypto purchases count as costs in the year paid, unused costs carry forward, crypto-to-crypto swaps aren't taxed, and EUR amounts convert at the NBP rate of the last business day before each transaction. Per year: revenue, costs, carried costs, income and a 19% estimate, plus a CSV worksheet. An estimate — staking rewards and free coins aren't included; check with a tax advisor.

### Across the app

- **Privacy mode** — the eye icon hides every amount (percentages stay); also applies to Share and the printed report.
- **Alerts** notify while the app is open (with permission; on iPhone the app must be installed, iOS 16.4+) and show as a badge on the installed app's icon.
- **Prices with fallbacks** — if CoinGecko is down or rate-limiting, Kraken and DefiLlama fill in (holdings and watchlist). A banner shows when Kraken reports an incident.
- **Updates** — after a new deploy, an open app offers "A new version is ready · Reload"; Settings › About shows the build.
- **Offline** — installed or not, the app opens without a connection and shows the last known prices.
- **Accessible** — full keyboard support (modal sheet with focus trap and Escape, chart scrubbing with arrow keys), screen-reader labels and live regions, visible focus rings, ≥ 4.5:1 text contrast in both themes, Dynamic Type-style text sizes and reduced-motion support.

## How the numbers are calculated

- **Balances are the ground truth.** The ledger is replayed in time order; each coin's cost basis is built **strict FIFO** (oldest coins leave first).
- **Free coins** — staking rewards, gifts and airdrops — have zero cost, so they lower the average cost. *Invested Only* excludes them.
- **Swaps** (crypto → crypto) move the cost of the coin you gave up to the coin you received; nothing is realized. Legs are paired by Kraken's ledger `refid` = trade `txid`.
- **Sales into EUR** realize proceeds − FIFO cost. They're booked from the Trades file, or from the ledger's EUR amount when the Trades row is missing.
- **Withdrawals stay yours** — coins sent off Kraken move to "In Private Wallet" with their cost (the network fee is spent). Coins deposited back return with their cost; any other deposit counts as free coins. The app can't see what happens to coins after they leave Kraken — watch-only addresses close that gap.
- **Holdings Outside Kraken** are kept separate from Kraken deposits. If you later move them to Kraken, delete the entry so they aren't counted twice.
- If the replayed ledger doesn't match Balances, the difference is reconciled (surplus = zero-cost coins, shortfall removed FIFO) and noted in Settings › About.
- **Avg buy price** = cost basis ÷ coins you paid for. **Break-even** = cost basis ÷ all coins you hold.
- **Money-weighted return (XIRR)**: EUR deposits and withdrawals (plus purchases you entered) against today's crypto value + cash. Less than a year of history is shown as a return so far, not annualized.
- **Same buys in BTC / ETH**: each euro you spent on crypto buys the benchmark coin on the same day; each sale sells it. Gifts and rewards aren't added to the benchmark, so they count in your favour.
- **Monthly return**: change in unrealized P/L plus profit realized that month, as a share of what was invested at the start of the month (plus that month's purchases).
- **Staking yield**: rewards in the last 12 months ÷ your time-weighted average holding of that coin (including coins not staked), annualized.
- **Sell Preview / PIT-38 change**: FIFO over the coins left on Kraken at the live price; the sale's proceeds are added to this year's PIT-38 revenue at the latest NBP rate.
- Timestamps are UTC; realized profit per year uses UTC calendar years in EUR. Legacy Kraken codes (`XXBT`, `XXBTZEUR`, `ZEUR`…) and staking variants (`DOT.S`, `ETH2`…) are understood. Fiat balances count as cash, not assets.

## Data sources

All are public and free; none needs an account. The app never sends quantities, values or cost basis anywhere.

| Source | Used for | What it receives |
|---|---|---|
| CoinGecko (`api.coingecko.com`) | Prices, logos, 24h/7d/30d change, 365-day history, coin search, trending coins | The CoinGecko IDs of coins you hold or watch; your optional demo key (header) |
| Kraken (`api.kraken.com`, `wss://ws.kraken.com`, `status.kraken.com`) | EUR prices (REST + live stream), asset names, status banner | Trading pairs of coins you hold or watch |
| DefiLlama (`coins.llama.fi`) | Fallback prices, full history (All range), BTC/ETH benchmark history | Coin IDs |
| Frankfurter (`api.frankfurter.dev`, ECB) | Exchange rates, historical EUR/USD | Currency codes, dates |
| NBP (`api.nbp.pl`) | EUR/PLN rates — only with the Polish tax helper on | Date ranges |
| alternative.me, Coinpaprika | Fear & Greed index, global market cap and BTC dominance | Nothing specific to you |
| rss2json, Crypto Vision (`cryptocurrency.cv`) | News headlines | Public feed URLs |
| mempool.space / Blockstream, Blockscout, BlockCypher | Balances of addresses you choose to watch; Bitcoin fee estimates | **The addresses you watch** |
| jsDelivr, Hugging Face | Sentiment library and model — only if you turn sentiment on | Nothing specific to you; headlines are processed on your device |

## Privacy & security

- **Static, client-side app** — no backend, no accounts, no analytics, no personal data. All computation runs in your browser.
- **Content-Security-Policy** (meta tag): `default-src 'self'`; scripts and styles only from the app itself (no inline scripts or styles, no `eval` — dynamic sizes and colours go through the CSSOM); network access limited to the sources above. Images may load from any HTTPS host because coin logos and news thumbnails come from CDNs (sent without a referrer).
- **Untrusted input is escaped**: CSV contents and every API field are HTML-escaped before display; IDs are URL-encoded; numbers are parsed, never evaluated. Exported CSV cells that could be read as spreadsheet formulas are neutralised.
- **Self-hosted chart library**; the only third-party code is the optional sentiment library, version-pinned and run inside a Web Worker.
- The **service worker** caches only the app's own files, never API responses, and on update removes only this app's previous builds.
- **Watch-only addresses** are public addresses; the explorer that looks one up could link it to your IP address — skip the feature if that matters to you. The app never asks for or stores keys or seed phrases.

Things to keep in mind:

- Your portfolio, alerts, notes and optional API key live in this browser's storage — anyone with access to the unlocked device can open the app. Use only a free **demo** CoinGecko key.
- **Backup files** contain your full portfolio in plain JSON (not the API key) — store them like any financial record.
- GitHub Pages can't send HTTP security headers. On a host that can, also send `Content-Security-Policy` with `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and HSTS.

## What's stored on your device

| Where | What |
|---|---|
| localStorage | Imported portfolio, holdings outside Kraken, watched addresses, watchlist, transaction notes, rebalance targets, alerts, preferences, caches (prices, logos, FX, history, news, NBP rates) |
| IndexedDB | The CSV files you imported (so the portfolio can be recomputed) and the previous copy for Undo |
| Cache Storage | The app's own files (offline) and, if enabled, the sentiment model |

**Backup** saves the portfolio, holdings outside Kraken, watched addresses, watchlist, notes, targets, alerts, preferences and the imported CSVs — not the API key. **Erase Everything on This Device** removes all of it, including the sentiment model.

## Run, test and deploy

### Run locally

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Open http://localhost:8000 — the service worker needs localhost or HTTPS.

### Tests

```bash
npm test                                   # engine unit tests (Node 18+, no dependencies)
npm ci && npx playwright-core install chromium
npm run test:e2e                           # browser suites (or PW_CHANNEL=chrome to use installed Chrome)
npm run test:e2e 07                        # one suite by prefix
```

- **Engine tests** (`tests/engine.test.js`) pin the cost engine: FIFO totals, timelines, UTC parsing, swaps, withdrawals and re-deposits, EUR-leg sales, legacy codes, fiat cash, and the v2 outputs (EUR flows, reward events, remaining lots). Tests that need the local-only `sample_csv/` fixtures skip when it's absent.
- **Browser suites** (`tests/e2e/`) serve the app on 127.0.0.1, **mock every external API** (no real network, a fake WebSocket for live prices) and use small invented Kraken CSVs (`tests/e2e/fixtures/`):

| Suite | Covers |
|---|---|
| `01-smoke` | Empty state, import, every tab, coin sheet, chart, no CSP violations or console errors |
| `02-settings` | Section headers, holdings outside Kraken, backup contents, erase |
| `03-watch` | Watch-only addresses: validation, URIs, balances, reconciliation, one-tap record, explorer errors |
| `04-live` | Kraken live prices: subscribe, stream, pause when hidden, stop on source change |
| `05-a11y` | axe-core on every tab, Activity, the rebalance editor and the coin sheet, dark and light |
| `06-pwa` | Manifest, service worker, build number, cache cleanup on update |
| `07-insights` | Performance + benchmark, monthly returns, staking yield, break-even line, sell preview (incl. PIT-38), rebalancing, watchlist, activity + notes, trending, print report |

**CI** (`.github/workflows/test.yml`) runs three jobs on every push and pull request: syntax check + engine tests, the browser suites, and **Lighthouse CI** (`.lighthouserc.json`: accessibility ≥ 95 and best practices ≥ 90 are required).

### Deploy on GitHub Pages

1. Push to the `main` branch of a GitHub repository.
2. Repository **Settings → Pages** → Source: `main`, folder `/ (root)`.
3. Open `https://<user>.github.io/<repo>/` (HTTPS is required for installing).

After a deploy, bump `CACHE` in `sw.js` (`portfolio-vNN`) whenever app files change, so installed apps pick up the new build.

### Install

- **iPhone / iPad (Safari):** Share → **Add to Home Screen**. Runs full-screen with a dark launch screen and works offline. iOS may clear an installed web app's data after weeks of non-use — the app asks the browser to keep its storage, but keep your Kraken CSVs (or a backup) as the source of truth.
- **Android / desktop (Chrome, Edge):** the install icon in the address bar or the browser menu. Shortcuts: **Portfolio** and **Import CSVs**.

## Files

| Path | Role |
|---|---|
| `index.html` | Single-page shell: four tabs (Overview, Portfolio, News, Settings), coin sheet, banners, CSP |
| `app.js` | UI, state, prices/FX, charts, insights, alerts, watchlist, activity, import/backup/undo, PIT-38 helper, live prices, watch-only addresses |
| `engine.js` | Strict-FIFO cost engine — pure, no DOM or network; also used by the tests |
| `styles.css` | Design tokens (dark/light), layout, components, print layout |
| `theme.js` | Applies a forced light/dark theme before first paint |
| `sentiment-worker.js` | Optional on-device headline sentiment (Web Worker) |
| `chart.umd.min.js` | Self-hosted Chart.js |
| `data.json` | Empty starter dataset (your data is imported in the app, never committed) |
| `manifest.webmanifest`, `sw.js` | Install metadata and the offline service worker |
| `icons/`, `icons/splash/`, `screenshots/` | App icons, iOS launch screens, install-dialog screenshots (from the sample data) |
| `tests/` | Engine unit tests and the browser suites with their mocks and invented fixtures |
| `package.json`, `package-lock.json` | Test scripts and dev dependencies (`playwright-core`, `axe-core`) — the app itself has no build step and no runtime dependencies |
| `.github/workflows/test.yml`, `.lighthouserc.json` | CI |

## Known limitations

- Kraken's private API can't be called from a browser (no CORS), so data comes from CSV exports.
- Alerts can't fire while the app is closed (that would need a push server).
- CoinGecko's free tier rate-limits quickly; prices then come from Kraken/DefiLlama, and adding watchlist coins or loading Trending may need a minute. A free demo key helps.
- Watch-only addresses cover native BTC, ETH, LTC and DOGE balances — not tokens, and not xpubs (add each address that holds coins).
- The QR scanner needs a browser with barcode detection (Chrome on Android/macOS); elsewhere, paste the address.
- The staking yield is measured on your whole holding of a coin, staked or not.

## License

MIT — see [LICENSE](LICENSE).
