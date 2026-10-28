/* PWA plumbing: manifest, service worker, build number shown in About. */
const fs = require("fs"), path = require("path"); const { reporter, until, mock } = require("../helpers.js");
module.exports = async (browser, url) => {
  const r = reporter(), ok = r.ok;
  const ctx = await browser.newContext(); await mock.install(ctx); const p = await ctx.newPage();
  await p.goto(url);
  const m = await p.evaluate(async () => (await fetch(document.querySelector('link[rel="manifest"]').href)).json());
  ok(m.name && m.start_url && m.display === "standalone" && m.icons.some(i => /maskable/.test(i.purpose || "")), "manifest: name, start_url, standalone, maskable icon");
  ok(m.icons.concat(m.screenshots || []).every(i => fs.existsSync(path.join(__dirname, "..", "..", "..", i.src))), "manifest icons and screenshots exist");
  ok(await until(p, async () => !!(await navigator.serviceWorker.getRegistration()), 10000), "service worker registers");
  const build = fs.readFileSync(path.join(__dirname, "..", "..", "..", "sw.js"), "utf8").match(/portfolio-v(\d+)/)[1];
  await p.reload();
  ok(await until(p, b => document.querySelector("#appVersion").textContent.includes("build " + b), 10000, build), `About shows build ${build}`);
  await ctx.close();
  // activation removes only this app's older builds (the sentiment model and sibling apps keep their caches)
  const c2 = await browser.newContext(); await mock.install(c2); await c2.route(/\/sw\.js$/, rt => rt.abort());
  const p2 = await c2.newPage(); await p2.goto(url);
  await p2.evaluate(async () => { for(const k of ["portfolio-v1", "transformers-cache", "other-app-v3"]) await (await caches.open(k)).put("/x", new Response("x")); });
  await c2.unroute(/\/sw\.js$/); await p2.reload();
  ok(await until(p2, async () => { const ks = await caches.keys(); return !ks.includes("portfolio-v1") && ks.some(k => /^portfolio-v\d+$/.test(k)); }, 15000), "service worker activates and drops its old build");
  const keys = await p2.evaluate(() => caches.keys());
  ok(keys.includes("transformers-cache") && keys.includes("other-app-v3"), "other caches survive an update", keys);
  await c2.close(); return r.fails;
};
