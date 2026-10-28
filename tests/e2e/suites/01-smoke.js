/* Import the fixture CSVs, walk every tab, open a coin; no CSP violations or page errors. */
const { reporter, until, openApp, importFixtures } = require("../helpers.js");
module.exports = async (browser, url) => {
  const r = reporter(), ok = r.ok; const { ctx, p, errors } = await openApp(browser, url);
  ok(await p.isVisible("#emptyState"), "empty state before any import");
  ok(await importFixtures(p), "fixture CSVs import (3 assets)", await p.textContent("#importMsg"));
  ok(JSON.stringify(await p.$$eval("#nav button", b => b.map(x => x.dataset.nav))) === '["overview","portfolio","news","settings"]', "four tabs");
  await p.click('#nav button[data-nav="portfolio"]');
  ok(await until(p, () => document.querySelectorAll("#portfolioList .hrow").length === 3), "portfolio lists BTC, ETH, SOL");
  ok(await until(p, () => /€/.test(document.querySelector("#heroValue").textContent)), "portfolio value priced");
  await p.click('#portfolioList .hrow[data-asset="BTC"]');
  ok(await until(p, () => !document.querySelector("#detailSheet").hidden && document.querySelector("#detailTitle").textContent === "BTC"), "BTC coin sheet opens");
  await p.click("#dsHoldSum");
  const hold = await p.textContent('#detailBody [data-ds="hold"]');
  ok(/In Private Wallet\s*0[.,]02/.test(hold) && /On Kraken\s*0[.,]0299/.test(hold), "withdrawal shows as in private wallet", hold.replace(/\s+/g, " ").slice(0, 200));
  await p.keyboard.press("Escape");
  await p.click('#nav button[data-nav="news"]');
  ok(await until(p, () => document.querySelectorAll("#newsList .news-card").length > 0), "news headlines render");
  await p.click('#nav button[data-nav="overview"]');
  ok(await until(p, () => { const c = window.Chart && Chart.getChart(document.querySelector("#valueChart")); return c && c.data.datasets[0].data.length > 30; }, 15000), "overview chart drawn");
  ok((await p.evaluate(() => window.__csp)).length === 0, "no CSP violations", await p.evaluate(() => window.__csp));
  ok(errors.length === 0, "no page or console errors", errors.slice(0, 3));
  await ctx.close(); return r.fails;
};
