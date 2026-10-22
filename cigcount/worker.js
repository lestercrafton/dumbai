var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/worker.js
var json = /* @__PURE__ */ __name((d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } }), "json");
var SHELF_PROMPT = `You count cigarette inventory in a gas-station photo. Look at every visible cigarette pack and carton.
Return ONLY JSON, no words outside JSON:
{"items":[{"brand":"Marlboro Red","packs":0,"cartons":0,"confidence":0.0}],"totalPacks":0,"notes":""}
Rules: packs = loose single packs. cartons = sealed cartons (1 carton = 10 packs, do not also count its packs).
Brand must include variety exactly as shown, e.g. "Marlboro Gold", "Newport Menthol", "Camel Blue". Use "Other" only if unreadable.
confidence 0.0-1.0: below 0.75 if partly hidden, stacked, blurry, or a guess. Count only what you can see. totalPacks = sum(packs) + 10*sum(cartons).`;
var INVOICE_PROMPT = `You read a cigarette wholesale delivery invoice photo. Return ONLY JSON, no words outside JSON:
{"items":[{"brand":"Marlboro Red","packs":0,"cartons":0,"confidence":0.0}],"totalPacks":0,"invoiceNumber":"","notes":""}
Rules: convert cartons to packs=0,cartons=n as printed (1 carton = 10 packs). Include variety. confidence below 0.75 for any line you are unsure of. totalPacks = sum(packs) + 10*sum(cartons).`;
function parseJsonText(text) {
  if (!text) return null;
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}
__name(parseJsonText, "parseJsonText");
function cleanResult(raw) {
  const items = Array.isArray(raw?.items) ? raw.items.map((it) => ({
    brand: String(it.brand || "Other").slice(0, 60),
    packs: Math.max(0, Math.round(Number(it.packs) || 0)),
    cartons: Math.max(0, Math.round(Number(it.cartons) || 0)),
    confidence: Math.min(1, Math.max(0, Number(it.confidence) || 0))
  })).filter((it) => it.packs || it.cartons) : [];
  const totalPacks = items.reduce((s, it) => s + it.packs + it.cartons * 10, 0);
  return { items, totalPacks, notes: String(raw?.notes || "").slice(0, 300), invoiceNumber: String(raw?.invoiceNumber || "") };
}
__name(cleanResult, "cleanResult");
async function countWithAi(env, bytes, kind) {
  const prompt = kind === "invoice" ? INVOICE_PROMPT : SHELF_PROMPT;
  const models = ["@cf/meta/llama-3.2-11b-vision-instruct", "@cf/llava-hf/llava-1.5-7b-hf"];
  let lastErr = "";
  for (const model of models) {
    try {
      const out = await env.AI.run(model, { image: Array.from(bytes), prompt, max_tokens: 1024 });
      const parsed = parseJsonText(out?.response ?? out?.text ?? JSON.stringify(out));
      if (parsed) return { ...cleanResult(parsed), model };
      lastErr = "AI answered but not in a readable list";
    } catch (e) {
      lastErr = String(e?.message || e);
    }
  }
  throw new Error(lastErr || "AI unavailable");
}
__name(countWithAi, "countWithAi");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return json({ ok: true, ai: !!env.AI });
    if (url.pathname === "/api/count" && request.method === "POST") {
      try {
        const body = await request.json();
        const kind = body.kind === "invoice" ? "invoice" : "shelf";
        const b64 = String(body.image || "").replace(/^data:image\/\w+;base64,/, "");
        if (!b64) return json({ ok: false, manual: true, error: "No photo received. You can still count by hand below." }, 400);
        const bin = atob(b64);
        if (bin.length > 6e6) return json({ ok: false, manual: true, error: "Photo too large. Move closer and take one shelf section at a time." }, 413);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        if (!env.AI) return json({ ok: false, manual: true, error: "Photo counting is off right now. Count by hand below \u2014 the sheet math still works." });
        const result = await countWithAi(env, bytes, kind);
        return json({ ok: true, kind, ...result });
      } catch (e) {
        return json({ ok: false, manual: true, error: "Photo counting hit a problem. Count by hand below \u2014 the sheet math still works.", detail: String(e?.message || e).slice(0, 200) });
      }
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
    return env.ASSETS.fetch(request);
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map

