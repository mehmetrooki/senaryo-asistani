// Türkçe metin işleme: küçük harf, ünlü uyumu, kural taraması, metin farkı (difflib karşılığı).
export const WORD = "0-9A-Za-zÇĞİIÖŞÜçğıiöşüÂÎÛâîûÀ-ÖØ-öø-ÿ'’";
const VOWELS = "aeıioöuü", FRONT = "eiöü", ROUND = "oöuü", VOICELESS = "çfhkpsşt";

/** Türkçe küçük harf; uzunluğu korur (konumlar bozulmaz). */
export const trLower = (s: string) =>
  [...s.replace(/I/g, "ı").replace(/İ/g, "i")].map((c) => { const l = c.toLowerCase(); return l.length === 1 ? l : c; }).join("");
const trUpper = (s: string) => s.replace(/i/g, "İ").replace(/ı/g, "I").toUpperCase();

export function matchCase(source: string, rep: string) {
  if (!rep || !source) return rep;
  const letters = [...source].filter((c) => /\p{L}/u.test(c));
  if (letters.length > 1 && letters.every((c) => c === c.toUpperCase() && c !== c.toLowerCase())) return trUpper(rep);
  if (source[0] !== source[0].toLowerCase()) return trUpper(rep[0]) + rep.slice(1);
  return rep;
}

const lastVowel = (w: string) => [...trLower(w)].reverse().find((c) => VOWELS.includes(c));

/** Eki yeni köke ünlü uyumuyla taşır: kudur+dun -> sinirlen+din, bekle+uyor -> bekliyor */
export function attachSuffix(stem: string, suffix: string) {
  if (!suffix || !stem) return stem + suffix;
  let base = stem, sfx = trLower(suffix);
  if (VOWELS.includes(sfx[0]) && VOWELS.includes(base.at(-1)!.toLowerCase())) {
    if (sfx.slice(1).startsWith("yor")) base = base.slice(0, -1);
    else sfx = "y" + sfx;
  }
  let last = lastVowel(base) ?? "e", out = "";
  [...sfx].forEach((c, i) => {
    if ("ıiuü".includes(c)) { c = FRONT.includes(last) ? (ROUND.includes(last) ? "ü" : "i") : (ROUND.includes(last) ? "u" : "ı"); last = c; }
    else if ("ae".includes(c)) { c = FRONT.includes(last) ? "e" : "a"; last = c; }
    else if ("oö".includes(c)) last = c;
    else if (i === 0 && "dc".includes(c) && VOICELESS.includes(base.at(-1)!.toLowerCase())) c = c === "d" ? "t" : "ç";
    out += c;
  });
  return base + out;
}

// ---------------------------------------------------------------- kural taraması
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const QPART = new RegExp(`(\\s+)(m[ıiuü](?:sun(?:uz)?|sın(?:ız)?|sin(?:iz)?|sün(?:üz)?|y[ıiuü][mz]|d[ıiuü]r)?)(?![${WORD}])`, "y");
const SENT_START = /(^|[.!?…:;\-–—"“”«(\n]|\)\s*)\s*$/;

function compile(rule: any) {
  const left = `(?<![${WORD}])`;
  if (rule.match_type === "desen") return new RegExp(left + rule.pattern.trim(), "g");
  const body = trLower(rule.pattern.trim()).split(/\s+/).map(esc).join("\\s+");
  if (rule.match_type === "kok") return new RegExp(`${left}${body}[${WORD}]*`, "g");
  return new RegExp(`${left}${body}(?:['’][a-zçğıöşüâîû]+)?(?![${WORD}])`, "g");
}

/** Bağlama bağlı kurallar (ha/he/be): gülme, hece ve cümle başı (yalnızca "ha") kullanımları işaretlenmez. */
function innocent(low: string, s: number, e: number, token: string) {
  const before = low.slice(0, s), after = low.slice(e);
  const near = `(?:${esc(token)}|h[ae]+h?[aev]*)`;
  if (new RegExp(`^[\\s\\-–,!.…]*${near}(?![${WORD}])`).test(after) || new RegExp(`(?<![${WORD}])${near}[\\s\\-–,!.…]*$`).test(before)
    || /h[ae]+\s*$/.test(before)) return true;
  if (new RegExp(`^-[${WORD}]`).test(after) || new RegExp(`[${WORD}]-$`).test(before)) return true;
  return token === "ha" && SENT_START.test(before);
}

export type Hit = { start: number; end: number; original: string; suggestions: string[]; category: string; reason: string; rule_id: string; severity: string };

export function scanParagraph(text: string, rules: any[]): Hit[] {
  const low = trLower(text), hits: Hit[] = [];
  for (const rule of rules) {
    let rx: RegExp;
    try { rx = compile(rule); } catch { continue; }
    const ctx = rule.context === "baglamsal";
    for (const m of low.matchAll(rx)) {
      let s = m.index!, e = s + m[0].length;
      if (!m[0] || (ctx && innocent(low, s, e, trLower(rule.pattern.trim())))) continue;
      let particle: [string, string] | null = null;
      if (rule.match_type === "kok") {
        QPART.lastIndex = e;
        const pm = QPART.exec(low);
        if (pm) { particle = [pm[1], text.slice(e + pm[1].length, e + pm[0].length)]; e += pm[0].length; }
      }
      const original = text.slice(s, e);
      const word = particle ? original.slice(0, original.length - particle[0].length - particle[1].length) : original;
      const apos = rule.match_type === "kelime" ? trLower(word).match(/['’]([a-zçğıöşüâîû]+)$/) : null;
      const reps: string[] = [];
      for (let rep of rule.replacements as string[]) {
        if (rule.match_type === "kok" && rep) {
          rep = attachSuffix(rep, word.slice(rule.pattern.trim().length));
          if (particle) rep = rep + particle[0] + attachSuffix(rep, particle[1]).slice(rep.length);
        } else if (apos && rep) {
          const sfx = apos[1];
          rep = rep.includes(" ") && VOWELS.includes(rep.at(-1)!) && VOWELS.includes(sfx[0]) ? attachSuffix(rep + "n", sfx) : attachSuffix(rep, sfx);
        } else if (particle && rep) rep = rep + particle[0] + particle[1];
        rep = matchCase(original, rep);
        if (!reps.includes(rep)) reps.push(rep);
      }
      hits.push({ start: s, end: e, original, suggestions: reps, category: rule.category, reason: rule.reason, rule_id: rule.id,
        severity: ctx ? "dusuk" : ["şiddet", "tehlikeli davranış", "çocuk güvenliği", "fiziksel / kaba tepki", "zorlama / alıkoyma"].includes(rule.category) ? "yuksek" : "orta" });
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const out: Hit[] = [];
  let lastEnd = -1;
  for (const h of hits) if (h.start >= lastEnd) { out.push(h); lastEnd = h.end; }
  return out;
}

// ---------------------------------------------------------------- difflib.SequenceMatcher (autojunk kapalı)
export type Op = [tag: "equal" | "replace" | "delete" | "insert", i1: number, i2: number, j1: number, j2: number];

export class SequenceMatcher<T> {
  private b2j = new Map<T, number[]>();
  constructor(private a: T[], private b: T[]) {
    b.forEach((x, j) => { const l = this.b2j.get(x); l ? l.push(j) : this.b2j.set(x, [j]); });
  }
  private longest(alo: number, ahi: number, blo: number, bhi: number): [number, number, number] {
    let bi = alo, bj = blo, size = 0, j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const next = new Map<number, number>();
      for (const j of this.b2j.get(this.a[i]) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        next.set(j, k);
        if (k > size) { bi = i - k + 1; bj = j - k + 1; size = k; }
      }
      j2len = next;
    }
    return [bi, bj, size];
  }
  matching(): [number, number, number][] {
    const q: [number, number, number, number][] = [[0, this.a.length, 0, this.b.length]], blocks: [number, number, number][] = [];
    while (q.length) {
      const [alo, ahi, blo, bhi] = q.pop()!;
      const [i, j, k] = this.longest(alo, ahi, blo, bhi);
      if (k) {
        blocks.push([i, j, k]);
        if (alo < i && blo < j) q.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) q.push([i + k, ahi, j + k, bhi]);
      }
    }
    blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const merged: [number, number, number][] = [];
    for (const b of blocks) {
      const l = merged.at(-1);
      if (l && l[0] + l[2] === b[0] && l[1] + l[2] === b[1]) l[2] += b[2];
      else merged.push([...b]);
    }
    merged.push([this.a.length, this.b.length, 0]);
    return merged;
  }
  opcodes(): Op[] {
    let i = 0, j = 0;
    const ops: Op[] = [];
    for (const [ai, bj, size] of this.matching()) {
      const tag = i < ai && j < bj ? "replace" : i < ai ? "delete" : j < bj ? "insert" : null;
      if (tag) ops.push([tag, i, ai, j, bj]);
      i = ai + size; j = bj + size;
      if (size) ops.push(["equal", ai, i, bj, j]);
    }
    return ops;
  }
  ratio() {
    const m = this.matching().reduce((s, b) => s + b[2], 0), t = this.a.length + this.b.length;
    return t ? (2 * m) / t : 1;
  }
}
export const ratio = (a: string, b: string) => new SequenceMatcher([...a], [...b]).ratio();

// ---------------------------------------------------------------- değişiklik çiftleri
const tokens = (s: string) => s.match(/[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]|\s+/gu) ?? [];

export function isJunkPattern(o: string) {
  o = o.trim();
  const letters = [...o].filter((c) => /\p{L}/u.test(c));
  if (letters.length < 3 || "’'‘-".includes(o[0]) || /\d/.test(o)) return true;
  if (letters.every((c) => c === c.toUpperCase())) return true;
  return o.split(/\s+/).length > 5;
}

function trivial(o: string, n: string) {
  o = o.trim(); n = n.trim();
  if (!o || !/[\p{L}\p{N}]/u.test(o) || isJunkPattern(o) || trLower(o) === trLower(n)) return true;
  return !!n && o.length > 3 && ratio(trLower(o), trLower(n)) > 0.8;
}

export type Pair = { old: string; new: string; pos: number; context: string };

/** İki metin arasındaki anlamlı değişiklikler (boşlukla ayrılmış ardışık değişiklikler tek grup). */
export function diffPairs(old: string, nw: string, context = 40): Pair[] {
  const a = tokens(old), b = tokens(nw), ops = new SequenceMatcher(a, b).opcodes();
  const groups: number[][] = [];
  let cur: number[] | null = null;
  ops.forEach(([tag, i1, i2, j1, j2], k) => {
    if (tag !== "equal") { if (!cur) cur = [i1, i2, j1, j2]; else { cur[1] = i2; cur[3] = j2; } return; }
    const bridge = cur && /^\s+$/.test(a.slice(i1, i2).join("")) && k + 1 < ops.length && ops[k + 1][0] !== "equal";
    if (bridge) { cur![1] = i2; cur![3] = j2; } else if (cur) { groups.push(cur); cur = null; }
  });
  if (cur) groups.push(cur);
  const strip = (s: string) => s.trim().replace(/^[,.;:!? ]+|[,.;:!? ]+$/g, "");
  const out: Pair[] = [];
  for (const [i1, i2, j1, j2] of groups) {
    const o = strip(a.slice(i1, i2).join("")), n = strip(b.slice(j1, j2).join(""));
    if (trivial(o, n)) continue;
    const pos = a.slice(0, i1).join("").length;
    out.push({ old: o, new: n, pos, context: old.slice(Math.max(0, pos - context), pos + o.length + context) });
  }
  return out;
}

/** İki sürümün değişmiş paragraf eşleşmeleri (eski indeks -> yeni indeks). */
export function mapParagraphs(old: string[], nw: string[], threshold = 0.35) {
  const map = new Map<number, number>();
  for (const [tag, i1, i2, j1, j2] of new SequenceMatcher(old, nw).opcodes()) {
    if (tag === "equal") for (let k = 0; k < i2 - i1; k++) map.set(i1 + k, j1 + k);
    else if (tag === "replace") {
      const used = new Set<number>();
      for (let i = i1; i < i2; i++) {
        let best = -1, br = threshold;
        for (let j = j1; j < j2; j++) {
          if (used.has(j)) continue;
          const r = ratio(old[i], nw[j]);
          if (r > br) { best = j; br = r; }
        }
        if (best >= 0) { used.add(best); map.set(i, best); }
      }
    }
  }
  return map;
}
