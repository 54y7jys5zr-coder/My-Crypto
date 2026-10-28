/* Shared helpers for the e2e suites. */
const path = require("path"), { chromium } = require("playwright-core"), mock = require("./mock.js");
const FIX = path.join(__dirname, "fixtures");
async function launch(){
  // PW_CHANNEL=chrome uses an installed Chrome; otherwise Playwright's Chromium (`npx playwright-core install chromium`)
  const channel = process.env.PW_CHANNEL;
  try { return await chromium.launch({ headless:true, ...(channel ? { channel } : {}) }); }
  catch(e){ if(channel) throw e; return chromium.launch({ headless:true, channel:"chrome" }); }
}
function reporter(name){
  let fails = 0;
  const ok = (c, m, x) => { console.log(`  ${c ? "PASS" : "FAIL"} ${m}${!c && x !== undefined ? "  → " + JSON.stringify(x) : ""}`); if(!c) fails++; };
  return { ok, get fails(){ return fails; }, name };
}
const until = async (p, fn, ms = 10000, arg) => { const t = Date.now();
  while(Date.now() - t < ms){ if(await p.evaluate(fn, arg).catch(() => false)) return true; await p.waitForTimeout(100); } return false; };
/* a fresh context with mocks, CSP capture and an error log; storage wiped and onboarding skipped */
async function openApp(browser, url, opts = {}){
  const ctx = await browser.newContext({ viewport:{ width:390, height:844 }, colorScheme: opts.scheme || "dark", serviceWorkers:"block", ...(opts.ctx || {}) });
  await mock.install(ctx);
  await ctx.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", e => window.__csp.push(e.violatedDirective + " " + e.blockedURI)); });
  const p = await ctx.newPage(); const errors = [];
  p.on("pageerror", e => errors.push(e.message)); p.on("console", m => { if(m.type() === "error" && !/net::ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  p.on("dialog", d => d.accept());
  await p.goto(url);
  await p.evaluate(async () => { localStorage.clear(); localStorage.setItem("onboarded", "1");
    localStorage.setItem("settings_open", JSON.stringify(["sec-import","sec-manual","sec-alerts","sec-backup","sec-api","sec-data","sec-display","sec-about"]));
    await new Promise(r => { const q = indexedDB.deleteDatabase("my-crypto"); q.onsuccess = q.onerror = q.onblocked = r; }); });
  await p.reload(); await p.waitForTimeout(300);
  return { ctx, p, errors };
}
async function importFixtures(p){
  await p.click('#nav button[data-nav="settings"]');
  await p.setInputFiles("#fileCsv", ["Balances", "Ledger", "Trades"].map(f => path.join(FIX, f + ".csv")));
  await p.waitForTimeout(200); await p.click("#recomputeBtn");
  return until(p, () => /^Imported 3 assets/.test(document.querySelector("#importMsg").textContent));
}
module.exports = { launch, reporter, until, openApp, importFixtures, mock };
