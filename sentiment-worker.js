/* On-device headline sentiment (opt-in, Settings › News). Runs in a worker so the model code — a
   pinned transformers.js from jsDelivr — never touches the page; it only ever receives public
   headline text and returns labels. Model: DistilRoBERTa fine-tuned on financial news (~83 MB,
   8-bit), downloaded once from Hugging Face and cached by the browser. */
const TRANSFORMERS = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js";
const MODEL = "Xenova/distilroberta-finetuned-financial-news-sentiment-analysis";
let clf = null;
async function classifier(){
  if(clf) return clf;
  const { pipeline, env } = await import(TRANSFORMERS);
  env.allowLocalModels = false;
  clf = await pipeline("text-classification", MODEL, { dtype:"q8",
    progress_callback: p => { if(p.status==="progress" && p.total) self.postMessage({progress: Math.round(p.loaded/p.total*100), file:p.file}); } });
  return clf;
}
self.onmessage = async e => {
  const { id, texts } = e.data || {};
  try{
    const c = await classifier();
    const out = [];
    for(const t of texts||[]){ const r = await c(String(t).slice(0,300)); out.push(r[0]); }   // [{label, score}]
    self.postMessage({ id, out });
  }catch(err){ self.postMessage({ id, error: String(err && err.message || err) }); }
};
