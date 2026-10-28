/* Kraken live prices over WebSocket: subscribe, stream, pause when hidden, stop when the source changes. */
const { reporter, until, openApp, importFixtures, mock } = require("../helpers.js");
module.exports = async (browser, url) => {
  const r = reporter(), ok = r.ok; const { ctx, p, errors } = await openApp(browser, url);
  await importFixtures(p);
  ok(await p.evaluate(() => !window.__ws), "no socket with CoinGecko as the source");
  await p.click('#priceSrcSeg button[data-src="kraken"]');
  ok(await until(p, () => window.__ws && window.__ws.readyState === 1 && window.__wsSubs), "socket opens with Kraken as the source");
  ok(JSON.stringify(await p.evaluate(() => window.__wsSubs.slice().sort())) === '["BTC/EUR","ETH/EUR","SOL/EUR"]', "subscribes to the held coins", await p.evaluate(() => window.__wsSubs));
  ok(await until(p, () => document.querySelector("#lastUpdated").textContent === "Live", 8000), "freshness pill says Live");
  const target = mock.PX.bitcoin * 1.5;
  await p.evaluate(v => window.__wsPush("BTC", v), target);
  ok(await until(p, v => { const px = JSON.parse(localStorage.getItem("px_cache")).px.BTC; return Math.abs(px - v) < 1e-6; }, 8000, target), "streamed price applied (batched)");
  ok(await until(p, () => /€/.test(document.querySelector("#heroValue").textContent)), "UI re-rendered");
  // hidden → socket closes; visible → reopens
  await p.evaluate(() => { Object.defineProperty(document, "hidden", { configurable:true, get:() => true }); document.dispatchEvent(new Event("visibilitychange")); });
  ok(await until(p, () => window.__ws.readyState === 3), "socket closes while hidden");
  await p.evaluate(() => { Object.defineProperty(document, "hidden", { configurable:true, get:() => false }); document.dispatchEvent(new Event("visibilitychange")); });
  ok(await until(p, () => window.__wsAll.length >= 2 && window.__ws.readyState === 1), "socket reopens when visible");
  await p.click('#priceSrcSeg button[data-src="coingecko"]');
  ok(await until(p, () => window.__ws.readyState === 3 && document.querySelector("#lastUpdated").textContent !== "Live"), "back to CoinGecko: socket closed");
  ok(errors.length === 0, "no page or console errors", errors.slice(0, 3));
  await ctx.close(); return r.fails;
};
