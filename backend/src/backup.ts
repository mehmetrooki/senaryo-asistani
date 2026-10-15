// Yedek alma ve BİRLEŞTİREREK içe aktarma (hiçbir şeyin üzerine yazılmaz; aynı dosyalar iki kez eklenmez).
// Python sürümünün yedekleriyle de uyumludur.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import JSZip from "jszip";
import { DATA_DIR } from "./config.js";
import * as db from "./db.js";
import { ingestFile } from "./memory.js";

const sha1 = (f: string) => crypto.createHash("sha1").update(fs.readFileSync(f)).digest("hex");

export async function makeBackup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sa-yedek-")), snap = path.join(tmp, "veri.sqlite3");
  db.db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`); // yazma sürerken bile tutarlı kopya
  const zip = new JSZip();
  zip.file("veri.sqlite3", fs.readFileSync(snap));
  for (const sub of ["belgeler", "bellek"]) {
    for (const f of fs.readdirSync(path.join(DATA_DIR, sub)).filter((x) => x.endsWith(".docx"))) zip.file(`${sub}/${f}`, fs.readFileSync(path.join(DATA_DIR, sub, f)));
  }
  zip.file("bilgi.json", JSON.stringify({ olusturma: new Date().toISOString(), surum: 2 }));
  fs.rmSync(tmp, { recursive: true, force: true });
  const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
  return { name: `senaryo-asistani-yedek-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.zip`,
    data: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }) };
}

export async function importBackup(buf: Buffer, user = "") {
  const s = { bellek_dosyasi: 0, bellek_atlandi: 0, not_duzeltmesi: 0, kural: 0, senaryo: 0, senaryo_atlandi: 0 };
  const zip = await JSZip.loadAsync(buf);
  if (!zip.file("veri.sqlite3")) throw new Error("Bu dosya bir Senaryo Asistanı yedeği değil.");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sa-ice-"));
  try {
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir || !(name === "veri.sqlite3" || (/^(belgeler|bellek)\/[^/\\]+\.docx$/.test(name)))) continue; // ../ kaçışı engeli
      fs.mkdirSync(path.join(tmp, path.dirname(name)), { recursive: true });
      fs.writeFileSync(path.join(tmp, name), await entry.async("nodebuffer"));
    }
    const src = new DatabaseSync(path.join(tmp, "veri.sqlite3"), { readOnly: true });
    const rows = (sql: string, ...p: any[]) => { try { return src.prepare(sql).all(...p) as any[]; } catch { return []; } };
    const local = (sub: string, stored: string) => { const f = path.join(tmp, sub, String(stored).split(/[\\/]/).pop()!); return fs.existsSync(f) ? f : null; };

    const haveMem = new Set(db.memoryFiles().map((f) => `${f.pair_key}|${f.kind}`));
    for (const f of rows("SELECT * FROM memory_files")) {
      if (haveMem.has(`${f.pair_key}|${f.kind}`)) { s.bellek_atlandi++; continue; }
      const file = local("bellek", f.stored_path);
      if (file) { await ingestFile(file, f.name, f.uploaded_by || user); s.bellek_dosyasi++; }
    }
    const target = new Map(db.listLessons().map((l) => [`${l.pair_key}\0${l.note}\0${l.anchor}`, l]));
    for (const l of rows("SELECT * FROM lessons")) {
      const t = target.get(`${l.pair_key}\0${l.note}\0${l.anchor}`);
      if (!t) continue;
      const changes = l.edited && !t.edited ? JSON.parse(l.changes) : null;
      const active = !l.active ? false : null, category = l.category !== t.category ? l.category : null;
      if (changes || active !== null || category) { db.updateLesson(t.id, { changes, active, category }); s.not_duzeltmesi++; }
    }
    for (const r of rows("SELECT * FROM rules WHERE source != 'varsayilan'")) {
      db.addRule(r.pattern, JSON.parse(r.replacements), { match_type: r.match_type, category: r.category, reason: r.reason,
        source: r.source, status: r.status, example: r.example ?? "", context: r.context ?? "kesin" });
      s.kural++;
    }
    const have = new Set(db.listDocuments().filter((d) => fs.existsSync(d.stored_path)).map((d) => sha1(d.stored_path)));
    for (const d of rows("SELECT * FROM documents")) {
      const file = local("belgeler", d.stored_path);
      if (!file) continue;
      const h = sha1(file);
      if (have.has(h)) { s.senaryo_atlandi++; continue; }
      have.add(h);
      const nd = db.storeDocument(file, d.name, d.uploaded_by || user);
      db.updateDocument(nd.id, { status: ["hazir", "hata"].includes(d.status) ? d.status : "hazir", paragraph_count: d.paragraph_count ?? 0, learned_count: d.learned_count ?? 0 });
      for (const f of rows("SELECT * FROM findings WHERE doc_id=?", d.id)) {
        const info = JSON.parse(f.suggestion_info || "{}");
        db.addFinding(nd.id, f.paragraph, f.start, f.end, f.original, JSON.parse(f.suggestions).map((t: string) => ({ text: t, ...info[t] })),
          { category: f.category, reason: f.reason, severity: f.severity, source: f.source, rule_id: f.rule_id, status: f.status, chosen: f.chosen });
      }
      s.senaryo++;
    }
    src.close();
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return s;
}
