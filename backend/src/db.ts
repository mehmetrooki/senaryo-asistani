// SQLite veri deposu (Python sürümüyle aynı şema; mevcut veriler olduğu gibi kullanılır).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR, DB_PATH, DEFAULT_CONFIG, loadConfig, newId, now } from "./config.js";
import data from "./data.json" with { type: "json" };
import { isJunkPattern } from "./text.js";

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA busy_timeout=30000; PRAGMA journal_mode=WAL;");

type Row = Record<string, any>;
export const all = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as Row[];
export const get = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as Row | undefined;
export const run = (sql: string, ...p: any[]) => db.prepare(sql).run(...p);
const J = (v: unknown) => JSON.stringify(v);

db.exec(`
CREATE TABLE IF NOT EXISTS rules (id TEXT PRIMARY KEY, pattern TEXT NOT NULL, match_type TEXT NOT NULL DEFAULT 'kelime',
  replacements TEXT NOT NULL DEFAULT '[]', category TEXT NOT NULL DEFAULT 'argo', reason TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manuel', status TEXT NOT NULL DEFAULT 'aktif', hits INTEGER NOT NULL DEFAULT 0,
  example TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, name TEXT NOT NULL, stored_path TEXT NOT NULL,
  uploaded_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'bekliyor', status_detail TEXT NOT NULL DEFAULT '',
  previous_id TEXT, paragraph_count INTEGER NOT NULL DEFAULT 0, learned_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS findings (id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, paragraph INTEGER NOT NULL,
  start INTEGER NOT NULL, end INTEGER NOT NULL, original TEXT NOT NULL, suggestions TEXT NOT NULL DEFAULT '[]',
  category TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', severity TEXT NOT NULL DEFAULT 'orta',
  source TEXT NOT NULL DEFAULT 'kural', rule_id TEXT, status TEXT NOT NULL DEFAULT 'bekliyor', chosen TEXT,
  created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_findings_doc ON findings(doc_id);
CREATE TABLE IF NOT EXISTS memory_files (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
  pair_key TEXT NOT NULL, stored_path TEXT NOT NULL, comment_count INTEGER NOT NULL DEFAULT 0, uploaded_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lessons (id TEXT PRIMARY KEY, pair_key TEXT NOT NULL, source_name TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '', note TEXT NOT NULL, anchor TEXT NOT NULL DEFAULT '', old_text TEXT NOT NULL DEFAULT '',
  new_text TEXT NOT NULL DEFAULT '', changes TEXT NOT NULL DEFAULT '[]', category TEXT NOT NULL DEFAULT 'diğer',
  outcome TEXT NOT NULL DEFAULT 'son_yok', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_lessons_pair ON lessons(pair_key);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS members (name TEXT PRIMARY KEY, first_login TEXT NOT NULL, last_login TEXT NOT NULL,
  logins INTEGER NOT NULL DEFAULT 0);
`);

// ---- eski kurulumlar için kolon eklemeleri
const cols = (t: string) => new Set(all(`PRAGMA table_info(${t})`).map((r) => r.name));
const addCol = (t: string, c: string, def: string) => { if (!cols(t).has(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); };
const hadContext = cols("rules").has("context");
addCol("rules", "context", "TEXT NOT NULL DEFAULT 'kesin'");
addCol("rules", "lesson_id", "TEXT");
addCol("findings", "suggestion_info", "TEXT NOT NULL DEFAULT '{}'");
addCol("documents", "uploaded_by", "TEXT NOT NULL DEFAULT ''");
addCol("memory_files", "uploaded_by", "TEXT NOT NULL DEFAULT ''");
addCol("lessons", "edited", "INTEGER NOT NULL DEFAULT 0");

// ---- varsayılan kurallar (sürüm bazlı: yeni eklenenler mevcut kurulumlara bir kez gelir)
export let migrated = false;
{
  const seeds = data.seedRules as any[];
  const row = get("SELECT value FROM meta WHERE key='seed_version'");
  const version = row?.value ?? (hadContext ? "1.1" : "1.0");
  const empty = !get("SELECT 1 FROM rules LIMIT 1");
  if (!hadContext) {
    migrated = true;
    run("UPDATE rules SET context='baglamsal' WHERE source='varsayilan' AND lower(pattern)='ha'");
    for (const r of all("SELECT id, pattern FROM rules WHERE status='aday' AND source='ogrenilen'")) {
      if (isJunkPattern(r.pattern)) run("DELETE FROM rules WHERE id=?", r.id); // "k", "’yi", "KUCHO" gibi anlamsız adaylar
    }
  }
  if (migrated || !row) {
    for (const r of seeds.filter((x) => x.added)) {
      run("DELETE FROM rules WHERE lower(pattern)=? AND status='aday' AND source='ogrenilen'", r.pattern.toLowerCase());
    }
  }
  const existing = new Set(all("SELECT pattern FROM rules").map((r) => String(r.pattern).toLowerCase()));
  for (const r of seeds) {
    const newer = r.added && r.added > version;
    if (empty || (newer && !existing.has(r.pattern.toLowerCase()))) {
      run(`INSERT INTO rules (id, pattern, match_type, replacements, category, reason, source, status, context, created_at)
           VALUES (?,?,?,?,?,?,'varsayilan','aktif',?,?)`,
        newId(), r.pattern, r.match_type, J(r.replacements), r.category, r.reason, r.context ?? "kesin", now());
    }
  }
  const latest = seeds.reduce((m, r) => (r.added && r.added > m ? r.added : m), version);
  if (latest !== version || !row) {
    run("INSERT OR REPLACE INTO meta (key, value) VALUES ('seed_version', ?)", latest);
    if (latest !== version) migrated = true;
  }
}

// ---------------------------------------------------------------- yardımcılar
export function defaultUser(): string {
  const a = (loadConfig().author || "").trim();
  return a && a !== DEFAULT_CONFIG.author ? a : os.userInfo().username;
}

/** Kayıttaki yol başka bilgisayarın yoluysa bu veri klasöründeki karşılığını kullan. */
function rebase(d: Row, sub: string): Row {
  if (d && !fs.existsSync(d.stored_path)) d.stored_path = path.join(DATA_DIR, sub, String(d.stored_path).split(/[\\/]/).pop()!);
  return d;
}

// ---------------------------------------------------------------- AI notları
// scope: "yer"     -> senaryoda belirli bir kısım için not (doc_id + paragraph + start/end + quote)
//        "senaryo" -> o senaryonun tamamı için not (doc_id)
//        "genel"   -> Geliştir sekmesindeki güncellemeler (yönerge, karakter bilgisi, üslup…)
// learn=1: sonraki senaryo incelemelerinde de Claude'a verilir. Genel notlarda "AI'da kullan" anlamına gelir.
db.exec(`CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, scope TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'not',
  doc_id TEXT, paragraph INTEGER, start INTEGER, end INTEGER, quote TEXT NOT NULL DEFAULT '', text TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '', learn INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'acik',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_notes_doc ON notes(doc_id);`);

const DEFAULT_GUIDELINE = "Normal olmayan, alışılmadık HER eylem tehlikeli olabilir ve çocuklara kötü örnek olur; bunları inanılmaz ısrarcı "
  + "şekilde denetle. Örnek: \"yangın tüpünü fark eder ve panzehiri yangın tüpünün içine sıkarak yanına alır\". Nesnelerin amacı dışında "
  + "kullanılması, maddelerin karıştırılması/sıkılması/içilmesi, güvenlik ekipmanlarıyla oynanması, bilinmeyen bitki-meyve-sıvının "
  + "yenmesi/içilmesi, elektrik hattına dokunulması gibi her durumu işaretle (ciddiyet: yuksek). Şüphede kalırsan işaretle ve sahnenin "
  + "amacını koruyan güvenli bir eylem öner.";
// Eski "ekip yönergeleri" (meta) bir kez Geliştir güncellemelerine taşınır
if (!get("SELECT 1 FROM meta WHERE key='notlar_tasindi'")) {
  const old = get("SELECT value FROM meta WHERE key='yonergeler'");
  for (const t of old ? (JSON.parse(old.value) as string[]) : [DEFAULT_GUIDELINE]) {
    run(`INSERT INTO notes (id, scope, kind, text, author, learn, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?)`,
      newId(), "genel", "yönerge", t, "Ekip", now(), now());
  }
  run("INSERT OR REPLACE INTO meta (key, value) VALUES ('notlar_tasindi', '1')");
}

// 1.4: fiziksel tepki ve zorlama yönergeleri (bir kez eklenir; sonra Geliştir'den düzenlenebilir)
if (!get("SELECT 1 FROM meta WHERE key='yonerge_1_4'")) {
  for (const t of [
    "Fiziksel / kaba tepkileri SERT şekilde denetle: karakterler dil çıkaramaz, tüküremez, taş atamaz; çimdikleme, ısırma, itip kakma, "
    + "dürtme, kaba el hareketi, geğirme gibi her fiziksel tepkiyi işaretle (ciddiyet: yuksek) ve zararsız bir tepkiyle değiştir.",
    "Karakterler başka karakterlere ZORLA bir şey yaptıramaz. İşkence, eziyet, birini alıkoymak, rehin almak, bir yere kapatmak, "
    + "bağlamak, hapsetmek kesinlikle olamaz. \"Bunu yapacaksın\", \"zorundasın\", \"emrediyorum\" gibi dayatma dili de olamaz; "
    + "rica ya da öneri diline çevir.",
  ]) run("INSERT INTO notes (id, scope, kind, text, author, learn, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?)", newId(), "genel", "yönerge", t, "Ekip", now(), now());
  run("INSERT OR REPLACE INTO meta (key, value) VALUES ('yonerge_1_4', '1')");
}

const noteRow = (r: Row): Row => ({ ...r, learn: !!r.learn });
export function addNote(n: { scope: string; text: string; kind?: string; doc_id?: string | null; paragraph?: number | null;
  start?: number | null; end?: number | null; quote?: string; author?: string; learn?: boolean }) {
  const id = newId();
  run(`INSERT INTO notes (id, scope, kind, doc_id, paragraph, start, end, quote, text, author, learn, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, n.scope, n.kind ?? "not", n.doc_id ?? null, n.paragraph ?? null, n.start ?? null,
    n.end ?? null, n.quote ?? "", n.text.trim(), n.author ?? defaultUser(), n.learn === false ? 0 : 1, now(), now());
  return getNote(id)!;
}
export const getNote = (id: string) => { const r = get("SELECT * FROM notes WHERE id=?", id); return r ? noteRow(r) : null; };
export function listNotes(o: { doc_id?: string; scope?: string; learnOnly?: boolean } = {}) {
  const w: string[] = [], p: any[] = [];
  if (o.doc_id) { w.push("doc_id=?"); p.push(o.doc_id); }
  if (o.scope) { w.push("scope=?"); p.push(o.scope); }
  if (o.learnOnly) w.push("learn=1");
  return all(`SELECT n.*, d.name AS doc_name FROM notes n LEFT JOIN documents d ON d.id=n.doc_id${w.length ? " WHERE " + w.map((x) => "n." + x).join(" AND ") : ""}
    ORDER BY n.created_at DESC`, ...p).map(noteRow);
}
export function updateNote(id: string, f: Row) {
  for (const k of ["text", "kind", "status"]) if (typeof f[k] === "string") run(`UPDATE notes SET ${k}=?, updated_at=? WHERE id=?`, f[k], now(), id);
  if (typeof f.learn === "boolean") run("UPDATE notes SET learn=?, updated_at=? WHERE id=?", f.learn ? 1 : 0, now(), id);
  return getNote(id);
}
export const deleteNote = (id: string) => run("DELETE FROM notes WHERE id=?", id);
/** Claude'un her incelemede uyduğu ekip güncellemeleri (Geliştir sekmesi, "AI'da kullan" açık olanlar). */
export const getGuidelines = () => listNotes({ scope: "genel", learnOnly: true }).reverse();

// ---------------------------------------------------------------- üyeler
export function touchMember(name: string) {
  run(`INSERT INTO members (name, first_login, last_login, logins) VALUES (?,?,?,1)
       ON CONFLICT(name) DO UPDATE SET last_login=excluded.last_login, logins=logins+1`, name, now(), now());
}
export const listMembers = () => all("SELECT * FROM members ORDER BY last_login DESC");

// ---------------------------------------------------------------- kurallar
const ruleRow = (r?: Row) => (r ? { ...r, replacements: JSON.parse(r.replacements) } : null);
export const listRules = (status?: string) =>
  (status ? all("SELECT * FROM rules WHERE status=? ORDER BY created_at DESC", status)
    : all("SELECT * FROM rules ORDER BY status, created_at DESC")).map(ruleRow) as Row[];

export function addRule(pattern: string, replacements: string[], o: {
  match_type?: string; category?: string; reason?: string; source?: string; status?: string; example?: string;
  context?: string; lesson_id?: string | null;
} = {}) {
  pattern = pattern.trim();
  const { match_type = "kelime", category = "argo", reason = "", source = "manuel", status = "aktif" } = o;
  const ex = get("SELECT * FROM rules WHERE lower(pattern)=lower(?)", pattern);
  let id: string;
  if (ex) {
    const reps: string[] = JSON.parse(ex.replacements);
    for (const r of replacements) if (r && !reps.includes(r)) reps.push(r);
    let st = ex.status;
    if (status === "aktif" || ex.status === "pasif") st = ex.status !== "aktif" ? status : "aktif";
    run("UPDATE rules SET replacements=?, status=?, hits=hits+?, lesson_id=COALESCE(lesson_id, ?) WHERE id=?",
      J(reps), st, source === "ogrenilen" ? 1 : 0, o.lesson_id ?? null, ex.id);
    id = ex.id;
  } else {
    id = newId();
    run(`INSERT INTO rules (id, pattern, match_type, replacements, category, reason, source, status, example, context,
         lesson_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, id, pattern, match_type, J(replacements.filter(Boolean)),
      category, reason, source, status, o.example ?? "", o.context ?? "kesin", o.lesson_id ?? null, now());
  }
  return ruleRow(get("SELECT * FROM rules WHERE id=?", id))!;
}

export function updateRule(id: string, f: Row) {
  for (const k of ["pattern", "match_type", "replacements", "category", "reason", "status", "context"]) {
    if (f[k] !== undefined && f[k] !== null) run(`UPDATE rules SET ${k}=? WHERE id=?`, k === "replacements" ? J(f[k]) : f[k], id);
  }
  return ruleRow(get("SELECT * FROM rules WHERE id=?", id));
}
export const deleteRule = (id: string) => run("DELETE FROM rules WHERE id=?", id);

/** Dersten "Kural yap" ile üretilen kuralları, ders elle düzeltilince günceller. */
export function syncLessonRules(lessonId: string, edits: { orig_old?: string; old?: string; new?: string }[]) {
  let n = 0;
  for (const e of edits) {
    const key = (e.orig_old || "").trim().toLowerCase();
    if (!key) continue;
    for (const r of all("SELECT id FROM rules WHERE lesson_id=? AND lower(pattern)=?", lessonId, key)) {
      const o = (e.old || "").trim(), nw = (e.new || "").trim();
      if (!o) run("DELETE FROM rules WHERE id=?", r.id);
      else run("UPDATE rules SET pattern=?, replacements=?, match_type=? WHERE id=?", o, J([nw]),
        o.includes(" ") ? "ifade" : "kelime", r.id);
      n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------- belgeler
export function storeDocument(src: string, name?: string, user?: string) {
  const id = newId(), dest = path.join(DATA_DIR, "belgeler", `${id}.docx`);
  fs.copyFileSync(src, dest);
  run("INSERT INTO documents (id, name, stored_path, uploaded_at, uploaded_by) VALUES (?,?,?,?,?)",
    id, name || path.basename(src), dest, now(), user ?? defaultUser());
  return getDocument(id)!;
}
export const getDocument = (id: string): Row | null => { const r = get("SELECT * FROM documents WHERE id=?", id); return r ? rebase(r, "belgeler") : null; };
export function listDocuments(): Row[] {
  return all("SELECT * FROM documents ORDER BY uploaded_at DESC, rowid DESC").map((d) => {
    const counts: Row = {};
    for (const c of all("SELECT status, COUNT(*) n FROM findings WHERE doc_id=? GROUP BY status", d.id)) counts[c.status] = c.n;
    return { ...rebase(d, "belgeler"), counts };
  });
}
export const latestDocument = (): Row | null => listDocuments()[0] ?? null;
export function updateDocument(id: string, f: Row) {
  for (const k of ["status", "status_detail", "previous_id", "paragraph_count", "learned_count", "name"]) {
    if (f[k] !== undefined) run(`UPDATE documents SET ${k}=? WHERE id=?`, f[k], id);
  }
}
export function deleteDocument(id: string) {
  const d = getDocument(id);
  run("DELETE FROM findings WHERE doc_id=?", id);
  run("DELETE FROM notes WHERE doc_id=? AND learn=0", id); // öğrenmede kullanılan notlar belge silinse de kalır
  run("DELETE FROM documents WHERE id=?", id);
  if (d) fs.rmSync(d.stored_path, { force: true });
}

// ---------------------------------------------------------------- bulgular
export type Sugg = string | { text: string; kaynak?: string; ref?: string; note?: string };
const findingRow = (r?: Row): Row | null => (r ? { ...r, suggestions: JSON.parse(r.suggestions), suggestion_info: JSON.parse(r.suggestion_info || "{}") } : null);

function normalize(sugg: Sugg[], def: string) {
  const texts: string[] = [], info: Row = {};
  for (const s of sugg) {
    const t = typeof s === "string" ? s : s.text ?? "";
    if (!(t in info)) {
      info[t] = typeof s === "string" ? { kaynak: def, ref: "" } : { kaynak: s.kaynak || def, ref: s.ref || "", ...(s.note ? { note: s.note } : {}) };
    }
    if (!texts.includes(t)) texts.push(t);
  }
  return { texts, info };
}

export function addFinding(docId: string, p: number, start: number, end: number, original: string, sugg: Sugg[], o: {
  category?: string; reason?: string; severity?: string; source?: string; rule_id?: string | null; status?: string; chosen?: string | null;
} = {}) {
  const source = o.source ?? "kural", status = o.status ?? "bekliyor";
  const { texts, info } = normalize(sugg, source === "ai" ? "claude" : source);
  const ov = get("SELECT * FROM findings WHERE doc_id=? AND paragraph=? AND start<? AND end>?", docId, p, end, start);
  if (ov && status === "bekliyor") {
    const s: string[] = JSON.parse(ov.suggestions), inf = JSON.parse(ov.suggestion_info || "{}");
    for (const t of texts) { if (!s.includes(t)) s.push(t); inf[t] ??= info[t]; }
    if (end - start > ov.end - ov.start) {
      run("UPDATE findings SET start=?, end=?, original=?, suggestions=?, suggestion_info=?, reason=? WHERE id=?",
        start, end, original, J(s), J(inf), o.reason || ov.reason, ov.id);
    } else run("UPDATE findings SET suggestions=?, suggestion_info=?, reason=? WHERE id=?", J(s), J(inf), ov.reason || o.reason || "", ov.id);
    return getFinding(ov.id)!;
  }
  const id = newId();
  run(`INSERT INTO findings (id, doc_id, paragraph, start, end, original, suggestions, suggestion_info, category, reason,
       severity, source, rule_id, status, chosen, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, docId, p, start, end, original, J(texts), J(info), o.category ?? "", o.reason ?? "", o.severity ?? "orta",
    source, o.rule_id ?? null, status, o.chosen ?? null, now());
  return getFinding(id)!;
}
export const deleteFindingsInRange = (docId: string, p: number, s: number, e: number) =>
  run("DELETE FROM findings WHERE doc_id=? AND paragraph=? AND start<? AND end>?", docId, p, Math.max(e, s + 1), s);
export const listFindings = (docId: string, status?: string) =>
  (status ? all("SELECT * FROM findings WHERE doc_id=? AND status=? ORDER BY paragraph, start", docId, status)
    : all("SELECT * FROM findings WHERE doc_id=? ORDER BY paragraph, start", docId)).map(findingRow) as Row[];
export const getFinding = (id: string) => findingRow(get("SELECT * FROM findings WHERE id=?", id));
export function decideFinding(id: string, status: string, chosen?: string | null) {
  run("UPDATE findings SET status=?, chosen=? WHERE id=?", status, status === "kabul" ? chosen ?? "" : null, id);
  return getFinding(id);
}
export function addSuggestions(id: string, sugg: Sugg[]) {
  const f = getFinding(id);
  if (!f) return null;
  const { texts, info } = normalize(sugg, "claude");
  for (const t of texts) { if (!f.suggestions.includes(t)) f.suggestions.push(t); f.suggestion_info[t] ??= info[t]; }
  run("UPDATE findings SET suggestions=?, suggestion_info=? WHERE id=?", J(f.suggestions), J(f.suggestion_info), id);
  return getFinding(id);
}
export const clearFindings = (docId: string, source?: string) => source
  ? run("DELETE FROM findings WHERE doc_id=? AND source=? AND status='bekliyor'", docId, source)
  : run("DELETE FROM findings WHERE doc_id=? AND status='bekliyor'", docId);

// ---------------------------------------------------------------- bellek
const lessonRow = (r: Row): Row => ({ ...r, changes: JSON.parse(r.changes), active: !!r.active, edited: !!r.edited });

export function addMemoryFile(src: string, name: string, kind: string, pairKey: string, commentCount: number, user?: string) {
  const id = newId(), dest = path.join(DATA_DIR, "bellek", `${id}.docx`);
  fs.copyFileSync(src, dest);
  for (const old of all("SELECT * FROM memory_files WHERE pair_key=? AND kind=?", pairKey, kind)) {
    fs.rmSync(rebase(old, "bellek").stored_path, { force: true });
    run("DELETE FROM memory_files WHERE id=?", old.id);
  }
  run(`INSERT INTO memory_files (id, name, kind, pair_key, stored_path, comment_count, uploaded_at, uploaded_by)
       VALUES (?,?,?,?,?,?,?,?)`, id, name, kind, pairKey, dest, commentCount, now(), user ?? defaultUser());
}
export const memoryFiles = (pairKey?: string): Row[] =>
  (pairKey ? all("SELECT * FROM memory_files WHERE pair_key=?", pairKey)
    : all("SELECT * FROM memory_files ORDER BY pair_key, kind")).map((r) => rebase(r, "bellek"));

export function memoryPairs() {
  const pairs: Record<string, Row> = {};
  for (const f of memoryFiles()) {
    const p = (pairs[f.pair_key] ??= { pair_key: f.pair_key, notlu: null, son: null });
    p[f.kind] = { id: f.id, name: f.name, uploaded_at: f.uploaded_at, comment_count: f.comment_count, uploaded_by: f.uploaded_by || "" };
  }
  for (const r of all("SELECT pair_key, outcome, COUNT(*) n FROM lessons GROUP BY pair_key, outcome")) {
    if (pairs[r.pair_key]) (pairs[r.pair_key].outcomes ??= {})[r.outcome] = r.n;
  }
  return Object.values(pairs).sort((a, b) => a.pair_key.localeCompare(b.pair_key));
}
export function deleteMemoryPair(pairKey: string) {
  for (const f of memoryFiles(pairKey)) fs.rmSync(f.stored_path, { force: true });
  run("DELETE FROM memory_files WHERE pair_key=?", pairKey);
  run("DELETE FROM lessons WHERE pair_key=?", pairKey);
}

export function replaceLessons(pairKey: string, lessons: Row[]) {
  const kept = new Map(all("SELECT id, note, anchor, active, category, edited, changes, outcome FROM lessons WHERE pair_key=?", pairKey)
    .map((r) => [`${r.note}\u0000${r.anchor}`, r]));
  run("DELETE FROM lessons WHERE pair_key=?", pairKey);
  for (const l of lessons) {
    const prev = kept.get(`${l.note}\u0000${l.anchor}`); // aynı kimlik: bağlı kurallar kopmasın; elle düzeltme korunur
    const edited = prev?.edited ?? 0;
    run(`INSERT INTO lessons (id, pair_key, source_name, author, note, anchor, old_text, new_text, changes, category, outcome,
         active, edited, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      prev?.id ?? newId(), pairKey, l.source_name, l.author ?? "", l.note, l.anchor, l.old_text, l.new_text,
      edited ? prev!.changes : J(l.changes), prev?.category ?? l.category, edited ? prev!.outcome : l.outcome,
      prev?.active ?? 1, edited, now());
  }
  return lessons.length;
}
export const listLessons = (activeOnly = false) =>
  all(`SELECT * FROM lessons${activeOnly ? " WHERE active=1" : ""} ORDER BY created_at DESC, pair_key`).map(lessonRow);
export function updateLesson(id: string, o: { active?: boolean | null; category?: string | null; changes?: Row[] | null }) {
  if (o.changes) {
    const clean = o.changes.map((c) => ({ old: String(c.old ?? "").trim(), new: String(c.new ?? "").trim() })).filter((c) => c.old || c.new);
    run("UPDATE lessons SET changes=?, edited=1, outcome=? WHERE id=?", J(clean), clean.length ? "revize" : "degismedi", id);
  }
  if (o.active !== undefined && o.active !== null) run("UPDATE lessons SET active=? WHERE id=?", o.active ? 1 : 0, id);
  if (o.category) run("UPDATE lessons SET category=? WHERE id=?", o.category, id);
  const r = get("SELECT * FROM lessons WHERE id=?", id);
  return r ? lessonRow(r) : null;
}
