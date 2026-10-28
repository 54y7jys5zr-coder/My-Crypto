/* axe-core on every tab and the coin sheet, dark and light. */
const fs = require("fs"); const { reporter, until, openApp, importFixtures } = require("../helpers.js");
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
module.exports = async (browser, url) => {
  const r = reporter(), ok = r.ok;
  for(const scheme of ["dark", "light"]){
    const { ctx, p } = await openApp(browser, url, { scheme, ctx:{ bypassCSP:true } });
    await p.evaluate(() => { localStorage.setItem("summary_open", JSON.stringify(["headline","flows","realized","perf","monthly","staking","rebal"])); localStorage.setItem("detail_open", JSON.stringify(["hold","stake","sell","tx","alert"])); });
    await importFixtures(p); await p.addScriptTag({ content: AXE });
    const run = () => p.evaluate(async () => (await axe.run(document, { resultTypes:["violations"] })).violations.map(v => `${v.id}: ${v.nodes.length}`));
    for(const tab of ["overview", "portfolio", "news", "settings"]){
      await p.click(`#nav button[data-nav="${tab}"]`); await p.waitForTimeout(500);
      const v = await run(); ok(v.length === 0, `${scheme} ${tab}: no violations`, v);
    }
    await p.click('#nav button[data-nav="portfolio"]'); await p.click('#portMode button[data-mode="activity"]'); await p.waitForTimeout(300);
    { const v = await run(); ok(v.length === 0, `${scheme} activity: no violations`, v); }
    await p.click('#portMode button[data-mode="list"]'); await p.click("#tgEdit"); await p.waitForTimeout(200);
    { const v = await run(); ok(v.length === 0, `${scheme} rebalance editor: no violations`, v); }
    await p.click("#tgCancel");
    await p.click('#portfolioList .hrow[data-asset="BTC"]');
    await until(p, () => !document.querySelector("#detailSheet").hidden); await p.waitForTimeout(400);
    const v = await run(); ok(v.length === 0, `${scheme} coin sheet: no violations`, v);
    await ctx.close();
  }
  return r.fails;
};
