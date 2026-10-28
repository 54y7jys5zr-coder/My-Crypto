/* Watch-only addresses: validation, balances, reconciliation with recorded holdings, one-tap record. */
const { reporter, until, openApp, importFixtures } = require("../helpers.js");
const BTC = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", ETH = "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe";
module.exports = async (browser, url) => {
  const r = reporter(), ok = r.ok; const { ctx, p, errors } = await openApp(browser, url);
  await importFixtures(p);
  const msg = () => p.textContent("#watchMsg");
  const add = async (coin, addr) => { await p.selectOption("#wfCoin", coin); await p.fill("#wfAddr", addr); await p.click('#watchForm button[type="submit"]'); await p.waitForTimeout(150); };
  await add("BTC", "not an address"); ok(/private key or seed phrase/.test(await msg()), "seed-phrase-like input refused and cleared", await msg());
  ok(await p.inputValue("#wfAddr") === "", "refused input is cleared");
  await add("BTC", "xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz");
  ok(/xpub/.test(await msg()), "xpub explained as unsupported");
  await add("DOGE", "D123"); ok(/isn't a valid DOGE address/.test(await msg()), "malformed address refused", await msg());
  await add("BTC", "bitcoin:" + BTC.toUpperCase() + "?amount=0.1");
  ok(await until(p, () => /0[.,]025 BTC on-chain/.test(document.querySelector("#watchMsg").textContent)), "BTC address (from a bitcoin: URI) watched; balance loaded", await msg());
  ok(await p.evaluate(a => JSON.parse(localStorage.getItem("watch_addrs"))[0].addr === a, BTC), "bech32 address stored lower-case");
  await add("BTC", BTC); ok(/already watching/.test(await msg()), "duplicate refused");
  const recon = await p.textContent("#watchRecon");
  ok(/0[.,]005 BTC more than recorded/.test(recon), "reconciliation: on-chain 0.025 vs recorded 0.02", recon);
  ok(/1 watched address/.test(await p.textContent("#metaManual")), "section status counts the address");
  // coin sheet: same reconciliation, plus the network fee line
  await p.click('#nav button[data-nav="portfolio"]'); await p.click('#portfolioList .hrow[data-asset="BTC"]');
  await until(p, () => !document.querySelector("#detailSheet").hidden);
  if(!(await p.evaluate(() => document.querySelector('#detailBody [data-ds="hold"]').open))) await p.click("#dsHoldSum");
  ok(await until(p, () => /0[.,]005 BTC more than recorded/.test(document.querySelector('#detailBody [data-ds="hold"]').textContent)), "coin sheet shows the difference");
  ok(await until(p, () => { const f = document.querySelector("#btcFee"); return f && !f.hidden && /5–12 sat\/vB/.test(f.textContent); }), "BTC network fee shown", await p.evaluate(() => document.querySelector("#btcFee") && document.querySelector("#btcFee").textContent));
  // one tap: prefilled holdings form, then add it
  await p.click('#detailBody button[data-record="BTC"]');
  ok(await until(p, () => document.querySelector("#mfAsset").value === "BTC" && document.querySelector("#mfUnits").value === "0.005" && document.activeElement.id === "mfDate"), "Record prefills the holdings form");
  await p.click('#manualForm button[type="submit"]');
  ok(await until(p, () => /matches your private-wallet records/.test(document.querySelector("#watchRecon").textContent)), "after recording, on-chain matches", await p.textContent("#watchRecon"));
  // ETH: nothing recorded in a private wallet → the full balance is the difference
  // ETH: pasted while BTC is selected → the coin is detected from the address
  await add("BTC", ETH);
  ok(await until(p, () => /Watching ETH address: 1[.,]5 ETH/.test(document.querySelector("#watchMsg").textContent)), "ETH detected from the address", await msg());
  ok(await until(p, () => /1[.,]5 ETH more than recorded/.test(document.querySelector("#watchRecon").textContent)), "ETH address reconciles against 0 recorded");
  // explorer error: saved, explained, shown as not loaded
  await add("BTC", "1BoatSLRHtKNngkdXEeobR76b6zAqqyQ8");
  ok(await until(p, () => /couldn't be loaded right now/.test(document.querySelector("#watchMsg").textContent)), "explorer failure is explained", await msg());
  ok(/Couldn't load/.test(await p.textContent("#watchList")) && /not loaded/.test(await p.textContent("#watchRecon")), "failing address flagged in the list and reconciliation");
  // remove
  await p.click(`#watchList li:last-child button[data-unwatch]`);
  ok(await until(p, () => JSON.parse(localStorage.getItem("watch_addrs")).length === 2), "address removed");
  ok((await p.evaluate(() => window.__csp)).length === 0, "no CSP violations", await p.evaluate(() => window.__csp));
  ok(errors.length === 0, "no page or console errors", errors.slice(0, 3));
  await ctx.close(); return r.fails;
};
