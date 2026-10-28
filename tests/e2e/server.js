/* Minimal static server for the e2e suites: serves the repo root on 127.0.0.1 (loopback only), random port. */
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const TYPES = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".json":"application/json", ".webmanifest":"application/manifest+json",
  ".png":"image/png", ".webp":"image/webp", ".svg":"image/svg+xml", ".ico":"image/x-icon", ".csv":"text/csv" };
function start(){
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path.join(ROOT, rel.endsWith("/") ? rel + "index.html" : rel);
    if(!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if(err){ res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(buf);
    });
  });
  return new Promise(ok => srv.listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${srv.address().port}/index.html`, close: () => srv.close() })));
}
module.exports = { start };
