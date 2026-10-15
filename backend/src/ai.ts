// Claude ile bağlamsal senaryo incelemesi: yönerge + kural listesi + Bellek'teki ekip notları.
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "./config.js";
import * as db from "./db.js";
import { promptExamples } from "./memory.js";
import { trLower } from "./text.js";
import data from "./data.json" with { type: "json" };

const SUGG = {
  type: "array",
  items: {
    type: "object", additionalProperties: false, required: ["text", "kaynak", "ref"],
    properties: { text: { type: "string" }, kaynak: { type: "string", enum: ["bellek", "yeni"] }, ref: { type: "string" } },
  },
};
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["paragraph", "quote", "category", "severity", "reason", "suggestions"],
        properties: {
          paragraph: { type: "integer" }, quote: { type: "string" },
          category: { type: "string", enum: data.aiCategories }, severity: { type: "string", enum: ["dusuk", "orta", "yuksek"] },
          reason: { type: "string" }, suggestions: SUGG,
        },
      },
    },
  },
};
const ALT_SCHEMA = { type: "object", additionalProperties: false, required: ["suggestions"], properties: { suggestions: SUGG } };

export const aiReady = () => {
  const c = loadConfig();
  return c.ai_enabled && !!(c.api_key || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
};
const client = () => { const k = loadConfig().api_key.trim(); return k ? new Anthropic({ apiKey: k }) : new Anthropic(); };

function houseExamples(limit = 60) {
  return db.listRules("aktif").filter((r) => r.replacements.length && r.match_type !== "desen")
    .sort((a, b) => Number(a.source !== "ogrenilen") - Number(b.source !== "ogrenilen") || b.hits - a.hits).slice(0, limit)
    .map((r) => `- "${r.pattern}" -> ${r.replacements.slice(0, 3).map((x: string) => (x ? `"${x}"` : "(kaldır)")).join(" | ")}  [${r.category}]`)
    .join("\n");
}

/** Sistem istemi; kurallar + Bellek bölümü uzun olduğu için önbelleğe alınır. */
export function buildSystem() {
  const blocks: any[] = [{ type: "text", text: data.systemPrompt }], extra: string[] = [];
  const ex = houseExamples(), lessons = promptExamples(), rules = db.getGuidelines();
  if (rules.length) extra.push("EKİP YÖNERGELERİ VE GÜNCELLEMELERİ (Geliştir sekmesi) — kesin talimatlar; her incelemede uygula, "
    + "bunlara giren her durumu ısrarla işaretle:\n" + rules.map((r) => `- [${r.kind}] ${r.text}`).join("\n"));
  const learned = db.listNotes({ learnOnly: true }).filter((n) => n.scope !== "genel").slice(0, 120);
  if (learned.length) extra.push("EDİTÖR NOTLARI — editörlerin önceki senaryolara yazdığı notlar. Yeni senaryolarda benzer durumları aynı "
    + "hassasiyetle işaretle:\n" + learned.map((n) => `- ${n.quote ? `«${n.quote.slice(0, 200)}» → ` : "(senaryonun geneli) "}${n.text}`).join("\n"));
  if (ex) extra.push("Ekibin kural listesi (bu ifadeler görüldüğünde benzer öneriler ver):\n" + ex);
  if (lessons) extra.push("BELLEK — ekibin geçmiş senaryolara düştüğü notlar ve yaptığı düzeltmeler. Yeni senaryoda aynı türden "
    + "durumları aynı hassasiyetle işaretle; bölüme özgü notları (ör. belirli bir karakterin adı) genelleme:\n\n" + lessons);
  if (extra.length) blocks.push({ type: "text", text: extra.join("\n\n"), cache_control: { type: "ephemeral" } });
  return blocks;
}

async function callJson(system: any[], content: any, schema: object, maxTokens = 64000, effort = "medium"): Promise<any | null> {
  const stream = client().beta.messages.stream({
    model: loadConfig().model || "claude-opus-5-5",
    max_tokens: maxTokens,
    system,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort, format: { type: "json_schema", schema } },
    messages: [{ role: "user", content }],
  } as any);
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") return null;
  const text = msg.content.find((b: any) => b.type === "text") as any;
  try { return text ? JSON.parse(text.text) : null; } catch { return null; } // max_tokens ile kesilmiş olabilir
}

const toSugg = (items: any[]) => items.map((it) => typeof it === "string" ? { text: it, kaynak: "claude", ref: "" }
  : { text: it.text ?? "", kaynak: it.kaynak === "bellek" ? "bellek" : "claude", ref: it.kaynak === "bellek" ? it.ref ?? "" : "" });

/** Senaryonun tamamı her istekte (önbellekli) verilir; her istekte küçük bir aralık ayrıntılı incelenir. */
export async function analyze(texts: string[], progress?: (d: number, t: number) => void, docNotes: any[] = []) {
  const system = buildSystem(), paras = texts.map((t, i) => [i, t] as const).filter(([, t]) => t.trim());
  const chunks: (typeof paras)[] = [];
  let cur: typeof paras = [], size = 0;
  for (const p of paras) { if (cur.length && size + p[1].length > 9000) { chunks.push(cur); cur = []; size = 0; } cur.push(p); size += p[1].length + 10; }
  if (cur.length) chunks.push(cur);
  const script = { type: "text", text: "<senaryo>\n" + paras.map(([i, t]) => `[${i}] ${t}`).join("\n") + "\n</senaryo>", cache_control: { type: "ephemeral" } };
  const general = docNotes.filter((n) => n.scope === "senaryo" && n.status !== "cozuldu");
  const notesFor = (a: number, b: number) => {
    const local = docNotes.filter((n) => n.scope === "yer" && n.status !== "cozuldu" && n.paragraph >= a && n.paragraph <= b);
    const lines = [...general.map((n) => `- (senaryonun geneli) ${n.text}`), ...local.map((n) => `- [${n.paragraph}] «${n.quote}»: ${n.text}`)];
    return lines.length ? "\n\nEDİTÖRÜN BU SENARYO İÇİN NOTLARI — mutlaka uygula; yere yazılan her not için o kısımda bir bulgu üret ve "
      + "notun istediğini karşılayan öneriler ver:\n" + lines.join("\n") : "";
  };
  const run = (c: typeof paras) => callJson(system, [script, { type: "text", text:
    `Yukarıdaki senaryonun YALNIZCA [${c[0][0]}] ile [${c.at(-1)![0]}] arasındaki paragraflarını ayrıntılı incele (sahne bağlamı için `
    + "senaryonun geri kalanına bakabilirsin). Paragraf başındaki [sayı] paragraf numarasıdır; bulgularda bu numarayı kullan. "
    + "Bu aralıkta bulduğun her sorunu ve iyileştirme fırsatını listele. EKİP YÖNERGELERİ'ne giren hiçbir durumu atlama; "
    + "özellikle normal olmayan, taklit edilebilir her eylemi tek tek kontrol et." + notesFor(c[0][0], c.at(-1)![0]) }], SCHEMA, 64000, "high").then((r) => r ?? { findings: [] });
  const results: any[] = [];
  let done = 0;
  const tick = () => progress?.(++done, chunks.length);
  if (chunks.length) { results.push(await run(chunks[0])); tick(); } // ilk istek önbelleği doldurur
  for (let i = 1; i < chunks.length; i += 4) {
    for (const r of await Promise.all(chunks.slice(i, i + 4).map(run))) { results.push(r); tick(); }
  }
  const out: any[] = [];
  for (const f of results.flatMap((r) => r.findings ?? [])) {
    const q = String(f.quote ?? "").trim(), t = texts[f.paragraph];
    if (!Number.isInteger(f.paragraph) || t === undefined || !q) continue;
    let pos = t.indexOf(q);
    if (pos < 0) pos = trLower(t).indexOf(trLower(q));
    if (pos < 0) continue;
    out.push({ ...f, start: pos, end: pos + q.length, original: t.slice(pos, pos + q.length), suggestions: toSugg(f.suggestions ?? []) });
  }
  return out;
}

export async function alternatives(original: string, paragraph: string, reason = "", existing: string[] = []) {
  const user = `Paragraf: ${paragraph}\n\nDeğiştirilecek kısım: "${original}"\nNeden: ${reason || "-"}\nZaten önerilenler: ${JSON.stringify(existing)}\n\n`
    + "Bu kısmın yerine yazılabilecek, çocuklara uygun, cümleye dilbilgisi olarak oturan 3 YENİ alternatif ver. Bellek'te benzer bir "
    + "düzeltme varsa birini ona dayandır (kaynak 'bellek'); diğerleri hikâyeyi bozmadan sahneyi tamamlayan kendi önerilerin olsun (kaynak 'yeni').";
  const r = await callJson(buildSystem(), user, ALT_SCHEMA, 8000);
  return toSugg(r?.suggestions ?? []).filter((s) => !existing.includes(s.text));
}

const NOTE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["quote", "reason", "suggestions"],
  properties: { quote: { type: "string" }, reason: { type: "string" }, suggestions: SUGG },
};
/** Editörün yere yazdığı notu uygular: değişmesi gereken en kısa parçayı ve notu karşılayan önerileri döndürür. */
export async function applyNote(note: any, paragraph: string, context: string) {
  const user = `Senaryodan bağlam:\n${context}\n\nDüzenlenecek paragraf: ${paragraph}\nEditörün işaretlediği kısım: «${note.quote}»\n`
    + `Editörün notu: ${note.text}\n\nNotu uygula: paragraftan HARFİ HARFİNE kopyalanmış, değişmesi gereken en kısa parçayı "quote" olarak ver; `
    + "yerine yazılacak, notu karşılayan ve hikâyeyi bozmayan 1-3 öneri üret; 'reason' kısa Türkçe açıklama olsun.";
  const r = await callJson(buildSystem(), user, NOTE_SCHEMA, 8000);
  return r ? { quote: String(r.quote ?? ""), reason: String(r.reason ?? ""), suggestions: toSugg(r.suggestions ?? []) } : null;
}
