"""DOCX okuma/yazma.

Önemli ilke: Export, kullanıcının yüklediği .docx dosyasının KENDİSİ üzerinde
yapılır. Yalnızca değişen kelimelerin bulunduğu <w:t> metinleri değiştirilir;
stiller, kenar boşlukları, sayfa yapısı, karakter adlarının ortalanması,
didaskali girintileri (Fransız senaryo formatı) vb. hiç dokunulmadan kalır.
"""
from __future__ import annotations

import copy
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph

W_P = qn("w:p")
W_R = qn("w:r")
W_T = qn("w:t")
W_TAB = qn("w:tab")
W_BR = qn("w:br")
W_CR = qn("w:cr")
W_DEL = qn("w:del")
W_INS = qn("w:ins")
W_DELTEXT = qn("w:delText")
W_RPR = qn("w:rPr")
W_MOVEFROM = qn("w:moveFrom")
MC_FALLBACK = "{http://schemas.openxmlformats.org/markup-compatibility/2006}Fallback"
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"


@dataclass
class Segment:
    el: object          # <w:t> ya da <w:tab>/<w:br>
    start: int
    end: int
    editable: bool


@dataclass
class Para:
    index: int
    el: object
    text: str
    segments: list[Segment] = field(default_factory=list)


def _owner_paragraph(el):
    p = el.getparent()
    while p is not None and p.tag != W_P:
        p = p.getparent()
    return p


def _excluded(el, para_el) -> bool:
    p = el.getparent()
    while p is not None and p is not para_el:
        if p.tag in (W_DEL, W_MOVEFROM, MC_FALLBACK):
            return True
        p = p.getparent()
    return False


def _build_para(index: int, p_el) -> Para:
    segs: list[Segment] = []
    pos = 0
    parts: list[str] = []
    for el in p_el.iter(W_T, W_TAB, W_BR, W_CR):
        if _owner_paragraph(el) is not p_el or _excluded(el, p_el):
            continue
        if el.tag == W_T:
            txt = el.text or ""
            editable = True
        else:
            # w:tab paragraf özelliklerindeki sekme tanımı da olabilir (w:tabs/w:tab)
            if el.tag == W_TAB and el.getparent().tag != W_R:
                continue
            txt = "\t" if el.tag == W_TAB else "\n"
            editable = False
        if not txt:
            continue
        segs.append(Segment(el, pos, pos + len(txt), editable))
        parts.append(txt)
        pos += len(txt)
    return Para(index, p_el, "".join(parts), segs)


def iter_paragraph_elements(doc):
    return list(doc.element.body.iter(W_P))


def load(path: str | Path):
    return Document(str(path))


def paragraphs(doc) -> list[Para]:
    return [_build_para(i, p) for i, p in enumerate(iter_paragraph_elements(doc))]


def read_text_paragraphs(path: str | Path) -> list[str]:
    return [p.text for p in paragraphs(load(path))]


# ---------------------------------------------------------------- görünüm bilgisi
_ALIGN = {
    WD_ALIGN_PARAGRAPH.CENTER: "center",
    WD_ALIGN_PARAGRAPH.RIGHT: "right",
    WD_ALIGN_PARAGRAPH.JUSTIFY: "justify",
}


def _style_attr(style, getter):
    while style is not None:
        try:
            v = getter(style)
        except Exception:
            v = None
        if v is not None:
            return v
        style = style.base_style
    return None


def describe(path: str | Path) -> list[dict]:
    """Arayüzde belgeyi orijinaline benzer göstermek için paragraf bilgileri."""
    doc = load(path)
    body = doc._body
    out = []
    for para in paragraphs(doc):
        p = Paragraph(para.el, body)
        try:
            style = p.style
            style_name = style.name if style is not None else ""
        except Exception:
            style, style_name = None, ""
        align = p.paragraph_format.alignment
        if align is None and style is not None:
            align = _style_attr(style, lambda s: s.paragraph_format.alignment)
        left = p.paragraph_format.left_indent
        if left is None and style is not None:
            left = _style_attr(style, lambda s: s.paragraph_format.left_indent)
        runs = [r for r in p.runs if r.text.strip()]
        bold = bool(runs) and all(
            (r.bold if r.bold is not None else bool(style is not None and _style_attr(style, lambda s: s.font.bold)))
            for r in runs)
        italic = bool(runs) and all(
            (r.italic if r.italic is not None else bool(style is not None and _style_attr(style, lambda s: s.font.italic)))
            for r in runs)
        out.append({
            "index": para.index,
            "text": para.text,
            "style": style_name,
            "align": _ALIGN.get(align, "left"),
            "indent_cm": round(left.cm, 2) if left is not None else 0,
            "bold": bold,
            "italic": italic,
            "in_table": para.el.getparent() is not None and para.el.getparent().tag == qn("w:tc"),
        })
    return out


# ---------------------------------------------------------------- izlenen değişiklikleri okuma
def tracked_change_versions(path: str | Path) -> list[tuple[int, str, str]]:
    """İzlenen değişiklik içeren paragraflar için (indeks, eski metin, yeni metin)."""
    doc = load(path)
    out = []
    for i, p_el in enumerate(iter_paragraph_elements(doc)):
        if not any(True for _ in p_el.iter(W_DEL, W_INS)):
            continue
        old_parts, new_parts = [], []
        for el in p_el.iter(W_T, W_DELTEXT, W_TAB):
            if _owner_paragraph(el) is not p_el:
                continue
            anc = el.getparent()
            in_del = in_ins = False
            while anc is not None and anc is not p_el:
                if anc.tag == W_DEL:
                    in_del = True
                elif anc.tag == W_INS:
                    in_ins = True
                elif anc.tag == MC_FALLBACK:
                    in_del = in_ins = True  # tekrar eden içerik, atla
                anc = anc.getparent()
            if in_del and in_ins:
                continue
            txt = "\t" if el.tag == W_TAB else (el.text or "")
            if el.tag == W_TAB and el.getparent().tag != W_R:
                continue
            if el.tag == W_DELTEXT or in_del:
                old_parts.append(txt)
            elif in_ins:
                new_parts.append(txt)
            else:
                old_parts.append(txt)
                new_parts.append(txt)
        old, new = "".join(old_parts), "".join(new_parts)
        if old != new:
            out.append((i, old, new))
    return out


# ---------------------------------------------------------------- değiştirme
def smart_removal_range(text: str, s: int, e: int) -> tuple[int, int, str]:
    """Bir ifade tamamen kaldırılırken çift boşluk / yetim virgül bırakmamak için aralığı genişletir.

    Döndürür: (yeni_başlangıç, yeni_bitiş, yerine_yazılacak_metin)
    """
    before = text[:s]
    after = text[e:]
    # "Gel buraya, ha!" -> "Gel buraya!"
    for sep in (", ", " "):
        if before.endswith(sep):
            return s - len(sep), e, ""
    # "Ha, bunu gör." -> "Bunu gör."
    for sep in (", ", "! ", " "):
        if after.startswith(sep):
            ne = e + len(sep)
            rest = text[ne:]
            if rest and (s == 0 or before.rstrip().endswith((".", "!", "?", "—", "-", ":"))):
                return s, ne + 1, rest[0].upper()
            return s, ne, ""
    return s, e, ""


def _locate(para: Para, f: dict) -> tuple[int, int] | None:
    s, e, orig = f["start"], f["end"], f["original"]
    if para.text[s:e] == orig:
        return s, e
    pos = para.text.find(orig)
    if pos >= 0:
        return pos, pos + len(orig)
    return None


def _set_text(t_el, value: str) -> None:
    t_el.text = value
    t_el.set(XML_SPACE, "preserve")


def _replace_clean(para: Para, s: int, e: int, new: str) -> None:
    first = True
    for seg in para.segments:
        if seg.end <= s or seg.start >= e or not seg.editable:
            continue
        txt = seg.el.text or ""
        ls, le = max(s, seg.start) - seg.start, min(e, seg.end) - seg.start
        if first:
            _set_text(seg.el, txt[:ls] + new + txt[le:])
            first = False
        else:
            _set_text(seg.el, txt[:ls] + txt[le:])
    if first:  # yalnızca düzenlenemeyen alan kapsandıysa en yakın metne ekle
        for seg in para.segments:
            if seg.editable and seg.start >= e:
                _set_text(seg.el, new + (seg.el.text or ""))
                break


class _Revision:
    def __init__(self, author: str):
        self.author = author
        self.date = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        self.next_id = 900000

    def attrs(self, el):
        el.set(qn("w:id"), str(self.next_id))
        el.set(qn("w:author"), self.author)
        el.set(qn("w:date"), self.date)
        self.next_id += 1
        return el


def _split_at(para_el, para_index: int, offset: int) -> None:
    para = _build_para(para_index, para_el)
    for seg in para.segments:
        if seg.editable and seg.start < offset < seg.end:
            t = seg.el
            run = t.getparent()
            if run.tag != W_R:
                return
            k = offset - seg.start
            txt = t.text or ""
            new_run = copy.deepcopy(run)
            children = list(run)
            idx = children.index(t)
            # orijinal run: t'den sonrası silinir
            for ch in children[idx + 1:]:
                run.remove(ch)
            _set_text(t, txt[:k])
            # kopya run: t'den öncesi (rPr hariç) silinir
            new_children = list(new_run)
            for ch in new_children[:idx]:
                if ch.tag != W_RPR:
                    new_run.remove(ch)
            _set_text(new_children[idx], txt[k:])
            run.addnext(new_run)
            return


def _replace_tracked(para_el, para_index: int, s: int, e: int, new: str, rev: _Revision) -> None:
    from docx.oxml import OxmlElement

    _split_at(para_el, para_index, e)
    _split_at(para_el, para_index, s)
    para = _build_para(para_index, para_el)
    runs = []
    for seg in para.segments:
        if seg.start >= s and seg.end <= e and seg.editable:
            r = seg.el.getparent()
            if r.tag == W_R and r not in runs:
                runs.append(r)
    if not runs:
        _replace_clean(para, s, e, new)
        return
    template_rpr = runs[0].find(W_RPR)
    last_wrapper = None
    for r in runs:
        for t in r.findall(W_T):
            t.tag = W_DELTEXT
            t.set(XML_SPACE, "preserve")
        wrapper = rev.attrs(OxmlElement("w:del"))
        r.addprevious(wrapper)
        wrapper.append(r)
        last_wrapper = wrapper
    if new:
        ins = rev.attrs(OxmlElement("w:ins"))
        nr = OxmlElement("w:r")
        if template_rpr is not None:
            nr.append(copy.deepcopy(template_rpr))
        nt = OxmlElement("w:t")
        _set_text(nt, new)
        nr.append(nt)
        ins.append(nr)
        last_wrapper.addnext(ins)


def apply_changes(src: str | Path, dest: str | Path, findings: list[dict], tracked: bool = False,
                  author: str = "Senaryo Asistanı") -> dict:
    """Kabul edilmiş bulguları orijinal belgeye uygular ve dest'e kaydeder."""
    doc = load(src)
    p_elems = iter_paragraph_elements(doc)
    by_para: dict[int, list[dict]] = {}
    for f in findings:
        by_para.setdefault(f["paragraph"], []).append(f)
    rev = _Revision(author)
    applied, skipped = 0, []
    for pi, items in by_para.items():
        if pi >= len(p_elems):
            skipped.extend(items)
            continue
        p_el = p_elems[pi]
        # Sondan başa uygula ki önceki konumlar kaymasın
        located = []
        para = _build_para(pi, p_el)
        for f in items:
            loc = _locate(para, f)
            if loc is None:
                skipped.append(f)
            else:
                located.append((loc[0], loc[1], f))
        located.sort(key=lambda x: x[0], reverse=True)
        last_start = None
        for s, e, f in located:
            if last_start is not None and e > last_start:
                skipped.append(f)  # çakışan bulgu
                continue
            new = f.get("chosen") or ""
            para = _build_para(pi, p_el)
            if new == "":
                s, e, new = smart_removal_range(para.text, s, e)
            if tracked:
                _replace_tracked(p_el, pi, s, e, new, rev)
            else:
                _replace_clean(para, s, e, new)
            last_start = s
            applied += 1
    doc.save(str(dest))
    return {"applied": applied, "skipped": [f["id"] for f in skipped if "id" in f]}


# ---------------------------------------------------------------- yorumlar (notlar)
W_COMMENT = qn("w:comment")
W_CRS = qn("w:commentRangeStart")
W_CRE = qn("w:commentRangeEnd")
W_CREF = qn("w:commentReference")


def extract_comments(path: str | Path) -> list[dict]:
    """Word yorumlarını, işaretledikleri metinle (anchor) ve paragraf numaralarıyla döndürür."""
    import zipfile

    from lxml import etree

    with zipfile.ZipFile(str(path)) as z:
        if "word/comments.xml" not in z.namelist():
            return []
        root = etree.fromstring(z.read("word/comments.xml"))
    notes: dict[str, dict] = {}
    for c in root.iter(W_COMMENT):
        text = "\n".join("".join(t.text or "" for t in p.iter(W_T)) for p in c.iter(W_P)).strip()
        if text:
            notes[c.get(qn("w:id"))] = {"id": c.get(qn("w:id")), "author": c.get(qn("w:author")) or "",
                                        "note": text, "anchor": "", "paragraphs": []}
    if not notes:
        return []

    doc = load(path)
    p_elems = iter_paragraph_elements(doc)
    p_index = {id(p): i for i, p in enumerate(p_elems)}
    open_ids: set[str] = set()
    for el in doc.element.body.iter():
        tag = el.tag
        if tag == W_CRS:
            cid = el.get(qn("w:id"))
            if cid in notes:
                open_ids.add(cid)
                pi = p_index.get(id(_owner_paragraph(el)))
                if pi is not None and pi not in notes[cid]["paragraphs"]:
                    notes[cid]["paragraphs"].append(pi)
        elif tag == W_CRE:
            open_ids.discard(el.get(qn("w:id")))
        elif tag == W_CREF:
            # aralığı olmayan (yalnızca referans) yorumlar: bulunduğu paragraf bağlamdır
            cid = el.get(qn("w:id"))
            if cid in notes and not notes[cid]["paragraphs"]:
                pi = p_index.get(id(_owner_paragraph(el)))
                if pi is not None:
                    notes[cid]["paragraphs"].append(pi)
        elif tag == W_P and open_ids:
            pi = p_index.get(id(el))
            for cid in open_ids:
                if notes[cid]["anchor"]:
                    notes[cid]["anchor"] += "\n"
                if pi is not None and pi not in notes[cid]["paragraphs"]:
                    notes[cid]["paragraphs"].append(pi)
        elif tag == W_T and open_ids:
            p_el = _owner_paragraph(el)
            if p_el is not None and not _excluded(el, p_el):
                for cid in open_ids:
                    notes[cid]["anchor"] += el.text or ""
    out = []
    for n in notes.values():
        n["anchor"] = n["anchor"].strip()
        n["paragraphs"].sort()
        out.append(n)
    return out
