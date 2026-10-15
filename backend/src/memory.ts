// Bellek: ekibin notlu (commented) senaryoları + son hâllerinden ders çıkarma; sürüm farkından öğrenme.
import path from "node:path";
import * as db from "./db.js";
import { extractComments, readTexts } from "./docx.js";
import { diffPairs, mapParagraphs, trLower, type Pair, SequenceMatcher } from "./text.js";
import data from "./data.json" with { type: "json" };

export const CATEGORIES = data.memoryCategories as string[];
const HINTS = (data.categoryHints as [string, string][]).map(([c, rx]) => [c, new RegExp(rx.replace(/\(\?<!/g, "(?<!"))] as const);
const NOTED = ["commented", "comments", "yorumlu", "notlu", "notlar"];

export function pairKey(name: string) {
  let stem = trLower(path.parse(name).name);
  for (const t of NOTED) stem = stem.replace(new RegExp(`[\\s._\\-()\\[\\]]*${t}[\\s._\\-()\\[\\]]*`, "g"), " ");
  return stem.replace(/[\s._-]+/g, "-").replace(/^-+|-+$/g, "");
}
const isNoted = (name: string) => NOTED.some((t) => trLower(path.parse(name).name).includes(t));
export const guessCategory = (note: string) => HINTS.find(([, rx]) => rx.test(trLower(note)))?.[0] ?? "diğer";

function nearAnchor(pairs: Pair[], oldText: string, anchor: string, slack = 2) {
  if (!pairs.length || !anchor) return pairs;
  const ranges = anchor.split("\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => [oldText.indexOf(l), l.length] as const).filter(([p]) => p >= 0).map(([p, n]) => [p - slack, p + n + slack]);
  if (!ranges.length) return pairs;
  const near = pairs.filter((p) => ranges.some(([s, e]) => p.pos < e && p.pos + Math.max(p.old.length, 1) > s));
  return near.length ? near : pairs;
}

function smallChanges(old: string, nw: string) {
  const a = old.split(/\s+/), b = nw.split(/\s+/);
  return new SequenceMatcher(a, b).opcodes().filter((o) => o[0] !== "equal")
    .map(([, i1, i2, j1, j2]) => ({ old: a.slice(i1, i2).join(" "), new: b.slice(j1, j2).join(" ") })).slice(0, 6);
}

async function buildLessons(notedPath: string, finalPath: string | null, sourceName: string) {
  const comments = await extractComments(notedPath), old = await readTexts(notedPath);
  const nw = finalPath ? await readTexts(finalPath) : null, map = nw ? mapParagraphs(old, nw) : new Map();
  return comments.map((c) => {
    const oldText = c.paragraphs.filter((i) => i < old.length).map((i) => old[i]).join("\n").trim();
    let newText = "", changes: { old: string; new: string }[] = [], outcome = "son_yok";
    if (nw) {
      const mapped = [...new Set(c.paragraphs.filter((i) => map.has(i)).map((i) => map.get(i)!))].sort((a, b) => a - b);
      newText = mapped.map((j) => nw[j]).join("\n").trim();
      if (!mapped.length) { outcome = "revize"; changes = oldText ? [{ old: oldText, new: "" }] : []; }
      else if (newText === oldText) outcome = "degismedi";
      else {
        outcome = "revize";
        changes = nearAnchor(diffPairs(oldText, newText), oldText, c.anchor).map((p) => ({ old: p.old, new: p.new }));
        if (!changes.length) changes = smallChanges(oldText, newText);
      }
    }
    return { source_name: sourceName, author: c.author, note: c.note, anchor: c.anchor || oldText.slice(0, 200),
      old_text: oldText, new_text: newText, changes, category: guessCategory(c.note), outcome };
  });
}

export async function rebuildPair(key: string) {
  const files = Object.fromEntries(db.memoryFiles(key).map((f) => [f.kind, f]));
  let lessons: any[] = [];
  if (files.notlu) lessons = await buildLessons(files.notlu.stored_path, files.son?.stored_path ?? null, files.notlu.name);
  if (files.son?.comment_count) lessons.push(...(await buildLessons(files.son.stored_path, null, files.son.name)));
  const seen = new Set<string>();
  return db.replaceLessons(key, lessons.filter((l) => !seen.has(l.note + "\0" + l.anchor) && seen.add(l.note + "\0" + l.anchor)));
}

/** Dosyayı belleğe ekler; tür adından belirlenir (son hâllerde de ikinci tur notlar olabilir). */
export async function ingestFile(file: string, name: string, user?: string) {
  const comments = await extractComments(file), kind = isNoted(name) ? "notlu" : "son", key = pairKey(name);
  db.addMemoryFile(file, name, kind, key, comments.length, user);
  return { pair_key: key, kind, comments: comments.length, lessons: await rebuildPair(key) };
}

// ---------------------------------------------------------------- sürüm farkından kural adayları
export function pairsToRules(pairs: Pair[]) {
  const by = new Map<string, any>();
  for (const p of pairs) {
    const r = by.get(trLower(p.old)) ?? by.set(trLower(p.old), { pattern: p.old, replacements: [] as string[],
      match_type: p.old.includes(" ") ? "ifade" : "kelime", example: p.context }).get(trLower(p.old));
    if (!r.replacements.includes(p.new)) r.replacements.push(p.new);
  }
  return [...by.values()];
}
export async function pairsBetweenVersions(oldFile: string, newFile: string) {
  const a = await readTexts(oldFile), b = await readTexts(newFile), out: Pair[] = [];
  for (const [i, j] of mapParagraphs(a, b, 0.5)) if (a[i] !== b[j]) out.push(...diffPairs(a[i], b[j]));
  return out;
}
export const similarity = (a: string[], b: string[]) => {
  const x = a.filter((s) => s.trim()), y = b.filter((s) => s.trim());
  return x.length && y.length ? new SequenceMatcher(x, y).ratio() : 0;
};

// ---------------------------------------------------------------- Claude'a ve kurallara giden Bellek
const clip = (s: string, n: number) => { s = s.split(/\s+/).join(" "); return s.length <= n ? s : s.slice(0, n - 1) + "…"; };

export function promptExamples(maxChars = 120_000) {
  const lessons = db.listLessons(true).sort((a, b) => Number(b.edited) - Number(a.edited));
  const seen = new Set<string>(), byCat = new Map<string, any[]>();
  for (const l of lessons) {
    const k = trLower(l.note.split(/\s+/).join(" ")).slice(0, 160);
    if (seen.has(k) && !l.edited) continue;
    seen.add(k);
    (byCat.get(l.category) ?? byCat.set(l.category, []).get(l.category)!).push(l);
  }
  const idx = (c: string) => (CATEGORIES.includes(c) ? CATEGORIES.indexOf(c) : CATEGORIES.length);
  const parts: string[] = [];
  let size = 0;
  for (const cat of [...byCat.keys()].sort((a, b) => idx(a) - idx(b))) {
    const block = [`## ${cat}`];
    for (const l of byCat.get(cat)!) {
      let line = `- Not: ${clip(l.note, 400)}\n  İşaretlenen: «${clip(l.anchor, 220)}»`;
      if (l.outcome === "revize" && l.changes.length) {
        const ch = l.changes.slice(0, 3).map((c: any) => `«${clip(c.old, 120)}» → «${clip(c.new, 120) || "(çıkarıldı)"}»`).join("; ");
        line += l.edited ? `\n  Editörün onayladığı doğru düzeltme (bunu esas al): ${ch}` : `\n  Ekip şöyle düzeltti: ${ch}`;
      } else if (l.outcome === "degismedi") line += "\n  (Son hâlde bu kısım değiştirilmemiş.)";
      if (size + line.length > maxChars) break;
      block.push(line); size += line.length;
    }
    if (block.length > 1) parts.push(block.join("\n"));
  }
  return parts.join("\n\n");
}

const norm = (s: string) => trLower(s).replace(/[\s.,;:!?…“”"'’]+/g, " ").trim();
export type MemSugg = { text: string; kaynak: "bellek"; ref: string; note: string };

/** Ekibin yaptığı düzeltmeler: normalize edilmiş eski ifade -> öneriler (kaynaklı). */
export function suggestionIndex() {
  const index = new Map<string, MemSugg[]>();
  for (const l of db.listLessons(true)) {
    const ref = l.source_name.replace(/[-_ ]*(commented|yorumlu|notlu)?\.docx$/i, "");
    for (const ch of l.changes) {
      const k = norm(ch.old);
      if (!k || k.split(" ").length > 6) continue;
      const items = index.get(k) ?? index.set(k, []).get(k)!;
      if (!items.some((i) => i.text === ch.new)) items.push({ text: ch.new, kaynak: "bellek", ref, note: l.note.slice(0, 200) });
    }
  }
  return index;
}
export const suggestionsFor = (original: string, index = suggestionIndex()) => (index.get(norm(original)) ?? []).slice(0, 4);
