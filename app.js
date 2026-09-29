/* My Crypto — UI + live prices + FX + chart. Engine in engine.js. */
(() => {
"use strict";
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const REDUCE_MOTION = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  data: null,          // {assets, meta, warnings}
  prices: {},          // symbol -> EUR price
  priceTs: null,       // timestamp of current prices
  fx: { EUR:1 },       // display currency -> rate from 1 EUR (EUR base). Non-EUR filled live.
  ccy: "EUR",
  ccyPair: ["EUR","PLN"], // the two currencies offered by the top toggle (user-configurable)
  view: 1,             // 1 = All Holdings (total), 3 = Invested Only (deployed)
  tableOpt: 1,
  sortKey: "ret",      // table sort (default: Return %)
  sortDir: -1,
  auto: true,
  timer: null,
  freshTimer: null,
  chart: null,
  chartLoaded: false,
  chartBusy: false,
  hist: null,          // cached 365d history
  sparks: {},          // symbol -> last 30 daily prices (memory only, sparklines)
  chartRange: 365,     // chart window in days (365|30|7|0=All)
  detailRange: 30,     // per-asset detail chart window (7|30|365|0=All)
  detailChart: null,   // Chart instance for the detail sparkline (destroyed on redraw)
  cardSort: "ret",     // portfolio sort key
  cardQuery: "",       // portfolio search
  tableQuery: "",      // table search
  alerts: {},          // symbol -> target price (EUR)
  logos: {},           // symbol -> logo URL (CoinGecko markets)
  chg24: {},           // symbol -> 24h % change (CoinGecko markets)
  chg7: {},            // symbol -> 7d % change
  chg30: {},           // symbol -> 30d % change
  prevPx: {},          // symbol -> previous price, for subtle flash-on-change
  scrubbing: false,    // true while user is scrubbing the overview chart
  newsBusy: false,     // a news fetch pass is in flight
};

/* ---------- currencies ----------
   Base is always EUR internally; display currencies convert via Frankfurter (ECB, EUR-based).
   symbol + `pre` (symbol before amount?) drive formatting. Frankfurter supports these fiats. */
const CCY = {
  EUR:{symbol:"€",pre:true},  PLN:{symbol:"zł",pre:false},
  USD:{symbol:"$",pre:true},  GBP:{symbol:"£",pre:true},
  CHF:{symbol:"CHF",pre:false}, SEK:{symbol:"kr",pre:false},
  NOK:{symbol:"kr",pre:false}, DKK:{symbol:"kr",pre:false},
  CZK:{symbol:"Kč",pre:false}, JPY:{symbol:"¥",pre:true},
  CAD:{symbol:"$",pre:true},  AUD:{symbol:"$",pre:true},
  INR:{symbol:"₹",pre:true},  BRL:{symbol:"R$",pre:true},
};
const CCY_CODES = Object.keys(CCY);

/* persisted prefs: "alerts" holds targets, "prefs" holds UI choices. Queries are never stored. */
function loadPrefs(){
  try{ state.alerts = JSON.parse(localStorage.getItem("alerts")||"{}") || {}; }catch(e){ state.alerts={}; }
  let p={};
  try{ p = JSON.parse(localStorage.getItem("prefs")||"{}") || {}; }catch(e){ p={}; }
  state.cardSort  = p.cardSort  || "ret";
  state.chartRange= (p.chartRange!=null && !isNaN(+p.chartRange)) ? +p.chartRange : 365;
  state.view      = +p.view      || 1;
  state.tableOpt  = +p.tableOpt  || 1;
  state.sortKey   = p.sortKey   || "ret";
  state.sortDir   = +p.sortDir  || -1;
  // one-time migration: the table default changed to Return % desc, so override the persisted pair once
  if(p.prefsV!==2){ state.sortKey="ret"; state.sortDir=-1; }
  // currency pair (2 codes) + last-selected display currency
  if(Array.isArray(p.ccyPair) && p.ccyPair.length===2 && p.ccyPair.every(c=>CCY[c]))
    state.ccyPair = p.ccyPair;
  state.ccy = (p.ccy && CCY[p.ccy] && state.ccyPair.includes(p.ccy)) ? p.ccy : state.ccyPair[0];
}
function savePrefs(){
  try{ localStorage.setItem("prefs", JSON.stringify({
    cardSort:state.cardSort, chartRange:state.chartRange, view:state.view,
    tableOpt:state.tableOpt, sortKey:state.sortKey, sortDir:state.sortDir,
    ccyPair:state.ccyPair, ccy:state.ccy, prefsV:2 })); }catch(e){}
}
function saveAlerts(){ try{ localStorage.setItem("alerts", JSON.stringify(state.alerts)); }catch(e){} }
function applyPrefUI(){
  const cso=$("#cardSort"); if(cso) cso.value=state.cardSort;
  $$("#chartRange button").forEach(x=>x.classList.toggle("active",+x.dataset.range===state.chartRange));
  $$("#viewSwitch button,#viewSwitch2 button").forEach(x=>x.classList.toggle("active",+x.dataset.view===state.view));
  $$("#tableTabs button").forEach(x=>x.classList.toggle("active",+x.dataset.t===state.tableOpt));
  renderCcyToggle();
}
/* build the header currency toggle from the configured pair */
function renderCcyToggle(){
  const box=$("#ccyToggle"); if(!box) return;
  const label=c=>`${CCY[c].symbol} ${c}`;
  box.innerHTML=state.ccyPair.map(c=>
    `<button data-ccy="${esc(c)}" class="${c===state.ccy?'active':''}">${esc(label(c))}</button>`).join("");
}
/* build the two currency <select>s in Settings */
function renderCcyPicker(){
  const mk=(slot)=>{ const sel=$("#ccySlot"+slot); if(!sel) return;
    sel.innerHTML=CCY_CODES.map(c=>`<option value="${c}"${c===state.ccyPair[slot]?" selected":""}>${esc(CCY[c].symbol+" "+c)}</option>`).join("");
  };
  mk(0); mk(1);
}

/* ---------- formatting ---------- */
const esc = s => s==null ? "" : String(s).replace(/[&<>"'`]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;","`":"&#96;"}[c]));
const rate = () => state.fx[state.ccy] || 1;
const ccySuffix = (s) => { const c=CCY[state.ccy]||CCY.EUR;
  return c.pre ? `${c.symbol}${s}` : `${s}\u00A0${c.symbol}`; };
const fmtMoney = (eur) => {
  if (eur==null || isNaN(eur)) return "—";
  const v = eur * rate();
  return ccySuffix(v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}));
};
/* compact money for tight card space: €7.2K, €1.3M */
const fmtMoneyCompact = (eur) => {
  if (eur==null || isNaN(eur)) return "—";
  const v = eur * rate(); const a = Math.abs(v);
  let s;
  if (a >= 1e9) s = (v/1e9).toFixed(2)+"B";
  else if (a >= 1e6) s = (v/1e6).toFixed(2)+"M";
  else if (a >= 1e4) s = (v/1e3).toFixed(1)+"K";
  else s = v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  return ccySuffix(s);
};
const fmtQty = (x) => x==null ? "—" : x.toLocaleString(undefined,{maximumFractionDigits:8});
/* price-aware money: per-unit prices/avg-cost span huge ranges (PEPE ~€0.0000041 .. BTC €73k).
   Pick significant decimals by magnitude so tiny values never render as €0.00. */
const fmtPrice = (eur) => {
  if (eur==null || isNaN(eur)) return "—";
  const v = eur * rate(); const a = Math.abs(v);
  let dp;
  if (a === 0)      dp = 2;
  else if (a >= 1)  dp = 2;        // €63.07 — display prices, not exchange tick sizes
  else if (a >= 0.01) dp = 6;
  else {
    // very small: show ~4 significant figures after the leading zeros
    const leadingZeros = Math.floor(-Math.log10(a));
    dp = Math.min(12, leadingZeros + 4);
  }
  return ccySuffix(v.toLocaleString(undefined,{minimumFractionDigits:Math.min(dp,2),maximumFractionDigits:dp}));
};
const fmtQtyCompact = (x) => {
  if(x==null) return "—"; const a=Math.abs(x);
  if(a>=1e6) return (x/1e6).toFixed(2)+"M";
  if(a>=1e4) return x.toLocaleString(undefined,{maximumFractionDigits:0});
  return x.toLocaleString(undefined,{maximumFractionDigits:6});
};
const pct = (x) => x==null||isNaN(x) ? "—" : `${x>=0?"+":""}${x.toFixed(1)}%`;
const arrowOf = u => u==null?"":(u>=0?"▲":"▼");
const plColorOf = u => u==null?"var(--flat)":(u>=0?"var(--green)":"var(--red)");

/* inline SVG sparkline from a numeric series (last N points). CSP-safe, no per-row Chart.
   Returns "" when insufficient data. Colored by net direction over the window. */
function sparkSVG(points, w=54, h=18){
  if(!points || points.length<2) return "";
  const min=Math.min(...points), max=Math.max(...points), span=(max-min)||1;
  const n=points.length, dx=w/(n-1);
  const pts=points.map((p,i)=>`${(i*dx).toFixed(1)},${(h-((p-min)/span)*h).toFixed(1)}`).join(" ");
  const up=points[n-1]>=points[0];
  const col=up?"var(--green)":"var(--red)";
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none" aria-hidden="true">`+
         `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
/* last-7-day price series for an asset, from the cached history */
function spark7(sym){
  const h=state.hist&&state.hist[sym];
  if(!h||h.length<2) return null;
  return h.slice(-7).map(x=>x.p);
}

function ratioColor(ratio){
  if (ratio==null || isNaN(ratio)) return {c:"var(--flat)", dim:"var(--card2)"};
  if (ratio >= 1.5) return {c:"var(--green)", dim:"var(--green-dim)"};
  if (ratio > 1.0)  return {c:"var(--green)", dim:"color-mix(in srgb,var(--green) 22%, var(--card))"};
  if (ratio === 1.0)return {c:"var(--flat)", dim:"var(--card2)"};
  if (ratio > 0.8)  return {c:"var(--red)", dim:"color-mix(in srgb,var(--red) 20%, var(--card))"};
  return {c:"var(--red)", dim:"var(--red-dim)"};
}

/* ---------- CoinGecko request layer ----------
   Single place that builds CoinGecko URLs + headers and enforces a 429 cooldown.
   To upgrade to a Demo API key later: set CG.demoKey (or read from localStorage) — the
   header + host below switch automatically. No other code needs to change. */
const CG = {
  base: "https://api.coingecko.com/api/v3",
  demoKey: null,                 // later: put a CoinGecko Demo key here (client-visible; fine for demo plan)
  cooldownUntil: 0,              // epoch ms; while now < this, skip CoinGecko calls
};
function cgHeaders(){ return CG.demoKey ? {"x-cg-demo-api-key": CG.demoKey} : {}; }
function cgOnCooldown(){ return Date.now() < CG.cooldownUntil; }
/* central CoinGecko GET: honors cooldown, sets cooldown on 429 (respects Retry-After).
   Returns parsed JSON, or throws a tagged error. */
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
  const r = await fetch("./data.json",{cache:"no-store"});
  state.data = await r.json();
  $("#dataSource").textContent = "bundled snapshot ("+(state.data.generated||"")+")";
  reconMsg();
}
function reconMsg(){
  const w = state.data && state.data.warnings || [];
  $("#reconMsg").textContent = w.length
    ? `Reconciliation: ${w.length} asset(s) with zero-cost residual (e.g. ${esc(w[0].asset)}).`
    : "Reconciliation: all assets tie to Balances.";
}

/* ---------- live prices + FX ----------
   ONE coins/markets call provides price + 24h/7d/30d change + logo for every asset,
   staying well within the free-tier rate limit. Populates prices, changes and logos together. */
async function fetchMarkets(){
  const ids=[...new Set(state.data.assets.map(a=>a.cg_id).filter(Boolean))].map(encodeURIComponent).join(",");
  if(!ids) throw new Error("no ids");
  const d = await cgFetch(`/coins/markets?vs_currency=eur&ids=${ids}&per_page=250&price_change_percentage=24h,7d,30d`);
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
  if(Object.keys(px).length===0) throw new Error("no prices in markets response");
  state.prices=px; state.priceTs=Date.now();
  try{ localStorage.setItem("px_cache", JSON.stringify({t:state.priceTs,px})); }catch(e){}
  try{ localStorage.setItem("logo_cache", JSON.stringify(state.logos)); }catch(e){}
}
function loadCachedLogos(){
  try{ const l=JSON.parse(localStorage.getItem("logo_cache")||"null"); if(l) state.logos=l; }catch(e){}
}
async function fetchFX(){
  // fetch every non-EUR currency the user might display (the two in the pair)
  const wanted=[...new Set(state.ccyPair.filter(c=>c!=="EUR"))];
  if(!wanted.length){ state.fx.EUR=1; return; }
  try{
    const r = await fetch(`https://api.frankfurter.dev/v1/latest?base=EUR&symbols=${wanted.join(",")}`,{cache:"no-store"});
    const d = await r.json();
    if(d && d.rates){ let got=false;
      for(const c of wanted){ if(d.rates[c]!=null){ state.fx[c]=d.rates[c]; got=true; } }
      try{ localStorage.setItem("fx_cache", JSON.stringify(state.fx)); }catch(e){}
      if(got) return;
    }
  }catch(e){}
  // fallback: derive via CoinGecko BTC cross-rate (skip if throttled)
  if(cgOnCooldown()) return;
  try{
    const vs=wanted.map(c=>c.toLowerCase()).join(",");
    const d = await cgFetch(`/simple/price?ids=bitcoin&vs_currencies=eur,${vs}`);
    if(d.bitcoin && d.bitcoin.eur){ for(const c of wanted){ const k=c.toLowerCase();
      if(d.bitcoin[k]!=null) state.fx[c]=d.bitcoin[k]/d.bitcoin.eur; } }
    try{ localStorage.setItem("fx_cache", JSON.stringify(state.fx)); }catch(e){}
  }catch(e){}
}
function loadCachedFX(){
  try{ const c=JSON.parse(localStorage.getItem("fx_cache")||"null"); if(c){ for(const k in c) if(k!=="EUR") state.fx[k]=c[k]; } }catch(e){}
}
function loadCachedPrices(){
  try{ const c=JSON.parse(localStorage.getItem("px_cache")||"null"); if(c&&c.px){ state.prices=c.px; state.priceTs=c.t||null; } }catch(e){}
}

/* ---------- compute ---------- */
function computeRows(view){
  view = view || state.view;
  return state.data.assets.map(a=>{
    const px = state.prices[a.asset];
    const units = view===3 ? a.deployed_units : a.quantity;
    const value = px!=null ? units*px : null;
    const cost = a.cost_basis;
    const unreal = value!=null ? value-cost : null;
    const ratio = (value!=null && cost>0) ? value/cost : (cost===0 && value>0 ? 2 : null);
    const ret = (cost>0 && unreal!=null) ? unreal/cost*100 : null;
    const avg = a.quantity ? cost/a.quantity : 0;
    return {...a, px, units, value, cost, unreal, ratio, ret, avg, priced: px!=null};
  }).sort((x,y)=> (y.value??-1)-(x.value??-1));
}
function totals(rows){
  let v=0,c=0,u=0,any=false;
  for(const r of rows){ c+=r.cost; if(r.value!=null){v+=r.value;u+=r.unreal;any=true;} }
  return {v:any?v:null, c, u:any?u:null, ret:c>0&&any?u/c*100:null};
}
function computeForView(view){
  let v=0,c=0,u=0,any=false;
  for(const a of state.data.assets){ const px=state.prices[a.asset]; const units=view===3?a.deployed_units:a.quantity;
    c+=a.cost_basis; if(px!=null){const val=units*px; v+=val; u+=val-a.cost_basis; any=true;} }
  return {v:any?v:null,c,u:any?u:null,ret:c>0&&any?u/c*100:null};
}
/* break-even price for an asset's TOTAL holdings (price at which value==cost) */
function breakEvenPrice(a){ return a.quantity>0 ? a.cost_basis/a.quantity : null; }
/* lifetime P/L = realized (booked) + current unrealized (All Holdings view) */
function lifetimePL(){
  const r1=computeForView(1); const realized=state.data.meta.total_realized||0;
  return { realized, unreal:r1.u, total:(r1.u!=null?r1.u:0)+realized, haveUnreal:r1.u!=null };
}
/* portfolio 24h change: value-weighted from per-asset 24h % (CoinGecko markets).
   Uses current value as the weight; value_prev = value/(1+chg). Returns {abs,pct} in EUR. */
function portfolioChange(map){
  let valNow=0, valPrev=0, any=false;
  for(const a of state.data.assets){
    const px=state.prices[a.asset], ch=map[a.asset];
    if(px==null || ch==null) continue;
    const v=a.quantity*px; const prev=v/(1+ch/100);
    valNow+=v; valPrev+=prev; any=true;
  }
  if(!any || valPrev<=0) return null;
  return { abs:valNow-valPrev, pct:(valNow-valPrev)/valPrev*100 };
}
function portfolio24h(){ return portfolioChange(state.chg24); }
/* biggest 24h mover among held & priced assets (by absolute %) */
function topMover24h(){
  let best=null;
  for(const a of state.data.assets){
    const ch=state.chg24[a.asset]; if(ch==null || state.prices[a.asset]==null) continue;
    if(!best || Math.abs(ch)>Math.abs(best.chg)) best={asset:a.asset,chg:ch};
  }
  return best;
}
/* compact 24h / 7d / 30d portfolio-change chips (Delta/Coinbase style) */
function renderPeriodChips(){
  const box=$("#periodChips"); if(!box) return;
  const periods=[["24h",state.chg24],["7d",state.chg7],["30d",state.chg30]];
  const chip=(label,map)=>{ const c=portfolioChange(map);
    const col=plColorOf(c?c.pct:null);
    const v=c?`${arrowOf(c.pct)} ${pct(c.pct)}`:"—";
    return `<span class="chip"><span class="chip-k">${label}</span><span class="chip-v" style="color:${col}">${v}</span></span>`;
  };
  box.innerHTML=periods.map(([l,m])=>chip(l,m)).join("");
}
/* allocation as a single horizontal stacked bar (by current value share) + legend.
   Small holdings (<3%) fold into an "Other" segment to keep the bar legible. */
function renderAlloc(){
  const box=$("#alloc"); if(!box) return;
  const rows=state.data.assets.map(a=>{ const px=state.prices[a.asset];
    return {asset:a.asset, value: px!=null ? a.quantity*px : 0}; })
    .filter(r=>r.value>0).sort((x,y)=>y.value-x.value);
  const total=rows.reduce((s,r)=>s+r.value,0);
  if(total<=0){ box.innerHTML=""; return; }
  const big=[], small=[];
  for(const r of rows){ (r.value/total>=0.03 ? big : small).push(r); }
  const otherVal=small.reduce((s,r)=>s+r.value,0);
  const segs=big.map(r=>({asset:r.asset, pct:r.value/total*100, hue:assetHue(r.asset)}));
  if(otherVal>0) segs.push({asset:"Other", pct:otherVal/total*100, hue:220, other:true});
  const bar=segs.map(s=>
    `<span class="alloc-seg" style="width:${s.pct.toFixed(2)}%;background:${s.other?'var(--flat)':`hsl(${s.hue} 68% 55%)`}" title="${esc(s.asset)} ${s.pct.toFixed(1)}%"></span>`).join("");
  const legend=segs.map(s=>
    `<span class="alloc-key"><i style="background:${s.other?'var(--flat)':`hsl(${s.hue} 68% 55%)`}"></i>${esc(s.asset)} <b>${s.pct.toFixed(1)}%</b></span>`).join("");
  box.innerHTML=`<div class="alloc-h">Allocation</div><div class="alloc-bar">${bar}</div><div class="alloc-legend">${legend}</div>`;
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
  if(!state.priceTs){ el.textContent="Syncing…"; el.className="fresh-pill syncing"; return; }
  const stale = (Date.now()-state.priceTs) > 120000; // >2 min
  el.textContent = (state.offline?"Offline · ":"") + "Updated "+relTime(state.priceTs);
  el.className = "fresh-pill " + (state.offline ? "offline" : stale ? "stale" : "live");
}

/* deterministic per-asset hue for the holdings list avatars */
const AVATAR_HUES=[258,190,152,42,330,210,282,18,96,222];
function assetHue(sym){
  const s=String(sym||"?"); let h=0;
  for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0;
  return AVATAR_HUES[h%AVATAR_HUES.length];
}

/* ---------- overview (home) ----------
   renderOverview() shows LIVE totals. When the user scrubs the chart, renderOverview(scrub)
   is called with a historical snapshot {value, dateLabel, dayDelta} and the hero + stat strip
   reflect that day instead — no marker/tooltip is drawn on the chart itself. */
function renderOverview(scrub){
  const rows=computeRows(); const t=totals(rows);
  const m=state.data.meta;
  const nm = state.view===3 ? "Invested Only" : "All Holdings";
  const el=document.querySelector(".hero-view-name-2"); if(el) el.textContent=nm;
  const hero=$(".ov-hero"); if(hero) hero.classList.toggle("scrubbing", !!scrub);

  if(scrub){
    // historical: value on that day, P/L vs cost basis, day-over-day delta
    const cost=t.c;
    const unreal = scrub.value!=null ? scrub.value-cost : null;
    const ret = (cost>0 && unreal!=null) ? unreal/cost*100 : null;
    $("#sumHeroValue").textContent=fmtMoney(scrub.value);
    const pl=$("#sumHeroPL");
    const dd=scrub.dayDelta;
    pl.textContent = dd ? `${arrowOf(dd.d)} ${fmtMoney(Math.abs(dd.d))} (${pct(dd.p)})` : "—";
    pl.style.color = plColorOf(dd?dd.d:null);
    $("#sumHeroCost").textContent=fmtMoney(cost);
    const ltEl=$("#heroLifetime");
    if(ltEl){ const c=plColorOf(unreal);
      ltEl.innerHTML = `<span class="lt-k">On ${esc(scrub.dateLabel)}</span> `+
        `<span class="lt-v" style="color:${c}">${arrowOf(unreal)} ${unreal==null?"—":fmtMoney(unreal)} vs cost</span>`; }
    $("#sumStats").innerHTML=`
      <div class="stat"><div class="k">Value on day</div><div class="v">${fmtMoney(scrub.value)}</div>
        <div class="sub">${esc(scrub.dateLabel)}</div></div>
      <div class="stat"><div class="k">Day change</div><div class="v" style="color:${plColorOf(dd?dd.d:null)}">${dd?pct(dd.p):"—"}</div>
        <div class="sub">vs prior day</div></div>`;
    return;
  }

  const hv=$("#sumHeroValue");
  hv.textContent=fmtMoney(t.v);
  hv.classList.toggle("skeleton", t.v==null);   // shimmer until first price arrives
  const pl=$("#sumHeroPL");
  pl.textContent = t.u==null?"—":`${arrowOf(t.u)} ${fmtMoney(Math.abs(t.u))} (${pct(t.ret)})`;
  pl.style.color = plColorOf(t.u);
  $("#sumHeroCost").textContent=fmtMoney(t.c);

  // lifetime P/L (realized + unrealized)
  const lt=lifetimePL(); const ltEl=$("#heroLifetime");
  if(ltEl){ const c=plColorOf(lt.total);
    ltEl.innerHTML = `<span class="lt-k">Lifetime P/L</span> `+
      (lt.haveUnreal
        ? `<span class="lt-v" style="color:${c}">${arrowOf(lt.total)} ${fmtMoney(lt.total)}</span>`
        : `<span class="lt-v muted">—</span>`);
  }
  const p24=portfolio24h();     // value-weighted 24h change across held assets
  const mover=topMover24h();    // largest 24h move (by %) among held & priced assets
  renderPeriodChips();
  renderAlloc();
  $("#sumStats").innerHTML=`
    <div class="stat"><div class="k">Net invested</div><div class="v">${fmtMoney(m.net_deposited)}</div>
      <div class="sub">cash in − out</div></div>
    <div class="stat"><div class="k">24h change</div><div class="v" style="color:${plColorOf(p24?p24.pct:null)}">${p24?pct(p24.pct):"—"}</div>
      <div class="sub">${p24?(arrowOf(p24.abs)+" "+fmtMoneyCompact(Math.abs(p24.abs))):"live"}</div></div>
    <div class="stat"><div class="k">Realized</div><div class="v" style="color:${plColorOf(m.total_realized)}">${fmtMoney(m.total_realized)}</div>
      <div class="sub">already sold</div></div>
    <div class="stat"><div class="k">Top mover</div><div class="v" style="color:${plColorOf(mover?mover.chg:null)}">${mover?esc(mover.asset):"—"}</div>
      <div class="sub">${mover?pct(mover.chg):"—"}</div></div>`;
}

/* ---------- portfolio flat list (Cards tab) ---------- */
function renderPortfolio(){
  const rows=computeRows(); const t=totals(rows);
  $(".hero-view-name").textContent = state.view===3 ? "Invested Only" : "All Holdings";
  const note=$("#viewNote"); if(note) note.textContent = state.view===3
    ? "Only the coins you paid for (excludes gifts & staking rewards)."
    : "Everything you hold, including gifts & staking rewards.";
  $("#heroValue").textContent = fmtMoney(t.v);
  const plEl=$("#heroPL");
  plEl.textContent = t.u==null ? "—" : `${arrowOf(t.u)} ${fmtMoney(Math.abs(t.u))} (${pct(t.ret)})`;
  plEl.style.color = plColorOf(t.u);
  $("#heroCost").textContent = fmtMoney(t.c);

  const box=$("#portfolioList"); if(!box) return;
  // filter + sort (#5, #6)
  let list=rows.slice();
  const q=state.cardQuery.trim().toUpperCase();
  if(q) list=list.filter(r=>r.asset.toUpperCase().includes(q));
  const key=state.cardSort;
  const cmp={value:(a,b)=>(b.value??-1)-(a.value??-1),
             unreal:(a,b)=>(b.unreal??-1e18)-(a.unreal??-1e18),
             ret:(a,b)=>(b.ret??-1e18)-(a.ret??-1e18),
             asset:(a,b)=>a.asset.localeCompare(b.asset)}[key];
  list.sort(cmp);
  if(!list.length){ box.innerHTML='<div class="empty muted">No assets match.</div>'; return; }
  box.innerHTML=list.map(r=>{
    const c=plColorOf(r.unreal);
    // alert badge (#10)
    const tgt=state.alerts[r.asset];
    const hit = tgt!=null && r.px!=null && r.px>=tgt;
    const bell = tgt!=null ? `<span class="alert-badge${hit?' hit':''}" title="Target ${esc(fmtMoney(tgt))}">🔔</span>` : "";
    // real coin logo layered over the colored-initial fallback (fallback shows if img fails)
    const logo=state.logos[r.asset];
    const img = logo ? `<img class="h-logo" src="${esc(logo)}" alt="" loading="lazy" decoding="async"/>` : "";
    // 24h change (Coinbase/Delta-style) on the sub-line
    const ch=state.chg24[r.asset];
    const chSpan = ch!=null ? ` <span class="h-24h" style="color:${plColorOf(ch)}">${pct(ch)}</span>` : "";
    // 7-day sparkline (inline SVG from cached history)
    const spark=sparkSVG(spark7(r.asset));
    const sparkCell = spark ? `<span class="h-spark">${spark}</span>` : "";
    return `<button class="hrow" data-asset="${esc(r.asset)}">
      <span class="h-ic" style="--h:${assetHue(r.asset)}">${esc(r.asset.slice(0,1).toUpperCase())}${img}</span>
      <span class="h-main">
        <span class="h-name">${esc(r.asset)}</span>
        <span class="h-sub">${r.px==null?"—":fmtPrice(r.px)}${chSpan}</span>
      </span>
      ${sparkCell}
      <span class="h-right">
        <span class="h-val">${fmtMoneyCompact(r.value)}</span>
        <span class="h-chg" style="color:${c}">${r.unreal==null?"":(r.ret!=null?arrowOf(r.unreal)+" "+pct(r.ret):"free")}</span>
      </span>${bell}</button>`;
  }).join("");
  applyPriceFlash();
}
/* subtle flash on rows whose price moved since the last render (respects reduced-motion) */
function applyPriceFlash(){
  if(REDUCE_MOTION) { for(const a of state.data.assets) state.prevPx[a.asset]=state.prices[a.asset]; return; }
  const box=$("#portfolioList"); if(!box) return;
  for(const a of state.data.assets){
    const sym=a.asset, cur=state.prices[sym], prev=state.prevPx[sym];
    if(cur!=null && prev!=null && cur!==prev){
      const el=box.querySelector(`.hrow[data-asset="${CSS.escape(sym)}"]`);
      if(el){ const cls=cur>prev?"flash-up":"flash-down";
        el.classList.remove("flash-up","flash-down"); void el.offsetWidth; el.classList.add(cls);
        setTimeout(()=>el.classList.remove(cls),900); }
    }
    state.prevPx[sym]=cur;
  }
}

/* ---------- table (sortable #3) ---------- */
const SORTS={asset:(a,b)=>a.asset.localeCompare(b.asset),quantity:(a,b)=>a.units-b.units,
  cost:(a,b)=>a.cost_basis-b.cost_basis,value:(a,b)=>(a.value??-1)-(b.value??-1),
  unreal:(a,b)=>(a.unreal??-1e18)-(b.unreal??-1e18),ret:(a,b)=>(a.ret??-1e18)-(b.ret??-1e18)};
function renderTable(){
  const opt=state.tableOpt;
  let rows=state.data.assets.map(a=>{
    const px=state.prices[a.asset];
    const units= opt===3 ? a.deployed_units : a.quantity;
    const value= px!=null ? units*px : null;
    const unreal= value!=null ? value-a.cost_basis : null;
    const ret=(a.cost_basis>0&&unreal!=null)?unreal/a.cost_basis*100:null;
    return {...a,units,value,unreal,ret,priced:px!=null};
  });
  const cmp=SORTS[state.sortKey]||SORTS.value;
  rows.sort((a,b)=> state.sortDir*cmp(a,b));
  // table search filter (#5)
  const tq=state.tableQuery.trim().toUpperCase();
  const filtered = tq ? rows.filter(r=>r.asset.toUpperCase().includes(tq)) : rows;
  const cols=[["asset","Asset"],["quantity","Quantity"],["cost","You paid"],["value","Value now"],["unreal","Profit/Loss"],["ret","Return"]];
  const thead=$("#mainTable thead"), tbody=$("#mainTable tbody");
  thead.innerHTML="<tr>"+cols.map(([k,label])=>{
    const active=state.sortKey===k; const car=active?(state.sortDir<0?" ▾":" ▴"):"";
    return `<th data-sort="${k}" class="${active?'sorted':''}">${label}${car}</th>`;
  }).join("")+"</tr>";
  tbody.innerHTML="";
  let tv=0,tc=0,tu=0,any=false;
  for(const r of filtered){
    tc+=r.cost_basis; if(r.value!=null){tv+=r.value;tu+=r.unreal;any=true;}
    const clr=plColorOf(r.unreal); const arrow=r.unreal==null?"":(r.unreal>=0?"▲ ":"▼ ");
    const trend=r.unreal==null?"flat":(r.unreal>=0?"up":"down");
    const tr=document.createElement("tr"); tr.dataset.asset=r.asset;
    tr.innerHTML=`<td class="asset-cell" data-trend="${trend}"><span class="asset-dot"></span><span class="asset-name" style="color:${clr}">${esc(r.asset)}</span></td><td>${fmtQty(r.units)}</td><td>${fmtMoney(r.cost_basis)}</td>
      <td>${r.value==null?'<span class="muted">no price</span>':fmtMoney(r.value)}</td>
      <td style="color:${clr}">${r.unreal==null?"—":arrow+fmtMoney(Math.abs(r.unreal))}</td>
      <td style="color:${clr}">${pct(r.ret)}</td>`;
    tbody.appendChild(tr);
  }
  const tr=document.createElement("tr"); tr.className="totrow";
  tr.innerHTML=`<td class="asset-cell">TOTAL</td><td></td><td>${fmtMoney(tc)}</td><td>${fmtMoney(any?tv:null)}</td>
    <td>${fmtMoney(any?tu:null)}</td><td>${pct(any&&tc>0?tu/tc*100:null)}</td>`;
  tbody.appendChild(tr);
  renderSummaryPanel();
  updateTableFade();
}
function renderSummaryPanel(){
  const m=state.data.meta;
  const r1=computeForView(1), r3=computeForView(3);
  $("#summary").innerHTML=`
    <h3>Headline</h3>
    <div class="row"><span class="k">Invested Only · value / return</span><span>${fmtMoney(r3.v)} (${pct(r3.ret)})</span></div>
    <div class="row"><span class="k">All Holdings · value / return</span><span>${fmtMoney(r1.v)} (${pct(r1.ret)})</span></div>
    <div class="row"><span class="k">You paid (cost basis)</span><span>${fmtMoney(r1.c)}</span></div>
    <div class="row"><span class="k">Free coins value (gifts + rewards)</span><span>${fmtMoney(r1.v!=null&&r3.v!=null?r1.v-r3.v:null)}</span></div>
    <hr/><h3>EUR flows</h3>
    <div class="row"><span class="k">Deposited</span><span>${fmtMoney(m.total_deposited)}</span></div>
    <div class="row"><span class="k">Withdrawn</span><span>${fmtMoney(m.total_withdrawn)}</span></div>
    <div class="row"><span class="k">Net deposited</span><span>${fmtMoney(m.net_deposited)}</span></div>
    <div class="row"><span class="k">Realized profit (already sold)</span><span>${fmtMoney(m.total_realized)}</span></div>`;
}
function updateTableFade(){
  const ts=$("#tableScroll"), tw=ts&&ts.querySelector(".table-wrap");
  if(tw){ const end=tw.scrollLeft+tw.clientWidth >= tw.scrollWidth-4; ts.classList.toggle("at-end",end); }
}

/* ---------- per-asset detail sheet (#1) ---------- */
function openDetail(sym){
  const a=state.data.assets.find(x=>x.asset===sym); if(!a) return;
  state.openSym=sym;
  const px=state.prices[sym];
  const totalVal = px!=null ? a.quantity*px : null;
  const depVal   = px!=null ? a.deployed_units*px : null;
  const freeUnits= a.quantity - a.deployed_units;
  const freeVal  = px!=null ? freeUnits*px : null;
  const unreal   = totalVal!=null ? totalVal-a.cost_basis : null;
  const ret      = a.cost_basis>0&&unreal!=null?unreal/a.cost_basis*100:null;
  const avg      = a.quantity?a.cost_basis/a.quantity:0;
  const bep      = breakEvenPrice(a);          // price at which value == cost
  const toBreakeven = (px!=null && bep!=null) ? (bep-px)/px*100 : null; // % move needed
  const aboveBE  = px!=null && bep!=null ? px>=bep : null;
  const col=ratioColor(px!=null&&a.cost_basis>0?totalVal/a.cost_basis:null);
  const tgt=state.alerts[sym];

  $("#detailTitle").textContent=sym;
  $("#detailBody").innerHTML=`
    <div class="d-hero" style="background:${col.dim}">
      <div class="d-val">${fmtMoney(totalVal)}</div>
      <div class="d-pl" style="color:${plColorOf(unreal)}">${arrowOf(unreal)} ${unreal==null?"—":fmtMoney(unreal)} (${pct(ret)})</div>
    </div>
    <div class="d-grid">
      <div class="d-cell"><div class="k">Live price</div><div class="v">${px==null?"—":fmtPrice(px)}</div></div>
      <div class="d-cell"><div class="k">Avg cost / unit</div><div class="v">${fmtPrice(avg)}</div></div>
      <div class="d-cell"><div class="k">You paid (cost)</div><div class="v">${fmtMoney(a.cost_basis)}</div></div>
      <div class="d-cell"><div class="k">Realized profit</div><div class="v">${fmtMoney(a.realized)}</div></div>
    </div>
    <h4>Holdings breakdown</h4>
    <div class="d-row"><span>Total quantity</span><span>${fmtQty(a.quantity)}</span></div>
    <div class="d-row"><span>Invested (paid for)</span><span>${fmtQty(a.deployed_units)} · ${fmtMoney(depVal)}</span></div>
    <div class="d-row"><span>Free coins (gifts+rewards)</span><span>${fmtQty(freeUnits)} · ${fmtMoney(freeVal)}</span></div>
    <h4>Break-even</h4>
    <div class="d-row"><span>Break-even price</span><span>${bep==null?"—":fmtPrice(bep)}</span></div>
    <div class="d-row"><span>Status</span><span style="color:${aboveBE==null?'var(--flat)':(aboveBE?'var(--green)':'var(--red)')}">${
      aboveBE==null?"—":(aboveBE
        ? "▲ above break-even"
        : "▼ needs "+ (toBreakeven!=null?("+"+toBreakeven.toFixed(1)+"%"):"—") +" to break even")}</span></div>
    <h4>Price alert</h4>
    <div class="d-alert">
      <input type="number" inputmode="decimal" id="alertInput" class="alert-input" placeholder="Target price (${state.ccy})" value="${tgt!=null?(function(x){const v=tgt*rate();const a=Math.abs(v);const dp=a>=1?4:Math.min(12,Math.floor(-Math.log10(a||1))+5);return v.toFixed(dp).replace(/0+$/,'').replace(/\.$/,'');})():''}"/>
      <button id="alertSet" class="chip-btn">${tgt!=null?"Update":"Set"}</button>
      ${tgt!=null?'<button id="alertClear" class="chip-btn ghost">Clear</button>':""}
    </div>
    <div class="muted small" style="margin-top:6px">Alerts show an in-app badge when the live price reaches your target. (iOS PWAs can't send push notifications.)</div>
    <div class="d-spark-head">
      <span class="d-sparklabel muted small" id="dSparkLabel">30-day price (approx.)</span>
      <div class="d-spark-range" id="dSparkRange" role="group" aria-label="Detail chart range">
        <button data-dr="7" class="${state.detailRange===7?'active':''}">1W</button>
        <button data-dr="30" class="${state.detailRange===30?'active':''}">1M</button>
        <button data-dr="365" class="${state.detailRange===365?'active':''}">1Y</button>
        <button data-dr="0" class="${state.detailRange===0?'active':''}">All</button>
      </div>
    </div>
    <div class="d-spark"><canvas id="sparkCanvas"></canvas></div>`;
  $("#detailSheet").classList.add("open");
  $("#detailBackdrop").classList.add("open");
  // alert set/clear (#10) — input is in display currency, stored in EUR
  const setBtn=$("#alertSet");
  if(setBtn) setBtn.addEventListener("click",()=>{
    const raw=parseFloat($("#alertInput").value);
    if(!isNaN(raw)&&raw>0){ state.alerts[sym]=raw/rate(); saveAlerts(); renderPortfolio(); openDetail(sym); }
  });
  const clrBtn=$("#alertClear");
  if(clrBtn) clrBtn.addEventListener("click",()=>{ delete state.alerts[sym]; saveAlerts(); renderPortfolio(); openDetail(sym); });
  drawSparkline(a);
}
function closeDetail(){ $("#detailSheet").classList.remove("open"); $("#detailBackdrop").classList.remove("open"); }
const SPARK_PLACEHOLDER='<div class="muted small" style="padding:20px 0;text-align:center">Price history loads…</div>';
const SPARK_CANVAS='<canvas id="sparkCanvas"></canvas>';
/* daily closes for the detail chart, honoring state.detailRange (7|30|365|0=All).
   Full history lives in state.hist; slice from it. Falls back to a 30d fetch if no history yet. */
function sparkPoints(a){
  const h=state.hist&&state.hist[a.asset];
  if(h&&h.length>=2){
    const r=+state.detailRange||0;
    const arr = r>0 ? h.slice(-r) : h;
    return arr.length>=2 ? arr.map(x=>x.p) : null;
  }
  let pts=state.sparks[a.asset];
  return (pts&&pts.length>=2)?pts:null;
}
async function fetchSpark(a){
  try{
    const r=+state.detailRange||365;
    const days = r>0 ? r : 365;
    const d=await cgFetch(`/coins/${encodeURIComponent(a.cg_id)}/market_chart?vs_currency=eur&days=${days}&interval=daily`);
    const arr=(d.prices||[]).map(p=>p[1]);
    if(arr.length<2) return null;
    state.sparks[a.asset]=arr; return arr;
  }catch(e){ return null; }
}
const DR_LABEL={7:"7-day",30:"30-day",365:"1-year",0:"All-time"};
async function drawSparkline(a){
  if(!window.Chart) return;
  const canvas=$("#sparkCanvas"); if(!canvas) return;
  const box=canvas.parentElement;
  const lbl=$("#dSparkLabel"); if(lbl) lbl.textContent=(DR_LABEL[+state.detailRange]||"")+" price (approx.)";
  let pts=sparkPoints(a);
  if(!pts){
    box.innerHTML=SPARK_PLACEHOLDER;
    if(!a.cg_id) return;
    pts=await fetchSpark(a);
    if(!pts) return;                                        // failure keeps the placeholder
    if($("#detailTitle").textContent!==a.asset) return;     // sheet moved on to another asset
    box.innerHTML=SPARK_CANVAS;
  }
  const cv=$("#sparkCanvas"); if(!cv) return;
  if(state.detailChart){ try{state.detailChart.destroy();}catch(e){} }
  const up=pts[pts.length-1]>=pts[0];
  state.detailChart=new Chart(cv.getContext("2d"),{type:"line",data:{labels:pts.map((_,i)=>i),
    datasets:[{data:pts,borderColor:up?"#16C784":"#EA3943",borderWidth:2,pointRadius:0,tension:.3,fill:false}]},
    options:{responsive:true,maintainAspectRatio:false,animation:REDUCE_MOTION?false:{duration:300},
      plugins:{legend:{display:false},tooltip:{enabled:false}},scales:{x:{display:false},y:{display:false}}}});
}

/* ---------- 365-day chart (#13 cache-first) ---------- */
async function loadChart(background){
  if(!window.Chart){ setTimeout(()=>loadChart(background),300); return; }
  const today=new Date().toISOString().slice(0,10);
  const cacheKey="hist_"+today;
  let hist=state.hist;
  if(!hist){ try{ hist=JSON.parse(localStorage.getItem(cacheKey)||"null"); }catch(e){} }
  if(hist){ state.hist=hist; drawChart(hist); }           // show cached instantly
  // Only fetch history when we genuinely need to:
  //  - never when offline, or while CoinGecko is on 429 cooldown
  //  - not if we already have today's cache (tab opens must NOT refetch)
  //  - at most once per calendar day (persistent flag), unless there's no data yet
  if(!navigator.onLine || cgOnCooldown()) return;
  const fetchedToday = (()=>{ try{ return localStorage.getItem("hist_fetched")===today; }catch(e){ return false; } })();
  if(hist && fetchedToday) return;                        // fresh for today — done
  if(hist && !background) return;                         // have data, foreground open — don't spend calls
  // fetch fresh in background, sequentially, via the throttled cgFetch (respects cooldown/key)
  const fresh={};
  for(const a of state.data.assets){
    if(!a.cg_id) continue;
    if(cgOnCooldown()) break;                             // stop the moment we're throttled
    try{
      const d=await cgFetch(`/coins/${encodeURIComponent(a.cg_id)}/market_chart?vs_currency=eur&days=365&interval=daily`);
      fresh[a.asset]=(d.prices||[]).map(p=>({t:p[0],p:p[1]}));
      await new Promise(res=>setTimeout(res,350));
    }catch(e){ if(e && (e.rate||e.cooldown)) break; }
  }
  if(Object.keys(fresh).length){
    // merge (a partial fetch shouldn't wipe assets we already had)
    state.hist=Object.assign({}, state.hist||{}, fresh);
    try{localStorage.setItem(cacheKey,JSON.stringify(state.hist));}catch(e){}
    // mark done for today only if we got every asset (so a partial run retries later)
    const complete=state.data.assets.filter(a=>a.cg_id).every(a=>state.hist[a.asset]);
    if(complete){ try{localStorage.setItem("hist_fetched",today);}catch(e){} }
    drawChart(state.hist);
  }
  else if(!hist){ $("#chartStats").innerHTML='<div class="stat"><div class="k">Chart</div><div class="v">unavailable</div></div>'; }
}
function drawChart(hist){
  let base=null;
  for(const a of state.data.assets){ const h=hist[a.asset]; if(h&&(!base||h.length>base.length)) base=h; }
  if(!base) return;
  const rawRange=+state.chartRange||0;              // 0 = All (full history)
  const range = rawRange>0 ? rawRange : base.length;
  const days=base.map(x=>x.t);
  const valueSeries=days.map((t,i)=>{ let v=0; for(const a of state.data.assets){ const h=hist[a.asset]; if(!h||!h[i]) continue; v+=a.quantity*h[i].p; } return v; });
  const totalCost=state.data.assets.reduce((s,a)=>s+a.cost_basis,0);
  const rt=rate();
  const dayLabel=t=>new Date(t).toLocaleDateString(undefined,{month:"short",day:"numeric"});
  // display window = last `range` points; the full series stays for the slice boundary
  const from=Math.max(0,valueSeries.length-range);
  const slDays=days.slice(from), slVals=valueSeries.slice(from);
  const labels=slDays.map(dayLabel);
  const valConv=slVals.map(v=>v*rt), costLine=slDays.map(()=>totalCost*rt);
  const rangeLabel = rawRange>0 ? (range+" days") : "All time";
  const secK=document.querySelector(".ov-sec-k"); if(secK) secK.textContent=rangeLabel;
  if(state.chart) state.chart.destroy();
  const ctx=$("#valueChart").getContext("2d");
  const start=slVals.find(v=>v>0)||0, lastVal=slVals[slVals.length-1]||0;
  const liveV=computeForView(1).v;
  const trend=start?((lastVal-start)/start*100):null;
  const chg=(start&&liveV!=null)?((liveV-start)/start*100):null;
  const [lineHex,rgb]=(trend==null||trend===0)?["#8A90A0","138,144,160"]:(trend>0?["#16C784","22,199,132"]:["#EA3943","234,57,67"]);
  const gh=ctx.canvas.height||150;
  const grad=ctx.createLinearGradient(0,0,0,gh);
  grad.addColorStop(0,`rgba(${rgb},0.35)`); grad.addColorStop(1,`rgba(${rgb},0.02)`);
  const css=getComputedStyle(document.documentElement);
  const ink=(n)=>(css.getPropertyValue(n)||"").trim();
  const tintBg=ink("--bg")||"#0B0D12";   // dot border blends into chart background
  // day-over-day change of a displayed point, read off the full series
  const dayDelta=(i)=>{ const prev=i>0?valueSeries[i-1]:null, cur=valueSeries[i];
    return (prev!=null&&prev>0)?{d:cur-prev,p:(cur-prev)/prev*100}:null; };
  const deltaHex=(d)=>d==null?"#8A90A0":(d>=0?"#16C784":"#EA3943");
  // stash the displayed window so the scrub handler can map an index -> value/day
  state.chartView={ from, days, valueSeries, slVals, dayLabel, dayDelta };
  // crosshair plugin: draws a thin vertical guide at the active index (position only, no value box)
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
    const gi=from+idx;
    state.scrubbing=true;
    renderOverview({ value:valueSeries[gi], dateLabel:dayLabel(days[gi]), dayDelta:dayDelta(gi) });
  };
  state.chartScrubTo=scrubTo;
  // trade-event dots (subtle): map each buy/sell to the nearest displayed day, sit it on the value line
  const evOn = state.showEvents!==false ? (state.data.events||[]) : [];
  const buyPts=new Array(slDays.length).fill(null), sellPts=new Array(slDays.length).fill(null);
  if(evOn.length && slDays.length){
    const winStart=slDays[0], winEnd=slDays[slDays.length-1];
    const step = slDays.length>1 ? (slDays[1]-slDays[0]) : 864e5;
    for(const ev of evOn){
      if(ev.t<winStart-step || ev.t>winEnd+step) continue;      // outside visible window
      // nearest displayed index
      let idx=Math.round((ev.t-winStart)/step);
      idx=Math.max(0,Math.min(slDays.length-1,idx));
      const y=slVals[idx]; if(y==null) continue;
      if(ev.type==="sell") sellPts[idx]=y*rt; else buyPts[idx]=y*rt;
    }
  }
  const hasEv = buyPts.some(v=>v!=null)||sellPts.some(v=>v!=null);
  state.chart=new Chart(ctx,{type:"line",plugins:[crosshair],data:{labels,datasets:[
    {label:"Value",data:valConv,borderColor:lineHex,backgroundColor:grad,fill:true,tension:.3,pointRadius:0,borderWidth:2},
    {label:"Cost",data:costLine,borderColor:"#8A90A0",borderDash:[6,5],fill:false,pointRadius:0,borderWidth:1.5},
    {label:"Buys",data:buyPts,showLine:false,pointStyle:"circle",pointRadius:hasEv?3:0,
      pointBackgroundColor:"rgba(22,199,132,0.9)",pointBorderColor:tintBg,pointBorderWidth:1.5,pointHoverRadius:4},
    {label:"Sells",data:sellPts,showLine:false,pointStyle:"circle",pointRadius:hasEv?3:0,
      pointBackgroundColor:"rgba(234,57,67,0.9)",pointBorderColor:tintBg,pointBorderWidth:1.5,pointHoverRadius:4}
  ]},options:{responsive:true,maintainAspectRatio:false,animation:REDUCE_MOTION?false:{duration:400},
    interaction:{intersect:false,mode:"index",axis:"x"},
    // scrub: update the whole Overview tab to the hovered day; no on-chart value box
    onHover:(e,els)=>{ if(els&&els.length) scrubTo(els[0].index); },
    plugins:{legend:{display:false},tooltip:{enabled:false}},
    scales:{x:{ticks:{display:false},grid:{display:false}},
            y:{ticks:{display:false},grid:{color:"rgba(138,144,160,.12)"}}}}});
  // release scrub when the pointer leaves the canvas / touch ends -> restore live values
  const cv=$("#valueChart");
  if(cv && !cv._scrubWired){
    const release=()=>{ if(state.scrubbing){ state.scrubbing=false; renderOverview(); if(state.chart){ state.chart.setActiveElements([]); state.chart.update("none"); } } };
    cv.addEventListener("pointerleave",release);
    cv.addEventListener("touchend",release,{passive:true});
    cv.addEventListener("touchcancel",release,{passive:true});
    cv._scrubWired=true;
  }
  const sw=document.querySelector(".chart-legend .sw.val"); if(sw) sw.style.background=lineHex;
  const sl=slVals.filter(v=>v>0);
  const hi=sl.length?Math.max(...sl):null, lo=sl.length?Math.min(...sl):null;
  // daily returns inside the window (includes the change into the window's first day)
  const rets=[]; for(let i=Math.max(1,from);i<valueSeries.length;i++){ const p=valueSeries[i-1], c=valueSeries[i];
    if(p>0&&c>0) rets.push((c-p)/p); }
  const bestDay = rets.length?Math.max(...rets)*100:null;
  const worstDay= rets.length?Math.min(...rets)*100:null;
  const stat=(k,v,color)=>`<div class="stat"><div class="k">${k}</div><div class="v"${color?` style="color:${color}"`:""}>${v}</div></div>`;
  const perLbl = rawRange>0 ? `${range}-day` : "All-time";
  $("#chartStats").innerHTML=
    stat("Current value", fmtMoney(liveV))+
    stat(`${perLbl} change`, `${arrowOf(chg)} ${pct(chg)}`, chg>=0?'var(--green)':'var(--red)')+
    stat(`${perLbl} high`, hi==null?"—":fmtMoney(hi))+
    stat(`${perLbl} low`, lo==null?"—":fmtMoney(lo))+
    stat("Best day", bestDay==null?"—":pct(bestDay), 'var(--green)')+
    stat("Worst day", worstDay==null?"—":pct(worstDay), 'var(--red)');
  state.chartLoaded=true;
}
/* debounced chart refresh (#12) */
let chartDebounce=null;
function refreshChartsSoon(){ clearTimeout(chartDebounce); chartDebounce=setTimeout(()=>{ if(state.chartLoaded && state.hist) drawChart(state.hist); },180); }

/* ---------- refresh cycle ---------- */
async function refresh(manual){
  const btn=$("#refreshBtn"); btn.classList.add("spin");
  // if CoinGecko throttled us, don't hammer — show cooldown state and bail early
  if(cgOnCooldown() && !manual){
    loadCachedPrices(); render();
    const secs=Math.ceil((CG.cooldownUntil-Date.now())/1000);
    setBanner({kind:"warn", msg:`Rate-limited by price service — retrying in ${secs}s. Showing last known values.`});
    btn.classList.remove("spin"); updateFreshness(); return;
  }
  try{
    // fetch FX if any non-EUR currency in the pair is missing a rate
    const needFX = state.ccyPair.some(c=>c!=="EUR" && state.fx[c]==null);
    // ONE coins/markets call now covers price + changes + logos
    await Promise.all([fetchMarkets(), needFX?fetchFX():Promise.resolve()]);
    state.offline=false;
    setBanner(null);
    render();
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
        : {kind:"error", msg:"Can't reach price service. Pull to refresh to retry."});
    }
  }finally{ setTimeout(()=>btn.classList.remove("spin"),400); updateFreshness(); }
}
/* friendly network/error banner (null hides it) */
function setBanner(b){
  const el=$("#netBanner"); if(!el) return;
  if(!b){ el.hidden=true; el.textContent=""; el.className="net-banner"; return; }
  el.hidden=false; el.textContent=b.msg; el.className="net-banner "+(b.kind||"warn");
}
function render(){ if(!state.scrubbing) renderOverview(); renderPortfolio(); renderTable(); }
const AUTO_MS=60000;   // 60s auto-refresh — well within CoinGecko free-tier limits
function startAuto(){ stopAuto(); if(state.auto){ state.timer=setInterval(()=>refresh(false),AUTO_MS);}
  $("#autoState").textContent=state.auto?"auto 60s":"auto off"; $("#autoState").className=state.auto?"auto-on":"auto-off"; }
function stopAuto(){ if(state.timer){clearInterval(state.timer);state.timer=null;} }

/* ---------- news (rss2json, cache-first) ----------
   Four crypto RSS feeds proxied through the free rss2json endpoint (CORS *, no key). The free
   tier 422s on count/order_by/order_dir, so those params are never sent and the per-feed cap is
   sliced client-side. Cache-first per feed ("news_"+url, 15 min TTL): cached items paint
   instantly, the network only refetches in the background when stale. Always fire-and-forget —
   it never gates a price refresh, and a fresh cache makes loadNews() a no-op. */
const NEWS_TTL = 15*60*1000;
const NEWS_PER_FEED = 10;
const NEWS_MAX = 20;
const FEEDS = [
  { name:"Cointelegraph", url:"https://cointelegraph.com/rss" },
  { name:"CoinDesk",       url:"https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { name:"Decrypt",        url:"https://decrypt.co/feed" },
  { name:"The Block",      url:"https://www.theblock.co/rss.xml" },
];
const stripHTML = s => String(s==null?"":s).replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
/* rss2json pubDate is "YYYY-MM-DD HH:mm:ss" in UTC — make the zone explicit, Safari needs it */
const newsDate = s => { const t=Date.parse(String(s==null?"":s).replace(" ","T")+"Z"); return isNaN(t)?0:t; };
function readNewsCache(f){
  try{ const c=JSON.parse(localStorage.getItem("news_"+f.url)||"null");
    return (c && Array.isArray(c.items)) ? c : null; }catch(e){ return null; }
}
function writeNewsCache(f, items){
  try{ localStorage.setItem("news_"+f.url, JSON.stringify({t:Date.now(), items})); }catch(e){}
}
/* one raw rss2json item -> our card shape (everything untrusted; escaped at render) */
function normalizeNews(f, it){
  // rss2json returns enclosure as {link}, but the array form is documented too — take either
  const enc = Array.isArray(it.enclosure) ? it.enclosure[0] : it.enclosure;
  const encLink = enc && typeof enc==="object" ? enc.link : "";
  const rawImg = String(it.thumbnail || encLink || "");
  return {
    title: stripHTML(it.title),
    source: f.name,
    url: String(it.link==null?"":it.link),
    date: newsDate(it.pubDate),
    // img is emitted via src="" — must be http(s) only; esc() cannot stop javascript: schemes
    img: /^https?:/i.test(rawImg) ? rawImg : "",
    summary: stripHTML(it.description).slice(0,180),
    tags: (Array.isArray(it.categories) ? it.categories : [])
      .map(c=>stripHTML(c)).filter(Boolean).slice(0,2),
  };
}
async function fetchFeed(f){
  try{
    const r=await fetch("https://api.rss2json.com/v1/api.json?rss_url="+encodeURIComponent(f.url),{cache:"no-store"});
    if(!r.ok) return;
    const d=await r.json();
    if(!d || d.status!=="ok" || !Array.isArray(d.items)) return;
    const items=d.items.slice(0,NEWS_PER_FEED)
      .map(it=>normalizeNews(f,it))
      .filter(it=>it.title && /^https?:/i.test(it.url));
    if(items.length) writeNewsCache(f, items);
  }catch(e){ /* fall through — loadNews re-reads whatever the cache holds */ }
}
function mergeNews(caches){
  const all=[];
  for(const c of caches){ if(c && Array.isArray(c.items)) for(const it of c.items) if(it && it.title) all.push(it); }
  all.sort((a,b)=>b.date-a.date);
  return all.slice(0,NEWS_MAX);
}
function loadNews(force){
  const cached=FEEDS.map(f=>readNewsCache(f));
  const items=mergeNews(cached);
  const stale=FEEDS.some((f,i)=>!cached[i] || Date.now()-(cached[i].t||0) > NEWS_TTL);
  renderNews(items, items.length ? (stale ? "Updating…" : "") : "Loading…");
  if(state.newsBusy || (!stale && !force)) return;
  if(!navigator.onLine){
    if(!items.length) renderNews([], "You're offline — pull to refresh when you're back.");
    return;
  }
  state.newsBusy=true;
  Promise.all(FEEDS.map(fetchFeed)).then(()=>{
    state.newsBusy=false;
    const fresh=mergeNews(FEEDS.map(f=>readNewsCache(f)));
    renderNews(fresh, fresh.length ? "" : "News unavailable — pull to refresh.");
  });
}
function renderNews(items, note){
  const box=$("#newsList"); if(!box) return;
  const st=$("#newsStatus"); if(st) st.textContent=note||"";
  if(!items || !items.length){
    box.innerHTML='<div class="news-empty empty muted">News unavailable — pull to refresh.</div>';
    return;
  }
  box.innerHTML=items.map(it=>{
    // render-side scheme re-gate: cached items are normalized, but localStorage is user-editable
    const img = it.img && /^https?:/i.test(it.img) ? it.img : "";
    const thumb = img
      ? `<img class="news-img" src="${esc(img)}" alt="" loading="lazy" decoding="async"/>`
      : `<span class="news-ph" aria-hidden="true">${esc(it.source.slice(0,2))}</span>`;
    // summary falls back to the title when a feed ships no description (never render it twice)
    const sum = it.summary || it.title;
    const sumHtml = sum!==it.title ? `<span class="news-sum">${esc(sum)}</span>` : "";
    const tags = it.tags.length
      ? `<span class="news-tags">${it.tags.map(t=>`<i class="news-tag">${esc(t)}</i>`).join("")}</span>` : "";
    const url = /^https?:/i.test(it.url) ? it.url : "#";
    return `<a class="news-card" href="${esc(url)}" target="_blank" rel="noopener noreferrer">
      ${thumb}
      <span class="news-body">
        <span class="news-meta"><span class="news-src">${esc(it.source)}</span><i aria-hidden="true">·</i><span class="news-time">${esc(relTime(it.date))}</span></span>
        <span class="news-title">${esc(it.title)}</span>
        ${sumHtml}${tags}
      </span></a>`;
  }).join("");
}

/* ---------- nav ---------- */
function switchView(name){
  const doIt=()=>{ $$(".view").forEach(v=>v.classList.remove("active"));
    $("#view-"+name).classList.add("active");
    $$(".bottom-nav button").forEach(b=>b.classList.toggle("active", b.dataset.nav===name));
    const bcls=document.body.classList;
    Array.from(bcls).filter(c=>c.startsWith("tab-")).forEach(c=>bcls.remove(c));
    bcls.add("tab-"+name);
    if(name==="overview" && !state.chartLoaded) loadChart(); };
  // View Transitions API (#8) with reduced-motion respect
  if(document.startViewTransition && !REDUCE_MOTION){ document.startViewTransition(doIt); } else { doIt(); }
  if(name==="news") loadNews();
}

/* ---------- export CSV + share (#8) ---------- */
function currentRowsForExport(){
  const opt=state.tableOpt;
  return state.data.assets.map(a=>{
    const px=state.prices[a.asset];
    const units=opt===3?a.deployed_units:a.quantity;
    const value=px!=null?units*px:null;
    const unreal=value!=null?value-a.cost_basis:null;
    const ret=(a.cost_basis>0&&unreal!=null)?unreal/a.cost_basis*100:null;
    return {asset:a.asset,units,cost:a.cost_basis,price:px,value,unreal,ret};
  }).sort((x,y)=>(y.value??-1)-(x.value??-1));
}
function exportCSV(){
  const rows=currentRowsForExport(); const rt=rate(); const ccy=state.ccy;
  // CSV cell sanitizer: quote always; escape quotes; neutralize formula-injection leaders (= + - @ tab CR)
  const cell=(x)=>{ let s=String(x==null?"":x);
    if(/^[=+\-@\t\r]/.test(s)) s="'"+s;      // leading apostrophe defuses spreadsheet formulas
    return '"'+s.replace(/"/g,'""')+'"'; };
  const head=["Asset","Quantity",`Cost(${ccy})`,`Price(${ccy})`,`Value(${ccy})`,`ProfitLoss(${ccy})`,"Return%"];
  const lines=[head.map(cell).join(",")];
  for(const r of rows){ lines.push([r.asset, r.units,
    (r.cost*rt).toFixed(2), r.price!=null?(r.price*rt).toFixed(8):"",
    r.value!=null?(r.value*rt).toFixed(2):"", r.unreal!=null?(r.unreal*rt).toFixed(2):"",
    r.ret!=null?r.ret.toFixed(1):""].map(cell).join(",")); }
  const blob=new Blob([lines.join("\n")],{type:"text/csv"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a");
  a.href=url; a.download=`portfolio_${state.tableOpt===3?"invested":"all"}_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function shareSnapshot(){
  const t=computeForView(state.tableOpt);
  const txt=`My crypto portfolio — value ${fmtMoney(t.v)}, P/L ${fmtMoney(t.u)} (${pct(t.ret)}). `+
            `Cost basis ${fmtMoney(t.c)}.`;
  try{
    if(navigator.share){ await navigator.share({title:"My Crypto", text:txt}); return; }
  }catch(e){ if(e && e.name==="AbortError") return; }
  // fallback: copy to clipboard
  try{ await navigator.clipboard.writeText(txt); toast("Summary copied to clipboard"); }
  catch(e){ toast("Sharing not supported on this device"); }
}
function toast(msg){
  let el=$("#toast"); if(!el){ el=document.createElement("div"); el.id="toast"; el.className="toast"; document.body.appendChild(el); }
  el.textContent=msg; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"),2200);
}

function wire(){
  $("#nav").addEventListener("click",e=>{const b=e.target.closest("button"); if(b) switchView(b.dataset.nav);});
  $("#ccyToggle").addEventListener("click",e=>{const b=e.target.closest("button"); if(!b)return;
    state.ccy=b.dataset.ccy; savePrefs();
    $$("#ccyToggle button").forEach(x=>x.classList.toggle("active",x===b));
    const needFX = state.ccy!=="EUR" && state.fx[state.ccy]==null;
    if(needFX){ fetchFX().then(()=>{ render(); refreshChartsSoon(); }); }
    render(); refreshChartsSoon();});
  const setView = (v) => { state.view=v; savePrefs();
    $$("#viewSwitch button,#viewSwitch2 button").forEach(x=>x.classList.toggle("active", +x.dataset.view===v));
    renderOverview(); renderPortfolio(); };
  $("#viewSwitch").addEventListener("click",e=>{const b=e.target.closest("button"); if(b) setView(+b.dataset.view);});
  $("#viewSwitch2").addEventListener("click",e=>{const b=e.target.closest("button"); if(b) setView(+b.dataset.view);});
  $("#tableTabs").addEventListener("click",e=>{const b=e.target.closest("button"); if(!b)return;
    state.tableOpt=+b.dataset.t; savePrefs(); $$("#tableTabs button").forEach(x=>x.classList.toggle("active",x===b)); renderTable();});
  // sortable headers (#3)
  $("#mainTable thead").addEventListener("click",e=>{const th=e.target.closest("th[data-sort]"); if(!th)return;
    const k=th.dataset.sort; if(state.sortKey===k) state.sortDir*=-1; else{ state.sortKey=k; state.sortDir=(k==="asset")?1:-1; }
    savePrefs(); renderTable();});
  // chart range filter — redraws through drawChart, which destroys the old instance first
  $("#chartRange").addEventListener("click",e=>{const b=e.target.closest("button[data-range]"); if(!b)return;
    const r=+b.dataset.range; if(r===state.chartRange) return;
    state.chartRange=r; savePrefs();
    $$("#chartRange button").forEach(x=>x.classList.toggle("active",x===b));
    if(state.hist) drawChart(state.hist); });
  $("#refreshBtn").addEventListener("click",()=>{ loadNews(true); refresh(true); });
  $("#autoToggle").addEventListener("change",e=>{state.auto=e.target.checked; startAuto();});
  // currency picker (Settings): pick the two currencies offered by the header toggle
  const onCcySlot=(slot,val)=>{
    if(!CCY[val]) return;
    const other = state.ccyPair[slot===0?1:0];
    // avoid a duplicate pair: if the same code is chosen twice, shift the other to a different one
    let pair=[...state.ccyPair]; pair[slot]=val;
    if(pair[0]===pair[1]){ const alt=CCY_CODES.find(c=>c!==val)||"USD"; pair[slot===0?1:0]=alt; }
    state.ccyPair=pair;
    if(!state.ccyPair.includes(state.ccy)) state.ccy=state.ccyPair[0];
    savePrefs(); renderCcyToggle(); renderCcyPicker();
    const needFX = state.ccyPair.some(c=>c!=="EUR" && state.fx[c]==null);
    if(needFX){ fetchFX().then(()=>{ render(); refreshChartsSoon(); }); }
    render(); refreshChartsSoon();
  };
  const s0=$("#ccySlot0"), s1=$("#ccySlot1");
  if(s0) s0.addEventListener("change",e=>onCcySlot(0,e.target.value));
  if(s1) s1.addEventListener("change",e=>onCcySlot(1,e.target.value));

  // portfolio search + sort (#5, #6)
  const cs=$("#cardSearch"); if(cs) cs.addEventListener("input",e=>{ state.cardQuery=e.target.value; renderPortfolio(); });
  const cso=$("#cardSort"); if(cso) cso.addEventListener("change",e=>{ state.cardSort=e.target.value; savePrefs(); renderPortfolio(); });
  // table search (#5)
  const ts2=$("#tableSearch"); if(ts2) ts2.addEventListener("input",e=>{ state.tableQuery=e.target.value; renderTable(); });
  // export CSV + share (#8)
  const ex=$("#exportCsvBtn"); if(ex) ex.addEventListener("click",exportCSV);
  const sh=$("#shareBtn"); if(sh) sh.addEventListener("click",shareSnapshot);

  // detail sheet open/close (#1)
  const openFromEl=(el)=>{ const s=el&&el.dataset&&el.dataset.asset; if(s) openDetail(s); };
  $("#portfolioList").addEventListener("click",e=>openFromEl(e.target.closest(".hrow")));
  // hide a coin logo that fails to load, revealing the colored-initial fallback (CSP-safe, no inline onerror)
  $("#portfolioList").addEventListener("error",e=>{ const t=e.target;
    if(t && t.classList && t.classList.contains("h-logo")) t.style.display="none"; }, true);
  // same for a news thumbnail from a dead CDN — drop it, the card keeps its text (CSP-safe, no inline onerror)
  $("#view-news").addEventListener("error",e=>{ const t=e.target;
    if(t && t.classList && t.classList.contains("news-img")) t.style.display="none"; }, true);
  $("#mainTable tbody").addEventListener("click",e=>openFromEl(e.target.closest("tr[data-asset]")));
  $("#detailClose").addEventListener("click",closeDetail);
  $("#detailBackdrop").addEventListener("click",closeDetail);
  // detail chart range (1W/1M/1Y/All) — delegated, redraws just the sparkline
  $("#detailBody").addEventListener("click",e=>{ const b=e.target.closest("#dSparkRange button[data-dr]"); if(!b) return;
    state.detailRange=+b.dataset.dr;
    $$("#dSparkRange button").forEach(x=>x.classList.toggle("active",x===b));
    const sym=state.openSym; const a=sym&&state.data.assets.find(x=>x.asset===sym);
    if(a) drawSparkline(a);
  });
  // swipe-down to dismiss the detail sheet (#7)
  (function(){ const sheet=$("#detailSheet"); if(!sheet) return; let sy=0, dy=0, drag=false;
    sheet.addEventListener("touchstart",e=>{ if(sheet.scrollTop>0) return; sy=e.touches[0].clientY; drag=true; dy=0; },{passive:true});
    sheet.addEventListener("touchmove",e=>{ if(!drag) return; dy=e.touches[0].clientY-sy;
      if(dy>0){ sheet.style.transform=`translateY(${dy}px)`; sheet.style.transition="none"; } },{passive:true});
    sheet.addEventListener("touchend",()=>{ if(!drag) return; drag=false; sheet.style.transition="";
      if(dy>90){ closeDetail(); } sheet.style.transform=""; dy=0; },{passive:true});
  })();

  // text size
  const applyScale=(s)=>{ document.documentElement.style.setProperty("--type-scale", s);
    $$("#textSize button").forEach(b=>b.classList.toggle("active", b.dataset.scale===String(s))); refreshChartsSoon(); };
  $("#textSize").addEventListener("click",e=>{const b=e.target.closest("button"); if(!b)return;
    applyScale(b.dataset.scale); try{localStorage.setItem("type_scale",b.dataset.scale);}catch(_){}} );

  // onboarding dismiss (#6)
  const ob=$("#onboard"); if(ob){ const dismiss=()=>{ ob.classList.remove("show"); try{localStorage.setItem("onboarded","1");}catch(_){}}; 
    $("#obClose").addEventListener("click",dismiss); const g=$("#obGo"); if(g) g.addEventListener("click",dismiss); }

  // pull-to-refresh
  const ptr=$("#ptr"); let startX=0, startY=0, pulling=false, dist=0, axis=null;
  const THRESH=()=>window.innerHeight*0.18;
  window.addEventListener("touchstart",e=>{ if(window.scrollY<=0 && e.touches.length===1){ startX=e.touches[0].clientX; startY=e.touches[0].clientY; pulling=true; dist=0; axis=null; } },{passive:true});
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

  // table fade on scroll
  const ts=$("#tableScroll"), tw=ts&&ts.querySelector(".table-wrap");
  if(tw){ tw.addEventListener("scroll",updateTableFade,{passive:true}); }

  // online/offline
  window.addEventListener("online",()=>{ state.offline=false; refresh(false); });
  window.addEventListener("offline",()=>{ state.offline=true; updateFreshness(); });

  // CSV import
  const files={bal:null,led:null,trd:null};
  const check=()=>{$("#recomputeBtn").disabled=!(files.bal&&files.led&&files.trd);};
  const hook=(inp,name,key)=>{$(inp).addEventListener("change",ev=>{const f=ev.target.files[0]; files[key]=f; $(name).textContent=f?f.name:"none"; check();});};
  hook("#fileBal","#nameBal","bal"); hook("#fileLed","#nameLed","led"); hook("#fileTrd","#nameTrd","trd");
  $("#recomputeBtn").addEventListener("click",async()=>{
    const msg=$("#importMsg"); msg.className="msg"; msg.textContent="Computing…";
    try{
      const [b,l,t]=await Promise.all([files.bal.text(),files.led.text(),files.trd.text()]);
      const res=window.PortfolioEngine.analyze(b,l,t);
      for(const a of res.assets){ if(!a.cg_id) a.cg_id=a.asset.toLowerCase(); }
      res.generated=new Date().toISOString().slice(0,10);
      state.data=res; state.hist=null;
      try{ localStorage.setItem("user_data", JSON.stringify(res)); }catch(e){}
      $("#dataSource").textContent="your imported CSV ("+res.generated+")";
      reconMsg(); await refresh(true); msg.className="msg ok"; msg.textContent=`Recomputed ${res.assets.length} assets. Cost basis ${fmtMoney(res.assets.reduce((s,a)=>s+a.cost_basis,0))}.`;
    }catch(e){ msg.className="msg err"; msg.textContent="Error: "+e.message; }
  });
  $("#resetBtn").addEventListener("click",async()=>{
    localStorage.removeItem("user_data"); state.hist=null; await loadBundled(); await refresh(true);
    $("#importMsg").className="msg ok"; $("#importMsg").textContent="Reset to bundled snapshot.";
  });
  // CoinGecko API key (Settings) — stored locally, applied to CG.demoKey immediately
  const keyMsg=$("#cgKeyMsg"), keyInput=$("#cgKeyInput");
  const saveKey=()=>{ const v=(keyInput.value||"").trim();
    if(!v){ if(keyMsg){keyMsg.className="msg err";keyMsg.textContent="Enter a key first, or press Clear.";} return; }
    CG.demoKey=v; try{localStorage.setItem("cg_key",v);}catch(e){}
    CG.cooldownUntil=0;                                   // a fresh key may lift throttling
    if(keyMsg){keyMsg.className="msg ok";keyMsg.textContent="API key saved. Refreshing…";}
    refresh(true); loadChart(true);
  };
  const clearKey=()=>{ CG.demoKey=null; try{localStorage.removeItem("cg_key");}catch(e){}
    if(keyInput) keyInput.value="";
    if(keyMsg){keyMsg.className="msg ok";keyMsg.textContent="API key removed — using free tier.";}
  };
  const ks=$("#cgKeySave"); if(ks) ks.addEventListener("click",saveKey);
  const kc=$("#cgKeyClear"); if(kc) kc.addEventListener("click",clearKey);
}

/* ---------- init ---------- */
async function init(){
  loadPrefs();
  try{ const k=localStorage.getItem("cg_key"); if(k){ CG.demoKey=k; const ki=$("#cgKeyInput"); if(ki) ki.value=k; } }catch(_){}
  try{ const s=localStorage.getItem("type_scale"); if(s) document.documentElement.style.setProperty("--type-scale",s); }catch(_){}
  wire();
  applyPrefUI();
  try{ const s=localStorage.getItem("type_scale")||"1"; $$("#textSize button").forEach(b=>b.classList.toggle("active",b.dataset.scale===s)); }catch(_){}
  // onboarding (first run)
  try{ if(!localStorage.getItem("onboarded")){ const ob=$("#onboard"); if(ob) ob.classList.add("show"); } }catch(_){}

  let loaded=false;
  try{ const u=JSON.parse(localStorage.getItem("user_data")||"null"); if(u&&u.assets){ state.data=u; $("#dataSource").textContent="your imported CSV ("+(u.generated||"")+")"; reconMsg(); loaded=true; } }catch(e){}
  if(!loaded) await loadBundled();
  loadCachedPrices();
  loadCachedLogos();
  loadCachedFX();
  renderCcyPicker();
  render();
  await refresh(true);
  startAuto();
  // tick the "updated Ns ago" label
  state.freshTimer=setInterval(updateFreshness,10000);
  // warm the history cache in the background so sparklines + chart are ready
  loadChart(true);
  if("serviceWorker" in navigator){ try{ await navigator.serviceWorker.register("./sw.js"); }catch(e){} }
}
window.PortfolioEngine = window.PortfolioEngine || {};
document.addEventListener("DOMContentLoaded", init);
})();
