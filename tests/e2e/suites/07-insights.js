/* Insights: performance + benchmark, monthly returns, staking yield, break-even line, sell preview,
   rebalancing, watchlist, activity with notes, trending coins, printable report. */
const fs = require("fs"), os = require("os"), path = require("path");
const { reporter, until, openApp, mock } = require("../helpers.js");
const FIX = path.join(__dirname, "..", "fixtures");
/* fixture ledger + monthly SOL staking rewards over the last year (dates relative to today) */
function fixtures(){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-e2e-")), pad = n => String(n).padStart(2, "0");
  let led = fs.readFileSync(path.join(FIX, "Ledger.csv"), "utf8").trimEnd(), extra = 0;
  for(let i = 11; i >= 0; i--){ const d = new Date(Date.now() - (i * 30 + 3) * 864e5);
    led += `\nLR${pad(i)},RR${pad(i)},${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} 08:00:00,staking,,currency,SOL,0.02,0,`; extra += 0.02; }
  const bal = fs.readFileSync(path.join(FIX, "Balances.csv"), "utf8").replace("SOL,spot,3.05", `SOL,spot,${(3.05 + extra).toFixed(2)}`);
  fs.writeFileSync(path.join(dir, "Ledger.csv"), led + "\n"); fs.writeFileSync(path.join(dir, "Balances.csv"), bal);
  fs.copyFileSync(path.join(FIX, "Trades.csv"), path.join(dir, "Trades.csv"));
  return dir;
}
module.exports = async (browser, url) => {
  const r = reporter(), ok = r.ok; const { ctx, p, errors } = await openApp(browser, url);
  await p.evaluate(() => { localStorage.setItem("summary_open", JSON.stringify(["headline","perf","monthly","staking","rebal"])); localStorage.setItem("detail_open", JSON.stringify(["hold","stake","sell"])); });
  const dir = fixtures();
  await p.click('#nav button[data-nav="settings"]');
  await p.setInputFiles("#fileCsv", ["Balances", "Ledger", "Trades"].map(f => path.join(dir, f + ".csv")));
  await p.waitForTimeout(200); await p.click("#recomputeBtn");
  ok(await until(p, () => /^Imported 3 assets/.test(document.querySelector("#importMsg").textContent)), "fixtures with recent staking rewards import");
  ok(await p.evaluate(() => { const d = JSON.parse(localStorage.getItem("user_data")); return d.engineV === 2 && d.flows.length === 1 && d.events.filter(e => e.type === "reward").length === 13 && d.assets.every(a => Array.isArray(a.ex_lots)); }), "engine v2: EUR flows, reward events, FIFO lots");
  // performance + benchmark
  await p.click('#nav button[data-nav="portfolio"]');
  ok(await until(p, () => { const t = document.querySelector('[data-sum="perf"]'); return t && /Money-Weighted/.test(t.textContent) && /Same Buys in BTC\s*€/.test(t.textContent) && /Same Buys in ETH\s*€/.test(t.textContent); }, 15000), "Performance: money-weighted return and BTC/ETH benchmarks", (await p.textContent("#summary")).slice(0, 300));
  ok(/Net Gain[^€]*€/.test(await p.textContent('[data-sum="perf"]')), "Performance: net gain");
  // monthly returns (needs the chart history)
  await p.click('#nav button[data-nav="overview"]');
  ok(await until(p, () => { const c = window.Chart && Chart.getChart(document.querySelector("#valueChart")); return c && c.data.datasets[0].data.length > 30; }, 15000), "overview chart drawn");
  await p.click('#benchSeg button[data-bench="bitcoin"]');
  ok(await until(p, () => { const c = Chart.getChart(document.querySelector("#valueChart")); return c.data.datasets.length === 5 && c.data.datasets[4].label === "BTC" && !document.querySelector("#benchKey").hidden; }, 10000), "chart: BTC comparison line + legend");
  ok(/vs BTC/.test(await p.textContent("#chartStats")), "chart stats: vs BTC");
  await p.click('#benchSeg button[data-bench=""]');
  ok(await until(p, () => Chart.getChart(document.querySelector("#valueChart")).data.datasets.length === 4 && document.querySelector("#benchKey").hidden), "comparison off again");
  await p.click('#nav button[data-nav="portfolio"]');
  ok(await until(p, () => document.querySelectorAll('#summary .mr-cell:not(.empty)').length >= 10), "Monthly Returns: heatmap cells", await p.evaluate(() => document.querySelectorAll('#summary .mr-cell:not(.empty)').length));
  await p.click('#summary .mr-cell:not(.empty) >> nth=0');
  ok(/€/.test(await p.textContent("#mrDetail")), "tapping a month shows its amount", await p.textContent("#mrDetail"));
  // staking
  const stake = await p.textContent('[data-sum="staking"]');
  ok(/SOL[\s\S]*~\d+(\.\d)?% a year/.test(stake), "Staking Rewards: SOL yield", stake.replace(/\s+/g, " ").slice(0, 160));
  const apy = parseFloat(stake.match(/~(\d+(?:\.\d)?)%/)[1]);
  ok(apy > 5 && apy < 10, "SOL yield is plausible (0.24 SOL on ~3.2 SOL a year ≈ 7–8%)", apy);
  // coin sheet: staking, break-even, sell preview
  await p.click('#portfolioList .hrow[data-asset="SOL"]'); await until(p, () => !document.querySelector("#detailSheet").hidden);
  ok(await until(p, () => /Rewards Received/.test(document.querySelector('#detailBody [data-ds="stake"]').textContent) && document.querySelectorAll("#detailBody .rw-bars rect").length === 12), "SOL sheet: staking section with 12 monthly bars");
  await p.click("#detailNext").catch(() => {});
  await p.keyboard.press("Escape");
  await p.click('#portfolioList .hrow[data-asset="BTC"]'); await until(p, () => document.querySelector("#detailTitle").textContent === "BTC");
  ok(await until(p, () => { const k = document.querySelector("#beKey"), c = Chart.getChart(document.querySelector("#sparkCanvas")); return k && !k.hidden && /Break-Even €60,120[.,]24/.test(k.textContent) && c && c.data.datasets.length === 2; }, 10000), "BTC chart: break-even line (cost ÷ all units incl. the fee-reduced withdrawal)", await p.evaluate(() => document.querySelector("#beKey") && document.querySelector("#beKey").textContent));
  await p.click('#sellPct button[data-sp="50"]');
  const sell = await p.textContent("#sellOut"), expP = 0.01495 * mock.PX.bitcoin;
  ok(/Proceeds\s*€1,09\d/.test(sell) && /FIFO Cost\s*€897\.00/.test(sell), "Sell preview 50%: proceeds and FIFO cost", sell.replace(/\s+/g, " "));
  await p.fill("#sellUnits", "1");
  ok(/Only 0[.,]0299 BTC is on Kraken/.test(await p.textContent("#sellOut")), "sell preview caps at the Kraken amount");
  await p.keyboard.press("Escape");
  // tax preview with the PIT-38 helper on
  await p.click('#nav button[data-nav="settings"]'); await p.check("#taxPlToggle");
  await p.click('#nav button[data-nav="portfolio"]'); await p.click('#portfolioList .hrow[data-asset="BTC"]');
  await p.click('#sellPct button[data-sp="100"]');
  ok(await until(p, () => /PIT-38 \d{4} Tax/.test(document.querySelector("#sellOut").textContent), 15000), "sell preview: PIT-38 tax effect", await p.textContent("#sellOut"));
  await p.keyboard.press("Escape");
  // rebalancing
  await p.click("#tgEdit"); ok(await p.locator("#summary [data-tg]").count() === 3, "Rebalance: one target per coin");
  await p.click("#tgEqual"); ok(/^100%$/.test(await p.textContent("#tgSum")), "equal split adds up to 100%");
  await p.locator('#summary [data-tg]').first().fill("50");
  await p.click("#tgSave"); ok(/add up to/.test(await p.textContent("#tgMsg")), "targets that don't add to 100% are refused");
  await p.click("#tgEqual"); await p.click("#tgSave");
  ok(await until(p, () => document.querySelectorAll("#summary .rb-row").length === 3 && /With your €798[.,]50 cash, buy/.test(document.querySelector('[data-sum="rebal"]').textContent)), "targets saved: drift + buy-with-cash suggestion", (await p.textContent('[data-sum="rebal"]')).replace(/\s+/g, " ").slice(0, 300));
  ok(/Largest drift/.test(await p.textContent('[data-sum="rebal"] .sec-meta')), "section status shows the largest drift");
  // watchlist
  await p.click("#wlAddBtn"); await p.fill("#wlInput", "ada"); await p.click('#wlForm button[type="submit"]');
  ok(await until(p, () => document.querySelector('#wlList [data-watch="ADA"]') && /€0[.,]60/.test(document.querySelector('#wlList [data-watch="ADA"]').textContent), 10000), "Watchlist: ADA added and priced", await p.textContent("#wlMsg"));
  await p.click('#wlList [data-watch="ADA"]');
  ok(await until(p, () => document.querySelector("#detailTitle").textContent === "ADA" && document.querySelector("#alertSet") && document.querySelector("#wlRemove") && document.querySelector("#detailPrev").hidden), "watched coin opens with price alert + remove");
  await p.click("#dsAlertSum").catch(() => {}); await p.fill("#alertInput", "1"); await p.click("#alertSet");
  ok(await until(p, () => JSON.parse(localStorage.getItem("alerts")).ADA), "alert set on a watched coin");
  await p.keyboard.press("Escape");
  ok(await p.locator('#wlList [data-watch="ADA"] .alert-badge').count() === 1, "watchlist row shows the alert bell");
  // activity
  await p.click('#portMode button[data-mode="activity"]');
  ok(await until(p, () => /^\d+ transactions$/.test(document.querySelector("#actCount").textContent)), "Activity: all transactions listed", await p.textContent("#actCount"));
  await p.selectOption("#actType", "reward");
  ok(await until(p, () => /^13 transactions of \d+/.test(document.querySelector("#actCount").textContent)), "filter: staking rewards only", await p.textContent("#actCount"));
  await p.selectOption("#actType", ""); await p.selectOption("#actCoin", "BTC");
  await p.click("#actList .act-row:last-child [data-note-edit]"); await p.fill("#actList .act-note-in", "First buy, DCA");
  await p.keyboard.press("Enter");
  ok(await until(p, () => /First buy, DCA/.test(document.querySelector("#actList").textContent) && /First buy/.test(localStorage.getItem("tx_notes"))), "note saved on a transaction");
  await p.fill("#actSearch", "dca");
  ok(await until(p, () => /^1 transaction of/.test(document.querySelector("#actCount").textContent)), "search finds the note");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#actExport")]);
  ok(/First buy, DCA/.test(fs.readFileSync(await dl.path(), "utf8")), "CSV export includes the note");
  await p.fill("#actSearch", "");
  await p.click('#portMode button[data-mode="list"]');
  ok(await p.isVisible("#summary") && await p.isVisible("#watchPane"), "back to List: summary and watchlist return");
  // trending
  await p.click('#nav button[data-nav="news"]');
  ok(await until(p, () => !document.querySelector("#trendStrip").hidden && document.querySelectorAll("#trendList .trend-chip").length === 3), "News: Trending Today strip");
  await p.click('#trendList .trend-chip >> nth=1');
  ok(await until(p, () => document.querySelector("#detailTitle").textContent === "DOT" && document.querySelector("#wlAddThis")), "trending coin opens with Add to Watchlist");
  await p.click("#wlAddThis");
  ok(await until(p, () => document.querySelector("#wlRemove") && JSON.parse(localStorage.getItem("watchlist")).some(w => w.sym === "DOT")), "added from Trending");
  await p.keyboard.press("Escape");
  await p.click('#trendList .trend-chip >> nth=2');
  ok(await until(p, () => document.querySelector("#detailTitle").textContent === "BTC" && document.querySelector('#detailBody [data-ds="hold"]')), "a trending coin you hold opens its normal sheet");
  await p.keyboard.press("Escape");
  // printable report
  await p.click('#nav button[data-nav="portfolio"]');
  await p.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await p.click("#printBtn");
  const rep = await p.evaluate(() => ({ n: window.__printed, t: document.querySelector("#printReport").textContent, rows: document.querySelectorAll("#printReport table tr").length }));
  ok(rep.n === 1 && /Portfolio Report/.test(rep.t) && /Holdings/.test(rep.t) && /Staking Rewards/.test(rep.t) && rep.rows > 10, "Print Report builds the report and opens print", { n: rep.n, rows: rep.rows });
  ok((await p.evaluate(() => window.__csp)).length === 0, "no CSP violations", await p.evaluate(() => window.__csp));
  ok(errors.length === 0, "no page or console errors", errors.slice(0, 3));
  fs.rmSync(dir, { recursive: true, force: true });
  await ctx.close(); return r.fails;
};
