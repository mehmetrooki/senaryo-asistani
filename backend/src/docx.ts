// DOCX okuma/yazma. Export, yüklenen dosyanın KENDİSİ üzerinde yapılır: yalnızca değişen <w:t> metinleri
// değişir; stiller, girintiler (Fransız senaryo formatı), üst/alt bilgiler ve diğer tüm parçalar aynen kalır.
import fs from "node:fs";
import JSZip from "jszip";
import { DOMParser, XMLSerializer, type Document, type Element, type Node } from "@xmldom/xmldom";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
type Seg = { el: Element; start: number; end: number; editable: boolean };
export type Para = { index: number; el: Element; text: string; segments: Seg[] };
export type Docx = { zip: JSZip; doc: Document; paras: Element[]; xml: string };

const parse = (xml: string) => new DOMParser().parseFromString(xml, "text/xml") as unknown as Document;
const elems = (n: Node): Element[] => {
  const out: Element[] = [];
  const walk = (x: Node) => { for (let c = x.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) { out.push(c as Element); walk(c); } };
  walk(n);
  return out;
};
const ownerP = (el: Node) => { let p = el.parentNode; while (p && (p as Element).nodeName !== "w:p") p = p.parentNode; return p as Element | null; };
const inside = (el: Node, stop: Node, names: string[]) => {
  for (let p = el.parentNode; p && p !== stop; p = p.parentNode) if (names.includes((p as Element).nodeName)) return true;
  return false;
};

export async function load(file: string): Promise<Docx> {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const xml = await zip.file("word/document.xml")!.async("string"), doc = parse(xml);
  const body = doc.getElementsByTagName("w:body")[0];
  return { zip, doc, xml, paras: elems(body).filter((e) => e.nodeName === "w:p") };
}

export function buildPara(index: number, p: Element): Para {
  const segments: Seg[] = [];
  let pos = 0, text = "";
  for (const el of elems(p)) {
    const n = el.nodeName;
    if (!["w:t", "w:tab", "w:br", "w:cr"].includes(n) || ownerP(el) !== p || inside(el, p, ["w:del", "w:moveFrom", "mc:Fallback"])) continue;
    if (n === "w:tab" && (el.parentNode as Element).nodeName !== "w:r") continue; // sekme tanımı, metin değil
    const t = n === "w:t" ? el.textContent ?? "" : n === "w:tab" ? "\t" : "\n";
    if (!t) continue;
    segments.push({ el, start: pos, end: pos + t.length, editable: n === "w:t" });
    text += t; pos += t.length;
  }
  return { index, el: p, text, segments };
}

export const paragraphs = (d: Docx) => d.paras.map((p, i) => buildPara(i, p));
export const readTexts = async (file: string) => paragraphs(await load(file)).map((p) => p.text);

// ---------------------------------------------------------------- görünüm (arayüzde orijinale benzer gösterim)
type Style = { name: string; based?: string; jc?: string; left?: number; b?: boolean; i?: boolean };
const attr = (el: Element | undefined, a: string) => el?.getAttribute(a) ?? undefined;
const child = (el: Element | undefined, n: string) => (el ? elems(el).find((c) => c.nodeName === n && c.parentNode === el) : undefined);
const onOff = (el?: Element) => (el ? !["0", "false", "off"].includes(attr(el, "w:val") ?? "1") : undefined);

export async function describe(file: string) {
  const d = await load(file);
  const styles = new Map<string, Style>();
  let defStyle: string | undefined;
  const sx = d.zip.file("word/styles.xml");
  if (sx) {
    for (const s of elems(parse(await sx.async("string"))).filter((e) => e.nodeName === "w:style")) {
      const ppr = child(s, "w:pPr"), rpr = child(s, "w:rPr"), ind = child(ppr, "w:ind");
      const id = attr(s, "w:styleId")!;
      styles.set(id, { name: attr(child(s, "w:name"), "w:val") ?? id, based: attr(child(s, "w:basedOn"), "w:val"),
        jc: attr(child(ppr, "w:jc"), "w:val"), left: Number(attr(ind, "w:left") ?? attr(ind, "w:start") ?? NaN),
        b: onOff(child(rpr, "w:b")), i: onOff(child(rpr, "w:i")) });
      if (attr(s, "w:type") === "paragraph" && attr(s, "w:default") === "1") defStyle = id;
    }
  }
  const inherit = <K extends keyof Style>(id: string | undefined, k: K) => {
    for (let n = 0; id && n < 20; n++) {
      const st = styles.get(id);
      if (!st) break;
      const v = st[k];
      if (v !== undefined && !(typeof v === "number" && Number.isNaN(v))) return v;
      id = st.based;
    }
    return undefined;
  };
  const ALIGN: Record<string, string> = { center: "center", right: "right", end: "right", both: "justify", distribute: "justify" };
  return paragraphs(d).map((p) => {
    const ppr = child(p.el, "w:pPr"), sid = attr(child(ppr, "w:pStyle"), "w:val") ?? defStyle;
    const ind = child(ppr, "w:ind"), leftAttr = attr(ind, "w:left") ?? attr(ind, "w:start");
    const left = leftAttr !== undefined ? Number(leftAttr) : inherit(sid, "left");
    const runs = elems(p.el).filter((e) => e.nodeName === "w:r" && ownerP(e) === p.el && (e.textContent ?? "").trim());
    const runFlag = (k: "b" | "i") => runs.length > 0 && runs.every((r) => onOff(child(child(r, "w:rPr"), `w:${k}`)) ?? inherit(sid, k) ?? false);
    return {
      index: p.index, text: p.text, style: sid ? styles.get(sid)?.name ?? sid : "",
      align: ALIGN[attr(child(ppr, "w:jc"), "w:val") ?? inherit(sid, "jc") ?? ""] ?? "left",
      indent_cm: left && !Number.isNaN(left) ? Math.round((left / 567) * 100) / 100 : 0,
      bold: runFlag("b"), italic: runFlag("i"), in_table: (p.el.parentNode as Element)?.nodeName === "w:tc",
    };
  });
}

// ---------------------------------------------------------------- izlenen değişiklikler ve yorumlar
export async function trackedChangeVersions(file: string) {
  const d = await load(file), out: [number, string, string][] = [];
  d.paras.forEach((p, i) => {
    const all = elems(p);
    if (!all.some((e) => e.nodeName === "w:del" || e.nodeName === "w:ins")) return;
    let old = "", nw = "";
    for (const el of all) {
      const n = el.nodeName;
      if (!["w:t", "w:delText", "w:tab"].includes(n) || ownerP(el) !== p) continue;
      if (n === "w:tab" && (el.parentNode as Element).nodeName !== "w:r") continue;
      const del = inside(el, p, ["w:del"]), ins = inside(el, p, ["w:ins"]);
      if ((del && ins) || inside(el, p, ["mc:Fallback"])) continue;
      const t = n === "w:tab" ? "\t" : el.textContent ?? "";
      if (n === "w:delText" || del) old += t; else if (ins) nw += t; else { old += t; nw += t; }
    }
    if (old !== nw) out.push([i, old, nw]);
  });
  return out;
}

export type Comment = { id: string; author: string; note: string; anchor: string; paragraphs: number[] };

export async function extractComments(file: string): Promise<Comment[]> {
  const d = await load(file), cx = d.zip.file("word/comments.xml");
  if (!cx) return [];
  const notes = new Map<string, Comment>();
  for (const c of elems(parse(await cx.async("string"))).filter((e) => e.nodeName === "w:comment")) {
    const note = elems(c).filter((e) => e.nodeName === "w:p")
      .map((p) => elems(p).filter((e) => e.nodeName === "w:t").map((t) => t.textContent).join("")).join("\n").trim();
    if (note) notes.set(attr(c, "w:id")!, { id: attr(c, "w:id")!, author: attr(c, "w:author") ?? "", note, anchor: "", paragraphs: [] });
  }
  if (!notes.size) return [];
  const pIndex = new Map(d.paras.map((p, i) => [p, i]));
  const open = new Set<string>();
  const addP = (c: Comment, p: Element | null) => { const i = p ? pIndex.get(p) : undefined; if (i !== undefined && !c.paragraphs.includes(i)) c.paragraphs.push(i); };
  for (const el of elems(d.doc.getElementsByTagName("w:body")[0])) {
    const n = el.nodeName, id = attr(el, "w:id") ?? "";
    if (n === "w:commentRangeStart" && notes.has(id)) { open.add(id); addP(notes.get(id)!, ownerP(el)); }
    else if (n === "w:commentRangeEnd") open.delete(id);
    else if (n === "w:commentReference" && notes.has(id) && !notes.get(id)!.paragraphs.length) addP(notes.get(id)!, ownerP(el));
    else if (n === "w:p" && open.size) for (const cid of open) { const c = notes.get(cid)!; if (c.anchor) c.anchor += "\n"; addP(c, el); }
    else if (n === "w:t" && open.size) {
      const p = ownerP(el);
      if (p && !inside(el, p, ["w:del", "w:moveFrom", "mc:Fallback"])) for (const cid of open) notes.get(cid)!.anchor += el.textContent ?? "";
    }
  }
  return [...notes.values()].map((c) => ({ ...c, anchor: c.anchor.trim(), paragraphs: c.paragraphs.sort((a, b) => a - b) }));
}

// ---------------------------------------------------------------- değiştirme
/** Bir ifade tamamen kaldırılırken çift boşluk / yetim virgül bırakmamak için aralığı genişletir. */
export function smartRemovalRange(text: string, s: number, e: number): [number, number, string] {
  const before = text.slice(0, s), after = text.slice(e);
  for (const sep of [", ", " "]) if (before.endsWith(sep)) return [s - sep.length, e, ""];
  for (const sep of [", ", "! ", " "]) {
    if (after.startsWith(sep)) {
      const ne = e + sep.length, rest = text.slice(ne);
      if (rest && (s === 0 || /[.!?—\-:]$/.test(before.trimEnd()))) return [s, ne + 1, rest[0].toLocaleUpperCase("tr")];
      return [s, ne, ""];
    }
  }
  return [s, e, ""];
}

const setText = (t: Element, v: string) => { t.textContent = v; t.setAttributeNS(XML_NS, "xml:space", "preserve"); };

function replaceClean(p: Para, s: number, e: number, nw: string) {
  let first = true;
  for (const seg of p.segments) {
    if (seg.end <= s || seg.start >= e || !seg.editable) continue;
    const t = seg.el.textContent ?? "", ls = Math.max(s, seg.start) - seg.start, le = Math.min(e, seg.end) - seg.start;
    setText(seg.el, first ? t.slice(0, ls) + nw + t.slice(le) : t.slice(0, ls) + t.slice(le));
    first = false;
  }
  if (first) { const seg = p.segments.find((x) => x.editable && x.start >= e); if (seg) setText(seg.el, nw + (seg.el.textContent ?? "")); }
}

function splitAt(doc: Document, pEl: Element, idx: number, offset: number) {
  const seg = buildPara(idx, pEl).segments.find((x) => x.editable && x.start < offset && offset < x.end);
  if (!seg) return;
  const t = seg.el, run = t.parentNode as Element;
  if (run.nodeName !== "w:r") return;
  const k = offset - seg.start, txt = t.textContent ?? "";
  const copy = run.cloneNode(true) as Element;
  const kids = [...elems(run)].filter((c) => c.parentNode === run), at = kids.indexOf(t);
  kids.slice(at + 1).forEach((c) => run.removeChild(c));
  setText(t, txt.slice(0, k));
  const ckids = [...elems(copy)].filter((c) => c.parentNode === copy);
  ckids.slice(0, at).forEach((c) => { if (c.nodeName !== "w:rPr") copy.removeChild(c); });
  setText(ckids[at], txt.slice(k));
  run.parentNode!.insertBefore(copy, run.nextSibling);
}

function replaceTracked(doc: Document, pEl: Element, idx: number, s: number, e: number, nw: string, rev: { author: string; date: string; id: number }) {
  splitAt(doc, pEl, idx, e);
  splitAt(doc, pEl, idx, s);
  const runs: Element[] = [];
  for (const seg of buildPara(idx, pEl).segments) {
    const r = seg.el.parentNode as Element;
    if (seg.editable && seg.start >= s && seg.end <= e && r.nodeName === "w:r" && !runs.includes(r)) runs.push(r);
  }
  if (!runs.length) return replaceClean(buildPara(idx, pEl), s, e, nw);
  const mark = (name: string) => {
    const el = doc.createElementNS(W, name);
    el.setAttributeNS(W, "w:id", String(rev.id++)); el.setAttributeNS(W, "w:author", rev.author); el.setAttributeNS(W, "w:date", rev.date);
    return el;
  };
  const rpr = elems(runs[0]).find((c) => c.nodeName === "w:rPr" && c.parentNode === runs[0]);
  let last: Element | null = null;
  for (const r of runs) {
    for (const t of elems(r).filter((c) => c.nodeName === "w:t")) {
      const dt = doc.createElementNS(W, "w:delText");
      dt.textContent = t.textContent; dt.setAttributeNS(XML_NS, "xml:space", "preserve");
      r.replaceChild(dt, t);
    }
    const del = mark("w:del");
    r.parentNode!.insertBefore(del, r);
    del.appendChild(r);
    last = del;
  }
  if (nw && last) {
    const ins = mark("w:ins"), nr = doc.createElementNS(W, "w:r"), nt = doc.createElementNS(W, "w:t");
    if (rpr) nr.appendChild(rpr.cloneNode(true));
    setText(nt, nw);
    nr.appendChild(nt); ins.appendChild(nr);
    last.parentNode!.insertBefore(ins, last.nextSibling);
  }
}

export async function applyChanges(src: string, dest: string, findings: any[], tracked = false, author = "Senaryo Asistanı") {
  const d = await load(src);
  const byP = new Map<number, any[]>();
  for (const f of findings) (byP.get(f.paragraph) ?? byP.set(f.paragraph, []).get(f.paragraph)!).push(f);
  const rev = { author, date: new Date().toISOString().replace(/\.\d+Z$/, "Z"), id: 900000 };
  let applied = 0;
  const skipped: string[] = [];
  for (const [pi, items] of byP) {
    const pEl = d.paras[pi];
    if (!pEl) { skipped.push(...items.map((f) => f.id)); continue; }
    const base = buildPara(pi, pEl), located: [number, number, any][] = [];
    for (const f of items) {
      let s = f.start, e = f.end;
      if (base.text.slice(s, e) !== f.original) { s = base.text.indexOf(f.original); e = s + f.original.length; }
      if (s < 0) skipped.push(f.id); else located.push([s, e, f]);
    }
    located.sort((a, b) => b[0] - a[0]); // sondan başa: önceki konumlar kaymasın
    let lastStart: number | null = null;
    for (let [s, e, f] of located) {
      if (lastStart !== null && e > lastStart) { skipped.push(f.id); continue; }
      let nw: string = f.chosen ?? "";
      const para = buildPara(pi, pEl);
      if (nw === "") [s, e, nw] = smartRemovalRange(para.text, s, e);
      if (tracked) replaceTracked(d.doc, pEl, pi, s, e, nw, rev); else replaceClean(para, s, e, nw);
      lastStart = s; applied++;
    }
  }
  // XML başlığını (satır sonu dahil) orijinalinden al: dosya, değişen metinler dışında birebir aynı kalsın
  const out = new XMLSerializer().serializeToString(d.doc as any), root = (x: string) => x.indexOf("<w:document");
  d.zip.file("word/document.xml", d.xml.slice(0, root(d.xml)) + out.slice(root(out)));
  fs.writeFileSync(dest, await d.zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  return { applied, skipped };
}
