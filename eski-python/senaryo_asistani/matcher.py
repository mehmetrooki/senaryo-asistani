"""Kural tabanlı tarama (çevrimdışı çalışır, API anahtarı gerektirmez)."""
from __future__ import annotations

import re

_TR_UPPER_FIX = str.maketrans({"I": "ı", "İ": "i"})
WORD_CHARS = r"0-9A-Za-zÇĞİIÖŞÜçğıiöşüÂÎÛâîûÀ-ÖØ-öø-ÿ'’"


def tr_lower(s: str) -> str:
    """Türkçe'ye uygun küçük harf; uzunluğu korur (konumlar bozulmaz)."""
    s = s.translate(_TR_UPPER_FIX)
    out = s.lower()
    return out if len(out) == len(s) else "".join(c.lower() if len(c.lower()) == 1 else c for c in s)


def match_case(source: str, replacement: str) -> str:
    """Değiştirilen ifadenin büyük/küçük harf yapısını öneriye taşır."""
    if not replacement or not source:
        return replacement
    letters = [c for c in source if c.isalpha()]
    if letters and all(c.isupper() for c in letters) and len(letters) > 1:
        return replacement.replace("i", "İ").replace("ı", "I").upper()
    if source[0].isupper():
        first = replacement[0]
        first = "İ" if first == "i" else ("I" if first == "ı" else first.upper())
        return first + replacement[1:]
    return replacement


_VOWELS = "aeıioöuü"
_FRONT = set("eiöü")
_ROUND = set("oöuü")
_VOICELESS = set("çfhkpsşt")


def _last_vowel(word: str) -> str | None:
    for c in reversed(tr_lower(word)):
        if c in _VOWELS:
            return c
    return None


def attach_suffix(stem_replacement: str, suffix: str) -> str:
    """Kök kuralında eki yeni köke ünlü uyumuyla taşır.

    kudur+dun -> sinirlen+din, kudur+muş -> öfkelen+miş, kudur+uyor -> sinirlen+iyor
    """
    if not suffix or not stem_replacement:
        return stem_replacement + suffix
    base = stem_replacement
    sfx = tr_lower(suffix)
    if sfx[0] in _VOWELS and base[-1].lower() in _VOWELS:
        if sfx[1:].startswith("yor"):
            base = base[:-1]  # bekle + iyor -> bekliyor
        else:
            sfx = "y" + sfx
    last = _last_vowel(base) or "e"
    out = []
    for i, c in enumerate(sfx):
        if c in "ıiuü":
            front, rnd = last in _FRONT, last in _ROUND
            c = ("ü" if rnd else "i") if front else ("u" if rnd else "ı")
            last = c
        elif c in "ae":
            c = "e" if last in _FRONT else "a"
            last = c
        elif c in "oö":
            last = c
        elif i == 0 and c in "dc" and base[-1].lower() in _VOICELESS:
            c = "t" if c == "d" else "ç"
        out.append(c)
    return base + "".join(out)


_QPARTICLE = re.compile(r"(\s+)(m[ıiuü](?:sun(?:uz)?|sın(?:ız)?|sin(?:iz)?|sün(?:üz)?|y[ıiuü][mz]|d[ıiuü]r)?)"
                        rf"(?![{WORD_CHARS}])")


_APOS_SUFFIX = r"(?:['’][a-zçğıöşüâîû]+)?"


def _compile(rule: dict) -> re.Pattern:
    left = rf"(?<![{WORD_CHARS}])"
    if rule["match_type"] == "desen":
        # ileri düzey: küçük harfli metinde düzenli ifade (ör. kötü örnek davranış kalıpları)
        return re.compile(left + rule["pattern"].strip())
    pat = tr_lower(rule["pattern"].strip())
    words = [re.escape(w) for w in pat.split()]
    body = r"\s+".join(words)
    if rule["match_type"] == "kok":
        # kökten sonra Türkçe ekler gelebilir: kudur -> kudurdu, kuduruyor
        return re.compile(left + body + rf"[{WORD_CHARS}]*")
    # tam kelime; kesme işaretiyle gelen ek de kapsanır: "star’a", "show’da"
    return re.compile(left + body + _APOS_SUFFIX + rf"(?![{WORD_CHARS}])")


_SENTENCE_START = re.compile(r"(^|[.!?…:;\-–—\"“”«(\n]|\)\s*)\s*$")


def _context_ok(low: str, s: int, e: int, token: str) -> bool:
    """Bağlama bağlı kurallar için: masum kullanımları ele (True = işaretleme)."""
    before, after = low[:s], low[e:]
    # Gülme / tekrar: "ha ha ha", "hah-hah-ha", "haaa ha"
    near = rf"(?:{re.escape(token)}|h[ae]+h?[aev]*)"
    if re.match(rf"[\s\-–,!.…]*{near}(?![{WORD_CHARS}])", after) or \
            re.search(rf"(?<![{WORD_CHARS}]){near}[\s\-–,!.…]*$", before) or re.search(r"h[ae]+\s*$", before):
        return True
    # Hecelere ayrılmış kelime: "Ha-tır-la-mı"
    if re.match(rf"-[{WORD_CHARS}]", after) or re.search(rf"[{WORD_CHARS}]-$", before):
        return True
    # Cümle başında anlama/şaşırma ünlemi: "Ha, o mu?", "KUCHO - Ha, ...", "(Şaşkın) Ha şimdi anladım!"
    # Yalnızca "ha" için; ekip "he"yi cümle başında da kaba buluyor ("He, tamam.")
    if token == "ha" and _SENTENCE_START.search(before):
        return True
    return False


def scan_paragraph(text: str, rules: list[dict]) -> list[dict]:
    low = tr_lower(text)
    hits = []
    for rule in rules:
        try:
            rx = _compile(rule)
        except re.error:
            continue
        contextual = rule.get("context") == "baglamsal"
        for m in rx.finditer(low):
            s, e = m.start(), m.end()
            if contextual and _context_ok(low, s, e, tr_lower(rule["pattern"].strip())):
                continue
            particle = None
            if rule["match_type"] == "kok":
                # "kudurdun mu" -> "sinirlendin mi": soru ekini de uyuma sok
                pm = _QPARTICLE.match(low, e)
                if pm:
                    particle = (pm.group(1), text[pm.start(2):pm.end(2)])
                    e = pm.end()
            original = text[s:e]
            word = original[: len(original) - (len(particle[0]) + len(particle[1])) if particle else len(original)]
            reps = []
            apos = re.search(r"['’]([a-zçğıöşüâîû]+)$", tr_lower(word)) if rule["match_type"] == "kelime" else None
            for rep in rule["replacements"]:
                if rule["match_type"] == "kok" and rep:
                    suffix = word[len(rule["pattern"].strip()):]
                    rep = attach_suffix(rep, suffix)
                elif apos and rep:
                    # "star’a" -> "yıldıza": Türkçe kelimeye ek kesme işaretsiz, ünlü uyumuyla gelir
                    sfx = apos.group(1)
                    if " " in rep and rep[-1] in _VOWELS and sfx[0] in _VOWELS:
                        # tamlama: "dünya yıldızı" + a -> "dünya yıldızına" (kaynaştırma n)
                        rep = attach_suffix(rep + "n", sfx)
                    else:
                        rep = attach_suffix(rep, sfx)
                    if particle:
                        rep = rep + particle[0] + attach_suffix(rep, particle[1])[len(rep):]
                elif particle:
                    rep = rep + particle[0] + particle[1] if rep else rep
                rep = match_case(original, rep)
                if rep not in reps:
                    reps.append(rep)
            hits.append({
                "start": s, "end": e, "original": original, "suggestions": reps,
                "category": rule["category"], "reason": rule["reason"], "rule_id": rule["id"],
                "severity": "dusuk" if contextual else
                            ("yuksek" if rule["category"] in ("şiddet", "tehlikeli davranış") else "orta"),
            })
    # uzun eşleşmeleri öncele, çakışanları ele
    hits.sort(key=lambda h: (h["start"], -(h["end"] - h["start"])))
    result, last_end = [], -1
    for h in hits:
        if h["start"] >= last_end:
            result.append(h)
            last_end = h["end"]
    return result
