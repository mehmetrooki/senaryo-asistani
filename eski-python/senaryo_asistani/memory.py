"""Bellek: ekibin notlu (commented) senaryoları ve son hâllerinden öğrenme.

Bir bölüm için iki dosya eşleştirilir:
  KUCHO-S1E51-DışSes-Senaryo-commented.docx  -> notlu hâl (Word yorumları)
  KUCHO-S1E51-DışSes-Senaryo.docx            -> son (revize edilmiş) hâl

Her yorum bir "ders" olur: notun metni, işaret edilen kısım, o kısmın son
hâlde neye dönüştüğü. Dersler Claude'a ekibin üslubu ve öncelikleri olarak
verilir; böylece yeni senaryoda benzer durumları aynı bakışla işaretler.
"""
from __future__ import annotations

import difflib
import re
from pathlib import Path

from . import docx_io, learn, storage
from .matcher import tr_lower

NOTED_TOKENS = ("commented", "comments", "yorumlu", "notlu", "notlar")

CATEGORIES = [
    "çocuk güvenliği", "kötü örnek davranış", "şiddet / sert söylem", "hakaret / alay", "argo / kaba dil",
    "uygunsuz çağrışım", "yaş grubuna uygunluk", "telif / reklam / RTÜK", "kelime seçimi / üslup",
    "dil bilgisi / yazım", "tekrar / fazla kullanım", "mantık / tutarlılık", "sinopsis uyumu", "karakter / isim",
    "format / sahne numarası", "eksik içerik", "diğer",
]

# Sıra önemli: ilk eşleşen kategori seçilir (daha belirgin olanlar önce).
# Kalıplar ekibin gerçek notlarından çıkarıldı.
_CATEGORY_HINTS = [
    ("telif / reklam / RTÜK", r"copyright|telif|reklam|rtük|marka"),
    ("çocuk güvenliği", r"taklit|tehlikeli|kulağına|kulağının|elektrik|priz|kibrit|bıçak|yüksekten|nefes al|"
                        r"ağzı dolu|ağzında"),
    ("uygunsuz çağrışım", r"uyuştur|madde altında|alkol|sigara|kumar|helezon|sarhoş|romantik|öpücük|ilişki|"
                          r"evlen|fal |büyücü|piercing|dövme|politik|siyasi|popo"),
    ("şiddet / sert söylem", r"şiddet|tehdit|sert söylem|sert bir|korkut|korkunç|dövü|kavga"),
    ("kötü örnek davranış", r"olumsuz|kötü örnek|saygısız|zorbal|kandır|fırlat"),
    ("hakaret / alay", r"hakaret|dalga geç|aşağıla|alay"),
    ("argo / kaba dil", r"yasaklı kelime|argo|kaba|küfür|nida|hoş olmayan|hitap"),
    ("yaş grubuna uygunluk", r"hedef kitle|anlayamaya|kavram"),
    ("sinopsis uyumu", r"synops|sinops"),
    ("format / sahne numarası", r"sahne numara|numarasını|sahne \d+.{0,30}(atlıyor|sonra gelmeli)|bölümün adı"),
    ("karakter / isim", r"ismini|isim ile|karakterin adı|karakter ismi|adını"),
    ("eksik içerik", r"şarkı söz|ekleyelim|eklenmeli|eklenmemiş|eksik|belirtelim"),
    ("tekrar / fazla kullanım", r"tekrar|fazla kullan|çok kullan|fazla olmuş|fazladan"),
    ("dil bilgisi / yazım", r"[”\"’']\s*olmalı|yazım|imla|dil bilgisi|gramer"),
    ("kelime seçimi / üslup", r"daha uygun|daha doğru|daha açıklayıcı|denilirse|denilebilir|türkçe|söylem|"
                              r"terim|sound"),
    ("mantık / tutarlılık", r"tutarl|mantık|bağlantı|saçma|netleştir|devamlılık|anlaşılm|neden|senaryoya göre|"
                            r"anlamalıyız|kimlerden|olmalı"),
]


def pair_key(name: str) -> str:
    stem = tr_lower(Path(name).stem)
    for tok in NOTED_TOKENS:
        stem = re.sub(rf"[\s._\-()\[\]]*{tok}[\s._\-()\[\]]*", " ", stem)
    stem = re.sub(r"[\s._\-]+", "-", stem).strip("-")
    return stem


def display_name(key: str) -> str:
    return key.upper()


def is_noted_name(name: str) -> bool:
    low = tr_lower(Path(name).stem)
    return any(tok in low for tok in NOTED_TOKENS)


def guess_category(note: str) -> str:
    low = tr_lower(note)
    for cat, rx in _CATEGORY_HINTS:
        if re.search(rx, low):
            return cat
    return "diğer"


def map_paragraphs(old: list[str], new: list[str]) -> dict[int, int]:
    """Notlu hâlin paragraflarını son hâlin paragraflarına eşler."""
    sm = difflib.SequenceMatcher(None, old, new, autojunk=False)
    mapping: dict[int, int] = {}
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                mapping[i1 + k] = j1 + k
        elif tag == "replace":
            used = set()
            for i in range(i1, i2):
                best, best_r = None, 0.35
                for j in range(j1, j2):
                    if j in used:
                        continue
                    r = difflib.SequenceMatcher(None, old[i], new[j]).ratio()
                    if r > best_r:
                        best, best_r = j, r
                if best is not None:
                    used.add(best)
                    mapping[i] = best
    return mapping


def build_lessons(noted_path: str | Path, final_path: str | Path | None, source_name: str) -> list[dict]:
    comments = docx_io.extract_comments(noted_path)
    old = docx_io.read_text_paragraphs(noted_path)
    new = docx_io.read_text_paragraphs(final_path) if final_path else None
    mapping = map_paragraphs(old, new) if new is not None else {}
    lessons = []
    for c in comments:
        paras = c["paragraphs"] or []
        old_text = "\n".join(old[i] for i in paras if i < len(old)).strip()
        new_text, changes, outcome = "", [], "son_yok"
        if new is not None:
            mapped = [mapping[i] for i in paras if i in mapping]
            new_text = "\n".join(new[j] for j in sorted(set(mapped))).strip()
            if not mapped:
                outcome = "revize"  # paragraf tamamen çıkarılmış ya da yeniden yazılmış
                changes = [{"old": old_text, "new": ""}] if old_text else []
            elif new_text == old_text:
                outcome = "degismedi"
            else:
                outcome = "revize"
                pairs = _near_anchor(learn.diff_pairs(old_text, new_text), old_text, c["anchor"])
                changes = [{"old": p["old"], "new": p["new"]} for p in pairs]
                if not changes:  # yalnızca küçük yazım/noktalama düzeltmesi
                    changes = _small_changes(old_text, new_text)
        lessons.append({
            "source_name": source_name, "author": c["author"], "note": c["note"],
            "anchor": c["anchor"] or old_text[:200], "old_text": old_text, "new_text": new_text,
            "changes": changes, "category": guess_category(c["note"]), "outcome": outcome,
        })
    return lessons


def _near_anchor(pairs: list[dict], old_text: str, anchor: str, slack: int = 2) -> list[dict]:
    """Notun işaret ettiği kısımla örtüşen değişiklikleri seçer (aynı paragraftaki ilgisiz düzeltmeleri eler)."""
    if not pairs or not anchor:
        return pairs
    ranges = []
    for line in anchor.split("\n"):
        line = line.strip()
        if not line:
            continue
        pos = old_text.find(line)
        if pos >= 0:
            ranges.append((pos - slack, pos + len(line) + slack))
    if not ranges:
        return pairs
    near = [p for p in pairs if any(p["pos"] < e and p["pos"] + max(len(p["old"]), 1) > s for s, e in ranges)]
    return near or pairs


def _small_changes(old: str, new: str) -> list[dict]:
    a, b = old.split(), new.split()
    out = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag != "equal":
            out.append({"old": " ".join(a[i1:i2]), "new": " ".join(b[j1:j2])})
    return out[:6]


def ingest_file(path: str | Path, name: str, user: str | None = None) -> dict:
    """Bir dosyayı belleğe ekler; eşi varsa o bölümün derslerini yeniden çıkarır."""
    comments = docx_io.extract_comments(path)
    # Tür dosya adından belirlenir: son hâllerde de ikinci tur notlar olabiliyor
    kind = "notlu" if is_noted_name(name) else "son"
    key = pair_key(name)
    storage.add_memory_file(path, name, kind, key, len(comments), user=user)
    n = rebuild_pair(key)
    return {"pair_key": key, "kind": kind, "comments": len(comments), "lessons": n}


def rebuild_pair(key: str) -> int:
    files = {f["kind"]: f for f in storage.memory_files(key)}
    noted, final = files.get("notlu"), files.get("son")
    lessons = []
    if noted:
        lessons += build_lessons(noted["stored_path"], final["stored_path"] if final else None, noted["name"])
    if final and final["comment_count"]:
        # son hâldeki açık notlar: henüz revizesi yok
        lessons += build_lessons(final["stored_path"], None, final["name"])
    unique, seen = [], set()
    for l in lessons:
        k = (l["note"], l["anchor"])
        if k not in seen:
            seen.add(k)
            unique.append(l)
    return storage.replace_lessons(key, unique)


def _clip(s: str, n: int) -> str:
    s = " ".join(s.split())
    return s if len(s) <= n else s[: n - 1] + "…"


def prompt_examples(max_chars: int = 120_000) -> str:
    """Claude'a verilecek, kategorilere göre gruplanmış ders özeti."""
    lessons = storage.list_lessons(active_only=True)
    if not lessons:
        return ""
    seen, by_cat = set(), {}
    # Editörün elle düzelttiği dersler önce gelir ve tekrar sayılıp elenmez
    for l in sorted(lessons, key=lambda x: not x.get("edited")):
        key = tr_lower(" ".join(l["note"].split()))[:160]
        if key in seen and not l.get("edited"):
            continue
        seen.add(key)
        by_cat.setdefault(l["category"], []).append(l)
    order = sorted(by_cat, key=lambda c: CATEGORIES.index(c) if c in CATEGORIES else len(CATEGORIES))
    parts, size = [], 0
    for cat in order:
        block = [f"## {cat}"]
        for l in by_cat[cat]:
            line = f'- Not: {_clip(l["note"], 400)}\n  İşaretlenen: «{_clip(l["anchor"], 220)}»'
            if l["outcome"] == "revize" and l["changes"]:
                ch = "; ".join(f'«{_clip(c["old"], 120)}» → «{_clip(c["new"], 120) or "(çıkarıldı)"}»'
                               for c in l["changes"][:3])
                if l.get("edited"):
                    line += f"\n  Editörün onayladığı doğru düzeltme (bunu esas al): {ch}"
                else:
                    line += f"\n  Ekip şöyle düzeltti: {ch}"
            elif l["outcome"] == "degismedi":
                line += "\n  (Son hâlde bu kısım değiştirilmemiş.)"
            if size + len(line) > max_chars:
                break
            block.append(line)
            size += len(line)
        if len(block) > 1:
            parts.append("\n".join(block))
    return "\n\n".join(parts)


def _norm(s: str) -> str:
    return re.sub(r"[\s.,;:!?…“”\"'’]+", " ", tr_lower(s)).strip()


def suggestion_index() -> dict[str, list[dict]]:
    """Ekibin yaptığı düzeltmeler: normalize edilmiş eski ifade -> [{"text", "kaynak", "ref"}]."""
    index: dict[str, list[dict]] = {}
    for l in storage.list_lessons(active_only=True):
        ref = re.sub(r"(?i)[-_ ]*(commented|yorumlu|notlu)?\.docx$", "", l["source_name"])
        for ch in l["changes"]:
            key = _norm(ch["old"])
            if not key or len(key.split()) > 6:
                continue
            items = index.setdefault(key, [])
            if not any(i["text"] == ch["new"] for i in items):
                items.append({"text": ch["new"], "kaynak": "bellek", "ref": ref, "note": l["note"][:200]})
    return index


def suggestions_for(original: str, index: dict | None = None) -> list[dict]:
    index = suggestion_index() if index is None else index
    return list(index.get(_norm(original), []))[:4]
