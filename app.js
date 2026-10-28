/* My Crypto — UI + live prices + FX + chart. Engine in engine.js. */
(() => {
"use strict";
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const REDUCE_MOTION = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const VIEWS = ["overview","portfolio","news","settings"];
const EMPTY_DATA = {assets:[],events:[],generated:"",warnings:[],
  meta:{total_deposited:0,total_withdrawn:0,net_deposited:0,eur_remaining:0,total_realized:0}};
/* Validate/normalize anything that becomes state.data (imports, backups, stored data). Returns null
   if unusable, so a damaged backup can't break every launch. */
function normalizeData(d){
  if(!d || typeof d!=="object" || !Array.isArray(d.assets)) return null;
  const num=x=>typeof x==="number" && isFinite(x);
  const assets=d.assets.filter(a=>a && typeof a.asset==="string" && num(a.quantity) && num(a.cost_basis))
    .map(a=>({...a, deployed_units:num(a.deployed_units)?a.deployed_units:a.quantity, realized:num(a.realized)?a.realized:0}));
  if(assets.length!==d.assets.length) return null;
  const m=d.meta && typeof d.meta==="object" ? d.meta : {};
  const meta={...EMPTY_DATA.meta};
  for(const k of Object.keys(meta)) if(num(m[k])) meta[k]=m[k];
  if(m.cash && typeof m.cash==="object") meta.cash=m.cash;
  if(num(m.total_fees_eur)) meta.total_fees_eur=m.total_fees_eur;
  return {...d, assets, meta, warnings:Array.isArray(d.warnings)?d.warnings:[], events:Array.isArray(d.events)?d.events:[]};
}

const state = {
  data: null,          // set to EMPTY_DATA below; {assets, meta, warnings, events, timelines, realized_events}
  prices: {},          // symbol -> EUR price
  priceTs: null,       // timestamp of current prices
  fx: { EUR:1 },       // display currency -> rate from 1 EUR (EUR base). Non-EUR filled live.
  ccy: "EUR",
  ccyPair: ["EUR","PLN"], // the two currencies offered by the top toggle (user-configurable)
  view: 1,             // 1 = All Holdings (total), 3 = Invested Only (deployed)
  portMode: "list",    // Portfolio tab layout: "list" | "table"
  sortKey: "value",    // shared by the list and the table
  sortDir: -1,
  query: "",           // portfolio search (never stored)
  auto: true,
  timer: null,
  chart: null,
  chartLoaded: false,
  hist: null,          // cached 365d history: symbol -> [{t,p}]
  sparks: {},          // symbol -> fallback daily prices for the detail chart (memory only)
  chartRange: 365,     // chart window in days (365|30|7)
  detailRange: 30,     // per-asset detail chart window (7|30|365)
  detailChart: null,   // Chart instance for the detail chart (destroyed on redraw)
  openSym: null,       // asset shown in the detail sheet, or null
  lastFocus: null,     // element focused before the sheet opened (focus returns there)
  alerts: {},          // symbol -> {p: target EUR, dir: "above"|"below", fired: bool}
  logos: {},           // symbol -> logo URL (CoinGecko markets)
  chg24: {},           // symbol -> 24h % change (CoinGecko markets)
  chg7: {},            // symbol -> 7d % change
  chg30: {},           // symbol -> 30d % change
  prevPx: {},          // symbol -> previous price, for subtle flash-on-change
  scrubbing: false,    // true while user is scrubbing the overview chart
  offline: false,
  privacy: false,      // hide amounts (persisted)
  fxTs: 0,             // when FX rates were last fetched
};
state.data = EMPTY_DATA;   // handlers may fire before init() finishes loading data

/* ---------- currencies ----------
   Base is always EUR internally; display currencies convert via Frankfurter (ECB, EUR-based).
   Formatting (symbol, placement, separators, decimals) comes from Intl for the user's locale. */
const CCY_CODES = ["EUR","PLN","USD","GBP","CHF","SEK","NOK","DKK","CZK","JPY","CAD","AUD","INR","BRL"];
const isCcy = c => CCY_CODES.includes(c);
const CHART_RANGES = [7,30,365,0];   // 0 = All (weekly points from DefiLlama, back to your first transaction)
const SORT_KEYS = ["value","unreal","ret","cost","quantity","asset"];

const nfCache = new Map();
function nf(opts){ const k=JSON.stringify(opts); let f=nfCache.get(k);
  if(!f){ f=new Intl.NumberFormat(undefined,opts); nfCache.set(k,f); } return f; }
const ccyOpts = c => ({style:"currency", currency:c, currencyDisplay:"narrowSymbol"});
function ccySymbol(c){
  try{ return nf(ccyOpts(c)).formatToParts(0).find(p=>p.type==="currency").value; }catch(e){ return c; }
}
const ccyLabel = c => { const s=ccySymbol(c); return s===c ? c : `${s} ${c}`; };

/* persisted prefs: "alerts" holds targets, "prefs" holds UI choices. Queries are never stored. */
function loadPrefs(){
  let a={};
  try{ a = JSON.parse(localStorage.getItem("alerts")||"{}") || {}; }catch(e){}
  // older builds stored a bare number (an "above" target)
  state.alerts={};
  for(const [k,v] of Object.entries(a)){
    if(typeof v==="number") state.alerts[k]={p:v, dir:"above", fired:false};
    else if(v && typeof v.p==="number") state.alerts[k]={p:v.p, dir:["below","move"].includes(v.dir)?v.dir:"above", fired:!!v.fired};
  }
  let p={};
  try{ p = JSON.parse(localStorage.getItem("prefs")||"{}") || {}; }catch(e){ p={}; }
  // CoinGecko free/Demo history is capped at 365 days, so 1Y is the widest range
  state.chartRange= CHART_RANGES.includes(+p.chartRange) ? +p.chartRange : 365;
  state.view      = +p.view===3 ? 3 : 1;
  state.portMode  = ["table","activity"].includes(p.portMode) ? p.portMode : "list";
  state.sortKey   = SORT_KEYS.includes(p.sortKey) ? p.sortKey : "ret";
  state.sortDir   = +p.sortDir===1 ? 1 : -1;
  // one-time migration (from the GitHub version): the default became Return % desc
  if(p.prefsV!==2){ state.sortKey="ret"; state.sortDir=-1; }
  state.auto      = p.auto!==false;
  state.privacy   = p.privacy===true;
  state.theme     = ["light","dark"].includes(p.theme) ? p.theme : "system";
  state.taxPl     = p.taxPl===true;
  state.priceSource = p.priceSource==="kraken" ? "kraken" : "coingecko";
  state.showMarket  = p.showMarket!==false;
  state.sentiment   = p.sentiment===true;
  state.bench       = ["bitcoin","ethereum"].includes(p.bench) ? p.bench : "";
  if(Array.isArray(p.ccyPair) && p.ccyPair.length===2 && p.ccyPair.every(isCcy) && p.ccyPair[0]!==p.ccyPair[1])
    state.ccyPair = p.ccyPair;
  state.ccy = state.ccyPair.includes(p.ccy) ? p.ccy : state.ccyPair[0];
}
function savePrefs(){
  try{ localStorage.setItem("prefs", JSON.stringify({
    chartRange:state.chartRange, view:state.view, portMode:state.portMode,
    sortKey:state.sortKey, sortDir:state.sortDir, auto:state.auto, privacy:state.privacy, theme:state.theme, taxPl:state.taxPl, priceSource:state.priceSource, showMarket:state.showMarket, sentiment:state.sentiment, bench:state.bench,
    ccyPair:state.ccyPair, ccy:state.ccy, prefsV:2 })); }catch(e){}
}
function saveAlerts(){ try{ localStorage.setItem("alerts", JSON.stringify(state.alerts)); }catch(e){} }

/* segmented controls: one place that sets both the visual state and aria-pressed */
function markActive(sel, pred){
  $$(sel).forEach(b=>{ const on=!!pred(b); b.classList.toggle("active",on); b.setAttribute("aria-pressed", on?"true":"false"); });
}
function applyPrefUI(){
  markActive("#chartRange button", b=>+b.dataset.range===state.chartRange);
  markActive("[data-view-switch] button", b=>+b.dataset.view===state.view);
  markActive("#portMode button", b=>b.dataset.mode===state.portMode);
  $("#autoToggle").checked=state.auto;
  $("#taxPlToggle").checked=state.taxPl;
  $("#marketToggle").checked=state.showMarket;
  $("#sentToggle").checked=state.sentiment;
  markActive("#priceSrcSeg button", b=>b.dataset.src===state.priceSource);
  markActive("#benchSeg button", b=>b.dataset.bench===state.bench);
  markActive("#themeSeg button", b=>b.dataset.theme===state.theme);
  applyPrivacy();
  renderCcyToggle();
}
/* header currency toggle from the configured pair */
function renderCcyToggle(){
  const box=$("#ccyToggle"); if(!box) return;
  box.innerHTML=state.ccyPair.map(c=>`<button data-ccy="${esc(c)}">${esc(ccyLabel(c))}</button>`).join("");
  markActive("#ccyToggle button", b=>b.dataset.ccy===state.ccy);
}
/* the two currency <select>s in Settings */
function renderCcyPicker(){
  for(const slot of [0,1]){ const sel=$("#ccySlot"+slot); if(!sel) continue;
    sel.innerHTML=CCY_CODES.map(c=>`<option value="${c}"${c===state.ccyPair[slot]?" selected":""}>${esc(ccyLabel(c))}</option>`).join("");
  }
}

/* ---------- formatting ---------- */
const esc = s => s==null ? "" : String(s).replace(/[&<>"'`]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;","`":"&#96;"}[c]));
/* currency actually displayed: the chosen one once its FX rate is known, EUR until then —
   never a foreign symbol on EUR amounts */
const dispCcy = () => state.fx[state.ccy]!=null ? state.ccy : "EUR";
const rate = () => state.fx[dispCcy()];
const ccyDigits = () => nf(ccyOpts(dispCcy())).resolvedOptions().maximumFractionDigits;  // 2 for EUR, 0 for JPY
const bad = x => x==null || isNaN(x);
const MASK = "•••••";
const fmtMoney = (eur) => bad(eur) ? "—" : state.privacy ? MASK : nf(ccyOpts(dispCcy())).format(eur*rate());
/* compact money for tight space: €7.2K, €1.35M */
const fmtMoneyCompact = (eur) => {
  if (bad(eur)) return "—";
  if (state.privacy) return MASK;
  const v = eur*rate(), a = Math.abs(v);
  if (a < 1e4) return fmtMoney(eur);
  const dp = a >= 1e6 ? 2 : 1;
  return nf({...ccyOpts(dispCcy()), notation:"compact", minimumFractionDigits:0, maximumFractionDigits:dp}).format(v);
};
const fmtQty = (x) => x==null ? "—" : state.privacy ? MASK : nf({maximumFractionDigits:8}).format(x);
/* price-aware money: per-unit prices span huge ranges (PEPE ~€0.0000041 .. BTC €73k).
   Pick decimals by magnitude so tiny values never render as €0.00. */
const fmtPrice = (eur) => {
  if (bad(eur)) return "—";
  const v = eur*rate(), a = Math.abs(v), def = ccyDigits();
  let dp;
  if (a === 0 || a >= 1) dp = def;
  else if (a >= 0.01) dp = 6;
  else dp = Math.min(12, Math.floor(-Math.log10(a)) + 4);   // ~4 significant figures after the zeros
  return nf({...ccyOpts(dispCcy()), minimumFractionDigits:Math.min(dp,def), maximumFractionDigits:dp}).format(v);
};
const pct = (x) => bad(x) ? "—" : `${x>=0?"+":""}${x.toFixed(1)}%`;
const arrowOf = u => u==null?"":(u>=0?"▲":"▼");
/* P/L tone as a class (no inline styles: the CSP has no 'unsafe-inline' for styles) */
const tone = u => bad(u) ? "c-flat" : (u>=0 ? "c-up" : "c-down");
const setTone = (el, u) => { el.classList.remove("c-up","c-down","c-flat"); el.classList.add(tone(u)); };
/* elements rendered with data-w (width %), data-c (background) or data-h (avatar hue) get those
   applied through the CSSOM, which the CSP allows (inline style="" attributes are blocked) */
function applyDataStyles(root){
  root.querySelectorAll("[data-w]").forEach(el=>{ el.style.width=el.dataset.w+"%"; });
  root.querySelectorAll("[data-c]").forEach(el=>{ el.style.background=el.dataset.c; });
  root.querySelectorAll("[data-h]").forEach(el=>{ el.style.setProperty("--h", el.dataset.h); });
}

const BELL_SVG = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/></svg>';

/* inline SVG sparkline from a numeric series. Returns "" when insufficient data. */
function sparkSVG(points, w=54, h=18){
  if(!points || points.length<2) return "";
  const min=Math.min(...points), max=Math.max(...points), span=(max-min)||1;
  const n=points.length, dx=w/(n-1);
  const pts=points.map((p,i)=>`${(i*dx).toFixed(1)},${(h-((p-min)/span)*h).toFixed(1)}`).join(" ");
  const up=points[n-1]>=points[0];
  return `<svg class="spark ${up?"spark-up":"spark-down"}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none" aria-hidden="true">`+
         `<polyline points="${pts}"/></svg>`;
}
/* last-7-day price series for an asset, from the cached history */
function spark7(sym){
  const h=state.hist&&state.hist[sym];
  return h&&h.length>=2 ? h.slice(-7).map(x=>x.p) : null;
}
/* detail-sheet hero tint by value/cost ratio */
function ratioTier(ratio){
  if (bad(ratio)) return "tier-flat";
  if (ratio >= 1.5) return "tier-up2";
  if (ratio > 1.0)  return "tier-up";
  if (ratio === 1.0)return "tier-flat";
  if (ratio > 0.8)  return "tier-down";
  return "tier-down2";
}

/* ---------- CoinGecko request layer ----------
   Single place that builds CoinGecko URLs + headers and enforces a 429 cooldown. */
const CG = {
  base: "https://api.coingecko.com/api/v3",
  demoKey: null,                 // optional Demo key from Settings (client-visible; fine for the demo plan)
  cooldownUntil: 0,              // epoch ms; while now < this, skip CoinGecko calls
};
function cgHeaders(){ return CG.demoKey ? {"x-cg-demo-api-key": CG.demoKey} : {}; }
function cgOnCooldown(){ return Date.now() < CG.cooldownUntil; }
/* central CoinGecko GET: honors cooldown, sets cooldown on 429 (respects Retry-After). */
async function cgFetch(path){
  if(cgOnCooldown()) throw Object.assign(new Error("cg cooldown"), {cooldown:true});
  const r = await fetch(CG.base+path, {cache:"no-store", headers:cgHeaders()});
  if(r.status===429){
    const ra = parseInt(r.headers.get("retry-after")||"", 10);
    const wait = (!isNaN(ra) ? ra*1000 : 60000);          // default 60s if no header
    CG.cooldownUntil = Date.now() + Math.min(wait, 300000); // cap at 5 min
    throw Object.assign(new Error("cg 429"), {rate:true, retryMs:wait});
  }
  if(!r.ok) throw new Error("cg "+r.status);
  return r.json();
}

/* ---------- data loading ---------- */
async function loadBundled(){
  try{
    const r = await fetch("./data.json",{cache:"no-store"});
    if(!r.ok) throw new Error("data.json "+r.status);
    state.data = normalizeData(await r.json()) || EMPTY_DATA;
  }catch(e){ state.data = EMPTY_DATA; }
  $("#dataSource").textContent = state.data.assets.length
    ? "bundled snapshot ("+(state.data.generated||"")+")" : "nothing imported yet";
  reconMsg();
}
function setUserData(d){
  state.data=d;
  $("#dataSource").textContent = d.generated ? "your imported CSV ("+d.generated+")"
    : d.assets.length ? "holdings entered manually" : "nothing imported yet";
}

/* ---------- on-device file store (IndexedDB) ----------
   Raw Kraken CSVs are kept here (they can exceed localStorage's ~5 MB) so the portfolio can be
   recomputed when manual holdings change, without re-importing. Never leaves the device. */
const IDB={
  db:null,
  open(){ return this.db || (this.db=new Promise((res,rej)=>{ try{
    const r=indexedDB.open("my-crypto",1);
    r.onupgradeneeded=()=>r.result.createObjectStore("kv");
    r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }catch(e){ rej(e); } })); },
  async run(mode, fn){ const db=await this.open();
    return new Promise((res,rej)=>{ const tx=db.transaction("kv",mode), st=tx.objectStore("kv"); const q=fn(st);
      tx.oncomplete=()=>res(q && q.result); tx.onerror=()=>rej(tx.error); tx.onabort=()=>rej(tx.error); }); },
  async get(k){ try{ return (await this.run("readonly", st=>st.get(k))) ?? null; }catch(e){ return null; } },
  async set(k,v){ return this.run("readwrite", st=>st.put(v,k)); },
  async del(k){ try{ await this.run("readwrite", st=>st.delete(k)); }catch(e){} },
};
const RAW_KEY="raw_csv", RAW_UNDO_KEY="raw_csv_undo";
let rawCache=null;   // in-memory copy so backup export stays synchronous (Safari blocks downloads after an await)
async function setRaw(v){ rawCache=v||null; if(v) await IDB.set(RAW_KEY,v); else await IDB.del(RAW_KEY); }

/* ---------- holdings outside Kraken (manual entries) ----------
   e.g. coins received as a gift straight into a private wallet. Stored in localStorage
   ("manual_entries"), included in backups/undo, and fed into the engine on every recompute. */
function loadEntries(){
  try{ const v=JSON.parse(localStorage.getItem("manual_entries")||"[]"); return Array.isArray(v) ? v.filter(e=>e && e.id && e.asset) : []; }catch(e){ return []; }
}
function saveEntries(list){ localStorage.setItem("manual_entries", JSON.stringify(list)); }
/* rebuild the portfolio from the stored CSVs + manual entries; keeps CoinGecko ids already resolved */
async function recompute(){
  const raw=rawCache, entries=loadEntries();
  const imported=!!(state.data.generated && state.data.assets.length);
  if(!raw && imported) return {needsReimport:true};
  const res=window.PortfolioEngine.analyze(raw?raw.bal:"", raw?raw.led:"", raw?raw.trd:"", entries);
  res.generated = raw ? raw.at : "";
  const prev=Object.fromEntries(state.data.assets.map(a=>[a.asset,a]));
  for(const a of res.assets){ const p=prev[a.asset]; if(p && p.cg_checked){ a.cg_id=p.cg_id; a.cg_checked=true; } }
  setUserData(res);
  try{ if(res.assets.length) localStorage.setItem("user_data", JSON.stringify(res)); else localStorage.removeItem("user_data"); }catch(e){}
  return {res};
}
function renderEntries(){
  const list=loadEntries().sort((a,b)=>a.date<b.date?-1:1), ul=$("#manualList");
  ul.hidden=!list.length;
  ul.innerHTML=list.map(e=>{
    const d=new Date(e.date+"T00:00:00Z").toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"});
    const what = e.kind==="purchase" ? `bought for ${nf(ccyOpts("EUR")).format(e.cost_eur||0)}` : "gift";
    return `<li><span class="me-main"><b>${esc(nf({maximumFractionDigits:8}).format(e.units))} ${esc(e.asset)}</b>
      <span class="muted small">${esc(what)} · ${esc(d)} · private wallet</span></span>
      <button class="chip-btn ghost" data-del="${esc(e.id)}" aria-label="Delete ${esc(e.asset)} entry from ${esc(d)}">Delete</button></li>`;
  }).join("");
  // asset suggestions: what you already hold plus the common majors
  const known=new Set([...state.data.assets.map(a=>a.asset),"BTC","ETH","SOL","XRP","ADA","DOT","LTC","LINK","USDC","USDT"]);
  $("#mfAssets").innerHTML=[...known].sort().map(a=>`<option value="${esc(a)}">`).join("");
  renderSettingsMeta();
}
async function applyEntriesChange(msgText){
  const m=$("#manualMsg");
  const r=await recompute();
  renderEntries(); renderWatch();
  if(r.needsReimport){ m.className="msg"; m.textContent="Saved. Re-import your Kraken CSVs once so it can be included (this version keeps them on the device for next time)."; return; }
  state.prices={}; state.priceTs=null;
  await refresh(true); loadChart(true);
  m.className="msg ok"; m.textContent=msgText;
}
async function addEntry(ev){
  ev.preventDefault();
  const m=$("#manualMsg"); m.className="msg err";
  const asset=$("#mfAsset").value.trim().toUpperCase(), date=$("#mfDate").value, units=parseFloat($("#mfUnits").value);
  const kind=$("#mfKind").value==="purchase"?"purchase":"gift", cost=parseFloat($("#mfCost").value);
  const today=new Date().toISOString().slice(0,10);
  if(!/^[A-Z0-9.]{2,12}$/.test(asset)){ m.textContent="Enter the coin's ticker, e.g. BTC."; $("#mfAsset").focus(); return; }
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || date>today){ m.textContent="Pick the date you received it (not in the future)."; $("#mfDate").focus(); return; }
  if(!(units>0)){ m.textContent="Enter an amount above zero."; $("#mfUnits").focus(); return; }
  if(kind==="purchase" && !(cost>=0)){ m.textContent="Enter what you paid in EUR (0 if unknown)."; $("#mfCost").focus(); return; }
  if(window.PortfolioEngine.FIAT && window.PortfolioEngine.FIAT.has(asset)){ m.textContent="That's a currency, not a coin."; return; }
  const list=loadEntries();
  list.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2,6), asset, date, units, kind, ...(kind==="purchase"?{cost_eur:cost}:{})});
  try{ saveEntries(list); }catch(e){ m.textContent="This device's storage is full — couldn't save."; return; }
  $("#manualForm").reset(); $("#mfCostWrap").hidden=true;
  await applyEntriesChange(`Added ${nf({maximumFractionDigits:8}).format(units)} ${asset}.`);
}
async function deleteEntry(id){
  const list=loadEntries(), e=list.find(x=>x.id===id); if(!e) return;
  if(!confirm(`Delete ${e.units} ${e.asset} (${e.kind==="purchase"?"bought":"gift"}, ${e.date})?`)) return;
  saveEntries(list.filter(x=>x.id!==id));
  await applyEntriesChange(`Deleted ${e.units} ${e.asset}.`);
}
function reconMsg(){
  const w = state.data && state.data.warnings || [];
  if(!state.data.assets.length){ $("#reconMsg").textContent=""; return; }
  // only flag missing prices once a price fetch has actually happened
  const unpriced = state.priceTs ? state.data.assets.filter(a=>state.prices[a.asset]==null).map(a=>a.asset) : [];
  const resid=w.filter(x=>x.residual_zero_cost!=null), unsold=w.filter(x=>x.unmatched_sale);
  const {missing}=cashEur();
  $("#reconMsg").textContent = (resid.length
    ? `Reconciliation: ${resid.length} asset(s) didn't tie to Balances and were adjusted (e.g. ${resid[0].asset}).`
    : "Reconciliation: all assets tie to Balances.")
    + (unsold.length ? ` ${unsold.length} sale(s) had no matching EUR amount, so no profit was booked for them (${[...new Set(unsold.map(x=>x.asset))].join(", ")}).` : "")
    + (unpriced.length ? ` No live price found for: ${unpriced.join(", ")}.` : "")
    + (missing.length ? ` No exchange rate for cash in: ${missing.join(", ")}.` : "");
}
/* ask the browser not to evict our data (iOS evicts unused PWA storage); report the outcome */
async function persistStorage(){
  const el=$("#storageMsg"); if(!navigator.storage || !navigator.storage.persist) return;
  try{
    const ok = (await navigator.storage.persisted()) || (await navigator.storage.persist());
    if(el) el.textContent = ok ? "Storage: persistent — the browser won't clear it automatically."
                               : "Storage: may be cleared by the browser if unused. Keep a backup.";
  }catch(e){}
}

/* ---------- live prices + FX ----------
   ONE coins/markets call provides price + 24h/7d/30d change + logo for every asset. */
async function fetchMarkets(){
  const wl=wlItems();
  const ids=[...new Set(state.data.assets.map(a=>a.cg_id).concat(wl.map(w=>w.id)).filter(Boolean))].map(encodeURIComponent).join(",");
  if(!ids) throw new Error("no ids");
  const d = await cgFetch(`/coins/markets?vs_currency=eur&ids=${ids}&per_page=250&price_change_percentage=24h,7d,30d`);
  if(!Array.isArray(d)) throw new Error("bad markets response");
  const byId={}; for(const c of d) byId[c.id]=c;
  const px={};
  for(const a of state.data.assets){ const c=byId[a.cg_id]; if(!c) continue;
    if(c.current_price!=null) px[a.asset]=c.current_price;
    if(c.image) state.logos[a.asset]=c.image;
    const ch24 = c.price_change_percentage_24h_in_currency!=null ? c.price_change_percentage_24h_in_currency : c.price_change_percentage_24h;
    if(ch24!=null) state.chg24[a.asset]=ch24;
    if(c.price_change_percentage_7d_in_currency!=null) state.chg7[a.asset]=c.price_change_percentage_7d_in_currency;
    if(c.price_change_percentage_30d_in_currency!=null) state.chg30[a.asset]=c.price_change_percentage_30d_in_currency;
  }
  for(const w of wl){ const c=byId[w.id]; if(!c) continue;
    if(c.current_price!=null) px[w.sym]=c.current_price;
    if(c.image) state.logos[w.sym]=c.image;
    const ch24=c.price_change_percentage_24h_in_currency!=null ? c.price_change_percentage_24h_in_currency : c.price_change_percentage_24h;
    if(ch24!=null) state.chg24[w.sym]=ch24;
    if(c.price_change_percentage_7d_in_currency!=null) state.chg7[w.sym]=c.price_change_percentage_7d_in_currency;
    if(c.price_change_percentage_30d_in_currency!=null) state.chg30[w.sym]=c.price_change_percentage_30d_in_currency; }
  // an empty-but-valid response just means no id matched; keep going so resolveMissingIds() can fix them
  state.prices=px; state.priceTs=Date.now();
  try{ localStorage.setItem("px_cache", JSON.stringify({t:state.priceTs,px})); }catch(e){}
  try{ localStorage.setItem("logo_cache", JSON.stringify(state.logos)); }catch(e){}
}
/* Symbols the engine can't map fall back to symbol.toLowerCase(), which often isn't a CoinGecko id
   ("sol" vs "solana"), leaving the asset silently unpriced. Search each unpriced symbol once, take the
   exact-symbol match with the best market-cap rank, and persist the result with the imported data. */
let resolvingIds=false;
async function resolveMissingIds(){
  if(resolvingIds || cgOnCooldown()) return false;
  const todo=state.data.assets.filter(a=>state.prices[a.asset]==null && !a.cg_checked && !isCcy(a.asset));
  if(!todo.length) return false;
  resolvingIds=true; let changed=false;
  try{
    for(const a of todo){
      let d; try{ d=await cgFetch(`/search?query=${encodeURIComponent(a.asset)}`); }catch(e){ break; } // retried next refresh
      const sym=a.asset.toUpperCase();
      const hit=(d.coins||[]).filter(c=>String(c.symbol).toUpperCase()===sym)
        .sort((x,y)=>(x.market_cap_rank??1e9)-(y.market_cap_rank??1e9))[0];
      a.cg_checked=true;
      if(hit && hit.id!==a.cg_id){ a.cg_id=hit.id; changed=true; }
      await new Promise(res=>setTimeout(res,350));
    }
    try{ if(localStorage.getItem("user_data")) localStorage.setItem("user_data", JSON.stringify(state.data)); }catch(e){}
  }finally{ resolvingIds=false; }
  return changed;
}
function loadCachedLogos(){
  try{ const l=JSON.parse(localStorage.getItem("logo_cache")||"null"); if(l) state.logos=l; }catch(e){}
}
const FX_MAX_AGE=6*3600e3;   // ECB rates change daily; refresh a few times a day
const cashCodes = () => Object.keys((state.data && state.data.meta && state.data.meta.cash) || {}).filter(isCcy);
const fxStale = () => [...state.ccyPair, ...cashCodes(), "USD"].some(c=>c!=="EUR" && state.fx[c]==null) || Date.now()-state.fxTs>FX_MAX_AGE;
function saveFX(){ state.fxTs=Date.now(); try{ localStorage.setItem("fx_cache", JSON.stringify({t:state.fxTs, rates:state.fx})); }catch(e){} }
async function fetchFX(){
  const wanted=[...new Set([...state.ccyPair, ...cashCodes(), "USD"].filter(c=>c!=="EUR"))];   // USD: DefiLlama/Coinpaprika quotes
  if(!wanted.length){ state.fxTs=Date.now(); return; }
  try{
    const r = await fetch(`https://api.frankfurter.dev/v1/latest?base=EUR&symbols=${wanted.join(",")}`,{cache:"no-store"});
    const d = await r.json();
    if(d && d.rates){ let got=false;
      for(const c of wanted){ if(d.rates[c]!=null){ state.fx[c]=d.rates[c]; got=true; } }
      if(got){ saveFX(); return; }
    }
  }catch(e){}
  // fallback: derive via CoinGecko BTC cross-rate (skip if throttled)
  if(cgOnCooldown()) return;
  try{
    const vs=wanted.map(c=>c.toLowerCase()).join(",");
    const d = await cgFetch(`/simple/price?ids=bitcoin&vs_currencies=eur,${vs}`);
    if(d.bitcoin && d.bitcoin.eur){ for(const c of wanted){ const k=c.toLowerCase();
      if(d.bitcoin[k]!=null) state.fx[c]=d.bitcoin[k]/d.bitcoin.eur; }
      saveFX(); }
  }catch(e){}
}
function loadCachedFX(){
  try{ const c=JSON.parse(localStorage.getItem("fx_cache")||"null"); if(!c) return;
    const rates = c.rates && typeof c.rates==="object" ? c.rates : c;   // older builds stored bare rates (no timestamp)
    for(const k in rates) if(k!=="EUR" && typeof rates[k]==="number") state.fx[k]=rates[k];
    state.fxTs = typeof c.t==="number" ? c.t : 0;
  }catch(e){}
}
/* EUR value of fiat cash on the exchange (currencies without a known rate are left out) */
function cashEur(){
  const cash=(state.data.meta && state.data.meta.cash) || {};
  let total=0, any=false; const missing=[];
  for(const [c,v] of Object.entries(cash)){
    if(c==="EUR"){ total+=v; any=true; }
    else if(state.fx[c]){ total+=v/state.fx[c]; any=true; }
    else missing.push(c);
  }
  if(!any && state.data.meta && state.data.meta.eur_remaining){ total=state.data.meta.eur_remaining; any=true; }  // pre-cash imports
  return {total, any, missing};
}
function loadCachedPrices(){
  try{ const c=JSON.parse(localStorage.getItem("px_cache")||"null"); if(c&&c.px){ state.prices=c.px; state.priceTs=c.t||null; } }catch(e){}
}

/* ---------- extra public data sources (no keys; nothing about your holdings is sent) ----------
   Kraken: EUR prices from your own exchange + status. DefiLlama: price fallback, history fallback and
   the long "All" history. alternative.me: Fear & Greed. Coinpaprika: global market data. */
const DAY=864e5;
function cacheGet(k, maxAge){ try{ const c=JSON.parse(localStorage.getItem(k)||"null"); if(c && "v" in c && (maxAge==null || Date.now()-c.t<maxAge)) return c.v; }catch(e){} return null; }
function cacheSet(k, v){ try{ localStorage.setItem(k, JSON.stringify({t:Date.now(), v})); }catch(e){} }
async function getJSON(url){ const r=await fetch(url,{cache:"no-store"}); if(!r.ok) throw new Error(new URL(url).hostname+" "+r.status); return r.json(); }
const usdToEur = usd => state.fx.USD ? usd/state.fx.USD : null;

/* Kraken asset pairs (symbol → EUR pair key) and asset aliases, refreshed daily */
async function krakenMeta(){
  const c=cacheGet("kraken_meta", DAY); if(c) return c;
  const [ap, as]=await Promise.all([getJSON("https://api.kraken.com/0/public/AssetPairs"), getJSON("https://api.kraken.com/0/public/Assets")]);
  const pairs={};
  for(const [k,v] of Object.entries(ap.result||{})){
    if(!v || !/^Z?EUR$/.test(v.quote) || /\.d$/.test(k)) continue;              // EUR-quoted spot pairs
    const sym=window.PortfolioEngine.baseAsset(String(v.wsname||"").split("/")[0]);
    if(sym && !pairs[sym]) pairs[sym]=k;
  }
  const aliases={}; for(const [k,v] of Object.entries(as.result||{})) if(v && v.altname && v.altname!==k) aliases[k]=v.altname;
  const m={pairs, aliases}; cacheSet("kraken_meta", m); return m;
}
/* last-trade EUR prices from Kraken for the given symbols → {SYM:{p, open}} */
async function krakenPrices(syms){
  const m=await krakenMeta(), want=syms.filter(x=>m.pairs[x]); if(!want.length) return {};
  const d=await getJSON("https://api.kraken.com/0/public/Ticker?pair="+want.map(x=>m.pairs[x]).join(","));
  const out={};
  for(const x of want){ const r=(d.result||{})[m.pairs[x]]; const c=r&&+r.c[0], o=r&&+r.o; if(c>0) out[x]={p:c, open:o}; }
  return out;
}
/* DefiLlama current prices (USD → EUR) by CoinGecko id */
async function llamaPrices(assets){
  const list=assets.filter(a=>a.cg_id); if(!list.length || !state.fx.USD) return {};
  const d=await getJSON("https://coins.llama.fi/prices/current/"+list.map(a=>"coingecko:"+encodeURIComponent(a.cg_id)).join(","));
  const out={}; for(const a of list){ const c=(d.coins||{})["coingecko:"+a.cg_id]; if(c && c.price>0) out[a.asset]=usdToEur(c.price); }
  return out;
}
/* EUR/USD by date (Frankfurter time series), to convert DefiLlama's USD history accurately */
async function fxUsdHistory(fromDate){
  const c=cacheGet("fx_usd_hist", DAY); if(c && c.from<=fromDate) return c;
  const d=await getJSON(`https://api.frankfurter.dev/v1/${fromDate}..?base=EUR&symbols=USD`);
  const rates=Object.entries(d.rates||{}).map(([k,v])=>[k,v.USD]).sort((a,b)=>a[0]<b[0]?-1:1);
  const v={from:fromDate, rates}; cacheSet("fx_usd_hist", v); return v;
}
const usdRateOn = (fx, t) => { const d=new Date(t).toISOString().slice(0,10), r=fx.rates; let lo=0, hi=r.length-1, ans=r[0];
  while(lo<=hi){ const m=(lo+hi)>>1; if(r[m][0]<=d){ ans=r[m]; lo=m+1; } else hi=m-1; } return ans ? ans[1] : state.fx.USD; };
/* DefiLlama price history in EUR: daily (≤ 366 points) or weekly since a date */
async function llamaHistory(cgId, startMs, period){
  const span = period==="1d" ? 366 : Math.min(500, Math.ceil((Date.now()-startMs)/(7*DAY))+1);
  const d=await getJSON(`https://coins.llama.fi/chart/coingecko:${encodeURIComponent(cgId)}?start=${Math.floor(startMs/1000)}&span=${span}&period=${period}`);
  const pts=((d.coins||{})["coingecko:"+cgId]||{}).prices||[];
  if(!pts.length) return null;
  const fx=await fxUsdHistory(new Date(pts[0].timestamp*1000-7*DAY).toISOString().slice(0,10));
  return pts.map(x=>({t:x.timestamp*1000, p:x.price/usdRateOn(fx, x.timestamp*1000)}));
}
/* After CoinGecko: Kraken (if chosen, or for anything still unpriced / when CoinGecko failed), then
   DefiLlama for whatever is left. Returns how many prices came from the fallbacks. */
async function fillPrices(cgFailed){
  // holdings plus watched coins (priced the same way when CoinGecko is down)
  const A=state.data.assets.concat(wlItems().map(w=>({asset:w.sym, cg_id:w.id}))); state.pxSrc={}; let filled=0;
  const wantK=A.filter(a=>state.priceSource==="kraken" || cgFailed || state.prices[a.asset]==null).map(a=>a.asset);
  if(wantK.length){ try{ const k=await krakenPrices(wantK);
    for(const [x,v] of Object.entries(k)){ state.prices[x]=v.p; state.pxSrc[x]="Kraken"; filled++;
      if(state.chg24[x]==null && v.open>0) state.chg24[x]=(v.p-v.open)/v.open*100; } }catch(e){} }
  const rest=A.filter(a=>!state.pxSrc[a.asset] && (cgFailed || state.prices[a.asset]==null));
  if(rest.length){ try{ const l=await llamaPrices(rest); for(const [x,p] of Object.entries(l)){ if(p>0){ state.prices[x]=p; state.pxSrc[x]="DefiLlama"; filled++; } } }catch(e){} }
  if(filled){ state.priceTs=Date.now(); try{ localStorage.setItem("px_cache", JSON.stringify({t:state.priceTs, px:state.prices})); }catch(e){} }
  return filled;
}
/* Kraken status: a banner while Kraken reports an incident (checked at most every 10 minutes) */
async function krakenStatus(){
  if(!state.data.generated || state.demo) { $("#krakenBanner").hidden=true; return; }   // only for real Kraken imports
  let st=cacheGet("kraken_status", 10*60e3);
  if(!st){ try{ const d=await getJSON("https://status.kraken.com/api/v2/status.json");
    st={ind:d.status&&d.status.indicator, desc:d.status&&d.status.description}; cacheSet("kraken_status", st); }catch(e){ return; } }
  const dismissed=(()=>{ try{ return sessionStorage.getItem("kraken_dismissed"); }catch(e){ return null; } })();
  const show = st.ind && st.ind!=="none" && dismissed!==st.desc;
  $("#krakenBanner").hidden=!show;
  if(show) $("#krakenStatusTxt").textContent=`Kraken: ${st.desc||"service issue"}`;
}
/* market overview: Fear & Greed (daily) + Coinpaprika global (cached 1 h) */
async function loadMarket(){
  const box=$("#marketStrip"); if(!state.showMarket || !state.data.assets.length){ box.hidden=true; return; }
  let fg=cacheGet("fng", 3600e3), gl=cacheGet("cp_global", 3600e3);
  renderMarket(fg||cacheGet("fng"), gl||cacheGet("cp_global"));
  if(fg && gl) return;
  const jobs=[];
  if(!fg) jobs.push(getJSON("https://api.alternative.me/fng/?limit=30").then(d=>{ fg=(d.data||[]).map(x=>({v:+x.value, c:x.value_classification, t:+x.timestamp*1000})); if(fg.length) cacheSet("fng", fg); }).catch(()=>{}));
  if(!gl) jobs.push(getJSON("https://api.coinpaprika.com/v1/global").then(d=>{ gl={cap:d.market_cap_usd, ch:d.market_cap_change_24h, dom:d.bitcoin_dominance_percentage}; cacheSet("cp_global", gl); }).catch(()=>{}));
  await Promise.all(jobs); renderMarket(fg||cacheGet("fng"), gl||cacheGet("cp_global"));
}
function renderMarket(fg, gl){
  const box=$("#marketStrip"); if(!fg && !gl){ box.hidden=true; return; }
  box.hidden=false;
  const now=fg&&fg[0], prev=fg&&fg[1];
  const fgTone = !now ? "" : now.v<=25 ? "c-down" : now.v>=75 ? "c-up" : now.v<45 ? "c-down" : now.v>55 ? "c-up" : "c-flat";
  const cap = gl && gl.cap ? usdToEur(gl.cap) : null;
  box.innerHTML=`
    <div class="stat"><div class="k">Fear &amp; Greed</div><div class="v ${fgTone}">${now?now.v:"—"} <span class="mk-sub">${now?esc(now.c):""}</span></div>
      <div class="sub">${now&&prev?`${now.v>=prev.v?"▲":"▼"} ${Math.abs(now.v-prev.v)} vs yesterday`:"Market mood"}</div>${fg&&fg.length>2?`<span class="mk-spark">${sparkSVG(fg.slice().reverse().map(x=>x.v),60,14)}</span>`:""}</div>
    <div class="stat"><div class="k">BTC Dominance</div><div class="v">${gl&&gl.dom!=null?gl.dom.toFixed(1)+"%":"—"}</div><div class="sub">Share of market</div></div>
    <div class="stat"><div class="k">Crypto Market</div><div class="v">${cap!=null?nf({...ccyOpts(dispCcy()),notation:"compact",maximumFractionDigits:2}).format(cap*rate()):"—"}</div>
      <div class="sub ${tone(gl&&gl.ch)}">${gl&&gl.ch!=null?pct(gl.ch)+" 24h":"Total cap"}</div></div>`;
}

/* ---------- watch-only wallet addresses ----------
   Public addresses of your own wallets ("watch_addrs" in localStorage, included in backups). Their
   on-chain balance is compared with the private-wallet amount the app has recorded; a difference can
   be recorded as a holding outside Kraken in one tap, so cost basis stays explicit. Native coins only. */
const WATCH_KEY="watch_addrs", WATCH_BAL_KEY="watch_bal", WATCH_TTL=10*60e3;
const CHAINS={
  BTC:{re:/^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/, ph:"bc1q…", via:"mempool.space"},
  ETH:{re:/^0x[0-9a-fA-F]{40}$/, ph:"0x…", via:"Blockscout"},
  LTC:{re:/^(ltc1[02-9ac-hj-np-z]{11,71}|[LM3][1-9A-HJ-NP-Za-km-z]{26,33})$/, ph:"ltc1q…", via:"BlockCypher"},
  DOGE:{re:/^[DA9][1-9A-HJ-NP-Za-km-z]{25,34}$/, ph:"D…", via:"BlockCypher"},
};
const URI_COIN={bitcoin:"BTC", ethereum:"ETH", litecoin:"LTC", dogecoin:"DOGE"};
function loadWatch(){ try{ const v=JSON.parse(localStorage.getItem(WATCH_KEY)||"[]"); return Array.isArray(v) ? v.filter(w=>w && w.id && CHAINS[w.asset] && typeof w.addr==="string") : []; }catch(e){ return []; } }
function saveWatch(list){ localStorage.setItem(WATCH_KEY, JSON.stringify(list)); }
function watchBal(){ try{ return JSON.parse(localStorage.getItem(WATCH_BAL_KEY)||"{}")||{}; }catch(e){ return {}; } }
/* bech32 addresses are case-insensitive: store them lower-case; strip "bitcoin:" URIs and query strings */
function cleanAddr(s){
  let a=String(s||"").trim(), coin=null;
  const m=a.match(/^([a-z]+):(.*)$/i); if(m && URI_COIN[m[1].toLowerCase()]){ coin=URI_COIN[m[1].toLowerCase()]; a=m[2]; }
  a=a.split(/[?@/]/)[0];
  if(/^(bc1|ltc1)/i.test(a)) a=a.toLowerCase();
  return {addr:a, coin};
}
const guessCoin = a => /^0x/i.test(a) ? "ETH" : /^(bc1|1)/.test(a) ? "BTC" : /^(ltc1|L|M)/.test(a) ? "LTC" : /^D/.test(a) ? "DOGE" : null;
async function fetchAddrBalance(w){
  const a=encodeURIComponent(w.addr);
  if(w.asset==="BTC"){
    const sat=d=>d.chain_stats.funded_txo_sum-d.chain_stats.spent_txo_sum+d.mempool_stats.funded_txo_sum-d.mempool_stats.spent_txo_sum;
    try{ return sat(await getJSON("https://mempool.space/api/address/"+a))/1e8; }
    catch(e){ return sat(await getJSON("https://blockstream.info/api/address/"+a))/1e8; }
  }
  if(w.asset==="ETH"){
    const d=await getJSON("https://eth.blockscout.com/api?module=account&action=balance&address="+a);
    if(d.status!=="1" || !/^\d+$/.test(d.result||"")) throw new Error("Blockscout: "+(d.message||"no balance"));
    const wei=BigInt(d.result); return Number(wei/10n**10n)/1e8;              // 8 decimals is plenty here
  }
  const d=await getJSON(`https://api.blockcypher.com/v1/${w.asset.toLowerCase()}/main/addrs/${a}/balance`);
  if(typeof d.final_balance!=="number") throw new Error("BlockCypher: no balance");
  return d.final_balance/1e8;
}
let watchBusy=false;
/* refresh balances older than WATCH_TTL (or all when forced), one request at a time (BlockCypher allows ~3/s) */
async function refreshWatch(force){
  const list=loadWatch(); if(!list.length || watchBusy || !navigator.onLine) return;
  const bal=watchBal(), now=Date.now();
  const due=list.filter(w=>force || !bal[w.addr] || now-bal[w.addr].t>WATCH_TTL); if(!due.length) return;
  watchBusy=true;
  try{
    for(const w of due){
      try{ const u=await fetchAddrBalance(w); bal[w.addr]={u, t:Date.now()}; }
      catch(e){ bal[w.addr]={...(bal[w.addr]||{}), t:Date.now(), err:String(e.message||e).slice(0,80)}; }
    }
    const keep=new Set(list.map(w=>w.addr)); for(const k of Object.keys(bal)) if(!keep.has(k)) delete bal[k];
    try{ localStorage.setItem(WATCH_BAL_KEY, JSON.stringify(bal)); }catch(e){}
  } finally { watchBusy=false; }
  renderWatch(); if(state.openSym && CHAINS[state.openSym]) renderDetail(true);
}
/* on-chain total for one coin across its watched addresses → {u, n, missing} (missing = addresses not loaded yet / failing) */
function onChain(asset){
  const list=loadWatch().filter(w=>w.asset===asset); if(!list.length) return null;
  const bal=watchBal(); let u=0, missing=0;
  for(const w of list){ const b=bal[w.addr]; if(b && typeof b.u==="number") u+=b.u; else missing++; }
  return {u, n:list.length, missing};
}
/* recorded private-wallet units vs on-chain → a short status line, with a button when there is more on-chain */
function reconcileHTML(asset){
  const oc=!state.demo && onChain(asset); if(!oc) return "";
  if(oc.missing===oc.n) return `<p class="muted small d-note">Checking ${oc.n} watched address${oc.n===1?"":"es"}…</p>`;
  const a=state.data.assets.find(x=>x.asset===asset), rec=a ? a.offexchange_units : 0, diff=oc.u-rec;
  const tol=Math.max(1e-8, rec*1e-3), q=x=>`${fmtQty(x)} ${esc(asset)}`;
  const partial = oc.missing ? ` <span class="c-down">(${oc.missing} address${oc.missing===1?"":"es"} not loaded)</span>` : "";
  let msg, btn="";
  if(Math.abs(diff)<=tol) msg=`<span class="c-up">✓</span> On-chain balance matches your private-wallet records (${q(oc.u)}).`;
  else if(diff>0){ msg=`On-chain: ${q(oc.u)} — ${q(diff)} more than recorded.`;
    btn=`<button class="chip-btn" data-record="${esc(asset)}" data-units="${diff.toFixed(8).replace(/0+$/,"").replace(/\.$/,"")}">Record ${q(diff)}</button>`; }
  else msg=`On-chain: ${q(oc.u)} — ${q(-diff)} less than recorded. Sent from your wallet, or held at an address you haven't added?`;
  return `<div class="recon-line"><p class="small d-note">${msg}${partial}</p>${btn}</div>`;
}
function renderWatch(){
  const list=loadWatch(), bal=watchBal(), ul=$("#watchList"); if(!ul) return;
  ul.hidden=!list.length;
  ul.innerHTML=list.map(w=>{ const b=bal[w.addr];
    const amt = b && typeof b.u==="number" ? `${fmtQty(b.u)} ${esc(w.asset)}` : b && b.err ? `<span class="c-down">Couldn't load</span>` : "Loading…";
    const short=w.addr.length>18 ? w.addr.slice(0,10)+"…"+w.addr.slice(-6) : w.addr;
    return `<li><span class="me-main"><b>${amt}</b>
      <span class="muted small"><span class="mono" title="${esc(w.addr)}">${esc(short)}</span>${w.label?" · "+esc(w.label):""}${b&&b.t?" · "+relTime(b.t):""}</span></span>
      <button class="chip-btn ghost" data-unwatch="${esc(w.id)}" aria-label="Stop watching ${esc(w.asset)} address ${esc(short)}">Remove</button></li>`; }).join("");
  const coins=[...new Set(list.map(w=>w.asset))];
  $("#watchRecon").innerHTML=coins.map(c=>`<div class="watch-recon"><b class="small">${esc(c)}</b>${reconcileHTML(c)}</div>`).join("");
  renderSettingsMeta();
}
async function addWatch(ev){
  ev.preventDefault();
  const m=$("#watchMsg"); m.className="msg err";
  const {addr, coin:uriCoin}=cleanAddr($("#wfAddr").value), coin=uriCoin||$("#wfCoin").value, label=$("#wfLabel").value.trim().slice(0,30);
  if(!addr){ m.textContent="Paste a public wallet address."; $("#wfAddr").focus(); return; }
  if(/\s/.test(addr) || /^(xprv|yprv|zprv|tprv)/i.test(addr) || /^[0-9a-f]{64}$/i.test(addr)){ m.textContent="That looks like a private key or seed phrase — never enter those. Use a public receiving address."; $("#wfAddr").value=""; return; }
  if(/^[xyz]pub/i.test(addr)){ m.textContent="Extended public keys (xpub) aren't supported — add the individual addresses that hold coins."; return; }
  if(!CHAINS[coin] || !CHAINS[coin].re.test(addr)){ const g=guessCoin(addr); m.textContent = g && g!==coin && CHAINS[g].re.test(addr) ? `That looks like a ${g} address — pick ${g} as the coin.` : `That isn't a valid ${coin} address.`; $("#wfAddr").focus(); return; }
  const list=loadWatch();
  if(list.some(w=>w.asset===coin && w.addr===addr)){ m.textContent="You're already watching that address."; return; }
  list.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2,6), asset:coin, addr, ...(label?{label}:{})});
  try{ saveWatch(list); }catch(e){ m.textContent="This device's storage is full — couldn't save."; return; }
  $("#watchForm").reset(); $("#wfAddr").placeholder=CHAINS.BTC.ph;
  m.className="msg ok"; m.textContent=`Watching ${coin} address — checking its balance with ${CHAINS[coin].via}…`;
  renderWatch(); await refreshWatch(true);
  const b=watchBal()[addr];
  if(b && b.err){ m.className="msg err"; m.textContent=`Saved, but the balance couldn't be loaded right now (${b.err}). It will retry on the next refresh.`; }
  else if(b) { m.className="msg ok"; m.textContent=`Watching ${coin} address: ${fmtQty(b.u)} ${coin} on-chain.`; }
}
function removeWatch(id){
  const list=loadWatch(), w=list.find(x=>x.id===id); if(!w) return;
  if(!confirm(`Stop watching this ${w.asset} address?\n\n${w.addr}`)) return;
  saveWatch(list.filter(x=>x.id!==id)); refreshWatch(); renderWatch();
  if(state.openSym===w.asset) renderDetail(true);
  const m=$("#watchMsg"); m.className="msg ok"; m.textContent=`Stopped watching ${w.asset} address.`;
}
/* "Record 0.02 BTC": prefill the holdings-outside-Kraken form — you choose gift or bought, and the date */
function recordDifference(asset, units){
  if(state.openSym) closeDetail();
  openSection("sec-manual");
  $("#mfAsset").value=asset; $("#mfUnits").value=units; $("#mfDate").value=new Date().toISOString().slice(0,10);
  const m=$("#manualMsg"); m.className="msg"; m.textContent=`Check the date and type (gift or bought), then tap Add holding to record ${units} ${asset}.`;
  requestAnimationFrame(()=>$("#mfDate").focus());
}
/* QR scan of an address (Chrome/Android with BarcodeDetector; the button stays hidden elsewhere) */
async function scanAddress(){
  const m=$("#watchMsg"), ov=$("#scanOverlay"), video=$("#scanVideo");
  let stream=null, stop=false;
  const done=()=>{ stop=true; if(stream) stream.getTracks().forEach(t=>t.stop()); video.srcObject=null; ov.hidden=true; $("#wfScan").focus(); };
  try{
    const det=new BarcodeDetector({formats:["qr_code"]});
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}, audio:false});
    video.srcObject=stream; ov.hidden=false; await video.play(); $("#scanCancel").focus();
    $("#scanCancel").onclick=done; ov.onkeydown=e=>{ if(e.key==="Escape") done(); };
    while(!stop){
      const codes=await det.detect(video).catch(()=>[]);
      if(codes.length){ const {addr, coin}=cleanAddr(codes[0].rawValue); $("#wfAddr").value=addr;
        const c=coin||guessCoin(addr); if(c && CHAINS[c]) $("#wfCoin").value=c;
        done(); m.className="msg"; m.textContent="Address scanned — check it, then tap Watch address."; return; }
      await new Promise(r=>setTimeout(r,250));
    }
  }catch(e){ done(); m.className="msg err"; m.textContent = e && e.name==="NotAllowedError" ? "Camera access was blocked — paste the address instead." : "Couldn't start the camera — paste the address instead."; }
}

/* ---------- Bitcoin network fee (mempool.space) ----------
   What sending from your own wallet costs right now: a typical 1-input, 2-output SegWit payment is ~141 vB. */
const TX_VBYTES=141;
async function btcFeeLine(){
  const el=$("#btcFee"); if(!el) return;
  let f=cacheGet("btc_fees", 10*60e3);
  if(!f){ try{ f=await getJSON("https://mempool.space/api/v1/fees/recommended"); cacheSet("btc_fees", f); }catch(e){ f=cacheGet("btc_fees"); } }
  const px=state.prices.BTC, box=$("#btcFee"); if(!box || !f || !px) { if(box) box.hidden=true; return; }
  const eur=sat=>fmtMoney(sat*TX_VBYTES/1e8*px);
  box.hidden=false;
  box.textContent=`Sending BTC from your wallet now costs about ${eur(f.hourFee)} (within an hour) to ${eur(f.fastestFee)} (next block) — ${f.hourFee}–${f.fastestFee} sat/vB, via mempool.space.`;
}

/* ---------- live prices (Kraken WebSocket v2) ----------
   With Kraken as the price source, prices stream while the app is open and visible; UI updates are
   batched every LIVE_MS. The REST refresh keeps running as the fallback, and the socket closes when
   the app is hidden, offline, or the source changes. */
const LIVE_MS=5000;
const live={ws:null, retry:0, timer:null, flushT:null, dirty:false, ticks:0, on:false};
const liveWanted = () => state.priceSource==="kraken" && state.auto && !document.hidden && navigator.onLine && state.data.assets.length>0 && "WebSocket" in window;
async function startLive(){
  if(!liveWanted()){ stopLive(); return; }
  if(live.ws) return;
  let m; try{ m=await krakenMeta(); }catch(e){ return; }
  const syms=[...new Set(state.data.assets.map(a=>a.asset).concat(wlItems().map(w=>w.sym)))].filter(s=>m.pairs[s]);
  if(!syms.length || live.ws || !liveWanted()) return;
  const ws=new WebSocket("wss://ws.kraken.com/v2"); live.ws=ws;
  ws.onopen=()=>{ live.retry=0; ws.send(JSON.stringify({method:"subscribe", params:{channel:"ticker", symbol:syms.map(s=>s+"/EUR")}})); };
  ws.onmessage=e=>{
    let d; try{ d=JSON.parse(e.data); }catch(_){ return; }
    if(d.channel!=="ticker" || !Array.isArray(d.data)) return;
    for(const t of d.data){
      const [s, q]=String(t.symbol||"").split("/"); if(q!=="EUR" || !(t.last>0)) continue;
      state.prices[s]=t.last; (state.pxSrc||(state.pxSrc={}))[s]="Kraken";
      if(typeof t.change_pct==="number") state.chg24[s]=t.change_pct;
    }
    state.priceTs=Date.now(); state.offline=false; live.on=true; live.dirty=true;
    if(!live.flushT) live.flushT=setTimeout(flushLive, LIVE_MS);
  };
  ws.onclose=()=>{ if(live.ws===ws){ live.ws=null; live.on=false; updateFreshness();
    if(liveWanted()){ const ms=Math.min(60e3, 2000*2**live.retry++); live.timer=setTimeout(startLive, ms); } } };
  ws.onerror=()=>{ try{ ws.close(); }catch(_){} };
}
function stopLive(){
  clearTimeout(live.timer); live.timer=null;
  if(live.ws){ const ws=live.ws; live.ws=null; live.on=false; try{ ws.close(); }catch(_){} }
  if(live.flushT){ clearTimeout(live.flushT); live.flushT=null; if(live.dirty) flushLive(); }
}
function flushLive(){
  live.flushT=null; if(!live.dirty) return; live.dirty=false;
  try{ localStorage.setItem("px_cache", JSON.stringify({t:state.priceTs, px:state.prices})); }catch(e){}
  checkAlerts();
  if(!state.scrubbing) renderOverview();
  renderPortfolio(); updateFreshness();
  if(state.openSym && ++live.ticks%3===0) renderDetail(true);   // the sheet redraws its chart: every ~15 s is enough
}

/* ---------- compute ----------
   One row builder for every view, list, table and export. */
/* units counted by the valuation view: 1 = All Holdings, 3 = Invested Only */
const viewUnits = (a, view=state.view) => view===3 ? a.deployed_units : a.quantity;
function assetRow(a, view=state.view){
  const px=state.prices[a.asset], units=viewUnits(a,view), cost=a.cost_basis;
  const value = px!=null ? units*px : null;
  const unreal = value!=null ? value-cost : null;
  const ret = (cost>0 && unreal!=null) ? unreal/cost*100 : null;
  return {...a, px, units, value, cost, unreal, ret, priced: px!=null};
}
const rowsFor = (view=state.view) => state.data.assets.map(a=>assetRow(a,view));
function totals(rows){
  let v=0,c=0,u=0,any=false;
  for(const r of rows){ c+=r.cost; if(r.value!=null){v+=r.value;u+=r.unreal;any=true;} }
  return {v:any?v:null, c, u:any?u:null, ret:c>0&&any?u/c*100:null};
}
const computeForView = view => totals(rowsFor(view));
/* sort keys; rows without a value for the key (unpriced) always go last, whichever direction */
const SORT_GET = {asset:r=>r.asset, quantity:r=>r.units, cost:r=>r.cost, value:r=>r.value, unreal:r=>r.unreal, ret:r=>r.ret};
function sortedRows(rows){
  const get=SORT_GET[state.sortKey]||SORT_GET.value, dir=state.sortDir;
  return rows.slice().sort((a,b)=>{ const x=get(a), y=get(b);
    if(x==null || y==null) return (x==null)-(y==null);
    return dir*(typeof x==="string" ? x.localeCompare(y) : x-y); });
}
function filteredRows(rows){ const q=state.query.trim().toUpperCase(); return q ? rows.filter(r=>r.asset.toUpperCase().includes(q)) : rows; }
/* break-even price for an asset's TOTAL holdings (price at which value==cost) */
function breakEvenPrice(a){ return a.quantity>0 ? a.cost_basis/a.quantity : null; }
/* lifetime P/L = realized (booked) + current unrealized (All Holdings view) */
function lifetimePL(){
  const r1=computeForView(1); const realized=state.data.meta.total_realized||0;
  return { realized, unreal:r1.u, total:(r1.u!=null?r1.u:0)+realized, haveUnreal:r1.u!=null };
}
/* portfolio change over a period: value-weighted from per-asset % changes. Returns {abs,pct} in EUR. */
function portfolioChange(map){
  let valNow=0, valPrev=0, any=false;
  for(const a of state.data.assets){
    const px=state.prices[a.asset], ch=map[a.asset];
    if(px==null || ch==null) continue;
    const v=viewUnits(a)*px; const prev=v/(1+ch/100);
    valNow+=v; valPrev+=prev; any=true;
  }
  if(!any || valPrev<=0) return null;
  return { abs:valNow-valPrev, pct:(valNow-valPrev)/valPrev*100 };
}
/* biggest 24h mover among held & priced assets (by absolute %) */
function topMover24h(){
  let best=null;
  for(const a of state.data.assets){
    const ch=state.chg24[a.asset]; if(ch==null || state.prices[a.asset]==null || !(viewUnits(a)>0)) continue;
    if(!best || Math.abs(ch)>Math.abs(best.chg)) best={asset:a.asset,chg:ch};
  }
  return best;
}
function renderPeriodChips(){
  const box=$("#periodChips"); if(!box) return;
  const periods=[["24h",state.chg24],["7d",state.chg7],["30d",state.chg30]];
  box.innerHTML=periods.map(([label,map])=>{ const c=portfolioChange(map);
    return `<span class="chip"><span class="chip-k">${label}</span><span class="chip-v ${tone(c?c.pct:null)}">${c?`${arrowOf(c.pct)} ${pct(c.pct)}`:"—"}</span></span>`;
  }).join("");
}
/* allocation as a single stacked bar (by current value share) + legend; <3% folds into "Other" */
function renderAlloc(){
  const box=$("#alloc"); if(!box) return;
  const rows=state.data.assets.map(a=>{ const px=state.prices[a.asset];
    return {asset:a.asset, value: px!=null ? viewUnits(a)*px : 0}; })
    .filter(r=>r.value>0).sort((x,y)=>y.value-x.value);
  const total=rows.reduce((s,r)=>s+r.value,0);
  if(total<=0){ box.innerHTML=""; return; }
  const big=[], small=[];
  for(const r of rows){ (r.value/total>=0.03 ? big : small).push(r); }
  const otherVal=small.reduce((s,r)=>s+r.value,0);
  // colours by rank from a fixed palette, so neighbouring segments never share a hue
  const segs=big.map((r,i)=>({asset:r.asset, pct:r.value/total*100, col:`hsl(${ALLOC_HUES[i%ALLOC_HUES.length]} 68% 55%)`}));
  if(otherVal>0) segs.push({asset:"Other", pct:otherVal/total*100, col:"var(--flat)"});
  // segments and legend keys are tappable: a coin opens its sheet, "Other" opens the Portfolio list
  const tgt=s=>s.asset==="Other" ? 'data-other="1"' : `data-asset="${esc(s.asset)}"`;
  const bar=segs.map(s=>`<button class="alloc-seg" ${tgt(s)} tabindex="-1" aria-hidden="true" data-w="${s.pct.toFixed(2)}" data-c="${s.col}"></button>`).join("");
  const legend=segs.map(s=>`<button class="alloc-key" ${tgt(s)} aria-label="${esc(s.asset)} ${s.pct.toFixed(1)}%${s.asset==="Other"?", show all holdings":", open details"}"><i data-c="${s.col}"></i>${esc(s.asset)} <b>${s.pct.toFixed(1)}%</b></button>`).join("");
  box.innerHTML=`<h2 class="alloc-h">Allocation</h2><div class="alloc-bar">${bar}</div><div class="alloc-legend">${legend}</div>`;
  applyDataStyles(box);
}

/* ---------- freshness ("updated 12s ago") ---------- */
function relTime(ts){
  if(!ts) return "—";
  const s=Math.round((Date.now()-ts)/1000);
  if(s<5) return "just now";
  if(s<60) return s+"s ago";
  const m=Math.round(s/60); if(m<60) return m+"m ago";
  const h=Math.round(m/60); return h+"h ago";
}
function updateFreshness(){
  const el=$("#lastUpdated");
  if(!state.data.assets.length){ el.textContent="No data yet"; el.className="fresh-pill"; return; }
  if(!state.priceTs){ el.textContent="Syncing…"; el.className="fresh-pill syncing"; return; }
  const stale = (Date.now()-state.priceTs) > 120000; // >2 min
  if(live.on && !state.offline){ el.textContent="Live"; el.title="Prices streaming from Kraken"; el.className="fresh-pill live"; return; }
  el.textContent = (state.offline?"Offline · ":"") + relTime(state.priceTs);
  el.title = "Prices updated "+relTime(state.priceTs);
  el.className = "fresh-pill " + (state.offline ? "offline" : stale ? "stale" : "live");
}

const ALLOC_HUES=[24,212,150,282,46,330,188,0,96,250];
/* deterministic per-asset hue for avatars */
const AVATAR_HUES=[258,190,152,42,330,210,282,18,96,222];
function assetHue(sym){
  const s=String(sym||"?"); let h=0;
  for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0;
  return AVATAR_HUES[h%AVATAR_HUES.length];
}

/* ---------- overview (home) ----------
   renderOverview() shows LIVE totals. While the user scrubs the chart, renderOverview(scrub) gets a
   historical snapshot {value, cost, dateLabel, dayDelta} and the hero + stat strip show that day. */
function renderOverview(scrub){
  const t=totals(rowsFor());
  const m=state.data.meta;
  const hero=$(".ov-hero"), strip=$("#sumStats");
  // Scrubbing must not change the height of anything above the chart: a reflow moves the chart
  // out from under the pointer, which fires pointerleave and cancels the scrub. Pin the heights.
  if(scrub && !hero.classList.contains("scrubbing")){ hero.style.minHeight=hero.offsetHeight+"px"; strip.style.minHeight=strip.offsetHeight+"px"; }
  if(!scrub){ hero.style.minHeight=""; strip.style.minHeight=""; }
  hero.classList.toggle("scrubbing", !!scrub);
  const pl=$("#sumHeroPL"), hv=$("#sumHeroValue"), ltEl=$("#heroLifetime");

  if(scrub){
    const unreal = scrub.value!=null ? scrub.value-scrub.cost : null;
    hv.textContent=fmtMoney(scrub.value);
    const dd=scrub.dayDelta;
    pl.textContent = dd ? `${arrowOf(dd.d)} ${fmtMoney(Math.abs(dd.d))} (${pct(dd.p)})` : "—";
    setTone(pl, dd?dd.d:null);
    $("#sumHeroCost").textContent=fmtMoney(scrub.cost);
    ltEl.innerHTML = `<span class="lt-k">On ${esc(scrub.dateLabel)}</span> `+
      `<span class="lt-v ${tone(unreal)}">${arrowOf(unreal)} ${unreal==null?"—":fmtMoney(unreal)} vs cost basis</span>`;
    strip.innerHTML=`
      <div class="stat"><div class="k">Value on Day</div><div class="v">${fmtMoney(scrub.value)}</div>
        <div class="sub">${esc(scrub.dateLabel)}</div></div>
      <div class="stat"><div class="k">Market Move</div><div class="v ${tone(dd?dd.d:null)}">${dd?pct(dd.p):"—"}</div>
        <div class="sub">vs prior ${state.chartRange===0?"week":"day"}</div></div>
      <div class="stat"><div class="k">Cost Basis</div><div class="v">${fmtMoney(scrub.cost)}</div>
        <div class="sub">On that day</div></div>
      <div class="stat"><div class="k">P/L vs Cost</div><div class="v ${tone(unreal)}">${unreal==null?"—":fmtMoney(unreal)}</div>
        <div class="sub">${scrub.cost>0&&unreal!=null?pct(unreal/scrub.cost*100):"—"}</div></div>`;
    $("#scrubStatus").textContent=`${scrub.dateLabel}: value ${fmtMoney(scrub.value)}, P/L ${unreal==null?"—":fmtMoney(unreal)}`;
    return;
  }

  hv.textContent=fmtMoney(t.v);
  hv.classList.toggle("skeleton", t.v==null && !!state.data.assets.length);   // shimmer until first price
  pl.textContent = t.u==null?"—":`${arrowOf(t.u)} ${fmtMoney(Math.abs(t.u))} (${pct(t.ret)})`;
  setTone(pl, t.u);
  $("#sumHeroCost").textContent=fmtMoney(t.c);

  const lt=lifetimePL();
  ltEl.innerHTML = `<span class="lt-k">Lifetime</span>`+
    (lt.haveUnreal ? `<span class="lt-v ${tone(lt.total)}">${arrowOf(lt.total)} ${fmtMoney(lt.total)}</span>`
                   : `<span class="lt-v muted">—</span>`);
  // fiat cash still on Kraken isn't in the crypto value above; show it and the account total
  const cash=cashEur(), acct=$("#heroAccount");
  acct.hidden=!(cash.any && Math.abs(cash.total)>0.005);
  if(!acct.hidden) acct.innerHTML=`<span class="lt-k">Cash</span><b>${fmtMoney(cash.total)}</b>`;   // account total: Portfolio › Headline
  renderDataAge();
  const p24=portfolioChange(state.chg24);
  const mover=topMover24h();
  renderPeriodChips();
  renderAlloc();
  renderTopHoldings();
  $("#scrubStatus").textContent="";
  strip.innerHTML=`
    <div class="stat"><div class="k">Net Invested</div><div class="v">${fmtMoney(m.net_deposited)}</div>
      <div class="sub">Cash in − out</div></div>
    <div class="stat"><div class="k">24h Change</div><div class="v ${tone(p24?p24.pct:null)}">${p24?pct(p24.pct):"—"}</div>
      <div class="sub">${p24?(arrowOf(p24.abs)+" "+fmtMoneyCompact(Math.abs(p24.abs))):"live"}</div></div>
    <div class="stat"><div class="k">Realized</div><div class="v ${tone(m.total_realized)}">${fmtMoney(m.total_realized)}</div>
      <div class="sub">Already sold</div></div>
    <div class="stat"><div class="k">Top Mover</div><div class="v ${tone(mover?mover.chg:null)}">${mover?esc(mover.asset):"—"}</div>
      <div class="sub">${mover?pct(mover.chg):"—"}</div></div>`;
}

/* "your data is N days old" — the import is a snapshot; trades after it are missing until re-import */
const AGE_WARN_DAYS=14;
function dataAgeDays(){
  const g=state.data.generated; if(!g || !state.data.assets.length) return null;
  const t=Date.parse(g+"T00:00:00Z"); return isNaN(t) ? null : Math.floor((Date.now()-t)/864e5);
}
function renderDataAge(){
  const el=$("#dataAge"), d=dataAgeDays();
  el.hidden = d==null || d<AGE_WARN_DAYS;
  if(!el.hidden){
    const when=new Date(Date.parse(state.data.generated+"T00:00:00Z")).toLocaleDateString(undefined,{day:"numeric",month:"short"});
    el.querySelector(".age-txt").textContent=`Your data is from ${when} (${d} days ago). Trades since then aren't included.`;
  }
}

/* ---------- alerts ---------- */
/* Alerts: coin price (rises to / falls to, EUR target), coin 24h move (±p %), and one portfolio-total
   alert stored under PORTFOLIO_KEY (rises to / falls to, EUR, All Holdings value). */
const PORTFOLIO_KEY="__portfolio__";
function alertValue(sym, al){             // the number the alert compares, or null if unknown right now
  if(sym===PORTFOLIO_KEY) return computeForView(1).v;
  return al.dir==="move" ? (state.chg24[sym]!=null ? Math.abs(state.chg24[sym]) : null) : (state.prices[sym]??null);
}
const alertHit = (al, sym) => { if(!al) return false; const v=alertValue(sym, al); if(v==null) return false;
  return al.dir==="below" ? v<=al.p : v>=al.p; };      // "move" compares |24h %| >= p
function alertLabel(al, sym){
  const money = sym===PORTFOLIO_KEY ? fmtMoney : fmtPrice;
  return al.dir==="move" ? `Moves ±${al.p}% in 24h` : `${al.dir==="below"?"Falls to":"Rises to"} ${money(al.p)}`;
}
/* fire a notification once per crossing; re-arm when the value moves back */
function checkAlerts(){
  let changed=false;
  for(const [sym,al] of Object.entries(state.alerts)){
    if(alertValue(sym, al)==null) continue;               // no data this round: leave the alert as it was
    const hit=alertHit(al, sym);
    if(hit && !al.fired){ al.fired=true; changed=true; notifyAlert(sym, al); }
    else if(!hit && al.fired){ al.fired=false; changed=true; }
  }
  if(changed){ saveAlerts(); renderAlertsList(); }
  updateBadge();
}
async function notifyAlert(sym, al){
  const name = sym===PORTFOLIO_KEY ? "Your portfolio" : sym;
  const body = al.dir==="move" ? `${sym} moved ${pct(state.chg24[sym])} in 24h (alert at ±${al.p}%).`
    : sym===PORTFOLIO_KEY ? `${name} is ${al.dir==="below"?"at or below":"at or above"} ${fmtMoney(al.p)} (now ${fmtMoney(computeForView(1).v)}).`
    : `${sym} is ${al.dir==="below"?"at or below":"at or above"} ${fmtPrice(al.p)} (now ${fmtPrice(state.prices[sym])}).`;
  sym = sym===PORTFOLIO_KEY ? "portfolio" : sym;
  toast(body);
  if(!("Notification" in window) || Notification.permission!=="granted") return;
  try{
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if(reg && reg.showNotification) await reg.showNotification("Price alert: "+sym, {body, icon:"icons/icon-192.png", tag:"alert-"+sym});
    else new Notification("Price alert: "+sym, {body, icon:"icons/icon-192.png"});
  }catch(e){}
}

/* ---------- portfolio: list ---------- */
function renderPortfolio(){
  const rows=rowsFor(); const t=totals(rows);
  $(".hero-view-name").textContent = state.view===3 ? "Invested Only" : "All Holdings";
  $("#viewNote").textContent = state.view===3
    ? "Only the coins you paid for (excludes gifts & staking rewards)."
    : "Everything you hold, including gifts & staking rewards.";
  $("#heroValue").textContent = fmtMoney(t.v);
  const plEl=$("#heroPL");
  plEl.textContent = t.u==null ? "—" : `${arrowOf(t.u)} ${fmtMoney(Math.abs(t.u))} (${pct(t.ret)})`;
  setTone(plEl, t.u);
  $("#heroCost").textContent = fmtMoney(t.c);
  $("#sortSel").value=state.sortKey;
  const mode=state.portMode, isAct=mode==="activity";
  $("#portfolioList").hidden=mode!=="list"; $("#tablePane").hidden=mode!=="table"; $("#activityPane").hidden=!isAct;
  $("#watchPane").hidden=mode!=="list"; $("#summary").hidden=isAct; $(".controls").hidden=isAct; $(".toolbar-r").hidden=isAct;   // Activity has its own CSV export
  if(isAct){ if(!$("#activityPane").contains(document.activeElement)) renderActivity(); return; }   // don't rebuild under the user's cursor
  if(mode==="table") renderTable(rows); else { renderList(rows); renderWatchlist(); }
  renderSummaryPanel();
}
function renderList(rows){
  const box=$("#portfolioList");
  const list=sortedRows(filteredRows(rows));
  if(!list.length){ box.innerHTML=`<div class="empty muted">${rows.length?"No assets match.":"No assets yet — import your CSVs in Settings."}</div>`; return; }
  box.innerHTML=list.map(rowHTML).join("");
  applyDataStyles(box);
  applyPriceFlash();
}
function rowHTML(r){
    const al=state.alerts[r.asset];
    const hit=alertHit(al, r.asset);
    const bell = al ? `<span class="alert-badge${hit?' hit':''}" title="${esc(alertLabel(al))}">${BELL_SVG}<span class="sr-only">Price alert set${hit?", reached":""}</span></span>` : "";
    // real coin logo layered over the colored-initial fallback (fallback shows if img fails)
    const logo=state.logos[r.asset];
    const img = logo ? `<img class="h-logo" src="${esc(logo)}" alt="" loading="lazy" decoding="async"/>` : "";
    const ch=state.chg24[r.asset];
    const chSpan = ch!=null ? ` <span class="h-24h ${tone(ch)}">${pct(ch)}</span>` : "";
    const spark=sparkSVG(spark7(r.asset));
    return `<button class="hrow" data-asset="${esc(r.asset)}">
      <span class="h-ic" data-h="${assetHue(r.asset)}" aria-hidden="true">${esc(r.asset.slice(0,1).toUpperCase())}${img}</span>
      <span class="h-main">
        <span class="h-name">${esc(r.asset)}</span>
        <span class="h-sub">${r.px==null?'<span class="muted">no price</span>':fmtPrice(r.px)}${chSpan}</span>
      </span>
      ${spark?`<span class="h-spark">${spark}</span>`:""}
      <span class="h-right">
        <span class="h-val">${fmtMoneyCompact(r.value)}</span>
        <span class="h-chg ${tone(r.unreal)}">${r.unreal==null?"":(r.ret!=null?arrowOf(r.unreal)+" "+pct(r.ret):"free")}</span>
      </span>${bell}</button>`;
}
/* Overview: the three largest holdings (current view), tap to open */
function renderTopHoldings(){
  const rows=rowsFor().filter(r=>r.value!=null).sort((a,b)=>b.value-a.value).slice(0,3);
  const wrap=$("#topHoldingsWrap"); wrap.hidden=!rows.length;
  if(!rows.length) return;
  const box=$("#topHoldings"); box.innerHTML=rows.map(rowHTML).join(""); applyDataStyles(box);
}
/* subtle flash on rows whose price moved since the last render (respects reduced-motion) */
function applyPriceFlash(){
  const box=$("#portfolioList");
  for(const a of state.data.assets){
    const sym=a.asset, cur=state.prices[sym], prev=state.prevPx[sym];
    if(!REDUCE_MOTION && cur!=null && prev!=null && cur!==prev){
      const el=box.querySelector(`.hrow[data-asset="${CSS.escape(sym)}"]`);
      if(el){ const cls=cur>prev?"flash-up":"flash-down";
        el.classList.remove("flash-up","flash-down"); void el.offsetWidth; el.classList.add(cls);
        setTimeout(()=>el.classList.remove(cls),900); }
    }
    state.prevPx[sym]=cur;
  }
}

/* ---------- portfolio: table ---------- */
const COLS=[["asset","Asset"],["quantity","Quantity"],["cost","Cost Basis"],["value","Value Now"],["unreal","Profit/Loss"],["ret","Return"]];
function renderTable(rows){
  const filtered=sortedRows(filteredRows(rows));
  $("#mainTable thead").innerHTML="<tr>"+COLS.map(([k,label])=>{
    const active=state.sortKey===k;
    const sort=active?(state.sortDir<0?"descending":"ascending"):"none";
    const car=active?(state.sortDir<0?" ▾":" ▴"):"";
    return `<th scope="col" aria-sort="${sort}" class="${active?'sorted':''}"><button class="th-btn" data-sort="${k}">${label}<span aria-hidden="true">${car}</span></button></th>`;
  }).join("")+"</tr>";
  let tv=0,tc=0,tu=0,any=false;
  const body=filtered.map(r=>{
    tc+=r.cost; if(r.value!=null){tv+=r.value;tu+=r.unreal;any=true;}
    const tn=tone(r.unreal), arrow=r.unreal==null?"":(r.unreal>=0?"▲ ":"▼ ");
    const trend=r.unreal==null?"flat":(r.unreal>=0?"up":"down");
    return `<tr data-asset="${esc(r.asset)}" tabindex="0" aria-label="${esc(r.asset)} details">
      <th scope="row" class="asset-cell" data-trend="${trend}"><span class="asset-dot"></span><span class="asset-name ${tn}">${esc(r.asset)}</span></th>
      <td>${fmtQty(r.units)}</td><td>${fmtMoney(r.cost)}</td>
      <td>${r.value==null?'<span class="muted">no price</span>':fmtMoney(r.value)}</td>
      <td class="${tn}">${r.unreal==null?"—":arrow+fmtMoney(Math.abs(r.unreal))}</td>
      <td class="${tn}">${pct(r.ret)}</td></tr>`;
  }).join("");
  $("#mainTable tbody").innerHTML = body + `<tr class="totrow"><th scope="row" class="asset-cell">TOTAL</th><td></td><td>${fmtMoney(tc)}</td><td>${fmtMoney(any?tv:null)}</td>
    <td>${fmtMoney(any?tu:null)}</td><td>${pct(any&&tc>0?tu/tc*100:null)}</td></tr>`;
  updateTableFade();
}
/* Portfolio summary: collapsible sections, open state remembered ("summary_open") */
const SUM_OPEN_KEY="summary_open";
function sumOpen(){ try{ const v=JSON.parse(localStorage.getItem(SUM_OPEN_KEY)||'["headline"]'); return Array.isArray(v)?v:[]; }catch(e){ return []; } }
const SUM_CHEV='<svg class="sec-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const sumSec=(id,title,meta,body)=>`<details class="d-sec" data-sum="${id}"${sumOpen().includes(id)?" open":""}>
  <summary><span class="sec-t"><span class="sec-k">${title}</span><span class="sec-meta">${meta}</span></span>${SUM_CHEV}</summary>${body}</details>`;
function renderSummaryPanel(){
  const m=state.data.meta;
  if(!state.data.assets.length){ $("#summary").innerHTML=""; return; }
  // don't wipe a target the user is typing (live prices re-render every few seconds)
  const ae=document.activeElement; if(ae && ae.matches && ae.matches("#summary input")) return;
  const r1=computeForView(1), r3=computeForView(3);
  const ys=realizedByYear(), nSales=ys?ys.reduce((s,y)=>s+y.sales,0):0;
  $("#summary").innerHTML=
    sumSec("headline","Headline",`${fmtMoney(r1.v)} · ${pct(r1.ret)}`,`
    <div class="row"><span class="k">Invested Only · Value / Return</span><span>${fmtMoney(r3.v)} (${pct(r3.ret)})</span></div>
    <div class="row"><span class="k">All Holdings · Value / Return</span><span>${fmtMoney(r1.v)} (${pct(r1.ret)})</span></div>
    <div class="row"><span class="k">Cost Basis</span><span>${fmtMoney(r1.c)}</span></div>
    <div class="row"><span class="k">Free Coins Value (Gifts + Rewards)</span><span>${fmtMoney(r1.v!=null&&r3.v!=null?r1.v-r3.v:null)}</span></div>
    ${rewardsRow()}${cashRows(r1)}`)
  + sumSec("flows","EUR Flows",`Net deposited ${fmtMoney(m.net_deposited)}`,`
    <div class="row"><span class="k">Deposited</span><span>${fmtMoney(m.total_deposited)}</span></div>
    <div class="row"><span class="k">Withdrawn</span><span>${fmtMoney(m.total_withdrawn)}</span></div>
    <div class="row"><span class="k">Net Deposited</span><span>${fmtMoney(m.net_deposited)}</span></div>
    <div class="row"><span class="k">Realized Profit (Already Sold)</span><span>${fmtMoney(m.total_realized)}</span></div>
    ${m.total_fees_eur!=null?`<div class="row"><span class="k">Trading Fees Paid</span><span>${fmtMoney(m.total_fees_eur)}</span></div>`:""}`)
  + (ys==null && !m.total_realized ? "" : sumSec("realized","Realized by Year",
      ys==null ? "Re-import to see" : `${fmtMoney(m.total_realized)} · ${nSales} sale${nSales===1?"":"s"}`, realizedByYearHTML()))
  + (state.taxPl ? sumSec("pit38","Polish Tax (PIT-38)", pit38Meta(), pit38HTML()) : "")
  + sumSec("perf","Performance", performanceMeta(), performanceHTML())
  + sumSec("monthly","Monthly Returns", (()=>{ const r=monthlyReturns(), l=r&&r.months[r.months.length-1]; return l&&l.pct!=null ? `This month ${pct(l.pct)}` : "Gain per month"; })(), monthlyHTML())
  + (()=>{ const h=stakingSecHTML(); if(!h) return ""; const n=state.data.assets.filter(a=>stakingStats(a.asset)).length;
      return sumSec("staking","Staking Rewards", `${n} coin${n===1?"":"s"} earning`, h); })()
  + sumSec("rebal","Rebalance", rebalanceMeta(), rebalanceHTML())
  + `<div class="sum-actions"><button class="chip-btn" id="printBtn"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8V3h10v5M7 17H4v-7h16v7h-3M7 14h10v7H7z"/></svg>Print Report</button></div>`;
  if(state.taxPl) ensureNbpRates();
}
function rewardsRow(){
  let v=0, any=false;
  for(const a of state.data.assets){ const px=state.prices[a.asset]; if(px!=null && a.reward_units>0){ v+=a.reward_units*px; any=true; } }
  return any ? `<div class="row"><span class="k">Staking Rewards Received (Value Now)</span><span>${fmtMoney(v)}</span></div>` : "";
}
function cashRows(r1){
  const c=cashEur(); if(!c.any || Math.abs(c.total)<0.005) return "";
  return `<div class="row"><span class="k">Cash on Kraken</span><span>${fmtMoney(c.total)}</span></div>
    <div class="row"><span class="k">Account Value (Crypto + Cash)</span><span>${fmtMoney((r1.v||0)+c.total)}</span></div>`;
}
/* realized P/L grouped by calendar year (UTC), from the engine's per-sale records */
function realizedByYear(){
  const ev=state.data.realized_events; if(!Array.isArray(ev)) return null;
  const by=new Map();
  for(const e of ev){ const y=new Date(e.t).getUTCFullYear();
    const r=by.get(y)||{year:y, sales:0, proceeds:0, cost:0, pnl:0};
    r.sales++; r.proceeds+=e.proceeds; r.cost+=e.cost; r.pnl+=e.pnl; by.set(y,r); }
  return [...by.values()].sort((a,b)=>b.year-a.year);
}
function realizedByYearHTML(){
  const ys=realizedByYear();
  if(ys==null) return `<p class="muted small d-note">Re-import your CSVs to see realized profit per tax year.</p>`;
  if(!ys.length) return `<p class="muted small d-note">No sales yet.</p>`;
  return `<p class="muted small d-note">FIFO profit per sale (EUR, UTC calendar years).</p>
    <div class="yr-head" aria-hidden="true"><span>Year</span><span>Proceeds</span><span>Cost</span><span>P/L</span></div>
    ${ys.map(y=>`<div class="row yr-row"><span class="k">${y.year} <span class="muted">· ${y.sales} sale${y.sales===1?"":"s"}</span></span>
      <span>${fmtMoney(y.proceeds)}</span><span>${fmtMoney(y.cost)}</span><span class="${tone(y.pnl)}">${fmtMoney(y.pnl)}</span></div>`).join("")}
    <button id="exportSalesBtn" class="chip-btn yr-export">${'<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0-5-5m5 5 5-5M4 19h16"/></svg>'}Export Sales (CSV, EUR)</button>`;
}
/* ---------- Polish tax helper (PIT-38, virtual currencies) ----------
   Polish rules differ from FIFO: revenue = proceeds of crypto sold for fiat; costs = fiat spent buying
   crypto (plus sale fees), deductible in the year they were paid; costs above revenue carry forward to
   later years; crypto-to-crypto swaps are not taxable. Each EUR amount is converted at the NBP mid rate
   (table A) of the last business day before the transaction. Estimate only — not tax advice. */
const NBP_KEY="nbp_eur";
let nbpLoading=false, nbpError=null;
function nbpCache(){ try{ const c=JSON.parse(localStorage.getItem(NBP_KEY)||"null"); if(c && c.rates) return c; }catch(e){} return {rates:{}, fetched:{}}; }
function pitEvents(){
  const out=[];
  for(const e of state.data.events||[]){
    if(e.type==="buy" && e.fiat && e.eur>0) out.push({t:e.t, kind:"purchase", asset:e.asset, eur:e.eur});
    else if(e.type==="manual" && e.kind==="purchase" && e.eur>0) out.push({t:e.t, kind:"purchase", asset:e.asset, eur:e.eur, manual:true});
    else if(e.type==="sell" && e.fiat && e.gross>0){ out.push({t:e.t, kind:"sale", asset:e.asset, eur:e.gross});
      if(e.fee>0) out.push({t:e.t, kind:"fee", asset:e.asset, eur:e.fee}); }
  }
  return out.sort((a,b)=>a.t-b.t);
}
const ymd = t => new Date(t).toISOString().slice(0,10);
/* rate of the last NBP business day strictly before date d (YYYY-MM-DD) */
function nbpRateBefore(d, sorted){
  let lo=0, hi=sorted.length-1, ans=null;
  while(lo<=hi){ const mid=(lo+hi)>>1; if(sorted[mid][0]<d){ ans=sorted[mid]; lo=mid+1; } else hi=mid-1; }
  return ans;
}
async function ensureNbpRates(){
  if(nbpLoading) return;
  const ev=pitEvents(); if(!ev.length) return;
  const c=nbpCache(), thisYear=new Date().getUTCFullYear(), today=ymd(Date.now());
  const y0=new Date(ev[0].t).getUTCFullYear();
  const need=[]; for(let y=y0;y<=thisYear;y++){ const f=c.fetched[y]; if(!f || (y===thisYear && f!==today)) need.push(y); }
  if(!need.length) return;
  nbpLoading=true; nbpError=null;
  try{
    for(const y of need){
      // two half-year queries (NBP allows ≤ 367 days); the first starts in late December of the year before
      for(const [a,b] of [[`${y-1}-12-15`,`${y}-06-30`],[`${y}-07-01`, y===thisYear?today:`${y}-12-31`]]){
        if(a>today) continue;
        const r=await fetch(`https://api.nbp.pl/api/exchangerates/rates/a/eur/${a}/${b<today?b:today}/?format=json`,{cache:"no-store"});
        if(r.status===404) continue;                       // no business days in range (e.g. early January)
        if(!r.ok) throw new Error("NBP "+r.status);
        const d=await r.json(); for(const x of d.rates||[]) c.rates[x.effectiveDate]=x.mid;
      }
      c.fetched[y] = y===thisYear ? today : "done";
    }
    try{ localStorage.setItem(NBP_KEY, JSON.stringify(c)); }catch(e){}
  }catch(e){ nbpError = navigator.onLine ? "Couldn't load NBP rates — try again later." : "Offline — NBP rates are needed for the PLN figures."; }
  finally{ nbpLoading=false; }
  renderSummaryPanel();
}
function pit38Years(){
  const ev=pitEvents(); if(!ev.length) return [];
  const sorted=Object.entries(nbpCache().rates).sort((a,b)=>a[0]<b[0]?-1:1);
  const rows=[]; let missing=0;
  for(const e of ev){ const r=nbpRateBefore(ymd(e.t), sorted); if(!r){ missing++; continue; } // amounts rounded to cents/grosze first, so the worksheet adds up exactly as printed
    const eur=Math.round(e.eur*100)/100; rows.push({...e, eur, nbpDate:r[0], rate:r[1], pln:Math.round(eur*r[1]*100)/100}); }
  const by=new Map();
  for(const x of rows){ const y=new Date(x.t).getUTCFullYear(); const v=by.get(y)||{year:y, revenue:0, costs:0}; 
    if(x.kind==="sale") v.revenue+=x.pln; else v.costs+=x.pln; by.set(y,v); }
  const y0=Math.min(...by.keys()), y1=new Date().getUTCFullYear(), out=[]; let carry=0;
  for(let y=y0;y<=y1;y++){ const v=by.get(y)||{year:y, revenue:0, costs:0};
    const income=Math.max(0, v.revenue-v.costs-carry), carryOut=Math.max(0, v.costs+carry-v.revenue);
    out.push({...v, carryIn:carry, income, carryOut, tax:Math.round(income*0.19)}); carry=carryOut; }
  return {years:out.reverse(), rows, missing};
}
const pln = v => state.privacy ? MASK : nf(ccyOpts("PLN")).format(v);
const eventsOutdated = () => (state.data.events||[]).length>0 && !state.data.events.some(e=>"units" in e);
function pit38Meta(){
  if(eventsOutdated()) return "Re-import to enable";
  if(nbpLoading) return "Loading NBP rates…";
  const r=pit38Years(); if(!r.years || !r.years.length) return "No fiat purchases or sales";
  const last=r.years.find(y=>y.year<new Date().getUTCFullYear()) || r.years[0];
  return `${last.year}: income ${pln(last.income)} · tax ≈ ${pln(last.tax)}`;
}
function pit38HTML(){
  if(eventsOutdated()) return `<p class="muted small d-note">Re-import your Kraken CSVs once — this needs per-transaction amounts that older imports don't have.</p>`;
  if(nbpError) return `<p class="msg err d-note">${esc(nbpError)}</p>`;
  const r=pit38Years();
  if(!r.years || !r.years.length) return `<p class="muted small d-note">${nbpLoading?"Loading NBP exchange rates…":"No crypto bought or sold for EUR yet."}</p>`;
  const yr=y=>`<div class="pit-yr"><div class="pit-h"><b>${y.year}</b>${y.year===new Date().getUTCFullYear()?' <span class="muted small">(so far)</span>':""}<span class="pit-tax">tax ≈ ${pln(y.tax)}</span></div>
    <div class="row"><span class="k">Revenue (Przychód)</span><span>${pln(y.revenue)}</span></div>
    <div class="row"><span class="k">Costs Paid This Year</span><span>${pln(y.costs)}</span></div>
    <div class="row"><span class="k">Costs Carried from Earlier Years</span><span>${pln(y.carryIn)}</span></div>
    <div class="row"><span class="k">Income (Dochód)</span><span>${pln(y.income)}</span></div>
    <div class="row"><span class="k">Costs Carried to Next Year</span><span>${pln(y.carryOut)}</span></div></div>`;
  return `<p class="muted small d-note">Pooled costs per Polish rules for crypto: purchases count in the year paid, unused costs carry forward, swaps aren't taxed. EUR → PLN at the NBP rate of the last business day before each transaction.${r.missing?` ${r.missing} transaction(s) still need a rate.`:""}</p>
    ${r.years.map(yr).join("")}
    <button id="exportPitBtn" class="chip-btn yr-export">${'<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0-5-5m5 5 5-5M4 19h16"/></svg>'}Export Worksheet (CSV, PLN)</button>
    <p class="muted fine d-note">Estimate to help fill PIT-38 — not tax advice. Staking rewards and coins received for free aren't included; check with a tax advisor.</p>`;
}
function exportPit(){
  const r=pit38Years(); if(!r.rows) return;
  const cell=(x)=>{ let s=String(x==null?"":x);
    if(!/^-?\d+(\.\d+)?$/.test(s) && /^[=+\-@\t\r]/.test(s)) s="'"+s; return '"'+s.replace(/"/g,'""')+'"'; };
  const lines=[["Date (UTC)","Type","Asset","Amount (EUR)","NBP table date","EUR/PLN","Amount (PLN)"].map(cell).join(",")];
  for(const x of r.rows) lines.push([new Date(x.t).toISOString().slice(0,19).replace("T"," "),
    {purchase:x.manual?"Purchase (manual entry)":"Purchase (cost)", sale:"Sale (revenue)", fee:"Sale fee (cost)"}[x.kind],
    x.asset, x.eur.toFixed(2), x.nbpDate, x.rate.toFixed(4), x.pln.toFixed(2)].map(cell).join(","));
  lines.push("");
  lines.push(["Year","Revenue (PLN)","Costs this year (PLN)","Costs carried in (PLN)","Income (PLN)","Carried forward (PLN)","Tax 19% (PLN, est.)"].map(cell).join(","));
  for(const y of r.years.slice().reverse()) lines.push([y.year,y.revenue.toFixed(2),y.costs.toFixed(2),y.carryIn.toFixed(2),y.income.toFixed(2),y.carryOut.toFixed(2),y.tax].map(cell).join(","));
  download(new Blob([lines.join("\n")],{type:"text/csv"}), `pit38_worksheet_${new Date().toISOString().slice(0,10)}.csv`);
}
/* one row per sale, always in EUR (the engine's base and the usual tax currency) */
function exportSales(){
  const ev=state.data.realized_events||[];
  const cell=(x)=>{ let s=String(x==null?"":x);
    if(!/^-?\d+(\.\d+)?$/.test(s) && /^[=+\-@\t\r]/.test(s)) s="'"+s; return '"'+s.replace(/"/g,'""')+'"'; };
  const lines=[["Date (UTC)","Asset","Units sold","Proceeds (EUR)","Cost basis (EUR)","Profit/Loss (EUR)"].map(cell).join(",")];
  for(const e of ev) lines.push([new Date(e.t).toISOString().slice(0,19).replace("T"," "), e.asset, e.units,
    e.proceeds.toFixed(2), e.cost.toFixed(2), e.pnl.toFixed(2)].map(cell).join(","));
  download(new Blob([lines.join("\n")],{type:"text/csv"}), `realized_sales_${new Date().toISOString().slice(0,10)}.csv`);
}
function updateTableFade(){
  const ts=$("#tableScroll"), tw=ts&&ts.querySelector(".table-wrap");
  if(tw){ const end=tw.scrollLeft+tw.clientWidth >= tw.scrollWidth-4; ts.classList.toggle("at-end",end); }
}

/* ---------- insights: performance, benchmark, monthly returns, staking yield, rebalancing ---------- */
const YEAR_MS=365.25*DAY;
/* money-weighted annual return (XIRR) of [[t, amount]] cash flows (negative = money you put in) */
function xirr(cfs){
  if(cfs.length<2 || !cfs.some(c=>c[1]<0) || !cfs.some(c=>c[1]>0)) return null;
  const t0=cfs[0][0], f=r=>cfs.reduce((s,[t,v])=>s+v/Math.pow(1+r,(t-t0)/YEAR_MS),0);
  let lo=-0.9999, hi=100, flo=f(lo);
  if(flo*f(hi)>0) return null;
  for(let i=0;i<200;i++){ const m=(lo+hi)/2, fm=f(m); if(Math.abs(fm)<1e-6) return m; if(flo*fm<0) hi=m; else { lo=m; flo=fm; } }
  return (lo+hi)/2;
}
/* EUR deposits/withdrawals (+ purchases entered under Holdings Outside Kraken) vs today's crypto + cash */
function performance(){
  const D=state.data; if(!Array.isArray(D.flows)) return null;
  const cf=D.flows.map(([t,v])=>[t,-v]);
  for(const e of D.events||[]) if(e.type==="manual" && e.kind==="purchase" && e.eur>0) cf.push([e.t,-e.eur]);
  if(!cf.length) return null;
  cf.sort((a,b)=>a[0]-b[0]);
  const v=computeForView(1).v; if(v==null) return null;
  const now=v+(cashEur().total||0), invested=-cf.reduce((s,c)=>s+c[1],0);
  const years=(Date.now()-cf[0][0])/YEAR_MS, r=xirr(cf.concat([[Date.now(), now]]));
  return {now, invested, gain:now-invested, r, years};
}
/* the euros you put into crypto: fiat buys and entered purchases (+), fiat sales (−) */
function cryptoFlows(){
  const out=[];
  for(const e of state.data.events||[]){
    if(e.type==="buy" && e.fiat && e.eur>0) out.push([e.t, e.eur]);
    else if(e.type==="sell" && e.fiat && e.eur>0) out.push([e.t, -e.eur]);
    else if(e.type==="manual" && e.kind==="purchase" && e.eur>0) out.push([e.t, e.eur]);
  }
  return out.sort((a,b)=>a[0]-b[0]);
}
const BENCH={bitcoin:{sym:"BTC", cls:"btc"}, ethereum:{sym:"ETH", cls:"eth"}};
const benchBusy={};
/* EUR price history for a benchmark coin: weekly since your first purchase, daily for the last year (cached per day) */
async function benchHistory(id){
  const day=new Date().toISOString().slice(0,10), c=cacheGet("bench_"+id);
  if(c && c.day===day) return c.pts;
  if(benchBusy[id]) return null; benchBusy[id]=true;
  try{
    const f=cryptoFlows(), first=f.length ? f[0][0] : Date.now()-365*DAY;
    let pts=[];
    if(first<Date.now()-360*DAY){ const w=await llamaHistory(id, first-7*DAY, "1w"); if(w) pts=w; }
    const d=await llamaHistory(id, Date.now()-365*DAY, "1d");
    if(d && d.length){ const cut=d[0].t; pts=pts.filter(x=>x.t<cut).concat(d); }
    if(!pts.length) return null;
    if(!state.demo) cacheSet("bench_"+id, {day, pts});
    return pts;
  }catch(e){ return null; } finally { benchBusy[id]=false; }
}
const benchCached = id => { const c=cacheGet("bench_"+id); return c && c.pts; };
const priceAt=(pts,t)=>{ let lo=0, hi=pts.length-1, ans=pts[0];
  while(lo<=hi){ const m=(lo+hi)>>1; if(pts[m].t<=t){ ans=pts[m]; lo=m+1; } else hi=m-1; } return ans ? ans.p : null; };
/* value on each day if every euro spent on crypto had bought the benchmark coin instead (sales sell it) */
function benchSeries(pts, days){
  const f=cryptoFlows(); let u=0, j=0; const out=[];
  for(const t of days){
    while(j<f.length && f[j][0]<=t){ const p=priceAt(pts,f[j][0]); if(p>0) u=Math.max(0, u+f[j][1]/p); j++; }
    const p=priceAt(pts,t); out.push(p!=null ? u*p : null);
  }
  return out;
}
function benchNow(id){
  const pts=benchCached(id); if(!pts) return null;
  const f=cryptoFlows(); if(!f.length) return null;
  let u=0; for(const [t,v] of f){ const p=priceAt(pts,t); if(p>0) u=Math.max(0,u+v/p); }
  const live=state.prices[BENCH[id].sym]; return u*(live!=null ? live : pts[pts.length-1].p);
}
function performanceHTML(){
  const p=performance();
  if(!p) return `<p class="muted small d-note">${Array.isArray(state.data.flows)?"Needs live prices and at least one EUR deposit.":"Re-import your CSVs once to see this."}</p>`;
  const annual = p.r==null ? null : p.years>=1 ? p.r*100 : (Math.pow(1+p.r,p.years)-1)*100;
  const crypto=computeForView(1).v, rows=[];
  for(const id of Object.keys(BENCH)){ const b=benchNow(id), s=BENCH[id].sym;
    if(b==null){ benchHistory(id).then(x=>{ if(x) renderSummaryPanel(); }); rows.push(`<div class="row"><span class="k">Same Buys in ${s}</span><span class="muted">Loading…</span></div>`); continue; }
    const vs=b>0 && crypto!=null ? (crypto/b-1)*100 : null;
    rows.push(`<div class="row"><span class="k">Same Buys in ${s}</span><span>${fmtMoney(b)}${vs==null?"":` <span class="${tone(vs)} small">(you ${pct(vs)})</span>`}</span></div>`); }
  return `<div class="row"><span class="k">${p.years>=1?"Annual Return (Money-Weighted)":"Return So Far (Money-Weighted)"}</span><span class="${tone(annual)}">${annual==null?"—":pct(annual)}</span></div>
    <div class="row"><span class="k">Net Gain (Value + Cash − Net Deposited)</span><span class="${tone(p.gain)}">${fmtMoney(p.gain)}</span></div>
    ${rows.join("")}
    <p class="muted small d-note">Money-weighted return (XIRR) accounts for when you deposited${p.years>=1?", per year":` — less than a year of history, so it isn't annualized`}. "Same buys" puts every euro you spent on crypto into BTC or ETH on the same days (sales sell it), compared with your crypto value now. Gifts and rewards count as gains.</p>`;
}
function performanceMeta(){ const p=performance(); if(!p || p.r==null) return "Money-weighted return";
  const a=p.years>=1 ? p.r*100 : (Math.pow(1+p.r,p.years)-1)*100; return `${pct(a)}${p.years>=1?" a year":" so far"}`; }

/* month-by-month gain: change in unrealized P/L plus profit realized that month (deposits and buys don't count) */
let monthlyMemo=null;
function monthlyReturns(){
  const h=state.hist; if(!h) return null;
  if(monthlyMemo && monthlyMemo.h===h && monthlyMemo.all===state.histAll && monthlyMemo.d===state.data && monthlyMemo.ts===state.priceTs) return monthlyMemo.v;
  const merged={};
  for(const a of state.data.assets){ const d=h[a.asset]||[], w=(state.histAll&&state.histAll[a.asset])||[], cut=d.length?d[0].t:Infinity;
    merged[a.asset]=w.filter(x=>x.t<cut).concat(d); }
  let base=null; for(const k in merged) if(!base || merged[k].length>base.length) base=merged[k];
  let v=null;
  if(base && base.length>1){
    const dk=t=>new Date(t).toISOString().slice(0,10), byDay=new Map(); for(const x of base) byDay.set(dk(x.t),x.t);
    const days=[...byDay.values()], {value, cost}=buildSeries(merged, days, 1), mk=t=>new Date(t).toISOString().slice(0,7);
    const ends=new Map(); days.forEach((t,i)=>ends.set(mk(t),i));
    const real=new Map(); for(const e of state.data.realized_events||[]) real.set(mk(e.t),(real.get(mk(e.t))||0)+e.pnl);
    const first=value.findIndex(x=>x>0), months=[];
    if(first>=0){ let s=first;
      for(const [k,e] of ends){ if(e<first || (e===s && months.length)) continue;
        const gain=(value[e]-cost[e])-(value[s]-cost[s])+(real.get(k)||0);
        const denom=value[s]+Math.max(0,cost[e]-cost[s]);
        months.push({k, gain, pct: denom>0 ? gain/denom*100 : null}); s=e; } }
    v={months, full:!!state.histAll};
  }
  monthlyMemo={h, all:state.histAll, d:state.data, ts:state.priceTs, v}; return v;
}
function monthlyHTML(){
  const r=monthlyReturns();
  if(!r) return `<p class="muted small d-note">Appears once the price history has loaded (Overview chart).</p>`;
  if(!r.months.length) return `<p class="muted small d-note">No full month of holdings yet.</p>`;
  const heat=p=>p==null?"":p>=0?(p>=15?"hp3":p>=5?"hp2":"hp1"):(p<=-15?"hn3":p<=-5?"hn2":"hn1");
  const byY=new Map(); for(const m of r.months){ const y=m.k.slice(0,4); if(!byY.has(y)) byY.set(y,[]); byY.get(y).push(m); }
  const cur=new Date().toISOString().slice(0,7), name=k=>new Date(k+"-01T00:00:00Z").toLocaleDateString(undefined,{month:"short",timeZone:"UTC"});
  const long=k=>new Date(k+"-01T00:00:00Z").toLocaleDateString(undefined,{month:"long",year:"numeric",timeZone:"UTC"});
  return `<p class="muted small d-note">Gain each month from price moves and sales — deposits and purchases don't count. Tap a month for the amount.</p>
    ${[...byY.entries()].reverse().map(([y,ms])=>{ const tot=ms.reduce((s,m)=>s+m.gain,0), byM=Object.fromEntries(ms.map(m=>[m.k,m]));
      return `<div class="mr-year"><div class="mr-h"><b>${y}</b><span class="${tone(tot)}">${fmtMoney(tot)}</span></div><div class="mr-grid">${
        Array.from({length:12},(_,i)=>{ const k=`${y}-${String(i+1).padStart(2,"0")}`, m=byM[k];
          if(!m) return `<span class="mr-cell empty" aria-hidden="true"><span>${name(k)}</span></span>`;
          const lbl=`${long(k)}${k===cur?" (so far)":""}: ${m.pct==null?"":pct(m.pct)+", "}${fmtMoney(m.gain)}`;
          return `<button class="mr-cell ${heat(m.pct)}" data-mr="${esc(lbl)}" aria-label="${esc(lbl)}"><span>${name(k)}</span><b>${m.pct==null?"—":pct(m.pct)}</b></button>`; }).join("")
      }</div></div>`; }).join("")}
    <p class="small d-note mr-detail" id="mrDetail" aria-live="polite"></p>
    ${r.full?"":`<button class="chip-btn" id="mrFull">Load Earlier Months</button>`}`;
}

/* staking yield actually earned: rewards in the last year ÷ time-weighted average holding, annualized */
function stakingStats(asset){
  const D=state.data, ev=(D.events||[]).filter(e=>e.type==="reward" && e.asset===asset);
  if(!ev.length) return null;
  const now=Date.now(), total=ev.reduce((s,e)=>s+e.units,0);
  const gap=ev.length>1 ? (ev[ev.length-1].t-ev[0].t)/(ev.length-1) : 7*DAY;
  const start=Math.max(now-365*DAY, ev[0].t-gap), inWin=ev.filter(e=>e.t>=start).reduce((s,e)=>s+e.units,0);
  const tl=D.holdings_timeline && D.holdings_timeline[asset];
  let area=0;
  if(tl && tl.length){ let t=start, s=stepAt(tl,start), u=s?s[1]:0;
    for(const p of tl){ if(p[0]<=start) continue; area+=u*(p[0]-t); t=p[0]; u=p[1]; }
    area+=u*Math.max(0,now-t); }
  const avg=area/(now-start);
  const apy = inWin>0 && avg>0 && now-start>=14*DAY ? inWin/avg*(YEAR_MS/(now-start))*100 : null;   // no rewards this year → no yield claimed
  const d=new Date(), months=[];
  for(let i=11;i>=0;i--){ const m=new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()-i, 1));
    months.push({k:m.toISOString().slice(0,7), u:0, label:m.toLocaleDateString(undefined,{month:"short",year:"numeric",timeZone:"UTC"})}); }
  const byK=Object.fromEntries(months.map(m=>[m.k,m]));
  for(const e of ev){ const m=byK[new Date(e.t).toISOString().slice(0,7)]; if(m) m.u+=e.units; }
  return {total, apy, inWin, months, last:ev[ev.length-1].t, n:ev.length};
}
function rewardBars(months, sym){
  const max=Math.max(...months.map(m=>m.u)); if(!(max>0)) return "";
  const W=12, G=4, H=40, w=months.length*(W+G)-G;
  return `<svg class="rw-bars" viewBox="0 0 ${w} ${H+12}" role="img" aria-label="${esc(sym)} rewards per month, last 12 months">${months.map((m,i)=>{
    const h=Math.max(m.u>0?2:0, m.u/max*H); return `<rect x="${i*(W+G)}" y="${H-h}" width="${W}" height="${h}" rx="2"><title>${esc(m.label)}: ${fmtQty(m.u)} ${esc(sym)}</title></rect>`; }).join("")}
    <text x="0" y="${H+11}">${esc(months[0].label.split(" ")[0])}</text><text x="${w}" y="${H+11}" text-anchor="end">${esc(months[months.length-1].label.split(" ")[0])}</text></svg>`;
}
function stakingSecHTML(){
  const list=state.data.assets.map(a=>({a, s:stakingStats(a.asset)})).filter(x=>x.s);
  if(!list.length) return null;
  const px=s=>state.prices[s];
  return `<p class="muted small d-note">Yield you actually earned over the last 12 months: rewards ÷ your average holding (including coins not staked), annualized.</p>
    ${list.map(({a,s})=>`<div class="row"><span class="k">${esc(a.asset)} <span class="muted">· ${fmtQty(s.total)} received</span></span>
      <span>${s.apy==null?"—":`~${s.apy.toFixed(1)}% a year`} <span class="muted small">${px(a.asset)!=null?fmtMoney(s.total*px(a.asset)):""}</span></span></div>`).join("")}`;
}

/* target allocation: drift from your targets and what to buy (or sell) to get back */
const TARGET_KEY="alloc_targets";
function loadTargets(){ try{ const v=JSON.parse(localStorage.getItem(TARGET_KEY)||"null"); return v && typeof v==="object" && !Array.isArray(v) ? v : null; }catch(e){ return null; } }
function rebalanceRows(){
  const rows=rowsFor(1).filter(r=>r.value!=null && r.value>0).sort((a,b)=>b.value-a.value);
  const V=rows.reduce((s,r)=>s+r.value,0); return {rows, V};
}
function rebalanceHTML(){
  const {rows, V}=rebalanceRows();
  if(!V) return `<p class="muted small d-note">Needs live prices.</p>`;
  const tg=loadTargets(), curPct=r=>r.value/V*100;
  if(state.rebalEdit){
    const draft=state.rebalDraft||{}, val=r=>draft[r.asset]!=null ? draft[r.asset] : tg && tg[r.asset]!=null ? tg[r.asset] : Math.round(curPct(r));
    const sum=rows.reduce((s,r)=>s+(+val(r)||0),0);
    return `<p class="muted small d-note">Target share of your crypto for each coin, in %. They should add up to 100.</p>
      ${rows.map(r=>`<label class="row tg-row"><span class="k">${esc(r.asset)} <span class="muted">· now ${curPct(r).toFixed(1)}%</span></span>
        <span class="tg-in"><input type="number" inputmode="decimal" min="0" max="100" step="any" data-tg="${esc(r.asset)}" value="${esc(String(val(r)))}" aria-label="${esc(r.asset)} target percent"/>%</span></label>`).join("")}
      <div class="row"><span class="k">Total</span><span id="tgSum" class="${Math.abs(sum-100)<0.05?"c-up":"c-down"}">${+sum.toFixed(2)}%</span></div>
      <div class="btn-row"><button class="chip-btn" id="tgSave">Save Targets</button><button class="chip-btn ghost" id="tgEqual">Equal Split</button><button class="chip-btn ghost" id="tgCancel">Cancel</button></div>
      <div class="msg" id="tgMsg" role="status" aria-live="polite"></div>`;
  }
  if(!tg) return `<p class="muted small d-note">Set a target mix (for example BTC 60%, ETH 30%, SOL 10%) to see how far you've drifted and what to buy to get back.</p>
    <button class="chip-btn" id="tgEdit">Set Targets</button>`;
  const tsum=rows.reduce((s,r)=>s+(+tg[r.asset]||0),0)||100, T=r=>(+tg[r.asset]||0)/tsum*100;
  const cash=Math.max(0, cashEur().total||0), V2=V+cash;
  const need=rows.map(r=>Math.max(0, T(r)/100*V2-r.value)), needSum=need.reduce((s,x)=>s+x,0), k=needSum>0?Math.min(1,cash/needSum):0;
  const buys=rows.map((r,i)=>[r.asset, need[i]*k]).filter(([,x])=>x>=1);
  return `<div class="yr-head rb-head" aria-hidden="true"><span>Coin</span><span>Now</span><span>Target</span><span>To Target</span></div>
    ${rows.map(r=>{ const d=T(r)/100*V-r.value, drift=curPct(r)-T(r);
      return `<div class="row yr-row rb-row"><span class="k">${esc(r.asset)}</span><span>${curPct(r).toFixed(1)}%</span><span>${T(r).toFixed(1)}% <span class="small ${Math.abs(drift)>=5?"c-down":"muted"}">${drift>=0?"+":""}${drift.toFixed(1)}</span></span>
        <span class="${Math.abs(d)<1?"muted":d>0?"c-up":"c-down"}">${Math.abs(d)<1?"—":(d>0?"Buy ":"Sell ")+fmtMoney(Math.abs(d))}</span></div>`; }).join("")}
    ${cash>=1 ? `<p class="small d-note">${buys.length ? `With your ${fmtMoney(cash)} cash, buy ${buys.map(([s,x])=>`${fmtMoney(x)} ${esc(s)}`).join(", ")} — no selling needed.` : `Your ${fmtMoney(cash)} cash isn't needed: you're on target.`}</p>` : ""}
    <p class="muted fine d-note">Drift in percentage points. Ideas to rebalance, not advice; fees and taxes not included.</p>
    <div class="btn-row"><button class="chip-btn" id="tgEdit">Edit Targets</button><button class="chip-btn ghost" id="tgClear">Clear</button></div>`;
}
function rebalanceMeta(){
  const tg=loadTargets(); if(!tg) return "Not set";
  const {rows, V}=rebalanceRows(); if(!V) return "Targets set";
  const tsum=rows.reduce((s,r)=>s+(+tg[r.asset]||0),0)||100;
  const max=Math.max(...rows.map(r=>Math.abs(r.value/V*100-(+tg[r.asset]||0)/tsum*100)));
  return `Largest drift ${max.toFixed(1)} pts`;
}
function saveTargets(){
  const m=$("#tgMsg"), out={};
  for(const el of $$("#summary [data-tg]")){ const v=parseFloat(el.value); if(!(v>=0) || v>100){ m.className="msg err"; m.textContent=`Enter 0–100 for ${el.dataset.tg}.`; el.focus(); return; } if(v>0) out[el.dataset.tg]=v; }
  const sum=Object.values(out).reduce((s,x)=>s+x,0);
  if(Math.abs(sum-100)>0.05){ m.className="msg err"; m.textContent=`Targets add up to ${+sum.toFixed(2)}% — adjust them to 100%.`; return; }
  try{ localStorage.setItem(TARGET_KEY, JSON.stringify(out)); }catch(e){ m.className="msg err"; m.textContent="This device's storage is full — couldn't save."; return; }
  state.rebalEdit=false; state.rebalDraft=null; renderSummaryPanel(); toast("Targets saved");
}

/* ---------- printable report (Print → Save as PDF) ---------- */
function printReport(){
  const rows=sortedRows(rowsFor(1)), t=totals(rows), p=performance(), ys=realizedByYear()||[], when=new Date();
  const tr=c=>`<tr>${c.map(x=>`<td>${x}</td>`).join("")}</tr>`, th=c=>`<tr>${c.map(x=>`<th>${x}</th>`).join("")}</tr>`;
  const stk=state.data.assets.map(a=>({a, s:stakingStats(a.asset)})).filter(x=>x.s);
  const pit=state.taxPl ? pit38Years() : null;
  $("#printReport").innerHTML=`<h1>My Crypto — Portfolio Report</h1>
    <p>Generated ${esc(when.toLocaleString())} · amounts in ${esc(dispCcy())} · prices ${state.priceTs?esc(new Date(state.priceTs).toLocaleString()):"unavailable"}${state.data.generated?` · Kraken data imported ${esc(state.data.generated)}`:""}${state.demo?" · SAMPLE DATA":""}</p>
    <h2>Summary</h2><table>${tr(["Value",fmtMoney(t.v)])}${tr(["Cost basis",fmtMoney(t.c)])}${tr(["Unrealized profit/loss",`${fmtMoney(t.u)} (${pct(t.ret)})`])}
      ${tr(["Realized profit",fmtMoney(state.data.meta.total_realized)])}${tr(["Net deposited",fmtMoney(state.data.meta.net_deposited)])}
      ${cashEur().any?tr(["Cash on Kraken",fmtMoney(cashEur().total)]):""}
      ${p&&p.r!=null?tr([p.years>=1?"Annual return (money-weighted)":"Return so far (money-weighted)", pct(p.years>=1?p.r*100:(Math.pow(1+p.r,p.years)-1)*100)]):""}</table>
    <h2>Holdings</h2><table>${th(["Coin","Quantity","On Kraken","Private wallet","Price","Value","Cost basis","Profit/loss","Return"])}
      ${rows.map(r=>{ const a=state.data.assets.find(x=>x.asset===r.asset); return tr([esc(r.asset), fmtQty(a.quantity), fmtQty(a.exchange_units), fmtQty(a.offexchange_units), fmtPrice(r.px), fmtMoney(r.value), fmtMoney(r.cost), fmtMoney(r.unreal), pct(r.ret)]); }).join("")}</table>
    ${ys.length?`<h2>Realized by Year (EUR, FIFO)</h2><table>${th(["Year","Sales","Proceeds","Cost","Profit/loss"])}${ys.map(y=>tr([y.year,y.sales,fmtMoney(y.proceeds),fmtMoney(y.cost),fmtMoney(y.pnl)])).join("")}</table>`:""}
    ${pit&&pit.years&&pit.years.length?`<h2>Polish Tax (PIT-38) — Estimate</h2><table>${th(["Year","Revenue","Costs","Carried in","Income","Carried out","Tax 19%"])}${pit.years.map(y=>tr([y.year,pln(y.revenue),pln(y.costs),pln(y.carryIn),pln(y.income),pln(y.carryOut),pln(y.tax)])).join("")}</table>`:""}
    ${stk.length?`<h2>Staking Rewards</h2><table>${th(["Coin","Received","Value now","Yield (12 months)"])}${stk.map(({a,s})=>tr([esc(a.asset),fmtQty(s.total),fmtMoney(state.prices[a.asset]!=null?s.total*state.prices[a.asset]:null),s.apy==null?"—":s.apy.toFixed(1)+"%"])).join("")}</table>`:""}
    <p class="pr-foot">Strict-FIFO cost basis from Kraken exports. An analysis tool — not tax or investment advice.</p>`;
  if(state.privacy) toast("Privacy mode is on — amounts are hidden in the report");
  window.print();
}

/* ---------- coin sheet extras: sell preview, watchlist and trending coins ---------- */
/* what selling u Kraken-held units would realize: FIFO over the remaining lots, at the current price */
function sellPreview(a, u){
  const px=state.prices[a.asset]; if(!(u>0) || px==null || !Array.isArray(a.ex_lots)) return null;
  const uu=Math.min(u, a.exchange_units); let need=uu, cost=0;
  for(const [lu,c] of a.ex_lots){ const x=Math.min(lu,need); cost+=x*c; need-=x; if(need<=1e-12) break; }
  const proceeds=uu*px; return {u:uu, capped:u>a.exchange_units+1e-12, proceeds, cost, pnl:proceeds-cost};
}
/* the same sale in this year's PIT-38: revenue rises by the proceeds (in PLN at the latest NBP rate) */
function pitPreview(eur){
  const r=pit38Years(), y=new Date().getUTCFullYear();
  const rates=Object.entries(nbpCache().rates).sort((a,b)=>a[0]<b[0]?-1:1), rate=rates.length ? rates[rates.length-1][1] : state.fx.PLN;
  if(!rate) return null;
  const prev=r.years && r.years.find(x=>x.year===y-1);
  const cur=(r.years && r.years.find(x=>x.year===y)) || {revenue:0, costs:0, carryIn:prev?prev.carryOut:0, tax:0};
  const income=Math.max(0, cur.revenue+eur*rate-cur.costs-cur.carryIn), tax=Math.round(income*0.19);
  return {year:y, tax, delta:tax-cur.tax, income, nbp:rates.length>0};
}
function sellOutHTML(a){
  const u=parseFloat((state.sellDraft||{})[a.asset]), r=sellPreview(a,u);
  if(!r) return `<p class="muted small d-note">${state.prices[a.asset]==null?"Needs a live price.":`Enter an amount — up to ${fmtQty(a.exchange_units)} ${esc(a.asset)} on Kraken.`}</p>`;
  const ret=r.cost>0 ? r.pnl/r.cost*100 : null;
  let pit="";
  if(state.taxPl){ const p=pitPreview(r.proceeds);
    pit = p ? `<div class="d-row"><span>PIT-38 ${p.year} Tax</span><span>${p.delta>0?"+":""}${pln(p.delta)} <span class="muted small">(year ≈ ${pln(p.tax)})</span></span></div>`
      : `<p class="muted small d-note">Loading NBP rates for the PIT-38 estimate…</p>`; }
  return `<div class="d-row"><span>Proceeds</span><span>${fmtMoney(r.proceeds)}</span></div>
    <div class="d-row"><span>FIFO Cost</span><span>${fmtMoney(r.cost)}</span></div>
    <div class="d-row"><span>Realized Profit</span><span class="${tone(r.pnl)}">${fmtMoney(r.pnl)}${ret==null?"":` (${pct(ret)})`}</span></div>
    ${pit}${r.capped?`<p class="small d-note c-down">Only ${fmtQty(a.exchange_units)} ${esc(a.asset)} is on Kraken — the preview uses that amount.</p>`:""}`;
}
function updateSellOut(){ const a=state.openSym && state.data.assets.find(x=>x.asset===state.openSym), box=$("#sellOut"); if(a && box) box.innerHTML=sellOutHTML(a); }

/* Watchlist: coins you don't hold, priced with your holdings ("watchlist" = [{sym, id, name}]) */
const WL_KEY="watchlist";
function loadWL(){ try{ const v=JSON.parse(localStorage.getItem(WL_KEY)||"[]"); return Array.isArray(v) ? v.filter(w=>w && typeof w.sym==="string" && typeof w.id==="string") : []; }catch(e){ return []; } }
function saveWL(l){ localStorage.setItem(WL_KEY, JSON.stringify(l)); }
const wlItems = () => { const held=new Set(state.data.assets.map(a=>a.asset)); return loadWL().filter(w=>!held.has(w.sym)); };
/* the asset shown in the sheet: a holding, or a watched / trending coin (no quantities) */
function sheetAsset(sym){
  const a=state.data.assets.find(x=>x.asset===sym); if(a) return a;
  const x=state.sheetExtra; return x && x.asset===sym ? x : null;
}
function openCoin(c){                     // c = {sym, id, name, px?, ch?, img?} from the watchlist or Trending
  if(state.data.assets.some(a=>a.asset===c.sym)) return openDetail(c.sym);
  const watched=loadWL().some(w=>w.sym===c.sym);
  state.sheetExtra={asset:c.sym, cg_id:c.id, name:c.name, watch:watched, trend:!watched, px:c.px, ch24:c.ch, rank:c.rank,
    quantity:0, cost_basis:0, deployed_units:0, exchange_units:0, offexchange_units:0};
  if(c.img && /^https:/.test(c.img) && !state.logos[c.sym]) state.logos[c.sym]=c.img;
  openDetail(c.sym);
}
function watchDetailHTML(a, sym){
  const px=state.prices[sym]!=null ? state.prices[sym] : a.px, ch24=state.chg24[sym]!=null ? state.chg24[sym] : a.ch24;
  const al=state.alerts[sym];
  return `<div class="d-hero">
      <div class="d-val">${px==null?"—":fmtPrice(px)}</div>
      <div class="d-px"><span>${esc(a.name||sym)}${a.rank?` <span class="d-src">#${esc(String(a.rank))} by market cap</span>`:""}</span>
        ${[["24h",ch24],["7d",state.chg7[sym]],["30d",state.chg30[sym]]].map(([k,v])=>`<span class="d-chg"><span class="k">${k}</span> <span class="${tone(v)}">${pct(v)}</span></span>`).join("")}</div>
    </div>
    ${SPARK_HEAD}
    <div class="d-spark"><canvas id="sparkCanvas" role="img" aria-label="${esc(sym)} price history"></canvas></div>
    ${a.watch ? alertSecHTML(sym, al) : `<p class="muted small d-note">Add it to your watchlist to follow its price on Portfolio and set alerts.</p>`}
    <div class="btn-row">${a.watch ? `<button class="chip-btn ghost" id="wlRemove">Remove from Watchlist</button>` : `<button class="chip-btn" id="wlAddThis">Add to Watchlist</button>`}</div>`;
}
async function addToWatchlist(query){
  const m=$("#wlMsg"); m.className="msg"; const q=String(query||"").trim();
  if(!q){ m.className="msg err"; m.textContent="Enter a coin's ticker or name, e.g. ADA."; return false; }
  m.textContent="Searching CoinGecko…";
  let d; try{ d=await cgFetch(`/search?query=${encodeURIComponent(q)}`); }catch(e){ m.className="msg err"; m.textContent = cgOnCooldown() || (e && e.rate) ? "CoinGecko is rate-limiting right now — try again in a minute." : "Couldn't reach CoinGecko — check your connection and try again."; return false; }
  const coins=d.coins||[], up=q.toUpperCase();
  const hit=coins.filter(c=>String(c.symbol).toUpperCase()===up).sort((x,y)=>(x.market_cap_rank??1e9)-(y.market_cap_rank??1e9))[0] || coins[0];
  if(!hit){ m.className="msg err"; m.textContent=`No coin found for "${q}".`; return false; }
  return addWatchCoin({sym:String(hit.symbol).toUpperCase(), id:hit.id, name:hit.name});
}
function addWatchCoin(c){
  const m=$("#wlMsg");
  if(state.data.assets.some(a=>a.asset===c.sym)){ m.className="msg"; m.textContent=`You hold ${c.sym} — it's in your list above.`; return false; }
  const l=loadWL(); if(l.some(w=>w.sym===c.sym)){ m.className="msg"; m.textContent=`${c.sym} is already on your watchlist.`; return false; }
  l.push({sym:c.sym, id:c.id, name:c.name||c.sym});
  try{ saveWL(l); }catch(e){ m.className="msg err"; m.textContent="This device's storage is full — couldn't save."; return false; }
  m.className="msg ok"; m.textContent=`Added ${c.name||c.sym} (${c.sym}).`;
  renderWatchlist(); refresh(false);
  return true;
}
function removeWatchCoin(sym){
  saveWL(loadWL().filter(w=>w.sym!==sym)); delete state.alerts[sym]; saveAlerts(); renderAlertsList();
  renderWatchlist(); toast(`Removed ${sym} from your watchlist`);
}
function renderWatchlist(){
  const box=$("#wlList"); if(!box) return;
  const l=wlItems();
  if(!l.length){ box.innerHTML=`<p class="muted small wl-empty">Follow coins you don't own — their prices, changes and alerts.</p>`; return; }
  box.innerHTML=l.map(w=>{ const px=state.prices[w.sym], ch=state.chg24[w.sym], logo=state.logos[w.sym], al=state.alerts[w.sym], hit=alertHit(al, w.sym);
    return `<button class="hrow wrow" data-watch="${esc(w.sym)}">
      <span class="h-ic" data-h="${assetHue(w.sym)}" aria-hidden="true">${esc(w.sym.slice(0,1))}${logo?`<img class="h-logo" src="${esc(logo)}" alt="" loading="lazy" decoding="async"/>`:""}</span>
      <span class="h-main"><span class="h-name">${esc(w.sym)}${al?` <span class="alert-badge${hit?' hit':''}">${BELL_SVG}<span class="sr-only">Price alert set${hit?", reached":""}</span></span>`:""}</span><span class="h-sub">${esc(w.name)}</span></span>
      <span class="h-right"><span class="h-val">${px==null?"—":fmtPrice(px)}</span><span class="h-chg ${tone(ch)}">${ch==null?"":pct(ch)}</span></span></button>`; }).join("");
  applyDataStyles(box);
}

/* Trending today (CoinGecko, cached 1 h) — a strip on News */
async function loadTrending(){
  const box=$("#trendStrip"); if(!box) return;
  let t=cacheGet("cg_trending", 3600e3);
  if(!t && !cgOnCooldown()){ try{ const d=await cgFetch("/search/trending");
    t=(d.coins||[]).slice(0,10).map(({item:c})=>({id:c.id, sym:String(c.symbol||"").toUpperCase(), name:c.name, img:c.small||c.thumb||"", rank:c.market_cap_rank,
      px:c.data && c.data.price>0 ? usdToEur(c.data.price) : null, ch:c.data && c.data.price_change_percentage_24h ? c.data.price_change_percentage_24h.eur : null}));
    if(t.length) cacheSet("cg_trending", t); }catch(e){} }
  if(!t) t=cacheGet("cg_trending");
  if(!t || !t.length){ box.hidden=true; return; }
  state.trending=t; box.hidden=false;
  $("#trendList").innerHTML=t.map((c,i)=>`<button class="trend-chip" data-trend="${i}" aria-label="${esc(c.name)} (${esc(c.sym)})${c.ch!=null?", "+pct(c.ch)+" in 24 hours":""}">
    ${/^https:/.test(c.img)?`<img src="${esc(c.img)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"/>`:""}<b>${esc(c.sym)}</b><span class="${tone(c.ch)}">${c.ch==null?"":pct(c.ch)}</span></button>`).join("");
}

/* ---------- per-asset detail sheet ----------
   A modal dialog: background is made inert, focus moves in and is trapped, Escape closes,
   and focus returns to the row that opened it. */
function openDetail(sym){
  if(state.sheetExtra && state.sheetExtra.asset!==sym) state.sheetExtra=null;
  const a=sheetAsset(sym); if(!a) return;
  const sheet=$("#detailSheet");
  if(!state.openSym) state.lastFocus=document.activeElement;
  state.openSym=sym;
  renderDetail(false);
  if(!sheet.classList.contains("open")){
    sheet.hidden=false; void sheet.offsetWidth;            // reflow so the slide-in transition runs
    sheet.classList.add("open"); $("#detailBackdrop").classList.add("open");
    for(const el of $$("header.topbar, main, nav.bottom-nav")) el.inert=true;
    $("#detailClose").focus();
  }
}
/* the coins in the order the Portfolio list shows them (current view, sort and search) */
function sheetOrder(){ const l=sortedRows(filteredRows(rowsFor())).map(r=>r.asset); return l.length ? l : state.data.assets.map(a=>a.asset); }
function stepDetail(d){
  const l=sheetOrder(), i=l.indexOf(state.openSym); if(i<0 || l.length<2) return;
  const sym=l[(i+d+l.length)%l.length]; state.openSym=sym; renderDetail(false);
  $("#detailSheet").scrollTop=0; $("#detailStatus").textContent=`${sym}, ${l.indexOf(sym)+1} of ${l.length}`;
}
/* ---------- sample data (demo) ----------
   A tiny invented portfolio built through the real engine, kept in memory only: nothing is written to
   storage, and importing real data or tapping Exit leaves demo mode. */
function demoData(){
  const D=864e5, now=Date.now(), at=d=>new Date(now-d*D).toISOString().slice(0,19).replace("T"," ");
  const L=[["txid","refid","time","type","subtype","aclass","asset","amount","fee","balance"]], T=[["txid","pair","time","type","cost","fee","vol"]];
  const buy=(id,d,a,units,eur)=>{ L.push(["L"+id+"a",id,at(d),"trade","","currency","EUR",String(-eur),"0",""],["L"+id+"b",id,at(d),"trade","","currency",a,String(units),"0",""]);
    T.push([id,a+"/EUR",at(d),"buy",String(eur-eur*0.0016),String(eur*0.0016),String(units)]); };
  const sell=(id,d,a,units,eur)=>{ L.push(["L"+id+"a",id,at(d),"trade","","currency",a,String(-units),"0",""],["L"+id+"b",id,at(d),"trade","","currency","EUR",String(eur),"0",""]);
    T.push([id,a+"/EUR",at(d),"sell",String(eur),String(eur*0.0016),String(units)]); };
  L.push(["LD1","D1",at(340),"deposit","","currency","EUR","6000","0",""]);
  buy("T1",330,"BTC",0.03,1700); buy("T2",300,"ETH",0.8,2100); buy("T3",240,"SOL",6,780);
  buy("T4",150,"BTC",0.012,700); sell("T5",90,"SOL",2,330); buy("T6",40,"ETH",0.2,520);
  for(let i=0;i<10;i++) L.push(["LR"+i,"R"+i,at(300-i*28),"staking","","currency","ETH","0.002","0",""]);
  const csv=rows=>rows.map(r=>r.join(",")).join("\n")+"\n";
  const res=window.PortfolioEngine.analyze(csv([["asset","wallet","quantity"],["BTC","spot","0.042"],["ETH","spot","1.02"],["SOL","spot","4"],["EUR","spot","170"]]), csv(L), csv(T));
  res.generated=new Date().toISOString().slice(0,10); res.demo=true;
  return res;
}
function enterDemo(){
  state.demo=true; state.data=demoData(); state.prices={}; state.priceTs=null; state.hist=null; state.chartLoaded=false;
  $("#demoBanner").hidden=false; $("#dataSource").textContent="sample data (not saved)";
  switchView("overview",{instant:true}); render(); refresh(true).then(()=>loadChart(true));
}
async function exitDemo(){
  state.demo=false; $("#demoBanner").hidden=true; state.prices={}; state.priceTs=null; state.hist=null; state.chartLoaded=false;
  if(state.chart){ state.chart.destroy(); state.chart=null; }
  state.data=EMPTY_DATA; await loadBundled(); render(); refresh(true);
}
function closeDetail(){
  const sheet=$("#detailSheet"); if(!state.openSym) return;
  state.openSym=null; state.sheetExtra=null;
  sheet.classList.remove("open"); $("#detailBackdrop").classList.remove("open");
  for(const el of $$("header.topbar, main, nav.bottom-nav")) el.inert=false;
  const done=()=>{ if(!state.openSym) sheet.hidden=true; };
  if(REDUCE_MOTION) done(); else setTimeout(done, 320);
  if(state.lastFocus && document.contains(state.lastFocus)) state.lastFocus.focus();
  else { const row=$$(`[data-asset="${CSS.escape(sheet.dataset.sym||"")}"]`).find(el=>el.offsetParent!==null); if(row) row.focus(); }
}
/* (re)render the open sheet. fromRefresh: live price update — skip while the user is typing a target */
const SPARK_HEAD=`<div class="d-spark-head">
      <span class="d-sparklabel muted small"><span id="dSparkLabel"></span><span class="be-key" id="beKey" hidden>Break-Even</span></span>
      <div class="seg d-spark-range" id="dSparkRange" role="group" aria-label="Detail chart range">
        <button data-dr="7">1W</button><button data-dr="30">1M</button><button data-dr="365">1Y</button><button data-dr="0">All</button>
      </div>
    </div>`;
function alertSecHTML(sym, al){
  const CHEV='<svg class="sec-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  const open=id=>detailOpen().includes(id)?" open":"";
  const hit=alertHit(al, sym);
  const tgtInput = al && al.dir==="move" ? String(al.p) : al ? (()=>{ const v=al.p*rate(); const ab=Math.abs(v);
    const dp=ab>=1?4:Math.min(12,Math.floor(-Math.log10(ab||1))+5); return v.toFixed(dp).replace(/0+$/,'').replace(/\.$/,''); })() : "";
  const alertMeta = al ? `${esc(alertLabel(al, sym))} · <span class="${hit?'c-up':''}">${hit?"reached":"waiting"}</span>` : "Not set";
  return `<details class="d-sec" data-ds="alert"${open("alert")}>
      <summary id="dsAlertSum"><span class="sec-t" id="alertH"><span class="sec-k">Price Alert</span><span class="sec-meta">${alertMeta}</span></span>${CHEV}</summary>
      <div class="d-alert" role="group" aria-labelledby="alertH">
        <select id="alertDir" class="alert-dir" aria-label="Alert direction">
          <option value="above"${!al||al.dir==="above"?" selected":""}>Rises To</option>
          <option value="below"${al&&al.dir==="below"?" selected":""}>Falls To</option>
          <option value="move"${al&&al.dir==="move"?" selected":""}>Moves ±% in 24h</option>
        </select>
        <input type="number" inputmode="decimal" step="any" min="0" id="alertInput" class="alert-input" aria-label="${al&&al.dir==="move"?"Percent move in 24 hours":"Target price in "+dispCcy()}" placeholder="${al&&al.dir==="move"?"Percent, e.g. 10":"Target ("+dispCcy()+")"}" value="${tgtInput}"/>
        <button id="alertSet" class="chip-btn">${al?"Update":"Set"}</button>
        ${al?'<button id="alertClear" class="chip-btn ghost">Clear</button>':""}
      </div>
      <p class="muted fine d-note">Checked on each price refresh; notifies while the app is open if allowed (iPhone: Home Screen app, iOS 16.4+).</p>
    </details>`;
}
function renderDetail(fromRefresh){
  const sym=state.openSym; const a=sym&&sheetAsset(sym); if(!a) return;
  const ae=document.activeElement;
  if(fromRefresh && ae && ["alertInput","alertDir","sellUnits"].includes(ae.id)) return;   // user is typing
  // remember focus inside the body so a live re-render doesn't drop it to <body>
  const focusKey = ae && $("#detailBody").contains(ae) ? (ae.id ? "#"+ae.id : ae.dataset.dr ? `[data-dr="${ae.dataset.dr}"]` : null) : null;
  $("#detailSheet").dataset.sym=sym;
  const multi=!a.watch && !a.trend && sheetOrder().length>1; $("#detailPrev").hidden=!multi; $("#detailNext").hidden=!multi;
  if(a.watch || a.trend){
    $("#detailTitle").textContent=sym; $("#detailBody").innerHTML=watchDetailHTML(a, sym);
    markActive("#dSparkRange button", b=>+b.dataset.dr===state.detailRange);
    if(focusKey){ const el=$("#detailBody "+focusKey); if(el) el.focus(); }
    drawSparkline(a, fromRefresh); return;
  }
  const px=state.prices[sym];
  const totalVal = px!=null ? a.quantity*px : null;
  const depVal   = px!=null ? a.deployed_units*px : null;
  const freeUnits= a.quantity - a.deployed_units;
  const freeVal  = px!=null ? freeUnits*px : null;
  const unreal   = totalVal!=null ? totalVal-a.cost_basis : null;
  const ret      = a.cost_basis>0&&unreal!=null?unreal/a.cost_basis*100:null;
  const avg      = a.quantity?a.cost_basis/a.quantity:0;
  const bep      = breakEvenPrice(a);
  const toBreakeven = (px!=null && bep!=null) ? (bep-px)/px*100 : null;
  const aboveBE  = px!=null && bep!=null ? px>=bep : null;
  const tier=ratioTier(px!=null&&a.cost_basis>0?totalVal/a.cost_basis:(a.cost_basis===0&&totalVal>0?2:null));
  const al=state.alerts[sym];
  const hit=alertHit(al, sym);
  const tgtInput = al && al.dir==="move" ? String(al.p) : al ? (()=>{ const v=al.p*rate(); const ab=Math.abs(v);
    const dp=ab>=1?4:Math.min(12,Math.floor(-Math.log10(ab||1))+5); return v.toFixed(dp).replace(/0+$/,'').replace(/\.$/,''); })() : "";
  const ch7=state.chg7[sym], ch30=state.chg30[sym];

  const ch24=state.chg24[sym];
  const manualU=loadEntries().filter(e=>e.asset===a.asset).reduce((s,e)=>s+e.units,0);
  const CHEV='<svg class="sec-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  const open=id=>detailOpen().includes(id)?" open":"";
  const row=(k,u,val)=>`<div class="d-row"><span>${k}</span><span>${fmtQty(u)}${val===undefined?"":" · "+fmtMoney(px!=null?u*px:null)}</span></div>`;
  const beSub = aboveBE==null ? "" : aboveBE ? `<span class="c-up">▲ Above</span>`
    : `<span class="c-down">▼ Needs +${toBreakeven.toFixed(1)}%</span>`;
  const holdMeta=`${fmtQty(a.quantity)} ${esc(sym)}`+(freeUnits>1e-12?` · ${fmtQty(freeUnits)} free`:"")+(a.offexchange_units>0?` · ${fmtQty(a.offexchange_units)} in wallet`:"");
  const alertMeta = al ? `${esc(alertLabel(al, sym))} · <span class="${hit?'c-up':''}">${hit?"reached":"waiting"}</span>` : "Not set";

  $("#detailTitle").textContent=sym;
  $("#detailBody").innerHTML=`
    <div class="d-hero ${tier}">
      <div class="d-val">${fmtMoney(totalVal)}</div>
      <div class="d-pl ${tone(unreal)}">${arrowOf(unreal)} ${unreal==null?"—":fmtMoney(unreal)} (${pct(ret)})</div>
      <div class="d-px"><span>${px==null?"No live price":fmtPrice(px)}${state.pxSrc&&state.pxSrc[sym]?` <span class="d-src">via ${esc(state.pxSrc[sym])}</span>`:""}</span>
        ${[["24h",ch24],["7d",ch7],["30d",ch30]].map(([k,v])=>`<span class="d-chg"><span class="k">${k}</span> <span class="${tone(v)}">${pct(v)}</span></span>`).join("")}</div>
    </div>
    ${SPARK_HEAD}
    <div class="d-spark"><canvas id="sparkCanvas" role="img" aria-label="${esc(sym)} price history"></canvas></div>
    <div class="d-grid">
      <div class="d-cell"><div class="k">Avg Buy Price</div><div class="v">${a.deployed_units>1e-12?fmtPrice(a.cost_basis/a.deployed_units):"—"}</div><div class="sub muted">Per coin paid for</div></div>
      <div class="d-cell"><div class="k">Cost Basis</div><div class="v">${fmtMoney(a.cost_basis)}</div></div>
      <div class="d-cell"><div class="k">Break-Even</div><div class="v">${bep==null?"—":fmtPrice(bep)}</div><div class="sub">${beSub}</div></div>
      <div class="d-cell"><div class="k">Realized Profit</div><div class="v ${a.realized?tone(a.realized):""}">${fmtMoney(a.realized)}</div></div>
    </div>
    <details class="d-sec" data-ds="hold"${open("hold")}>
      <summary id="dsHoldSum"><span class="sec-t"><span class="sec-k">Holdings</span><span class="sec-meta">${holdMeta}</span></span>${CHEV}</summary>
      ${row("Invested (Paid For)", a.deployed_units, 1)}
      ${row("Free Coins (Gifts + Rewards)", freeUnits, 1)}
      ${a.reward_units>0?row("&nbsp;· Staking Rewards", a.reward_units, 1):""}
      ${a.gift_units>0?row("&nbsp;· Gifts / Free Deposits", a.gift_units, 1):""}
      ${a.offexchange_units>0?row("On Kraken", a.exchange_units, 1)+row("In Private Wallet", a.offexchange_units, 1):""}
      ${manualU>0?`<p class="muted small d-note">Includes ${fmtQty(manualU)} ${esc(sym)} you added under Settings › Holdings Outside Kraken.</p>`:""}
      ${reconcileHTML(sym)}
      ${sym==="BTC" && (a.offexchange_units>0 || onChain("BTC")) ? '<p class="muted small d-note" id="btcFee" hidden></p>' : ""}
    </details>
    ${(()=>{ const st=stakingStats(sym); if(!st) return "";
      return `<details class="d-sec" data-ds="stake"${open("stake")}>
      <summary><span class="sec-t"><span class="sec-k">Staking</span><span class="sec-meta">${st.apy==null?"Rewards received":`~${st.apy.toFixed(1)}% a year earned`}</span></span>${CHEV}</summary>
      ${row("Rewards Received", st.total, 1)}
      ${row("Last 12 Months", st.inWin, 1)}
      <div class="d-row"><span>Last Reward</span><span>${new Date(st.last).toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"})}</span></div>
      ${rewardBars(st.months, sym)}
      <p class="muted small d-note">Yield = the last 12 months' rewards ÷ your average ${esc(sym)} holding (including coins not staked), annualized.</p>
    </details>`; })()}
    ${a.exchange_units>0 && Array.isArray(a.ex_lots) ? `<details class="d-sec" data-ds="sell"${open("sell")}>
      <summary><span class="sec-t"><span class="sec-k">Sell Preview</span><span class="sec-meta">What a sale would realize</span></span>${CHEV}</summary>
      <div class="sell-in"><input type="number" inputmode="decimal" step="any" min="0" id="sellUnits" class="alert-input" aria-label="Amount of ${esc(sym)} to sell" placeholder="Amount of ${esc(sym)}" value="${esc((state.sellDraft||{})[sym]||"")}"/>
        <div class="seg seg-sm" id="sellPct" role="group" aria-label="Share of your Kraken ${esc(sym)}"><button data-sp="25">25%</button><button data-sp="50">50%</button><button data-sp="100">All</button></div></div>
      <div id="sellOut">${sellOutHTML(a)}</div>
      <p class="muted fine d-note">Coins on Kraken only, sold oldest first (FIFO) at the current price, before fees. A preview, not advice.</p>
    </details>` : ""}
    ${(()=>{ const n=(state.data.events||[]).filter(e=>e.asset===sym && "units" in e).length;
      return n ? `<details class="d-sec" data-ds="tx"${open("tx")}>
      <summary id="dsTxSum"><span class="sec-t"><span class="sec-k">Transactions</span><span class="sec-meta">${n} recorded</span></span>${CHEV}</summary>
      <div class="tx-list" id="txList"></div></details>` : ""; })()}
    ${alertSecHTML(sym, al)}`;
  markActive("#dSparkRange button", b=>+b.dataset.dr===state.detailRange);
  renderTxList(); btcFeeLine();
  if(focusKey){ const el=$("#detailBody "+focusKey); if(el) el.focus(); }
  drawSparkline(a, fromRefresh);
}
/* ---------- Activity: every transaction, filterable, with your own notes ("tx_notes" = {key: text}) ---------- */
const NOTES_KEY="tx_notes", ACT_PAGE=50;
const txKey = e => `${e.t}|${e.asset}|${e.type}|${Number(e.units).toPrecision(12)}`;
function txNotes(){ try{ const v=JSON.parse(localStorage.getItem(NOTES_KEY)||"{}"); return v && typeof v==="object" ? v : {}; }catch(e){ return {}; } }
const txLabel=e=>({buy:e.via?`Swapped from ${esc(e.via)}`:"Bought", sell:e.via?`Swapped to ${esc(e.via)}`:"Sold",
  deposit:e.gift?"Deposited (Free)":"Deposited", withdrawal:"To Private Wallet", reward:"Staking Reward",
  manual:e.kind==="gift"?"Gift (Entered)":"Bought Elsewhere (Entered)"}[e.type]||esc(e.type));
const txCat = e => (e.type==="buy"||e.type==="sell") && e.via ? "swap" : e.type;
const ACT_TYPES=[["","All Types"],["buy","Buys"],["sell","Sales"],["swap","Swaps"],["reward","Staking Rewards"],["deposit","Deposits"],["withdrawal","To Private Wallet"],["manual","Entered"]];
const act={coin:"", type:"", year:"", q:"", shown:ACT_PAGE, edit:null};
function actEvents(){
  const notes=txNotes(), q=act.q.trim().toLowerCase();
  return (state.data.events||[]).filter(e=>"units" in e
    && (!act.coin || e.asset===act.coin) && (!act.type || txCat(e)===act.type)
    && (!act.year || String(new Date(e.t).getUTCFullYear())===act.year)
    && (!q || e.asset.toLowerCase().includes(q) || (notes[txKey(e)]||"").toLowerCase().includes(q) || (e.via||"").toLowerCase().includes(q)))
    .sort((a,b)=>b.t-a.t);
}
function renderActivity(){
  const ev=state.data.events||[], all=ev.filter(e=>"units" in e);
  const coins=[...new Set(all.map(e=>e.asset))].sort(), years=[...new Set(all.map(e=>String(new Date(e.t).getUTCFullYear())))].sort().reverse();
  const opt=(v,l,cur)=>`<option value="${esc(v)}"${v===cur?" selected":""}>${esc(l)}</option>`;
  $("#actCoin").innerHTML=opt("","All Coins",act.coin)+coins.map(c=>opt(c,c,act.coin)).join("");
  $("#actType").innerHTML=ACT_TYPES.map(([v,l])=>opt(v,l,act.type)).join("");
  $("#actYear").innerHTML=opt("","All Years",act.year)+years.map(y=>opt(y,y,act.year)).join("");
  const list=actEvents(), notes=txNotes(), shown=Math.min(list.length, act.shown);
  $("#actCount").textContent = !all.length ? "" : `${list.length} transaction${list.length===1?"":"s"}${list.length!==all.length?` of ${all.length}`:""}`;
  if(!all.length){ $("#actList").innerHTML=`<p class="muted small">${ev.length?"Re-import your CSVs once to see the transaction history.":"No transactions yet."}</p>`; $("#actExport").hidden=true; return; }
  $("#actExport").hidden=!list.length;
  const amt=e=>e.eur==null ? "" : e.via ? `<span class="muted">cost ${fmtMoney(e.eur)}</span>` : fmtMoney(e.eur);
  $("#actList").innerHTML = list.slice(0,shown).map(e=>{ const k=txKey(e), note=notes[k], sign=["buy","deposit","manual","reward"].includes(e.type)?"+":"−";
    const editing=act.edit===k;
    return `<div class="tx act-row" data-k="${esc(k)}"><span class="tx-l"><span class="tx-k">${txLabel(e)} <span class="muted">${esc(e.asset)}</span></span>
        <span class="muted small">${new Date(e.t).toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"})}</span>
        ${editing ? `<span class="act-edit"><input class="act-note-in" maxlength="120" value="${esc(note||"")}" aria-label="Note for this transaction" placeholder="e.g. DCA, gift from Dad"/><button class="chip-btn" data-note-save>Save</button>${note?'<button class="chip-btn ghost" data-note-del>Delete</button>':""}</span>`
          : `${note?`<span class="tx-note small">${esc(note)}</span>`:""}<button class="link-btn act-note-btn" data-note-edit>${note?"Edit Note":"Add Note"}</button>`}</span>
      <span class="tx-r"><span class="${sign==="+"?"c-up":""}">${sign}${fmtQty(e.units)}</span><span class="small">${amt(e)}</span></span></div>`; }).join("")
    + (shown<list.length ? `<button class="chip-btn act-more" id="actMore">Show ${Math.min(ACT_PAGE, list.length-shown)} More</button>` : "")
    + (list.length ? "" : `<p class="muted small">No transactions match these filters.</p>`);
  if(act.edit){ const i=$("#actList .act-note-in"); if(i) i.focus(); }
}
function saveNote(k, text){
  const n=txNotes(); if(text) n[k]=text.slice(0,120); else delete n[k];
  try{ localStorage.setItem(NOTES_KEY, JSON.stringify(n)); }catch(e){ toast("This device's storage is full — couldn't save the note"); return; }
  act.edit=null; renderActivity();
  const row=$(`#actList .act-row[data-k="${CSS.escape(k)}"] [data-note-edit]`); if(row) row.focus();
}
function exportActivity(){
  const notes=txNotes(), cell=x=>{ let s=String(x==null?"":x); if(!/^-?\d+(\.\d+)?$/.test(s) && /^[=+\-@\t\r]/.test(s)) s="'"+s; return '"'+s.replace(/"/g,'""')+'"'; };
  const plain=h=>h.replace(/<[^>]+>/g,"").replace(/&amp;/g,"&");
  const lines=[["Date (UTC)","Type","Asset","Units","EUR","Other coin","Note"].map(cell).join(",")];
  for(const e of actEvents()) lines.push([new Date(e.t).toISOString().slice(0,19).replace("T"," "), plain(txLabel(e)), e.asset, e.units, e.eur!=null?e.eur.toFixed(2):"", e.via||"", notes[txKey(e)]||""].map(cell).join(","));
  download(new Blob([lines.join("\n")],{type:"text/csv"}), `transactions_${new Date().toISOString().slice(0,10)}.csv`);
}
/* transaction history for the open coin — built only while its section is open; newest first */
const TX_PAGE=15;
function renderTxList(more){
  const box=$("#txList"); if(!box || !box.closest("details").open){ if(box) box.innerHTML=""; return; }
  const sym=state.openSym, all=(state.data.events||[]).filter(e=>e.asset===sym && "units" in e).sort((a,b)=>b.t-a.t);
  const shown=more ? all.length : Math.min(all.length, Math.max(TX_PAGE, box.querySelectorAll(".tx").length));
  const label=txLabel;
  const amt=e=>e.eur==null ? "" : e.via ? `<span class="muted">cost ${fmtMoney(e.eur)}</span>` : fmtMoney(e.eur);
  const notes=txNotes();
  box.innerHTML=all.slice(0,shown).map(e=>{ const sign=["buy","deposit","manual","reward"].includes(e.type)?"+":"−", note=notes[txKey(e)];
    return `<div class="tx"><span class="tx-l"><span class="tx-k">${label(e)}</span><span class="muted small">${new Date(e.t).toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"})}</span>${note?`<span class="tx-note small">${esc(note)}</span>`:""}</span>
      <span class="tx-r"><span class="${sign==="+"?"c-up":""}">${sign}${fmtQty(e.units)}</span><span class="small">${amt(e)}</span></span></div>`; }).join("")
    + (shown<all.length ? `<button class="link-btn tx-more" id="txMore">Show All ${all.length}</button>` : "");
}
const DETAIL_OPEN_KEY="detail_open";
function detailOpen(){ try{ const v=JSON.parse(localStorage.getItem(DETAIL_OPEN_KEY)||"[]"); return Array.isArray(v)?v:[]; }catch(e){ return []; } }
function saveDetailOpen(){ try{ localStorage.setItem(DETAIL_OPEN_KEY, JSON.stringify($$("#detailBody .d-sec").filter(d=>d.open).map(d=>d.dataset.ds))); }catch(e){} }
async function setAlert(sym){
  const raw=parseFloat($("#alertInput").value);
  if(isNaN(raw)||raw<=0){ toast("Enter a value above zero"); return; }
  const dir=["below","move"].includes($("#alertDir").value) ? $("#alertDir").value : "above";
  const al={p: dir==="move" ? raw : raw/rate(), dir, fired:false};
  if(dir==="move" && raw>1000){ toast("Enter a percentage up to 1000"); return; }
  al.fired=alertHit(al, sym);                    // already past the target: show "reached", don't notify
  state.alerts[sym]=al; saveAlerts();
  renderPortfolio(); renderDetail(false); renderAlertsList(); $("#alertSet").focus();
  // permission prompt only from this user gesture, after the UI already shows the alert (an unanswered
  // prompt must not hold the update back)
  if("Notification" in window && Notification.permission==="default"){ try{ await Notification.requestPermission(); }catch(e){} }
}
const SPARK_PLACEHOLDER='<div class="muted small spark-ph">Price history loads…</div>';
const SPARK_CANVAS='<canvas id="sparkCanvas"></canvas>';
/* daily closes for the detail chart, honoring state.detailRange. Falls back to a direct fetch. */
function sparkPoints(a){
  if(state.detailRange===0){ const w=state.histAll&&state.histAll[a.asset]; return w&&w.length>=2 ? w.map(x=>x.p) : null; }
  const h=state.hist&&state.hist[a.asset];
  if(h&&h.length>=2){ const arr=h.slice(-state.detailRange); return arr.length>=2 ? arr.map(x=>x.p) : null; }
  const pts=state.sparks[a.asset];
  return (pts&&pts.length>=2)?pts.slice(-state.detailRange):null;
}
async function fetchSpark(a){
  try{
    let arr;
    try{ const d=await cgFetch(`/coins/${encodeURIComponent(a.cg_id)}/market_chart?vs_currency=eur&days=365&interval=daily`); arr=(d.prices||[]).map(p=>p[1]); }
    catch(e){ const h=await llamaHistory(a.cg_id, Date.now()-365*DAY, "1d"); arr=h?h.map(x=>x.p):[]; }   // DefiLlama fallback
    if(arr.length<2) return null;
    state.sparks[a.asset]=arr; return arr.slice(-state.detailRange);
  }catch(e){ return null; }
}
const DR_LABEL={7:"7-Day",30:"30-Day",365:"1-Year",0:"Full-History"};
async function drawSparkline(a, quiet){
  if(!window.Chart) return;
  const canvas=$("#sparkCanvas"); if(!canvas) return;
  const box=canvas.parentElement;
  const lbl=$("#dSparkLabel"); if(lbl) lbl.textContent=(DR_LABEL[state.detailRange]||"")+" Price";
  let pts=sparkPoints(a);
  if(!pts){
    box.innerHTML=SPARK_PLACEHOLDER;
    if(!a.cg_id) return;
    if(state.detailRange===0){ await loadAllHistory(); pts=sparkPoints(a); } else pts=await fetchSpark(a);
    if(!pts) return;                                        // failure keeps the placeholder
    if(state.openSym!==a.asset) return;                     // sheet moved on to another asset
    box.innerHTML=SPARK_CANVAS;
  }
  const cv=$("#sparkCanvas"); if(!cv) return;
  if(state.detailChart){ try{state.detailChart.destroy();}catch(e){} }
  const up=pts[pts.length-1]>=pts[0];
  // your break-even price as a dashed line, when it's within reach of the visible range
  const be=a.quantity>0 ? breakEvenPrice(a) : null, mn=Math.min(...pts), mx=Math.max(...pts);
  const showBE = be>0 && be<=mx*1.6 && be>=mn/1.6, bk=$("#beKey");
  if(bk){ bk.hidden=!(be>0); bk.textContent = be>0 ? `Break-Even ${fmtPrice(be)}${showBE?"":" (off chart)"}` : ""; bk.classList.toggle("off", !showBE); }
  state.detailChart=new Chart(cv.getContext("2d"),{type:"line",data:{labels:pts.map((_,i)=>i),
    datasets:[{data:pts,borderColor:up?"#16C784":"#EA3943",borderWidth:2,pointRadius:0,tension:.3,fill:false},
      ...(showBE ? [{data:pts.map(()=>be),borderColor:"#8A90A0",borderDash:[4,4],borderWidth:1.25,pointRadius:0,fill:false}] : [])]},
    options:{responsive:true,maintainAspectRatio:false,animation:(REDUCE_MOTION||quiet)?false:{duration:300},
      plugins:{legend:{display:false},tooltip:{enabled:false}},scales:{x:{display:false},y:{display:false}}}});
}

/* ---------- 365-day chart (cache-first) ---------- */
/* One history entry, overwritten in place. Older builds wrote a new "hist_YYYY-MM-DD" key every
   day and never removed them, which eventually fills localStorage — purge those on load. */
const HIST_KEY="hist_cache";
function loadHistCache(){
  try{
    const old=[]; for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i);
      if(/^hist_\d{4}-\d{2}-\d{2}$/.test(k)) old.push(k); }
    old.sort();                                            // newest last
    const newest = old.length ? localStorage.getItem(old[old.length-1]) : null;
    for(const k of old) localStorage.removeItem(k);        // free space first: storage may be full
    if(newest && localStorage.getItem(HIST_KEY)==null) localStorage.setItem(HIST_KEY, newest);
    return JSON.parse(localStorage.getItem(HIST_KEY)||"null");
  }catch(e){ return null; }
}
/* one history load at a time; a call that arrives mid-load re-runs once afterwards */
let chartLoading=false, chartAgain=false;
async function loadChart(background){
  if(!window.Chart){ setTimeout(()=>loadChart(background),300); return; }
  if(!state.data.assets.length) return;
  if(chartLoading){ chartAgain=chartAgain||background; return; }
  chartLoading=true;
  try{ await loadChartOnce(background); }
  finally{ chartLoading=false; if(chartAgain){ chartAgain=false; loadChart(true); } }
}
async function loadChartOnce(background){
  const today=new Date().toISOString().slice(0,10);
  let hist=state.hist;
  if(!hist) hist=loadHistCache();
  if(hist){ state.hist=hist; drawChart(hist); }           // show cached instantly (even if from an earlier day)
  // Only fetch history when we genuinely need to:
  //  - never when offline, or while CoinGecko is on 429 cooldown
  //  - each asset at most once per calendar day (per-asset stamp), so tab opens don't refetch
  if(!navigator.onLine) return;
  let stamps={}; try{ const v=JSON.parse(localStorage.getItem("hist_fetched")||"{}"); if(v && typeof v==="object") stamps=v; }catch(e){}
  const need=state.data.assets.filter(a=>a.cg_id && !(hist && hist[a.asset] && stamps[a.asset]===today));
  if(!need.length) return;                                 // fresh for today — done
  if(hist && !background) return;                         // have data, foreground open — don't spend calls
  const fresh={};
  for(const a of need){
    try{
      if(cgOnCooldown()) throw Object.assign(new Error("cg cooldown"),{cooldown:true});
      const d=await cgFetch(`/coins/${encodeURIComponent(a.cg_id)}/market_chart?vs_currency=eur&days=365&interval=daily`);
      fresh[a.asset]=(d.prices||[]).map(p=>({t:p[0],p:p[1]}));
      stamps[a.asset]=today;
      await new Promise(res=>setTimeout(res,350));
    }catch(e){
      // CoinGecko throttled or failed for this coin: one year of daily prices from DefiLlama instead
      try{ const h=await llamaHistory(a.cg_id, Date.now()-365*DAY, "1d"); if(h && h.length>1){ fresh[a.asset]=h; stamps[a.asset]=today; } }catch(_){}
    }
  }
  if(Object.keys(fresh).length){
    // merge (a partial fetch shouldn't wipe assets we already had)
    state.hist=Object.assign({}, state.hist||{}, fresh);
    if(!state.demo){ try{ localStorage.setItem(HIST_KEY,JSON.stringify(state.hist)); localStorage.setItem("hist_fetched",JSON.stringify(stamps)); }catch(e){} }
    drawChart(state.hist);
    if(state.portMode==="list") renderPortfolio();        // sparklines come from the same history
  }
  else if(!hist){ $("#chartStats").innerHTML='<div class="stat"><div class="k">Chart</div><div class="v">Unavailable</div></div>'; }
}
/* step lookup into an engine timeline sorted by t: last entry at or before t (or null) */
function stepAt(tl, t){
  let lo=0, hi=tl.length-1, ans=null;
  while(lo<=hi){ const mid=(lo+hi)>>1; if(tl[mid][0]<=t){ ans=tl[mid]; lo=mid+1; } else hi=mid-1; }
  return ans;
}
/* Portfolio value per day. With the engine's holdings timeline (CSV imports from this version on),
   each day uses the units you actually held that day; older data falls back to today's holdings.
   Holdings are scaled so the newest point ties to the current quantity (absorbs the engine's
   zero-cost residual). `mkt` is the pure market move: yesterday's holdings at today's prices. */
function buildSeries(hist, days, view=state.view){
  const D=state.data, ht=D.holdings_timeline, idx=view===3?2:1;
  const dayKey=t=>new Date(t).toISOString().slice(0,10);
  const per=D.assets.map(a=>{ const m=new Map(); for(const x of hist[a.asset]||[]) m.set(dayKey(x.t),x.p);
    const tl=ht&&ht[a.asset]; const end=tl&&tl.length?tl[tl.length-1][idx]:0;
    const now=viewUnits(a, view), scale=end>0?now/end:1;
    const unitsAt = tl&&tl.length ? (t=>{ const s=stepAt(tl,t); return s?s[idx]*scale:0; }) : (()=>now);
    return {m, unitsAt, last:null, prevUnits:null}; });
  const value=[], mkt=[];
  for(const t of days){ const k=dayKey(t); let v=0, mv=0;
    for(const s of per){
      const prevPx=s.last;
      if(s.m.has(k)) s.last=s.m.get(k);
      const u=s.unitsAt(t);
      if(s.last!=null) v+=u*s.last;
      if(prevPx!=null && s.last!=null && s.prevUnits!=null) mv+=s.prevUnits*(s.last-prevPx);
      s.prevUnits=u;
    }
    value.push(v); mkt.push(mv);
  }
  const btl=D.basis_timeline, totalCost=D.assets.reduce((s,a)=>s+a.cost_basis,0);
  const cost=days.map(t=>{ if(!btl||!btl.length) return totalCost; const s=stepAt(btl,t); return s?s[1]:0; });
  return {value, mkt, cost};
}
/* "All" range: weekly EUR prices since your first transaction (DefiLlama + historical EUR/USD) */
let allLoading=false;
async function loadAllHistory(){
  if(allLoading) return; allLoading=true;
  try{
    const today=new Date().toISOString().slice(0,10);
    const c=!state.demo && cacheGet("hist_all");
    const covered=c && c.day===today && state.data.assets.every(a=>!a.cg_id || c.h[a.asset]);
    if(covered){ state.histAll=c.h; return; }
    const ev=state.data.events||[], bt=state.data.basis_timeline||[];
    const first=Math.min(...ev.map(e=>e.t).filter(t=>t>0), ...(bt.length?[bt[0][0]]:[]), Date.now()-365*DAY);
    const h={};
    for(const a of state.data.assets){ if(!a.cg_id) continue;
      try{ const pts=await llamaHistory(a.cg_id, first-7*DAY, "1w"); if(pts && pts.length){
        if(state.prices[a.asset]!=null) pts.push({t:Date.now(), p:state.prices[a.asset]});   // end at the live price
        h[a.asset]=pts; } }catch(e){}
    }
    if(Object.keys(h).length){ state.histAll=h; if(!state.demo) cacheSet("hist_all", {day:today, h}); }
  } finally { allLoading=false; }
}
function drawChart(hist){
  // "All" uses its own weekly history; load it on first use
  if(state.chartRange===0){
    if(!state.histAll){ $("#chartTitle").textContent="Loading Full History…"; loadAllHistory().then(()=>{ if(state.histAll && state.chartRange===0) drawChart(state.hist); else $("#chartTitle").textContent="Full History Unavailable"; }); return; }
    hist=state.histAll;
  }
  const weekly = state.chartRange===0;
  let base=null;
  for(const a of state.data.assets){ const h=hist[a.asset]; if(h&&(!base||h.length>base.length)) base=h; }
  if(!base) return;
  const range=state.chartRange;
  // one point per UTC day, keeping the latest (today's live point replaces today's 00:00 point)
  const dk=t=>new Date(t).toISOString().slice(0,10), byDay=new Map();
  for(const x of base) byDay.set(dk(x.t), x.t);
  const days=[...byDay.values()];
  const {value:valueSeries, mkt, cost:costSeries}=buildSeries(hist, days);
  const rt=rate();
  const dayLabel=t=>new Date(t).toLocaleDateString(undefined,{month:"short",day:"numeric"});
  const from = range===0 ? 0 : Math.max(0,valueSeries.length-range);
  const slDays=days.slice(from), slVals=valueSeries.slice(from), slCost=costSeries.slice(from);
  const labels=slDays.map(dayLabel);
  const valConv=slVals.map(v=>v*rt), costLine=slCost.map(c=>c*rt);
  $("#chartTitle").textContent = range===0 ? `Since ${new Date(days[0]).getUTCFullYear()}` : range+" Days";
  if(state.chart) state.chart.destroy();
  const ctx=$("#valueChart").getContext("2d");
  // P/L change over the window (value − cost basis), so deposits/purchases don't read as gains
  const i0=slVals.findIndex(v=>v>0);
  const plStart = i0>=0 ? slVals[i0]-slCost[i0] : null;
  const liveT=computeForView(state.view);
  const plNow = liveT.u;
  const plChg = (plStart!=null && plNow!=null) ? plNow-plStart : null;
  const [lineHex,rgb]=(plChg==null||plChg===0)?["#8A90A0","138,144,160"]:(plChg>0?["#16C784","22,199,132"]:["#EA3943","234,57,67"]);
  const gh=ctx.canvas.height||150;
  const grad=ctx.createLinearGradient(0,0,0,gh);
  grad.addColorStop(0,`rgba(${rgb},0.35)`); grad.addColorStop(1,`rgba(${rgb},0.02)`);
  const css=getComputedStyle(document.documentElement);
  const ink=(n)=>(css.getPropertyValue(n)||"").trim();
  const tintBg=ink("--bg")||"#0B0D12";
  // day-over-day market move of a displayed point (holdings changes excluded)
  const dayDelta=(i)=>{ const prev=i>0?valueSeries[i-1]:null;
    return (prev!=null&&prev>0)?{d:mkt[i],p:mkt[i]/prev*100}:null; };
  const crosshair={ id:"crosshair", afterDatasetsDraw(c){
    const act=c.tooltip&&c.tooltip.getActiveElements&&c.tooltip.getActiveElements();
    if(!act||!act.length) return;
    const x=act[0].element.x, a=c.chartArea, cx=c.ctx;
    cx.save(); cx.beginPath(); cx.moveTo(x,a.top); cx.lineTo(x,a.bottom);
    cx.lineWidth=1; cx.strokeStyle=ink("--muted")||"#9BA1AE"; cx.globalAlpha=.5; cx.stroke();
    cx.globalAlpha=1; cx.beginPath(); cx.arc(x,act[0].element.y,3.2,0,Math.PI*2);
    cx.fillStyle=lineHex; cx.fill(); cx.restore();
  }};
  const scrubTo=(idx)=>{
    if(idx==null){ state.scrubbing=false; renderOverview(); return; }
    state.scrubIdx=idx;
    const gi=from+idx;
    state.scrubbing=true;
    renderOverview({ value:valueSeries[gi], cost:costSeries[gi], dateLabel:dayLabel(days[gi]), dayDelta:dayDelta(gi) });
  };
  // trade-event dots: map each buy/sell to the nearest displayed day, sit it on the value line
  const evOn = (state.data.events||[]).filter(e=>e.type==="buy"||e.type==="sell");
  const buyPts=new Array(slDays.length).fill(null), sellPts=new Array(slDays.length).fill(null);
  if(evOn.length && slDays.length){
    const winStart=slDays[0], winEnd=slDays[slDays.length-1];
    const step = slDays.length>1 ? (slDays[1]-slDays[0]) : 864e5;
    for(const ev of evOn){
      if(ev.t<winStart-step || ev.t>winEnd+step) continue;
      let idx=Math.round((ev.t-winStart)/step);
      idx=Math.max(0,Math.min(slDays.length-1,idx));
      const y=slVals[idx]; if(y==null) continue;
      if(ev.type==="sell") sellPts[idx]=y*rt; else buyPts[idx]=y*rt;
    }
  }
  const hasEv = buyPts.some(v=>v!=null)||sellPts.some(v=>v!=null);
  // optional benchmark: the same euros put into BTC or ETH (loads once per day, then redraws)
  const bId=state.bench, bPts=bId && benchCached(bId);
  if(bId && !bPts) benchHistory(bId).then(x=>{ if(x && state.bench===bId) drawChart(state.hist); });
  const bVals = bPts ? benchSeries(bPts, slDays).map(v=>v==null?null:v*rt) : null;
  const bk=$("#benchKey"); if(bk){ bk.hidden=!bVals; if(bVals){ $("#benchKeyTxt").textContent=`Same Buys in ${BENCH[bId].sym}`; bk.querySelector(".sw").className="sw "+BENCH[bId].cls; } }
  state.chart=new Chart(ctx,{type:"line",plugins:[crosshair],data:{labels,datasets:[
    {label:"Value",data:valConv,borderColor:lineHex,backgroundColor:grad,fill:true,tension:.3,pointRadius:0,borderWidth:2},
    {label:"Cost Basis",data:costLine,borderColor:"#8A90A0",borderDash:[6,5],fill:false,pointRadius:0,borderWidth:1.5,stepped:"before"},
    {label:"Buys",data:buyPts,showLine:false,pointStyle:"circle",pointRadius:hasEv?3:0,
      pointBackgroundColor:"rgba(22,199,132,0.9)",pointBorderColor:tintBg,pointBorderWidth:1.5,pointHoverRadius:4},
    {label:"Sells",data:sellPts,showLine:false,pointStyle:"circle",pointRadius:hasEv?3:0,
      pointBackgroundColor:"rgba(234,57,67,0.9)",pointBorderColor:tintBg,pointBorderWidth:1.5,pointHoverRadius:4},
    ...(bVals ? [{label:BENCH[bId].sym,data:bVals,borderColor:bId==="bitcoin"?"#F7931A":"#7B93F2",borderDash:[3,3],borderWidth:1.5,fill:false,pointRadius:0,tension:.3,spanGaps:true}] : [])
  ]},options:{responsive:true,maintainAspectRatio:false,animation:REDUCE_MOTION?false:{duration:400},
    interaction:{intersect:false,mode:"index",axis:"x"},
    onHover:(e,els)=>{ if(els&&els.length) scrubTo(els[0].index); },
    plugins:{legend:{display:false},tooltip:{enabled:false}},
    scales:{x:{grid:{display:false},border:{display:false},
              ticks:{color:ink("--muted")||"#9BA1AE",font:{size:11},maxRotation:0,autoSkip:true,maxTicksLimit:4,padding:2}},
            y:{grid:{color:"rgba(138,144,160,.12)"},border:{display:false},
              ticks:{mirror:true,maxTicksLimit:3,color:ink("--muted")||"#9BA1AE",font:{size:11},padding:4,z:1,
                callback:v=>state.privacy?"":nf({...ccyOpts(dispCcy()),notation:"compact",minimumFractionDigits:0,maximumFractionDigits:1}).format(v)}}}}});
  state.chartScrub={scrubTo, n:slDays.length};
  // release scrub when the pointer leaves the canvas / touch ends / focus leaves -> restore live values
  const cv=$("#valueChart");
  if(cv && !cv._scrubWired){
    const release=()=>{ if(state.scrubbing){ state.scrubbing=false; state.scrubIdx=null; renderOverview(); if(state.chart){ state.chart.setActiveElements([]); state.chart.tooltip.setActiveElements([],{x:0,y:0}); state.chart.update("none"); } } };
    cv.addEventListener("pointerleave",release);
    cv.addEventListener("touchend",release,{passive:true});
    cv.addEventListener("touchcancel",release,{passive:true});
    cv.addEventListener("blur",release);
    // keyboard: ←/→ step a day, Home/End jump, Escape returns to live values
    cv.addEventListener("keydown",e=>{
      const sc=state.chartScrub; if(!sc || !state.chart) return;
      let i = state.scrubIdx!=null ? state.scrubIdx : sc.n-1;
      if(e.key==="ArrowLeft") i=Math.max(0,i-1); else if(e.key==="ArrowRight") i=Math.min(sc.n-1,i+1);
      else if(e.key==="Home") i=0; else if(e.key==="End") i=sc.n-1;
      else if(e.key==="Escape"){ release(); return; } else return;
      e.preventDefault();
      const el={datasetIndex:0,index:i}, pt=state.chart.getDatasetMeta(0).data[i];
      state.chart.setActiveElements([el]); state.chart.tooltip.setActiveElements([el],{x:pt.x,y:pt.y}); state.chart.update("none");
      sc.scrubTo(i);
    });
    cv._scrubWired=true;
  }
  const sw=$(".chart-legend .sw.val"); if(sw) sw.style.background=lineHex;
  const sl=slVals.filter(v=>v>0);
  const hi=sl.length?Math.max(...sl):null, lo=sl.length?Math.min(...sl):null;
  // daily market returns inside the window (holdings changes excluded)
  const rets=[]; for(let i=Math.max(1,from);i<valueSeries.length;i++){ const p=valueSeries[i-1];
    if(p>0) rets.push(mkt[i]/p); }
  const bestDay = rets.length?Math.max(...rets)*100:null;
  const worstDay= rets.length?Math.min(...rets)*100:null;
  const stat=(k,v,cls)=>`<div class="stat"><div class="k">${k}</div><div class="v ${cls||""}">${v}</div></div>`;
  const perLbl = `${range}-day`;
  $("#chartStats").innerHTML=
    // short labels: the range is in the chart title
    stat("Now", fmtMoney(liveT.v))+
    stat("P/L Change", plChg==null?"—":`${arrowOf(plChg)} ${fmtMoney(Math.abs(plChg))}`, tone(plChg))+
    stat("High", hi==null?"—":fmtMoney(hi))+
    stat("Low", lo==null?"—":fmtMoney(lo))+
    stat(weekly?"Best Week":"Best Day", bestDay==null?"—":pct(bestDay), 'c-up')+
    stat(weekly?"Worst Week":"Worst Day", worstDay==null?"—":pct(worstDay), 'c-down')+
    (()=>{ if(!bVals) return ""; const b=benchNow(bId), vs=b>0&&liveT.v!=null?(liveT.v/b-1)*100:null; return stat(`vs ${BENCH[bId].sym}`, pct(vs), tone(vs)); })();
  const cvs=$("#valueChart"); if(cvs) cvs.setAttribute("aria-label",
    `Portfolio value over ${range} days: high ${hi==null?"—":fmtMoney(hi)}, low ${lo==null?"—":fmtMoney(lo)}, now ${fmtMoney(liveT.v)}`);
  state.chartLoaded=true;
}
/* debounced chart refresh */
let chartDebounce=null;
function refreshChartsSoon(){ clearTimeout(chartDebounce); chartDebounce=setTimeout(()=>{ if(state.chartLoaded && state.hist) drawChart(state.hist); },180); }

/* ---------- refresh cycle ---------- */
async function refresh(manual){
  const btn=$("#refreshBtn");
  // nothing imported yet: there is nothing to price — not an outage, so no error banner
  if(!state.data.assets.length){ state.offline=false; setBanner(null); render(); updateFreshness(); return; }
  btn.classList.add("spin");
  if(cgOnCooldown() && !manual){
    loadCachedPrices();
    if(await fillPrices(true)){ state.offline=false; setBanner({kind:"warn", msg:"CoinGecko is rate-limiting — prices from Kraken and DefiLlama for now."});
      checkAlerts(); render(); btn.classList.remove("spin"); updateFreshness(); return; }
    render();
    const secs=Math.ceil((CG.cooldownUntil-Date.now())/1000);
    setBanner({kind:"warn", msg:`Rate-limited by price service — retrying in ${secs}s. Showing last known values.`});
    btn.classList.remove("spin"); updateFreshness(); return;
  }
  try{
    let cgErr=null;
    await Promise.all([fetchMarkets().catch(e=>{ cgErr=e; }), fxStale()?fetchFX():Promise.resolve()]);
    const filled=await fillPrices(!!cgErr);
    if(cgErr && !filled) throw cgErr;                      // nothing worked → the offline/rate-limit banners below
    state.offline=false;
    setBanner(cgErr ? {kind:"warn", msg:"CoinGecko is unavailable — prices from Kraken and DefiLlama for now."} : null);
    krakenStatus(); loadMarket(); refreshWatch(); startLive();
    checkAlerts();
    render();
    resolveMissingIds().then(changed=>{ if(changed){ refresh(false); loadChart(true); } });
    if(manual){ btn.classList.add("ok"); setTimeout(()=>btn.classList.remove("ok"),700); }
  }catch(e){
    state.offline=true; loadCachedPrices(); render();
    const havePx = Object.keys(state.prices).length>0;
    if(e && (e.rate || e.cooldown)){
      const secs=Math.max(1,Math.ceil((CG.cooldownUntil-Date.now())/1000));
      setBanner({kind:"warn", msg:`Rate-limited by price service — retrying in ${secs}s. ${havePx?"Showing last known values.":""}`.trim()});
    } else {
      setBanner(havePx
        ? {kind:"warn", msg:(navigator.onLine?"Prices unavailable — showing last known values.":"You're offline — showing last known values.")}
        : {kind:"error", msg:"Can't reach price service. Pull down or tap refresh to retry."});
    }
  }finally{ setTimeout(()=>btn.classList.remove("spin"),400); updateFreshness(); }
}
/* friendly network/error banner (null hides it) */
function setBanner(b){
  const el=$("#netBanner"); if(!el) return;
  if(!b){ el.hidden=true; el.textContent=""; el.className="net-banner"; return; }
  el.hidden=false; el.textContent=b.msg; el.className="net-banner "+(b.kind||"warn");
}
/* ---------- Settings sections (collapsible) ----------
   Open/closed state is remembered; with nothing imported yet, "Kraken Data" starts open. */
const SEC_KEY="settings_open";
function initSections(){
  let open=null; try{ open=JSON.parse(localStorage.getItem(SEC_KEY)||"null"); }catch(e){}
  if(!Array.isArray(open)) open = state.data.assets.length ? [] : ["sec-import"];
  for(const d of $$(".set-sec")){
    d.open=open.includes(d.id);
    d.addEventListener("toggle",()=>{ try{ localStorage.setItem(SEC_KEY, JSON.stringify($$(".set-sec").filter(x=>x.open).map(x=>x.id))); }catch(e){} });
  }
}
/* jump to a section from elsewhere (Import CSVs, Re-import): open it and bring it into view */
function openSection(id){
  switchView("settings", {instant:true});
  const d=$("#"+id); if(!d) return;
  d.open=true;
  requestAnimationFrame(()=>{ d.scrollIntoView({block:"start", behavior:REDUCE_MOTION?"auto":"smooth"}); d.querySelector("summary").focus({preventScroll:true}); });
}
/* one-line status in each section header, so closed sections still say what's going on */
function renderSettingsMeta(){
  const set=(id,txt,warn)=>{ const el=$("#"+id); if(!el) return; el.textContent=txt; el.classList.toggle("warn",!!warn); };
  const D=state.data, n=D.assets.length, age=dataAgeDays();
  if(state.demo) set("metaImport","Sample data — not saved", true); else
  set("metaImport", D.generated ? `Imported ${new Date(D.generated+"T00:00:00Z").toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"})} · ${n} asset${n===1?"":"s"}${age!=null&&age>=AGE_WARN_DAYS?` · ${age} days old`:""}`
    : n ? "Not imported — manual holdings only" : "Nothing imported yet", !D.generated || (age!=null && age>=AGE_WARN_DAYS));
  const m=loadEntries().length, wn=loadWatch().length;
  set("metaManual", [m ? `${m} holding${m===1?"":"s"}` : "", wn ? `${wn} watched address${wn===1?"":"es"}` : ""].filter(Boolean).join(" · ") || "None added");
  set("metaBackup", readUndo() ? "Export or restore · undo available" : "Export or restore a file");
  set("metaApi", CG.demoKey ? "Demo key saved" : "Not set — using the free tier");
  const scale=getComputedStyle(document.documentElement).getPropertyValue("--type-scale").trim()||"1";
  const sizeName={"0.9":"small text","1":"default text","1.15":"large text","1.3":"extra large text"}[scale]||"custom text";
  set("metaDisplay", `${{system:"Auto theme",light:"Light",dark:"Dark"}[state.theme]} · ${state.ccyPair.join(" / ")} · ${sizeName} · auto-refresh ${state.auto?"on":"off"}`);
  set("metaData", `Prices: ${state.priceSource==="kraken"?"Kraken":"CoinGecko"} · market ${state.showMarket?"on":"off"} · sentiment ${state.sentiment?"on":"off"}${state.taxPl?" · PIT-38":""}`);
  const na=Object.keys(state.alerts).length; set("metaAlerts", na ? `${na} active` : "None set");
  const w=(D.warnings||[]).length; set("metaAbout", n ? (w ? `${w} reconciliation note${w===1?"":"s"}` : "Method, sources · all assets reconcile") : "Method and data sources", w>0);
}
function render(){
  const empty=!state.data.assets.length;
  document.body.classList.toggle("no-data", empty);
  $("#emptyState").hidden=!empty;
  if(empty) $("#onboard").classList.remove("show");   // the empty state already explains what to do
  if(!state.scrubbing) renderOverview();
  renderPortfolio(); reconMsg(); renderSettingsMeta();
  if(state.openSym) renderDetail(true);
}
const AUTO_MS=60000;   // 60s auto-refresh — well within CoinGecko free-tier limits
function startAuto(){ stopAuto(); if(state.auto && !document.hidden){ state.timer=setInterval(()=>refresh(false),AUTO_MS);}
  $("#autoState").textContent=state.auto?"Auto-refresh every 60 seconds":"Auto-refresh off"; }   // visible state lives in Settings › Display
function stopAuto(){ if(state.timer){clearInterval(state.timer);state.timer=null;} }

/* ---------- nav ---------- */
function switchView(name, opts){
  if(!VIEWS.includes(name)) name="overview";
  const doIt=()=>{ $$(".view").forEach(v=>v.classList.remove("active"));
    $("#view-"+name).classList.add("active");
    $$(".bottom-nav button").forEach(b=>{ const on=b.dataset.nav===name; b.classList.toggle("active",on);
      if(on) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current"); });
    const bcls=document.body.classList;
    Array.from(bcls).filter(c=>c.startsWith("tab-")).forEach(c=>bcls.remove(c));
    bcls.add("tab-"+name);
    try{ history.replaceState(null,"", name==="overview" ? location.pathname+location.search : "#"+name); }catch(e){}
    if(name==="overview" && !state.chartLoaded && state.data) loadChart(); };
  if(name==="news"){ loadNews(); loadTrending(); }
  if(opts&&opts.instant){ doIt(); return; }
  // a quick second tap skips the first transition; that rejection is expected, not an error
  if(document.startViewTransition && !REDUCE_MOTION){ const vt=document.startViewTransition(doIt); vt.ready.catch(()=>{}); vt.finished.catch(()=>{}); vt.updateCallbackDone.catch(()=>{}); } else { doIt(); }
}

/* ---------- news (rss2json + Crypto Vision, cache-first) ----------
   Four crypto RSS feeds proxied through the free rss2json endpoint (CORS *, no key; the free tier
   422s on count/order params, so the per-feed cap is applied client-side) plus Crypto Vision's
   JSON API. Cache-first per feed ("news_"+url, 15 min TTL): cached items paint instantly, the
   network refetches in the background only when stale. Fire-and-forget — never gates prices.
   Nothing about the portfolio is sent; only the public feed URLs. */
const NEWS_TTL = 15*60*1000;
const NEWS_PER_FEED = 10;
const NEWS_MAX = 20;
const FEEDS = [
  { name:"Cointelegraph", url:"https://cointelegraph.com/rss" },
  { name:"CoinDesk",       url:"https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { name:"Decrypt",        url:"https://decrypt.co/feed" },
  { name:"The Block",      url:"https://www.theblock.co/rss.xml" },
];
const CRYPTOVISION = { name:"Crypto Vision", url:"https://cryptocurrency.cv/api/news" };
let newsBusy=false;
const stripHTML = s => String(s==null?"":s).replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
/* rss2json pubDate is "YYYY-MM-DD HH:mm:ss" in UTC — make the zone explicit (Safari needs it);
   Crypto Vision returns ISO "…Z" already */
const newsDate = s => { const t=String(s==null?"":s); return t.endsWith("Z") ? Date.parse(t) : Date.parse(t.replace(" ","T")+"Z"); };
const httpOnly = u => /^https?:/i.test(String(u||"")) ? String(u) : "";   // esc() can't stop javascript: URLs
function readNewsCache(f){
  try{ const c=JSON.parse(localStorage.getItem("news_"+f.url)||"null"); return (c && Array.isArray(c.items)) ? c : null; }catch(e){ return null; }
}
function writeNewsCache(f, items){ try{ localStorage.setItem("news_"+f.url, JSON.stringify({t:Date.now(), items})); }catch(e){} }
/* one raw item -> card shape (everything untrusted; escaped at render) */
function normalizeNews(f, it){
  const enc = Array.isArray(it.enclosure) ? it.enclosure[0] : it.enclosure;   // rss2json: {link} or [{link}]
  return { title:stripHTML(it.title), source:f.name, url:httpOnly(it.link), date:newsDate(it.pubDate),
    img:httpOnly(it.thumbnail || (enc && typeof enc==="object" ? enc.link : "")),
    summary:stripHTML(it.description).slice(0,180),
    tags:(Array.isArray(it.categories)?it.categories:[]).map(stripHTML).filter(Boolean).slice(0,2) };
}
function normalizeCryptoVision(f, it){
  return { title:stripHTML(it.title), source:stripHTML(it.source||f.name), url:httpOnly(it.link), date:newsDate(it.pubDate),
    img:httpOnly(it.image), summary:stripHTML(it.description).slice(0,180), tags:it.category?[stripHTML(it.category)]:[] };
}
async function fetchFeed(f){
  try{
    const r=await fetch("https://api.rss2json.com/v1/api.json?rss_url="+encodeURIComponent(f.url),{cache:"no-store"});
    if(!r.ok) return;
    const d=await r.json(); if(!d || d.status!=="ok" || !Array.isArray(d.items)) return;
    const items=d.items.slice(0,NEWS_PER_FEED).map(it=>normalizeNews(f,it)).filter(it=>it.title && it.url);
    if(items.length) writeNewsCache(f, items);
  }catch(e){ /* keep whatever the cache holds */ }
}
/* Crypto Vision returns 3 articles per page — fetch a few pages so the merged list has enough */
async function fetchCryptoVision(){
  try{
    const pages=await Promise.all([1,2,3,4,5,6].map(p=>fetch(CRYPTOVISION.url+"?page="+p,{cache:"no-store"}).then(r=>r.ok?r.json():null).catch(()=>null)));
    const items=pages.flatMap(d=>d && Array.isArray(d.articles) ? d.articles : [])
      .map(it=>normalizeCryptoVision(CRYPTOVISION,it)).filter(it=>it.title && it.url);
    if(items.length) writeNewsCache(CRYPTOVISION, items);
  }catch(e){ /* keep whatever the cache holds */ }
}
function mergeNews(caches){
  const all=[], seen=new Set();
  for(const c of caches) for(const it of (c && c.items) || []) if(it && it.title && !seen.has(it.url)){ seen.add(it.url); all.push(it); }
  return all.sort((a,b)=>b.date-a.date).slice(0,NEWS_MAX);
}
function loadNews(force){
  const sources=[...FEEDS, CRYPTOVISION], cached=sources.map(readNewsCache), items=mergeNews(cached);
  const stale=sources.some((f,i)=>!cached[i] || Date.now()-(cached[i].t||0) > NEWS_TTL);
  renderNews(items, items.length ? (stale ? "Updating…" : "") : "Loading…");
  if(newsBusy || (!stale && !force)) return;
  if(!navigator.onLine){ if(!items.length) renderNews([], "You're offline — pull down to refresh when you're back."); return; }
  newsBusy=true;
  Promise.all([...FEEDS.map(fetchFeed), fetchCryptoVision()]).then(()=>{
    newsBusy=false;
    const fresh=mergeNews(sources.map(readNewsCache));
    renderNews(fresh, fresh.length ? "" : "News unavailable — pull down to refresh.");
  });
}
/* ---------- headline sentiment (opt-in, on-device) ----------
   Titles go to sentiment-worker.js (DistilRoBERTa fine-tuned on financial news, run locally by
   transformers.js). Results are cached per story URL; only public headline text is involved. */
const SENT_KEY="news_sent";
let sentWorker=null, sentPending=false, newsFilter="all", lastNews=[];
function sentCache(){ try{ return JSON.parse(localStorage.getItem(SENT_KEY)||"{}")||{}; }catch(e){ return {}; } }
function saveSent(c){ const keys=Object.keys(c); if(keys.length>400) for(const k of keys.slice(0,keys.length-400)) delete c[k];
  try{ localStorage.setItem(SENT_KEY, JSON.stringify(c)); }catch(e){} }
function classifyNews(items){
  if(!state.sentiment || sentPending || !window.Worker) return;
  const c=sentCache(), todo=items.filter(it=>it.url && !c[it.url]);
  if(!todo.length) return;
  sentPending=true;
  if(!sentWorker){
    try{ sentWorker=new Worker("sentiment-worker.js",{type:"module"}); }catch(e){ sentPending=false; $("#newsStatus").textContent="On-device sentiment isn't supported in this browser."; return; }
  }
  sentWorker.onmessage=e=>{ const d=e.data||{};
    if(d.progress!=null){ $("#newsStatus").textContent=`Preparing on-device sentiment model… ${d.progress}%`; return; }
    sentPending=false;
    if(d.error){ $("#newsStatus").textContent="Sentiment unavailable: "+d.error; return; }
    const cc=sentCache(); (d.out||[]).forEach((r,i)=>{ if(r && todo[i]) cc[todo[i].url]={l:r.label, s:Math.round(r.score*100)/100}; }); saveSent(cc);
    $("#newsStatus").textContent=""; renderNews(lastNews, "");
  };
  sentWorker.onerror=()=>{ sentPending=false; $("#newsStatus").textContent="Sentiment unavailable (the model couldn't load)."; };
  sentWorker.postMessage({id:Date.now(), texts:todo.map(it=>it.title)});
}
const SENT_LABEL={positive:["▲","Positive","c-up"], negative:["▼","Negative","c-down"], neutral:["●","Neutral","c-flat"]};
function renderNews(items, note){
  const box=$("#newsList"); if(!box) return;
  if(!(sentPending && !note)) $("#newsStatus").textContent=note||"";
  lastNews=items||[];
  const sent=state.sentiment ? sentCache() : null;
  // mood summary + filter (only with sentiment on and results available)
  const moodBox=$("#newsMood"), withS=sent ? lastNews.filter(it=>sent[it.url]) : [];
  moodBox.hidden=!withS.length;
  if(withS.length){
    const n=l=>withS.filter(it=>sent[it.url].l===l).length;
    $("#newsMoodTxt").textContent=`Today's headlines: ${n("positive")} positive · ${n("negative")} negative · ${n("neutral")} neutral`;
    markActive("#newsFilter button", b=>b.dataset.f===newsFilter);
  } else newsFilter="all";
  const shown = newsFilter==="all" ? lastNews : lastNews.filter(it=>sent && sent[it.url] && sent[it.url].l===newsFilter);
  if(state.sentiment) classifyNews(lastNews);
  if(!items || !items.length){ box.innerHTML='<div class="news-empty empty muted">News unavailable — pull down to refresh.</div>'; return; }
  if(!shown.length){ box.innerHTML=`<div class="news-empty empty muted">No ${newsFilter} headlines right now.</div>`; return; }
  box.innerHTML=shown.map(it=>{
    const img=httpOnly(it.img), url=httpOnly(it.url)||"#";       // re-gate: localStorage is user-editable
    const thumb = img ? `<img class="news-img" src="${esc(img)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"/>`
                      : `<span class="news-ph" aria-hidden="true">${esc(String(it.source).slice(0,2))}</span>`;
    const sum = it.summary && it.summary!==it.title ? `<span class="news-sum">${esc(it.summary)}</span>` : "";
    const tags = it.tags && it.tags.length ? `<span class="news-tags">${it.tags.map(t=>`<i class="news-tag">${esc(t)}</i>`).join("")}</span>` : "";
    return `<a class="news-card" href="${esc(url)}" target="_blank" rel="noopener noreferrer">
      ${thumb}
      <span class="news-body">
        <span class="news-meta"><span class="news-src">${esc(it.source)}</span><i aria-hidden="true">·</i><span class="news-time">${esc(relTime(it.date))}</span>${(()=>{ const r=sent&&sent[it.url], L=r&&SENT_LABEL[r.l]; return L?`<span class="news-sent ${L[2]}" title="On-device sentiment, ${Math.round(r.s*100)}% confident">${L[0]} ${L[1]}</span>`:""; })()}</span>
        <span class="news-title">${esc(it.title)}</span>
        ${sum}${tags}
      </span></a>`;
  }).join("");
}

/* ---------- export CSV + share ---------- */
function exportCSV(){
  const rows=sortedRows(rowsFor()); const rt=rate(); const ccy=dispCcy();
  // CSV cell sanitizer: quote always; escape quotes; neutralize formula-injection leaders (= + - @ tab CR).
  // Plain numbers (incl. negative P/L) pass through so spreadsheets keep them numeric.
  const cell=(x)=>{ let s=String(x==null?"":x);
    if(!/^-?\d+(\.\d+)?$/.test(s) && /^[=+\-@\t\r]/.test(s)) s="'"+s;  // apostrophe defuses formulas
    return '"'+s.replace(/"/g,'""')+'"'; };
  const head=["Asset","Quantity",`CostBasis(${ccy})`,`Price(${ccy})`,`Value(${ccy})`,`ProfitLoss(${ccy})`,"Return%"];
  const lines=[head.map(cell).join(",")];
  for(const r of rows){ lines.push([r.asset, r.units,
    (r.cost*rt).toFixed(2), r.px!=null?(r.px*rt).toFixed(8):"",
    r.value!=null?(r.value*rt).toFixed(2):"", r.unreal!=null?(r.unreal*rt).toFixed(2):"",
    r.ret!=null?r.ret.toFixed(1):""].map(cell).join(",")); }
  download(new Blob([lines.join("\n")],{type:"text/csv"}),
    `portfolio_${state.view===3?"invested":"all"}_${new Date().toISOString().slice(0,10)}.csv`);
}
function download(blob, name){
  const url=URL.createObjectURL(blob); const a=document.createElement("a");
  a.href=url; a.download=name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function shareSnapshot(){
  const t=computeForView(state.view);
  const txt=`My crypto portfolio — value ${fmtMoney(t.v)}, P/L ${fmtMoney(t.u)} (${pct(t.ret)}). `+
            `Cost basis ${fmtMoney(t.c)}.`;
  try{
    if(navigator.share){ await navigator.share({title:"My Crypto", text:txt}); return; }
  }catch(e){ if(e && e.name==="AbortError") return; }
  try{ await navigator.clipboard.writeText(txt); toast("Summary copied to clipboard"); }
  catch(e){ toast("Sharing not supported on this device"); }
}
function toast(msg, action){
  let el=$("#toast"); if(!el){ el=document.createElement("div"); el.id="toast"; el.className="toast";
    el.setAttribute("role","status"); el.setAttribute("aria-live","polite"); document.body.appendChild(el); }
  el.textContent=msg;
  el.classList.toggle("has-action", !!action);
  if(action){ const b=document.createElement("button"); b.className="toast-btn"; b.textContent=action.label;
    b.addEventListener("click",()=>{ el.classList.remove("show"); action.fn(); }); el.appendChild(b); }
  el.classList.add("show"); clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove("show"), action?8000:2600);
}

/* ---------- undo (import / restore / clear) ----------
   Before a change that replaces data, the affected keys are snapshotted; Undo writes them back. */
const UNDO_KEY="undo_snapshot";
function snapshotForUndo(label){
  const items={}; for(const k of BACKUP_KEYS){ try{ items[k]=localStorage.getItem(k); }catch(e){ items[k]=null; } }
  try{ localStorage.setItem(UNDO_KEY, JSON.stringify({label, at:Date.now(), items})); return items; }
  catch(e){ return items; }                                // storage full: change still goes ahead, without undo
}
function readUndo(){ try{ const u=JSON.parse(localStorage.getItem(UNDO_KEY)||"null"); return u && u.items ? u : null; }catch(e){ return null; } }
function writeItems(items){ for(const [k,v] of Object.entries(items)){ if(v==null) localStorage.removeItem(k); else localStorage.setItem(k,v); } }
async function undoLast(){
  const u=readUndo(); if(!u){ toast("Nothing to undo"); return; }
  try{ writeItems(u.items); localStorage.removeItem(UNDO_KEY); localStorage.removeItem(HIST_KEY); localStorage.removeItem("hist_fetched"); }
  catch(e){ toast("Couldn't undo: storage error"); return; }
  await setRaw(await IDB.get(RAW_UNDO_KEY));
  try{ sessionStorage.setItem("flash", JSON.stringify({msg:`Undone: ${u.label.toLowerCase()}`})); }catch(e){}
  location.reload();
}
function renderUndo(){
  const u=readUndo(), b=$("#undoBtn"); b.hidden=!u; renderSettingsMeta();
  if(u) b.textContent=`Undo ${u.label.toLowerCase()} (${new Date(u.at).toLocaleString(undefined,{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})})`;
}
/* theme: "system" follows prefers-color-scheme; light/dark force it (theme.js applies it before first paint) */
const THEME_BG={light:"#F7F8FA", dark:"#0B0D12"};
function applyTheme(){
  const root=document.documentElement;
  if(state.theme==="system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", state.theme);
  const metas=$$('meta[name="theme-color"]');
  metas.forEach(m=>{ const media=m.getAttribute("media")||"";
    m.setAttribute("content", state.theme!=="system" ? THEME_BG[state.theme] : (media.includes("light") ? THEME_BG.light : THEME_BG.dark)); });
  markActive("#themeSeg button", b=>b.dataset.theme===state.theme);
}
/* Settings › Alerts: every alert in one place */
function renderAlertsList(){
  const ul=$("#alertsList"); if(!ul) return;
  const items=Object.entries(state.alerts).sort(([a],[b])=>a===PORTFOLIO_KEY?-1:b===PORTFOLIO_KEY?1:a.localeCompare(b));
  ul.hidden=!items.length;
  ul.innerHTML=items.map(([sym,al])=>{
    const name=sym===PORTFOLIO_KEY?"Portfolio total":sym, hit=alertHit(al, sym);
    return `<li><span class="me-main"><b>${esc(name)}</b><span class="muted small">${esc(alertLabel(al, sym))} · <span class="${hit?"c-up":""}">${hit?"reached":"waiting"}</span></span></span>
      <button class="chip-btn ghost" data-del-alert="${esc(sym)}" aria-label="Delete alert for ${esc(name)}">Delete</button></li>`;
  }).join("");
  $("#pfValLbl").firstChild.textContent=`Value (${dispCcy()})`;
  updateBadge();
  renderSettingsMeta();
}
async function setPortfolioAlert(ev){
  ev.preventDefault();
  const m=$("#alertsMsg"), raw=parseFloat($("#pfValue").value), dir=$("#pfDir").value==="above"?"above":"below";
  if(!(raw>0)){ m.className="msg err"; m.textContent="Enter a value above zero."; $("#pfValue").focus(); return; }
  const al={p:raw/rate(), dir, fired:false}; al.fired=alertHit(al, PORTFOLIO_KEY);
  state.alerts[PORTFOLIO_KEY]=al; saveAlerts(); renderAlertsList();
  m.className="msg ok"; m.textContent=`Portfolio alert set: ${alertLabel(al, PORTFOLIO_KEY).toLowerCase()}.`;
  $("#pfAlertForm").reset();
  if("Notification" in window && Notification.permission==="default"){ try{ await Notification.requestPermission(); }catch(e){} }
}
/* version = the service worker's cache name (sw.js is the single place it's bumped) */
async function renderVersion(updated){
  try{ const k=(await caches.keys()).filter(n=>/^portfolio-v\d+$/.test(n)).sort((a,b)=>+b.slice(11)-+a.slice(11))[0];
    $("#appVersion").textContent = k ? `Version: build ${k.slice(11)}${updated?" — a newer build is ready, reload to use it":""}` : ""; }catch(e){}
}
/* app-icon badge = number of alerts currently reached (installed PWAs: iOS 16.4+, Chrome, Edge) */
function updateBadge(){
  if(!("setAppBadge" in navigator)) return;
  const n=Object.entries(state.alerts).filter(([sym,al])=>alertHit(al,sym)).length;
  (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(()=>{});
}
/* wipe every trace of the app's data on this device (the cached app shell stays so it still opens) */
async function eraseAll(){
  if(!confirm("Erase ALL My Crypto data on this device?\n\nThis removes your imported data, holdings outside Kraken, alerts, settings, API key, stored CSVs and the downloaded sentiment model. It can't be undone — export a backup first if you might need it.")) return;
  if(sentWorker){ sentWorker.terminate(); sentWorker=null; }
  try{ localStorage.clear(); sessionStorage.clear(); }catch(e){}
  try{ const db=IDB.db && await IDB.db; if(db) db.close(); }catch(e){}
  await new Promise(res=>{ try{ const q=indexedDB.deleteDatabase("my-crypto"); q.onsuccess=q.onerror=q.onblocked=res; }catch(e){ res(); } });
  try{ for(const k of await caches.keys()) if(!/^portfolio-v\d+$/.test(k)) await caches.delete(k); }catch(e){}   // model + other caches
  try{ if("clearAppBadge" in navigator) await navigator.clearAppBadge(); }catch(e){}
  location.replace(location.pathname);
}
/* privacy mode: amounts masked everywhere (percentages stay) */
function applyPrivacy(){
  document.body.classList.toggle("privacy", state.privacy);
  const b=$("#privacyBtn"); if(b){ b.setAttribute("aria-pressed", state.privacy?"true":"false");
    b.setAttribute("aria-label", state.privacy?"Show amounts":"Hide amounts"); b.title=b.getAttribute("aria-label"); }
}

/* ---------- backup / restore ---------- */
const BACKUP_KEYS=["user_data","manual_entries","watch_addrs","watchlist","tx_notes","alloc_targets","alerts","prefs","type_scale","onboarded"];
function exportBackup(){
  const out={app:"my-crypto", version:1, exported:new Date().toISOString(), items:{}};
  for(const k of BACKUP_KEYS){ try{ const v=localStorage.getItem(k); if(v!=null) out.items[k]=v; }catch(e){} }
  if(rawCache) out.raw_csv=rawCache;                                     // lets a restored device recompute too
  download(new Blob([JSON.stringify(out,null,1)],{type:"application/json"}), `my-crypto-backup-${new Date().toISOString().slice(0,10)}.json`);
  const m=$("#backupMsg"); m.className="msg ok"; m.textContent="Backup saved.";
}
async function restoreBackup(file){
  const m=$("#backupMsg");
  try{
    const b=JSON.parse(await file.text());
    if(!b || b.app!=="my-crypto" || !b.items || typeof b.items!=="object") throw new Error("not a My Crypto backup file");
    const ud=b.items.user_data ? normalizeData(JSON.parse(b.items.user_data)) : null;
    if(b.items.user_data && !ud) throw new Error("backup data is damaged");
    const when=b.exported ? new Date(b.exported).toLocaleString() : "an unknown date";
    if(!confirm(`Replace the data on this device with the backup from ${when}${ud?` (${ud.assets.length} assets)`:""}?`)) return;
    await IDB.set(RAW_UNDO_KEY, await IDB.get(RAW_KEY));
    const before=snapshotForUndo("Restore");
    const next={}; for(const k of BACKUP_KEYS) next[k]=typeof b.items[k]==="string" ? b.items[k] : null;
    try{ writeItems(next); }
    catch(err){ try{ writeItems(before); }catch(_){}           // roll back a half-written restore
      throw new Error("not enough storage on this device — nothing was changed"); }
    localStorage.removeItem(HIST_KEY); localStorage.removeItem("hist_fetched");
    const raw=b.raw_csv; await setRaw(raw && typeof raw.led==="string" ? raw : null);
    try{ sessionStorage.setItem("flash", JSON.stringify({msg:"Backup restored", undo:true})); }catch(e){}
    location.reload();
  }catch(e){ m.className="msg err"; m.textContent="Couldn't restore: "+e.message; }
}

/* ---------- CSV import ----------
   One picker (or drop) for all three Kraken exports; each file is recognised by its header. */
const imp={bal:null,led:null,trd:null, res:null};
const IMP_LABEL={bal:"Balances",led:"Ledger",trd:"Trades"};
function detectCsv(text){
  const h=new Set(String(text).split(/\r?\n/,1)[0].split(",").map(x=>x.replace(/"/g,"").trim().toLowerCase()));
  if(h.has("pair")) return "trd";
  if(h.has("refid") || (h.has("type") && h.has("amount"))) return "led";
  if(h.has("asset") && ["wallet","quantity","balance","amount","vol"].some(k=>h.has(k))) return "bal";
  return null;
}
async function addImportFiles(fileList){
  const msg=$("#importMsg"); msg.className="msg"; msg.textContent="";
  const unknown=[];
  for(const f of Array.from(fileList||[])){
    const text=await f.text(); const k=detectCsv(text);
    if(k) imp[k]={name:f.name, text}; else unknown.push(f.name);
  }
  if(unknown.length){ msg.className="msg err"; msg.textContent=`Not recognised as a Kraken export: ${unknown.join(", ")}`; }
  for(const li of $$("#importStatus li")){ const f=imp[li.dataset.k];
    li.classList.toggle("ok", !!f); li.querySelector(".st").textContent=f?f.name:"Not selected"; }
  previewImport();
}
function previewImport(){
  const pv=$("#importPreview"), btn=$("#recomputeBtn");
  imp.res=null; btn.disabled=true; btn.textContent="Import";
  const missing=["bal","led","trd"].filter(k=>!imp[k]);
  if(missing.length){ pv.hidden=!(imp.bal||imp.led||imp.trd);
    pv.className="import-preview"; pv.textContent=`Still needed: ${missing.map(k=>IMP_LABEL[k]).join(", ")}.`; return; }
  try{
    const res=window.PortfolioEngine.analyze(imp.bal.text, imp.led.text, imp.trd.text, loadEntries());
    imp.res=res;
    const cost=res.assets.reduce((s,a)=>s+a.cost_basis,0);
    pv.hidden=false; pv.className="import-preview ok";
    pv.textContent=`Ready: ${res.assets.length} asset${res.assets.length===1?"":"s"} · cost basis ${fmtMoney(cost)} · realized ${fmtMoney(res.meta.total_realized)}`+
      (res.warnings.length?` · ${res.warnings.length} reconciliation warning(s)`:"")+
      (state.data.assets.length?". This replaces your current data.":".");
    btn.disabled=false; btn.textContent=`Import ${res.assets.length} asset${res.assets.length===1?"":"s"}`;
  }catch(e){ pv.hidden=false; pv.className="import-preview err"; pv.textContent="Can't read these files: "+e.message; }
}
async function applyImport(){
  const res=imp.res; if(!res) return;
  const msg=$("#importMsg"); msg.className="msg"; msg.textContent="Importing…";
  res.generated=new Date().toISOString().slice(0,10);
  if(state.demo){ state.demo=false; $("#demoBanner").hidden=true; }
  try{ await IDB.set(RAW_UNDO_KEY, await IDB.get(RAW_KEY)); }catch(e){}
  snapshotForUndo("Import");
  try{ await setRaw({bal:imp.bal.text, led:imp.led.text, trd:imp.trd.text, at:res.generated,
    names:{bal:imp.bal.name, led:imp.led.name, trd:imp.trd.name}}); }catch(e){}   // optional: enables recompute
  setUserData(res); state.hist=null; state.prices={}; state.priceTs=null;
  try{ localStorage.setItem("user_data", JSON.stringify(res)); }
  catch(e){ msg.className="msg err"; msg.textContent="Imported, but this device's storage is full — it won't survive a restart."; }
  persistStorage();
  reconMsg(); await refresh(true); loadChart(true);
  if(!msg.classList.contains("err")){ msg.className="msg ok";
    msg.textContent=`Imported ${res.assets.length} asset${res.assets.length===1?"":"s"}. Cost basis ${fmtMoney(res.assets.reduce((s,a)=>s+a.cost_basis,0))}.`; }
  renderUndo(); if(readUndo()) toast(`Imported ${res.assets.length} asset${res.assets.length===1?"":"s"}`, {label:"Undo", fn:undoLast});
}
async function clearImported(){
  if(state.demo){ await exitDemo(); return; }
  if(!state.data.assets.length){ toast("Nothing to clear"); return; }
  const keepManual=loadEntries().length;
  if(!confirm("Remove your imported Kraken data from this device?\n\n"+(keepManual?"Your holdings outside Kraken, ":"")+"Alerts and settings are kept. Export a backup first if you might need this data again.")) return;
  try{ await IDB.set(RAW_UNDO_KEY, await IDB.get(RAW_KEY)); }catch(e){}
  snapshotForUndo("Clear");
  try{ for(const k of ["user_data",HIST_KEY,"hist_fetched","px_cache"]) localStorage.removeItem(k); }catch(e){}
  await setRaw(null);
  state.hist=null; state.prices={}; state.priceTs=null; state.chartLoaded=false;
  if(state.chart){ state.chart.destroy(); state.chart=null; }
  if(keepManual){ state.data=EMPTY_DATA; await recompute(); } else await loadBundled();
  renderEntries(); await refresh(true); loadChart(true);
  $("#importMsg").className="msg ok"; $("#importMsg").textContent="Imported data cleared.";
  renderUndo(); if(readUndo()) toast("Imported data cleared", {label:"Undo", fn:undoLast});
}

function wire(){
  const onSeg=(sel,fn)=>{ $$(sel).forEach(box=>box.addEventListener("click",e=>{ const b=e.target.closest("button"); if(b&&box.contains(b)) fn(b); })); };
  $("#nav").addEventListener("click",e=>{const b=e.target.closest("button"); if(b) switchView(b.dataset.nav);});
  $("#ccyToggle").addEventListener("click",e=>{const b=e.target.closest("button"); if(!b)return;
    state.ccy=b.dataset.ccy; savePrefs();
    markActive("#ccyToggle button", x=>x===b);
    if(state.ccy!=="EUR" && state.fx[state.ccy]==null){ fetchFX().then(()=>{ render(); refreshChartsSoon(); }); }
    render(); refreshChartsSoon();});
  onSeg("[data-view-switch]", b=>{ state.view=+b.dataset.view===3?3:1; savePrefs();
    markActive("[data-view-switch] button", x=>+x.dataset.view===state.view);
    render(); refreshChartsSoon(); });
  onSeg("#portMode", b=>{ state.portMode=["table","activity"].includes(b.dataset.mode)?b.dataset.mode:"list"; savePrefs();
    markActive("#portMode button", x=>x.dataset.mode===state.portMode); renderPortfolio(); });
  // sorting: the select and the table headers drive the same key/direction
  $("#sortSel").addEventListener("change",e=>{ state.sortKey=e.target.value; state.sortDir=state.sortKey==="asset"?1:-1; savePrefs(); renderPortfolio(); });
  $("#mainTable thead").addEventListener("click",e=>{const b=e.target.closest("button[data-sort]"); if(!b)return;
    const k=b.dataset.sort; if(state.sortKey===k) state.sortDir*=-1; else{ state.sortKey=k; state.sortDir=(k==="asset")?1:-1; }
    savePrefs(); renderPortfolio(); const nb=$(`#mainTable thead button[data-sort="${k}"]`); if(nb) nb.focus(); });
  onSeg("#benchSeg", b=>{ state.bench=BENCH[b.dataset.bench]?b.dataset.bench:""; savePrefs(); markActive("#benchSeg button", x=>x===b); if(state.hist) drawChart(state.hist); });
  onSeg("#chartRange", b=>{ const r=+b.dataset.range; if(r===state.chartRange) return;
    state.chartRange=r; savePrefs(); markActive("#chartRange button", x=>x===b);
    if(state.hist) drawChart(state.hist); });
  $("#refreshBtn").addEventListener("click",()=>{ loadNews(true); refresh(true); });
  // a news thumbnail from a dead CDN is dropped; the card keeps its text (CSP-safe, no inline onerror)
  $("#view-news").addEventListener("error",e=>{ const t=e.target; if(t && t.classList && t.classList.contains("news-img")) t.hidden=true; }, true);
  $("#autoToggle").addEventListener("change",e=>{state.auto=e.target.checked; savePrefs(); startAuto(); startLive(); renderSettingsMeta();});
  // currency picker (Settings): pick the two currencies offered by the header toggle
  const onCcySlot=(slot,val)=>{
    if(!isCcy(val)) return;
    const pair=[...state.ccyPair]; pair[slot]=val;
    if(pair[0]===pair[1]) pair[slot===0?1:0]=CCY_CODES.find(c=>c!==val);   // never the same code twice
    state.ccyPair=pair;
    if(!state.ccyPair.includes(state.ccy)) state.ccy=state.ccyPair[0];
    savePrefs(); renderCcyToggle(); renderCcyPicker();
    if(state.ccyPair.some(c=>c!=="EUR" && state.fx[c]==null)){ fetchFX().then(()=>{ render(); refreshChartsSoon(); }); }
    render(); refreshChartsSoon();
  };
  $("#ccySlot0").addEventListener("change",e=>onCcySlot(0,e.target.value));
  $("#ccySlot1").addEventListener("change",e=>onCcySlot(1,e.target.value));

  $("#search").addEventListener("input",e=>{ state.query=e.target.value; renderPortfolio(); });
  $("#exportCsvBtn").addEventListener("click",exportCSV);
  $("#shareBtn").addEventListener("click",shareSnapshot);

  // detail sheet open/close
  const openFromEl=(el)=>{ const s=el&&el.dataset&&el.dataset.asset; if(s) openDetail(s); };
  $("#portfolioList").addEventListener("click",e=>openFromEl(e.target.closest(".hrow")));
  // hide a coin logo that fails to load, revealing the colored-initial fallback (CSP-safe, no inline onerror)
  $("#portfolioList").addEventListener("error",e=>{ const t=e.target;
    if(t && t.classList && t.classList.contains("h-logo")) t.hidden=true; }, true);
  $("#mainTable tbody").addEventListener("click",e=>openFromEl(e.target.closest("tr[data-asset]")));
  $("#mainTable tbody").addEventListener("keydown",e=>{ if(e.key!=="Enter"&&e.key!==" ") return;
    const tr=e.target.closest("tr[data-asset]"); if(tr){ e.preventDefault(); openFromEl(tr); } });
  $("#detailClose").addEventListener("click",closeDetail);
  $("#detailBackdrop").addEventListener("click",closeDetail);
  const sheet=$("#detailSheet");
  sheet.addEventListener("keydown",e=>{
    if(e.key==="Escape"){ e.preventDefault(); closeDetail(); return; }
    // ←/→ step between coins, unless the user is in a field or on the chart
    if((e.key==="ArrowLeft"||e.key==="ArrowRight") && !e.target.closest("input,select,canvas,.seg")){ e.preventDefault(); stepDetail(e.key==="ArrowRight"?1:-1); return; }
    if(e.key!=="Tab") return;
    // reachable = not disabled, rendered, and not inside a closed <details> (its own summary stays reachable;
    // offsetParent alone isn't enough — Chrome still reports one for content of a closed <details>)
    const reachable=el=>{ if(el.disabled || el.offsetParent===null) return false;
      const d=el.closest("details"); return !d || d.open || (el.tagName==="SUMMARY" && el.parentElement===d); };
    const f=$$("#detailSheet button, #detailSheet input, #detailSheet select, #detailSheet summary").filter(reachable);
    if(!f.length) return;
    const first=f[0], last=f[f.length-1];
    if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
  });
  $("#detailBody").addEventListener("click",e=>{
    const sym=state.openSym; if(!sym) return;
    const t=e.target.closest("button"); if(!t) return;
    if(t.id==="alertSet") setAlert(sym);
    else if(t.id==="alertClear"){ delete state.alerts[sym]; saveAlerts(); renderPortfolio(); renderDetail(false); renderAlertsList(); $("#alertSet").focus(); }
    else if(t.id==="txMore"){ renderTxList(true); }
    else if(t.dataset.record){ recordDifference(t.dataset.record, t.dataset.units); }
    else if(t.dataset.sp){ const a=state.data.assets.find(x=>x.asset===sym); if(!a) return;
      const u=+(a.exchange_units*t.dataset.sp/100).toFixed(8); (state.sellDraft||(state.sellDraft={}))[sym]=String(u); $("#sellUnits").value=u; updateSellOut();
      if(state.taxPl) ensureNbpRates().then(updateSellOut); }
    else if(t.id==="wlAddThis"){ const x=state.sheetExtra; if(x && addWatchCoin({sym:x.asset, id:x.cg_id, name:x.name})){ x.watch=true; x.trend=false; renderDetail(false); const r=$("#wlRemove"); if(r) r.focus(); } }
    else if(t.id==="wlRemove"){ removeWatchCoin(sym); closeDetail(); }
    else if(t.dataset.dr){ state.detailRange=+t.dataset.dr; markActive("#dSparkRange button", x=>x===t);
      const a=sheetAsset(sym); if(a) drawSparkline(a); }
  });
  $("#detailBody").addEventListener("input",e=>{ if(e.target.id!=="sellUnits" || !state.openSym) return;
    (state.sellDraft||(state.sellDraft={}))[state.openSym]=e.target.value; updateSellOut();
    if(state.taxPl) ensureNbpRates().then(updateSellOut); });
  $("#detailBody").addEventListener("change",e=>{ if(e.target.id!=="alertDir") return;
    const mv=e.target.value==="move", inp=$("#alertInput"); inp.value="";
    inp.placeholder = mv ? "Percent, e.g. 10" : `Target (${dispCcy()})`;
    inp.setAttribute("aria-label", mv ? "Percent move in 24 hours" : `Target price in ${dispCcy()}`); });
  $("#detailBody").addEventListener("toggle",e=>{ if(e.target.classList && e.target.classList.contains("d-sec")){ saveDetailOpen(); if(e.target.dataset.ds==="tx") renderTxList(); } }, true);
  $("#detailBody").addEventListener("keydown",e=>{ if(e.key==="Enter" && e.target.id==="alertInput" && state.openSym){ e.preventDefault(); setAlert(state.openSym); } });
  // swipe down to dismiss; swipe left/right to step to the next/previous coin (not on the chart or form fields)
  (function(){ let sx=0, sy=0, dx=0, dy=0, track=false, axis=null;
    sheet.addEventListener("touchstart",e=>{ if(e.touches.length!==1) return;
      if(e.target.closest && e.target.closest(".d-spark,input,select,.tx-list")) return;
      sx=e.touches[0].clientX; sy=e.touches[0].clientY; dx=dy=0; axis=null; track=true; },{passive:true});
    sheet.addEventListener("touchmove",e=>{ if(!track) return; dx=e.touches[0].clientX-sx; dy=e.touches[0].clientY-sy;
      if(!axis && Math.hypot(dx,dy)>12) axis = Math.abs(dx)>Math.abs(dy) ? "x" : "y";
      if(axis==="y" && dy>0 && sheet.scrollTop<=0){ sheet.style.transform=`translateY(${dy}px)`; sheet.style.transition="none"; } },{passive:true});
    sheet.addEventListener("touchend",()=>{ if(!track) return; track=false; sheet.style.transition=""; sheet.style.transform="";
      if(axis==="y" && dy>90 && sheet.scrollTop<=0) closeDetail();
      else if(axis==="x" && Math.abs(dx)>70) stepDetail(dx<0 ? 1 : -1); },{passive:true});
  })();
  $("#detailPrev").addEventListener("click",()=>stepDetail(-1));
  $("#detailNext").addEventListener("click",()=>stepDetail(1));

  // text size
  const applyScale=(s)=>{ document.documentElement.style.setProperty("--type-scale", s);
    markActive("#textSize button", b=>b.dataset.scale===String(s)); refreshChartsSoon(); renderSettingsMeta(); };
  onSeg("#textSize", b=>{ applyScale(b.dataset.scale); try{localStorage.setItem("type_scale",b.dataset.scale);}catch(_){} });

  // onboarding dismiss
  const ob=$("#onboard"); const dismiss=()=>{ ob.classList.remove("show"); try{localStorage.setItem("onboarded","1");}catch(_){} };
  $("#obClose").addEventListener("click",dismiss); $("#obGo").addEventListener("click",dismiss);
  $("#emptyImport").addEventListener("click",()=>openSection("sec-import"));
  $("#ageImport").addEventListener("click",()=>openSection("sec-import"));
  $("#undoBtn").addEventListener("click",undoLast);
  $("#eraseBtn").addEventListener("click",eraseAll);
  $("#demoBtn").addEventListener("click",enterDemo);
  $("#demoExit").addEventListener("click",exitDemo);
  onSeg("#themeSeg", b=>{ state.theme=["light","dark"].includes(b.dataset.theme)?b.dataset.theme:"system"; savePrefs(); applyTheme();
    render(); refreshChartsSoon(); const a=state.openSym&&state.data.assets.find(x=>x.asset===state.openSym); if(a) drawSparkline(a,true); });
  $("#taxPlToggle").addEventListener("change",e=>{ state.taxPl=e.target.checked; savePrefs(); render(); });
  $("#pfAlertForm").addEventListener("submit",setPortfolioAlert);
  onSeg("#priceSrcSeg", b=>{ state.priceSource=b.dataset.src==="kraken"?"kraken":"coingecko"; savePrefs(); markActive("#priceSrcSeg button", x=>x===b); renderSettingsMeta(); stopLive(); refresh(true); });
  $("#marketToggle").addEventListener("change",e=>{ state.showMarket=e.target.checked; savePrefs(); loadMarket(); renderSettingsMeta(); });
  $("#sentToggle").addEventListener("change",e=>{ state.sentiment=e.target.checked; savePrefs(); renderSettingsMeta();
    if(!state.sentiment && sentWorker){ sentWorker.terminate(); sentWorker=null; sentPending=false; }
    renderNews(lastNews, ""); });
  onSeg("#newsFilter", b=>{ newsFilter=["positive","negative"].includes(b.dataset.f)?b.dataset.f:"all"; renderNews(lastNews,""); });
  $("#krakenDismiss").addEventListener("click",()=>{ try{ sessionStorage.setItem("kraken_dismissed", $("#krakenStatusTxt").textContent.replace(/^Kraken: /,"")); }catch(e){} $("#krakenBanner").hidden=true; });
  $("#alertsList").addEventListener("click",e=>{ const b=e.target.closest("button[data-del-alert]"); if(!b) return;
    delete state.alerts[b.dataset.delAlert]; saveAlerts(); renderAlertsList(); renderPortfolio(); if(state.openSym) renderDetail(false); });
  $("#topHoldings").addEventListener("click",e=>openFromEl(e.target.closest(".hrow")));
  $("#seeAllBtn").addEventListener("click",()=>switchView("portfolio"));
  $("#alloc").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return;
    if(b.dataset.other) switchView("portfolio"); else openFromEl(b); });
  $("#manualForm").addEventListener("submit",addEntry);
  $("#mfKind").addEventListener("change",e=>{ $("#mfCostWrap").hidden=e.target.value!=="purchase"; });
  $("#manualList").addEventListener("click",e=>{ const b=e.target.closest("button[data-del]"); if(b) deleteEntry(b.dataset.del); });
  $("#watchForm").addEventListener("submit",addWatch);
  // Watchlist (Portfolio) and Trending (News)
  $("#wlAddBtn").addEventListener("click",()=>{ const f=$("#wlForm"), open=f.hidden; f.hidden=!open; $("#wlAddBtn").setAttribute("aria-expanded", String(open)); if(open) $("#wlInput").focus(); });
  $("#wlForm").addEventListener("submit",async e=>{ e.preventDefault(); if(await addToWatchlist($("#wlInput").value)){ $("#wlInput").value=""; } });
  $("#wlList").addEventListener("click",e=>{ const b=e.target.closest("[data-watch]"); if(!b) return; const w=loadWL().find(x=>x.sym===b.dataset.watch); if(w) openCoin(w); });
  $("#trendList").addEventListener("click",e=>{ const b=e.target.closest("[data-trend]"); if(!b || !state.trending) return; const c=state.trending[+b.dataset.trend]; if(c) openCoin(c); });
  // Activity
  const actSet=(k,v)=>{ act[k]=v; act.shown=ACT_PAGE; act.edit=null; renderActivity(); };
  $("#actCoin").addEventListener("change",e=>actSet("coin",e.target.value));
  $("#actType").addEventListener("change",e=>actSet("type",e.target.value));
  $("#actYear").addEventListener("change",e=>actSet("year",e.target.value));
  $("#actSearch").addEventListener("input",e=>actSet("q",e.target.value));
  $("#actExport").addEventListener("click",exportActivity);
  $("#actList").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return;
    if(b.id==="actMore"){ act.shown+=ACT_PAGE; renderActivity(); return; }
    const row=b.closest(".act-row"); if(!row) return; const k=row.dataset.k;
    if(b.hasAttribute("data-note-edit")){ act.edit=k; renderActivity(); }
    else if(b.hasAttribute("data-note-save")) saveNote(k, row.querySelector(".act-note-in").value.trim());
    else if(b.hasAttribute("data-note-del")) saveNote(k, ""); });
  $("#actList").addEventListener("keydown",e=>{ if(!e.target.classList.contains("act-note-in")) return; const k=e.target.closest(".act-row").dataset.k;
    if(e.key==="Enter"){ e.preventDefault(); saveNote(k, e.target.value.trim()); } else if(e.key==="Escape"){ e.stopPropagation(); act.edit=null; renderActivity(); } });
  $("#wfCoin").addEventListener("change",e=>{ $("#wfAddr").placeholder=CHAINS[e.target.value].ph; });
  $("#wfAddr").addEventListener("change",e=>{ const {addr, coin}=cleanAddr(e.target.value), c=coin||guessCoin(addr);
    if(c && CHAINS[c] && CHAINS[c].re.test(addr)){ $("#wfCoin").value=c; $("#wfAddr").placeholder=CHAINS[c].ph; } });
  $("#sec-manual").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return;
    if(b.dataset.unwatch) removeWatch(b.dataset.unwatch);
    else if(b.dataset.record) recordDifference(b.dataset.record, b.dataset.units); });
  if("BarcodeDetector" in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia){ $("#wfScan").hidden=false; $("#wfScan").addEventListener("click",scanAddress); }
  $("#mfDate").max=new Date().toISOString().slice(0,10);
  $("#privacyBtn").addEventListener("click",()=>{ state.privacy=!state.privacy; savePrefs(); applyPrivacy(); render(); refreshChartsSoon(); });
  $("#summary").addEventListener("click",e=>{
    const b=e.target.closest("button"); if(!b) return;
    if(b.id==="exportSalesBtn") exportSales(); else if(b.id==="exportPitBtn") exportPit();
    else if(b.id==="printBtn") printReport();
    else if(b.dataset.mr){ $("#mrDetail").textContent=b.dataset.mr; $$("#summary .mr-cell.sel").forEach(x=>x.classList.remove("sel")); b.classList.add("sel"); }
    else if(b.id==="mrFull"){ b.disabled=true; b.textContent="Loading…"; loadAllHistory().then(()=>{ monthlyMemo=null; renderSummaryPanel(); }); }
    else if(b.id==="tgEdit"){ state.rebalEdit=true; state.rebalDraft=null; renderSummaryPanel(); const i=$("#summary [data-tg]"); if(i) i.focus(); }
    else if(b.id==="tgCancel"){ state.rebalEdit=false; state.rebalDraft=null; renderSummaryPanel(); }
    else if(b.id==="tgSave") saveTargets();
    else if(b.id==="tgEqual"){ const ins=$$("#summary [data-tg]"), v=+(100/ins.length).toFixed(2); state.rebalDraft={};
      ins.forEach((el,i)=>{ el.value = i===ins.length-1 ? +(100-v*(ins.length-1)).toFixed(2) : v; state.rebalDraft[el.dataset.tg]=el.value; }); updateTgSum(); }
    else if(b.id==="tgClear"){ if(confirm("Clear your target allocation?")){ localStorage.removeItem(TARGET_KEY); renderSummaryPanel(); } }
  });
  const updateTgSum=()=>{ const sum=$$("#summary [data-tg]").reduce((s,el)=>s+(parseFloat(el.value)||0),0), el=$("#tgSum");
    if(el){ el.textContent=+sum.toFixed(2)+"%"; el.className=Math.abs(sum-100)<0.05?"c-up":"c-down"; } };
  $("#summary").addEventListener("input",e=>{ const el=e.target; if(!el.dataset || !el.dataset.tg) return;
    (state.rebalDraft||(state.rebalDraft={}))[el.dataset.tg]=el.value; updateTgSum(); });
  $("#summary").addEventListener("keydown",e=>{ if(e.key==="Enter" && e.target.dataset && e.target.dataset.tg){ e.preventDefault(); saveTargets(); } });
  $("#summary").addEventListener("toggle",e=>{ if(!e.target.dataset || !e.target.dataset.sum) return;
    try{ localStorage.setItem(SUM_OPEN_KEY, JSON.stringify($$("#summary .d-sec").filter(d=>d.open).map(d=>d.dataset.sum))); }catch(_){} }, true);

  // pull-to-refresh — vertical pulls only (sideways swipes are ignored), not from the chart (scrubbing),
  // the table (sideways scroll), form fields, or while a sheet is open; also refreshes News
  const ptr=$("#ptr"); let startX=0, startY=0, pulling=false, dist=0, axis=null;
  const THRESH=()=>window.innerHeight*0.18;
  window.addEventListener("touchstart",e=>{
    if(state.openSym || e.touches.length!==1 || window.scrollY>0) return;
    if(e.target.closest && e.target.closest(".chart-box,.table-wrap,.chart-stats,.sheet,input,select")) return;
    startX=e.touches[0].clientX; startY=e.touches[0].clientY; pulling=true; dist=0; axis=null; },{passive:true});
  window.addEventListener("touchmove",e=>{ if(!pulling) return; const dx=e.touches[0].clientX-startX, dy=e.touches[0].clientY-startY;
    if(!axis){ if(Math.abs(dx)<10 && Math.abs(dy)<10) return; axis=Math.abs(dy)>Math.abs(dx)?"y":"x"; }
    if(axis!=="y") return;
    dist=dy;
    if(dist>0 && window.scrollY<=0){ const p=Math.min(dist/THRESH(),1.3); ptr.classList.add("show");
      ptr.style.transform=`translateX(-50%) scale(${0.6+p*0.4})`+(REDUCE_MOTION?"":` rotate(${dist}deg)`); } },{passive:true});
  const endPull=async(doRefresh)=>{ if(!pulling) return; pulling=false;
    if(doRefresh && dist>THRESH()){ ptr.classList.add("spin"); loadNews(true); await refresh(true); ptr.classList.remove("spin"); }
    ptr.classList.remove("show"); ptr.style.transform="translateX(-50%) scale(.6)"; dist=0; };
  window.addEventListener("touchend",()=>endPull(true),{passive:true});
  window.addEventListener("touchcancel",()=>endPull(false),{passive:true});

  const tw=$("#tableScroll .table-wrap"); if(tw) tw.addEventListener("scroll",updateTableFade,{passive:true});

  // online/offline + background: no polling while hidden; catch up when visible again
  window.addEventListener("online",()=>{ state.offline=false; refresh(false); });
  window.addEventListener("offline",()=>{ state.offline=true; stopLive(); updateFreshness(); });
  document.addEventListener("visibilitychange",()=>{
    if(document.hidden){ stopAuto(); stopLive(); return; }
    startLive();
    if(state.auto && (!state.priceTs || Date.now()-state.priceTs>=AUTO_MS)) refresh(false);
    startAuto(); updateFreshness();
  });

  // CSV import: picker + drag-and-drop onto the same zone
  $("#fileCsv").addEventListener("change",e=>{ addImportFiles(e.target.files); e.target.value=""; });
  const dz=$("#dropZone");
  dz.addEventListener("dragover",e=>{ e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave",()=>dz.classList.remove("drag"));
  dz.addEventListener("drop",e=>{ e.preventDefault(); dz.classList.remove("drag"); addImportFiles(e.dataTransfer.files); });
  $("#recomputeBtn").addEventListener("click",applyImport);
  $("#resetBtn").addEventListener("click",clearImported);
  $("#backupBtn").addEventListener("click",exportBackup);
  $("#restoreInput").addEventListener("change",e=>{ const f=e.target.files[0]; e.target.value=""; if(f) restoreBackup(f); });

  // CoinGecko API key (Settings) — stored locally, applied to CG.demoKey immediately
  const keyMsg=$("#cgKeyMsg"), keyInput=$("#cgKeyInput");
  $("#cgKeySave").addEventListener("click",()=>{ const v=(keyInput.value||"").trim();
    if(!v){ keyMsg.className="msg err"; keyMsg.textContent="Enter a key first, or press Clear."; return; }
    CG.demoKey=v; try{localStorage.setItem("cg_key",v);}catch(e){}
    CG.cooldownUntil=0;                                   // a fresh key may lift throttling
    keyMsg.className="msg ok"; keyMsg.textContent="API key saved. Refreshing…"; renderSettingsMeta();
    refresh(true); loadChart(true);
  });
  $("#cgKeyClear").addEventListener("click",()=>{ CG.demoKey=null; try{localStorage.removeItem("cg_key");}catch(e){}
    keyInput.value=""; keyMsg.className="msg ok"; keyMsg.textContent="API key removed — using free tier."; renderSettingsMeta();
  });
}

/* ---------- init ---------- */
async function init(){
  loadPrefs();
  try{ const k=localStorage.getItem("cg_key"); if(k){ CG.demoKey=k; $("#cgKeyInput").value=k; } }catch(_){}
  const scale=(()=>{ try{ return localStorage.getItem("type_scale")||"1"; }catch(_){ return "1"; } })();
  document.documentElement.style.setProperty("--type-scale",scale);
  wire();
  applyPrefUI();
  markActive("#textSize button", b=>b.dataset.scale===scale);
  // manifest shortcuts: #portfolio, #settings, and #import (= Settings with "Kraken Data" open)
  const startHash=location.hash.slice(1);
  switchView(startHash==="import" ? "settings" : (startHash||"overview"), {instant:true});

  let loaded=false;
  try{ const u=normalizeData(JSON.parse(localStorage.getItem("user_data")||"null")); if(u){ setUserData(u); loaded=true; } }catch(e){}
  if(!loaded) await loadBundled();
  reconMsg();
  // onboarding on first run with data (the empty state covers the no-data case)
  try{ if(!localStorage.getItem("onboarded") && state.data.assets.length) $("#onboard").classList.add("show"); }catch(_){}
  loadCachedPrices();
  loadCachedLogos();
  loadCachedFX();
  renderCcyPicker();
  renderUndo();
  rawCache=await IDB.get(RAW_KEY);
  // manual holdings but nothing imported (or entries edited on another device and restored): build from them
  // (only when no portfolio is stored at all: never overwrite stored data we couldn't read, or data
  // another tab saved meanwhile)
  if(!state.data.assets.length && loadEntries().length && !localStorage.getItem("user_data")) await recompute();
  else if(rawCache && state.data.generated && state.data.engineV!==window.PortfolioEngine.ENGINE_V) await recompute();
  renderEntries(); renderWatch();
  { const km=cacheGet("kraken_meta"); if(km) window.PortfolioEngine.setAliases(km.aliases); }
  krakenMeta().then(m=>window.PortfolioEngine.setAliases(m.aliases)).catch(()=>{});
  applyTheme();
  renderAlertsList();
  initSections();
  render();
  if(startHash==="import") openSection("sec-import");
  try{ const f=JSON.parse(sessionStorage.getItem("flash")||"null"); sessionStorage.removeItem("flash");
    if(f) toast(f.msg, f.undo && readUndo() ? {label:"Undo", fn:undoLast} : null); }catch(e){}
  await refresh(true);
  startAuto();
  setInterval(updateFreshness,10000);
  loadChart(true);
  if(loaded) persistStorage();
  if("serviceWorker" in navigator){
    // a new deploy takes over immediately (sw.js: skipWaiting + clients.claim); tell the user so they can
    // reload into it. No toast on the very first install (there was no previous worker).
    let hadController=!!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange",()=>{
      if(!hadController){ hadController=true; return; }      // first install took control: not an update
      renderVersion(true);
      toast("A new version of My Crypto is ready", {label:"Reload", fn:()=>location.reload()}); });
    try{ const reg=await navigator.serviceWorker.register("./sw.js");
      // check for a new deploy when the app comes back to the foreground (at most hourly)
      let lastCheck=Date.now();
      document.addEventListener("visibilitychange",()=>{ if(!document.hidden && Date.now()-lastCheck>3600e3){ lastCheck=Date.now(); reg.update().catch(()=>{}); } });
    }catch(e){}
    renderVersion(false);
  }
}
document.addEventListener("DOMContentLoaded", init);
})();
