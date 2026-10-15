// Fastify API + derlenmiş Next.js arayüzü + Claude bağlayıcısı (MCP over HTTP).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import fstatic from "@fastify/static";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { DATA_DIR, HOST, PORT, ROOT, loadConfig, saveConfig } from "./config.js";
import * as db from "./db.js";
import * as auth from "./auth.js";
import { alternatives } from "./ai.js";
import { describe, load, readTexts } from "./docx.js";
import { CATEGORIES, ingestFile } from "./memory.js";
import { createMcpServer } from "./mcp.js";
import * as svc from "./service.js";
import { importBackup, makeBackup } from "./backup.js";

auth.accessKey(); // anahtar yoksa açıkça hata ver
const out = path.join(ROOT, "frontend/out");
const app = Fastify({
  logger: false, trustProxy: true, bodyLimit: 20 * 1024 * 1024,
  // Next.js statik çıktısı sayfa ön yükleme dosyasını "__next.bellek/__PAGE__.txt" olarak yazar, tarayıcı
  // "__next.bellek.__PAGE__.txt" ister — eşle.
  rewriteUrl: (req) => {
    const u = req.url ?? "/", m = u.match(/^(.*\/__next\.[^/?]+)\.(__PAGE__\.txt)(\?.*)?$/);
    return m && fs.existsSync(path.join(out, decodeURIComponent(m[1]), m[2])) ? `${m[1]}/${m[2]}${m[3] ?? ""}` : u;
  },
});
await app.register(cookie);
await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024, files: 200 } });

const user = (r: FastifyRequest) => (r as any).user as string;
const bg = (p: Promise<unknown>) => void p.catch((e) => console.error(e));
const fail = (code: number, detail: string) => Object.assign(new Error(detail), { statusCode: code });
app.setErrorHandler((e: any, _r, reply) => reply.code(e.statusCode ?? 500).send({ detail: e.message }));

// ---------------------------------------------------------------- üyelik
app.addHook("onRequest", async (req, reply) => {
  if (!req.url.startsWith("/api/") || req.url.startsWith("/api/giris")) return;
  const name = auth.readSession(req.cookies[auth.COOKIE]);
  if (!name) return reply.code(401).send({ detail: "Oturum gerekli" });
  (req as any).user = name;
});

app.post("/api/giris", async (req, reply) => {
  const { ad = "", anahtar = "" } = (req.body ?? {}) as any;
  const name = String(ad).split(/\s+/).join(" ").trim().slice(0, 40);
  if (!name || !auth.checkKey(String(anahtar))) throw fail(401, "Ad ya da erişim anahtarı hatalı");
  db.touchMember(name);
  reply.setCookie(auth.COOKIE, auth.makeSession(name), { path: "/", httpOnly: true, sameSite: "lax", secure: req.protocol === "https", maxAge: auth.MAX_AGE });
  return { ok: true, ad: name };
});
app.post("/api/cikis", async (_req, reply) => { reply.clearCookie(auth.COOKIE, { path: "/" }); return { ok: true }; });
app.get("/saglik", async () => ({ ok: true }));
app.get("/api/status", async (req) => ({ ai_ready: svc.aiReady(), data_dir: DATA_DIR, version: "2.0.0", user: user(req),
  mcp_path: `/baglanti/${auth.mcpToken()}/mcp`, members: db.listMembers() }));

// ---------------------------------------------------------------- dosya yükleme yardımcısı
async function saveUploads(req: FastifyRequest) {
  const files: { tmp: string; name: string }[] = [], fields: Record<string, string> = {};
  for await (const part of req.parts()) {
    if (part.type === "file") {
      const name = path.basename(part.filename.replace(/\\/g, "/")), tmp = path.join(os.tmpdir(), `sa-${crypto.randomUUID()}.docx`);
      fs.writeFileSync(tmp, await part.toBuffer());
      files.push({ tmp, name });
    } else fields[part.fieldname] = String(part.value);
  }
  return { files, fields };
}
const cleanup = (files: { tmp: string }[]) => files.forEach((f) => fs.rmSync(f.tmp, { force: true }));

// ---------------------------------------------------------------- senaryolar
app.get("/api/docs", async () => db.listDocuments());
app.post("/api/docs", async (req) => {
  const { files, fields } = await saveUploads(req), created: any[] = [];
  try {
    for (const f of files.filter((x) => x.name.toLowerCase().endsWith(".docx"))) {
      try { await load(f.tmp); } catch { throw fail(400, `'${f.name}' okunamadı; geçerli bir .docx değil.`); }
      created.push(db.storeDocument(f.tmp, f.name, user(req)));
    }
  } finally { cleanup(files); }
  if (!created.length) throw fail(400, "Yalnızca .docx dosyaları kabul edilir.");
  bg((async () => { for (const d of created) await svc.processDoc(d.id, fields.run_ai !== "false"); })());
  return created;
});
const docOr404 = (id: string) => db.getDocument(id) ?? (() => { throw fail(404, "Belge bulunamadı"); })();
app.get("/api/docs/:id", async (req: any) => {
  const doc = docOr404(req.params.id), paras = await describe(doc.stored_path), findings = db.listFindings(doc.id);
  return { doc, findings, paragraphs: paras.map((p) => {
    const fs_ = findings.filter((f) => f.paragraph === p.index);
    return { ...p, preview: fs_.length ? svc.previewParagraph(p.text, fs_) : p.text };
  }) };
});
app.delete("/api/docs/:id", async (req: any) => (db.deleteDocument(req.params.id), { ok: true }));
app.post("/api/docs/delete", async (req: any) => { for (const id of req.body.ids) db.deleteDocument(id); return { deleted: req.body.ids.length }; });
app.post("/api/docs/to_memory", async (req: any) => {
  let moved = 0;
  for (const id of req.body.ids) {
    const d = db.getDocument(id);
    if (!d) continue;
    await ingestFile(d.stored_path, d.name, d.uploaded_by || user(req));
    db.deleteDocument(id); moved++;
  }
  return { moved, lessons: db.listLessons().length };
});
app.post("/api/docs/:id/rescan", async (req: any) => {
  const id = docOr404(req.params.id).id, ai = req.body?.ai !== false;
  bg((async () => {
    db.updateDocument(id, { status: "analiz", status_detail: "Kurallar taranıyor" });
    await svc.scanRules(id);
    if (ai && svc.aiReady()) {
      try { await svc.scanAi(id, (d, t) => db.updateDocument(id, { status_detail: `Claude inceliyor (${d}/${t})` })); }
      catch (e: any) { return db.updateDocument(id, { status: "hazir", status_detail: `Claude hatası: ${e.message}` }); }
    }
    db.updateDocument(id, { status: "hazir", status_detail: "" });
  })());
  return { ok: true };
});
app.post("/api/docs/:id/findings", async (req: any) => {
  const doc = docOr404(req.params.id), { paragraph, start, end, suggestion = "", reason = "Editör tarafından işaretlendi." } = req.body;
  const t = (await readTexts(doc.stored_path))[paragraph];
  if (t === undefined || !(0 <= start && start < end && end <= t.length)) throw fail(400, "Geçersiz seçim");
  return db.addFinding(doc.id, paragraph, start, end, t.slice(start, end), suggestion ? [suggestion] : [], { category: "editör", reason, source: "manuel" });
});
app.post("/api/docs/:id/edit", async (req: any) => {
  try { return { finding: await svc.editParagraph(docOr404(req.params.id).id, req.body.paragraph, req.body.text) }; }
  catch (e: any) { throw fail(e.statusCode ?? 400, e.message); }
});
app.post("/api/docs/:id/accept_all", async (req: any) => {
  let n = 0;
  for (const f of db.listFindings(req.params.id, "bekliyor")) if (f.suggestions.length) { svc.decide(f.id, "kabul", f.suggestions[0], false); n++; }
  return { accepted: n };
});
app.get("/api/docs/:id/export", async (req: any, reply) => {
  const r = await svc.exportDoc(docOr404(req.params.id).id, req.query.tracked === "true");
  return reply.header("Content-Disposition", `attachment; filename*=utf-8''${encodeURIComponent(path.basename(r.path))}`)
    .header("X-Applied", String(r.applied)).header("X-Pending", String(r.pending))
    .type("application/vnd.openxmlformats-officedocument.wordprocessingml.document").send(fs.readFileSync(r.path));
});
app.post("/api/compare", async (req: any) => {
  const o = docOr404(req.body.old_id), n = docOr404(req.body.new_id);
  return { learned: await svc.learnFromVersions(o.stored_path, n.stored_path, `'${o.name}' -> '${n.name}'`) };
});

// ---------------------------------------------------------------- bulgular
app.post("/api/findings/:id/decide", async (req: any) => svc.decide(req.params.id, req.body.action, req.body.text) ?? (() => { throw fail(404, "Bulgu yok"); })());
app.post("/api/findings/:id/alternatives", async (req: any) => {
  const f = db.getFinding(req.params.id);
  if (!f) throw fail(404, "Bulgu yok");
  if (!svc.aiReady()) throw fail(400, "Claude bağlantısı yok. Ayarlar'dan API anahtarı ekleyin.");
  const t = (await readTexts(db.getDocument(f.doc_id)!.stored_path))[f.paragraph];
  try { return db.addSuggestions(f.id, await alternatives(f.original, t, f.reason, f.suggestions)); }
  catch (e: any) { throw fail(502, `Claude hatası: ${e.message}`); }
});

// ---------------------------------------------------------------- bellek
app.get("/api/memory", async () => ({ pairs: db.memoryPairs(), lessons: db.listLessons(), categories: CATEGORIES }));
app.post("/api/memory", async (req) => {
  const { files } = await saveUploads(req), out: any[] = [];
  try {
    for (const f of files.filter((x) => x.name.toLowerCase().endsWith(".docx") && !x.name.startsWith("~$"))) {
      try { out.push({ name: f.name, ...(await ingestFile(f.tmp, f.name, user(req))) }); }
      catch (e: any) { out.push({ name: f.name, error: `okunamadı: ${e.message}` }); }
    }
  } finally { cleanup(files); }
  bg(svc.rescanAllRules());
  return out;
});
app.delete("/api/memory/:key", async (req: any) => (db.deleteMemoryPair(req.params.key), { ok: true }));
app.patch("/api/lessons/:id", async (req: any) => {
  const { active = null, category = null, changes = null } = req.body ?? {};
  const r: any = db.updateLesson(req.params.id, { active, category, changes });
  if (!r) throw fail(404, "Not bulunamadı");
  if (changes) r.rules_updated = db.syncLessonRules(req.params.id, changes);
  if (changes || active !== null) bg(svc.rescanAllRules());
  return r;
});
app.post("/api/lessons/:id/rule", async (req: any) => {
  const l = db.listLessons().find((x) => x.id === req.params.id), { old = "", new: nw = "" } = req.body;
  if (!l || !String(old).trim()) throw fail(400, "Geçersiz istek");
  return db.addRule(old, [nw], { match_type: old.includes(" ") ? "ifade" : "kelime", category: l.category, reason: l.note.split(/\s+/).join(" ").slice(0, 300),
    source: "ogrenilen", status: "aktif", example: l.old_text.slice(0, 300), lesson_id: l.id });
});

// ---------------------------------------------------------------- kurallar
app.get("/api/rules", async () => db.listRules());
app.post("/api/rules", async (req: any) => {
  const { pattern = "", replacements = [], match_type = "kelime", category = "argo", reason = "" } = req.body;
  if (!pattern.trim()) throw fail(400, "Kelime/ifade boş olamaz");
  if (match_type === "desen") { try { new RegExp(pattern); } catch { throw fail(400, "Desen geçerli bir düzenli ifade değil"); } }
  return db.addRule(pattern, replacements, { match_type, category, reason, source: "manuel" });
});
app.patch("/api/rules/:id", async (req: any) => db.updateRule(req.params.id, req.body) ?? (() => { throw fail(404, "Kural yok"); })());
app.delete("/api/rules/:id", async (req: any) => (db.deleteRule(req.params.id), { ok: true }));

// ---------------------------------------------------------------- ayarlar ve yedek
const masked = () => { const c = loadConfig(), k = c.api_key; return { ...c, api_key: k.length > 12 ? `${k.slice(0, 7)}…${k.slice(-4)}` : "", api_key_set: !!k }; };
app.get("/api/settings", async () => masked());
app.post("/api/settings", async (req: any) => {
  const b = { ...req.body };
  if (String(b.api_key ?? "").includes("…")) delete b.api_key; // maskeli değer geri geldi
  saveConfig(b);
  return masked();
});
app.get("/api/yedek", async (_req, reply) => {
  const { name, data } = await makeBackup();
  return reply.header("Content-Disposition", `attachment; filename="${name}"`).type("application/zip").send(data);
});
app.post("/api/yedek", async (req) => {
  const file = await req.file();
  if (!file) throw fail(400, "Dosya yok");
  try { const r = await importBackup(await file.toBuffer(), user(req)); bg(svc.rescanAllRules()); return r; }
  catch (e: any) { throw fail(400, `Yedek okunamadı: ${e.message}`); }
});

// ---------------------------------------------------------------- Claude bağlayıcısı: /baglanti/<gizli>/mcp
app.all("/baglanti/:token/mcp", async (req: any, reply) => {
  if (req.params.token !== auth.mcpToken()) return reply.code(404).send({ detail: "Bulunamadı" });
  const server = createMcpServer("Claude"), transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  reply.hijack();
  reply.raw.on("close", () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req.raw, reply.raw, req.body);
});

// ---------------------------------------------------------------- arayüz (next build çıktısı)
if (fs.existsSync(out)) {
  await app.register(fstatic, { root: out, extensions: ["html"], index: ["index.html"] });
  app.setNotFoundHandler((req, reply) => req.url.startsWith("/api/") ? reply.code(404).send({ detail: "Bulunamadı" })
    : reply.code(404).type("text/html").send(fs.readFileSync(path.join(out, fs.existsSync(path.join(out, "404.html")) ? "404.html" : "index.html"))));
}

if (db.migrated) bg(svc.rescanAllRules());
await app.listen({ port: PORT, host: HOST });
console.log(`Senaryo Asistanı API: http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}${fs.existsSync(out) ? "" : "  (arayüz derlenmemiş: npm run build)"}`);
