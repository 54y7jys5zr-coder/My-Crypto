/* Browser end-to-end suites: `npm run test:e2e` (or `node tests/e2e/run.js [suite…]`).
   Serves the app on 127.0.0.1, mocks every external API, and runs each file in suites/. */
const fs = require("fs"), path = require("path"), { start } = require("./server.js"), { launch } = require("./helpers.js");
(async () => {
  const dir = path.join(__dirname, "suites"), only = process.argv.slice(2);
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".js") && (!only.length || only.some(o => f.startsWith(o)))).sort();
  const srv = await start(), browser = await launch();
  let failed = 0;
  for(const f of files){
    console.log(`\n${f}`);
    try { const n = await require(path.join(dir, f))(browser, srv.url); if(n) failed += n; }
    catch(e){ console.log(`  CRASH ${e.stack || e}`); failed++; }
  }
  await browser.close(); srv.close();
  console.log(failed ? `\n${failed} check(s) FAILED` : `\nAll e2e suites passed (${files.length})`);
  process.exit(failed ? 1 : 0);
})();
