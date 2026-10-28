/* Settings: title-cased headers, holdings outside Kraken, backup contents, erase. */
const { reporter, until, openApp, importFixtures } = require("../helpers.js");
module.exports = async (browser, url) => {
  const r = reporter(), ok = r.ok; const { ctx, p, errors } = await openApp(browser, url);
  await importFixtures(p);
  const heads = await p.$$eval(".set-sec > summary .sec-k", e => e.map(x => x.textContent));
  ok(JSON.stringify(heads) === JSON.stringify(["Kraken Data","Holdings Outside Kraken","Alerts","Backup & Restore","CoinGecko API Key","Data & Extras","Display","About"]), "section headers", heads);
  // a gift held outside Kraken
  await p.fill("#mfAsset", "ADA"); await p.fill("#mfDate", "2024-05-01"); await p.fill("#mfUnits", "100");
  await p.click('#manualForm button[type="submit"]');
  ok(await until(p, () => /Added 100 ADA/.test(document.querySelector("#manualMsg").textContent)), "gift entry added");
  const ada = await p.evaluate(() => (JSON.parse(localStorage.getItem("user_data")).assets.find(a => a.asset === "ADA") || null));
  ok(ada && Math.abs(ada.offexchange_units - 100) < 1e-9 && ada.cost_basis === 0, "gift counted as a zero-cost private-wallet holding", ada);
  ok(/1 holding/.test(await p.textContent("#metaManual")), "section status shows the holding");
  // backup carries the manual entries and watch list
  await p.evaluate(() => localStorage.setItem("watch_addrs", JSON.stringify([{id:"w1", asset:"BTC", addr:"bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"}])));
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#backupBtn")]);
  const b = JSON.parse(require("fs").readFileSync(await dl.path(), "utf8"));
  ok(b.app === "my-crypto" && b.items.manual_entries && b.items.watch_addrs && b.raw_csv, "backup includes entries, watched addresses and CSVs", Object.keys(b.items));
  // delete the entry again
  await p.click('#manualList button[data-del]');
  ok(await until(p, () => /Deleted 100 ADA/.test(document.querySelector("#manualMsg").textContent)), "entry deleted");
  // erase everything
  await p.click("#eraseBtn"); await p.waitForLoadState("load"); await p.waitForTimeout(400);
  ok(await p.evaluate(() => localStorage.length === 0 || !localStorage.getItem("user_data")), "erase clears stored data");
  ok(errors.length === 0, "no page or console errors", errors.slice(0, 3));
  await ctx.close(); return r.fails;
};
