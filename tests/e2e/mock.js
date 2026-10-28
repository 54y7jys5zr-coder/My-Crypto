/* Deterministic stand-ins for every external service the app calls. Anything not mocked is aborted,
   so the suites never touch the real network. Prices: CoinGecko = PX, Kraken REST = PX × 1.01,
   Kraken WebSocket = PX × 1.02 (so a test can tell the sources apart), DefiLlama = USD (EUR × 1.10). */
const PX={bitcoin:73301,ethereum:2147,solana:140,cardano:0.6,polkadot:4,chainlink:10.7,ripple:2.1};
const SYM={bitcoin:"btc",ethereum:"eth",solana:"sol",cardano:"ada",polkadot:"dot",chainlink:"link",ripple:"xrp"};
const BY_SYM=Object.fromEntries(Object.entries(SYM).map(([id,s])=>[s.toUpperCase(),PX[id]]));
// watch-only addresses known to the explorer mocks
const ADDR={
  "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq":0.025,               // BTC: 0.005 more than the fixtures record
  "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe":1.5,                 // ETH (nothing recorded in a private wallet)
  "DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L":1000,                        // DOGE
};
const state={cgDown:false, krakenDown:false, krakenIncident:false};
const stats={};
const bump=k=>{ stats[k]=(stats[k]||0)+1; };
function series(id){ let seed=[...id].reduce((s,c)=>s*31+c.charCodeAt(0),7)>>>0; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
  const D=864e5, today=Math.floor(Date.now()/D)*D, pts=[]; let p=PX[id];
  for(let i=0;i<=365;i++){ pts.unshift(p); p=p*(1+(rnd()-0.5)*0.06); }
  const out=pts.map((v,i)=>[today-(365-i)*D, v]); out.push([Date.now(), PX[id]]); return out; }
const json=(route,b,status=200)=>route.fulfill({status,contentType:"application/json",headers:{"access-control-allow-origin":"*"},body:JSON.stringify(b)});
async function install(ctx){
  // registered first = matched last: blocks every host that has no mock below
  await ctx.route(u=>!/^http:\/\/127\.0\.0\.1[:/]/.test(u.href), r=>{ bump("blocked"); return r.abort(); });
  await ctx.route(/api\.coingecko\.com/, route=>{ const u=new URL(route.request().url());
    if(state.cgDown) return route.fulfill({status:503,body:"{}"});
    if(u.pathname.endsWith("/coins/markets")){ bump("markets"); const ids=(u.searchParams.get("ids")||"").split(",").filter(id=>PX[id]);
      return json(route, ids.map(id=>({id,symbol:SYM[id],current_price:PX[id],image:"",price_change_percentage_24h_in_currency:1.1,price_change_percentage_7d_in_currency:-3,price_change_percentage_30d_in_currency:-2.8}))); }
    if(u.pathname.endsWith("/search/trending")){ bump("trending"); return json(route,{coins:[["cardano","Cardano",9,3.2],["polkadot","Polkadot",20,-1.4],["bitcoin","Bitcoin",1,0.8]].map(([id,name,rank,ch])=>({item:{id,name,symbol:SYM[id],market_cap_rank:rank,small:"",data:{price:PX[id]*1.10,price_change_percentage_24h:{eur:ch}}}}))}); }
    if(u.pathname.endsWith("/search")){ const q=(u.searchParams.get("query")||"").toLowerCase(); return json(route,{coins:Object.entries(SYM).filter(([,s])=>s===q).map(([id,s],i)=>({id,symbol:s.toUpperCase(),market_cap_rank:i+1}))}); }
    const m=u.pathname.match(/\/coins\/([^/]+)\/market_chart/); if(m){ bump("chart"); return PX[m[1]] ? json(route,{prices:series(m[1])}) : route.fulfill({status:404,body:"{}"}); }
    return route.fulfill({status:404,body:"{}"}); });
  await ctx.route(/api\.frankfurter\.dev/, route=>{ bump("fx"); const u=route.request().url(), ts=u.match(/v1\/(\d{4}-\d{2}-\d{2})\.\./);
    if(ts){ const rates={}; for(let t=Date.parse(ts[1]+"T00:00:00Z"); t<=Date.now(); t+=864e5) rates[new Date(t).toISOString().slice(0,10)]={USD:1.10}; return json(route,{base:"EUR",rates}); }
    json(route,{base:"EUR",rates:{PLN:4.26,USD:1.10,GBP:0.84}}); });
  const KP={XXBTZEUR:["XBT/EUR","bitcoin"],XETHZEUR:["ETH/EUR","ethereum"],SOLEUR:["SOL/EUR","solana"],ADAEUR:["ADA/EUR","cardano"],DOTEUR:["DOT/EUR","polkadot"],LINKEUR:["LINK/EUR","chainlink"],XXRPZEUR:["XRP/EUR","ripple"]};
  await ctx.route(/api\.kraken\.com/, route=>{ bump("kraken"); const u=new URL(route.request().url());
    if(state.krakenDown) return route.fulfill({status:503,body:"{}"});
    if(u.pathname.endsWith("/AssetPairs")) return json(route,{error:[],result:Object.fromEntries(Object.entries(KP).map(([k,[ws]])=>[k,{wsname:ws,quote:"ZEUR",base:"X"+ws.split("/")[0]}]))});
    if(u.pathname.endsWith("/Assets")) return json(route,{error:[],result:{XXBT:{altname:"XBT"},XETH:{altname:"ETH"},ZEUR:{altname:"EUR"}}});
    if(u.pathname.endsWith("/Ticker")){ const ks=(u.searchParams.get("pair")||"").split(","); return json(route,{error:[],result:Object.fromEntries(ks.filter(k=>KP[k]).map(k=>{ const p=PX[KP[k][1]]*1.01; return [k,{c:[String(p),"1"],o:String(p/1.02)}]; }))}); }
    return route.fulfill({status:404,body:"{}"}); });
  await ctx.route(/status\.kraken\.com/, route=>json(route,{status:{indicator:state.krakenIncident?"minor":"none",description:state.krakenIncident?"Partially Degraded Service":"All Systems Operational"}}));
  await ctx.route(/coins\.llama\.fi/, route=>{ bump("llama"); const u=new URL(route.request().url());
    const ids=decodeURIComponent(u.pathname.split("/").pop()).split(",").map(x=>x.replace("coingecko:","")).filter(id=>PX[id]);
    if(u.pathname.includes("/prices/current/")) return json(route,{coins:Object.fromEntries(ids.map(id=>["coingecko:"+id,{price:PX[id]*1.10*0.99,symbol:SYM[id]}]))});
    if(u.pathname.includes("/chart/")){ const period=u.searchParams.get("period"), start=+u.searchParams.get("start")*1000, step=period==="1w"?7*864e5:864e5, prices=[];
      for(let t=start;t<=Date.now();t+=step) prices.push({timestamp:Math.floor(t/1000), price:PX[ids[0]]*1.10});
      return json(route,{coins:ids.length?{["coingecko:"+ids[0]]:{symbol:SYM[ids[0]],prices}}:{}}); }
    return route.fulfill({status:404,body:"{}"}); });
  await ctx.route(/api\.alternative\.me/, route=>json(route,{data:Array.from({length:30},(_,i)=>({value:String(i===0?32:40+i%10),value_classification:i===0?"Fear":"Neutral",timestamp:String(Math.floor(Date.now()/1000)-i*86400)}))}));
  await ctx.route(/api\.coinpaprika\.com/, route=>json(route,{market_cap_usd:2.8e12,market_cap_change_24h:-0.22,bitcoin_dominance_percentage:57.5}));
  await ctx.route(/api\.nbp\.pl/, route=>{ const m=route.request().url().match(/eur\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})/), rates=[];
    if(m) for(let t=Date.parse(m[1]+"T00:00:00Z"); t<=Date.parse(m[2]+"T00:00:00Z"); t+=864e5){ const d=new Date(t).getUTCDay(); if(d>0&&d<6) rates.push({effectiveDate:new Date(t).toISOString().slice(0,10),mid:4.3}); }
    return rates.length ? json(route,{table:"A",code:"EUR",rates}) : route.fulfill({status:404,body:"Brak danych"}); });
  await ctx.route(/api\.rss2json\.com/, route=>{ bump("rss"); const feed=new URL(route.request().url()).searchParams.get("rss_url"), host=new URL(feed).hostname.replace("www.","");
    json(route,{status:"ok",items:[1,2,3].map(i=>({title:`${host} headline ${i}`,link:`https://${host}/story-${i}`,pubDate:new Date(Date.now()-i*3600e3*(host.length%5+1)).toISOString().slice(0,19).replace("T"," "),
      description:`<p>Summary ${i} from ${host}</p>`,thumbnail:"",enclosure:{},categories:["Markets"]}))}); });
  await ctx.route(/cryptocurrency\.cv/, route=>{ bump("cv"); const p=+new URL(route.request().url()).searchParams.get("page")||1;
    json(route,{articles:[1,2,3].map(i=>({title:`Crypto Vision story ${p}-${i}`,link:`https://cryptocurrency.cv/a/${p}-${i}`,pubDate:new Date(Date.now()-(p*3+i)*1800e3).toISOString(),source:"Crypto Vision",description:"cv summary",image:"",category:"Bitcoin"}))}); });
  // block explorers + Bitcoin fees
  await ctx.route(/mempool\.space|blockstream\.info/, route=>{ const u=new URL(route.request().url());
    if(u.pathname.endsWith("/fees/recommended")) return json(route,{fastestFee:12,halfHourFee:8,hourFee:5,economyFee:2,minimumFee:1});
    const m=u.pathname.match(/\/address\/([^/]+)$/); bump("btcAddr");
    if(m && ADDR[m[1]]!=null) return json(route,{address:m[1],chain_stats:{funded_txo_sum:Math.round(ADDR[m[1]]*1e8)+1000,spent_txo_sum:1000},mempool_stats:{funded_txo_sum:0,spent_txo_sum:0}});
    return json(route,{error:"Invalid Bitcoin address"},400); });
  await ctx.route(/eth\.blockscout\.com/, route=>{ const a=new URL(route.request().url()).searchParams.get("address");
    return json(route, ADDR[a]!=null ? {status:"1",message:"OK",result:(BigInt(Math.round(ADDR[a]*1e8))*10n**10n).toString()} : {status:"0",message:"Invalid address hash",result:null}); });
  await ctx.route(/api\.blockcypher\.com/, route=>{ const m=route.request().url().match(/addrs\/([^/]+)\/balance/);
    return m && ADDR[m[1]]!=null ? json(route,{address:m[1],final_balance:Math.round(ADDR[m[1]]*1e8)}) : json(route,{error:"Address is invalid"},400); });
  // Kraken WebSocket v2: a fake socket that answers ticker subscriptions; tests push updates with __wsPush(sym, price)
  await ctx.addInitScript(BY=>{
    class FakeWS{
      constructor(url){ this.url=url; this.readyState=0; (window.__wsAll=window.__wsAll||[]).push(this); window.__ws=this; setTimeout(()=>{ this.readyState=1; this.onopen&&this.onopen({}); },20); }
      send(s){ const m=JSON.parse(s); this.subs=m.params.symbol; window.__wsSubs=this.subs;
        setTimeout(()=>this._emit("snapshot", this.subs.filter(x=>BY[x.split("/")[0]]).map(x=>({symbol:x,last:BY[x.split("/")[0]]*1.02,change_pct:2.5}))),20); }
      _emit(type,data){ if(this.readyState===1 && this.onmessage) this.onmessage({data:JSON.stringify({channel:"ticker",type,data})}); }
      close(){ if(this.readyState===3) return; this.readyState=3; setTimeout(()=>this.onclose&&this.onclose({}),0); }
    }
    window.WebSocket=FakeWS;
    window.__wsPush=(sym,last)=>window.__ws && window.__ws._emit("update",[{symbol:sym+"/EUR",last,change_pct:3}]);
  }, BY_SYM);
}
module.exports={install, state, stats, PX, ADDR};
