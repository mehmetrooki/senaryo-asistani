"""Belgedeki değişikliklerden öğrenme.

İki kaynak:
  1) Word'ün "Değişiklikleri İzle" (track changes) ile yapılmış düzeltmeler:
     silinen ifade -> eklenen ifade çiftleri.
  2) Aynı senaryonun önceki sürümü: yeni yüklenen belge, daha önce yüklenmiş
     bir belgeyle büyük oranda aynıysa iki sürüm otomatik karşılaştırılır.

Çıkan her çift "neyin olmaması gerektiği" ve "yerine neyin geçtiği" olarak
kural adayına dönüşür.
"""
from __future__ import annotations

import difflib
import re

from .matcher import tr_lower

_TOKEN = re.compile(r"\w+|[^\w\s]|\s+", re.UNICODE)


def _tokens(s: str) -> list[str]:
    return _TOKEN.findall(s)


def is_junk_pattern(o: str) -> bool:
    """Kural olamayacak parçalar: tek-iki harf, ek parçası, karakter adı/başlık, sayı."""
    o = o.strip()
    letters = [c for c in o if c.isalpha()]
    if len(letters) < 3:
        return True
    if o[0] in "’'‘-" or re.search(r"\d", o):
        return True
    if all(c.isupper() for c in letters):
        return True  # KUCHO, SAHNE başlıkları vb.
    if len(o.split()) > 5:
        return True  # uzun cümle değişiklikleri kural değil, Bellek'te ders olarak tutulur
    return False


def _is_trivial(old: str, new: str) -> bool:
    o, n = old.strip(), new.strip()
    if not o:
        return True  # salt ekleme -> öğrenilecek "yasaklı" bir şey yok
    if not re.search(r"\w", o):
        return True  # yalnızca noktalama
    if is_junk_pattern(o):
        return True
    if tr_lower(o) == tr_lower(n):
        return True  # yalnızca büyük/küçük harf
    if n and len(o) > 3 and difflib.SequenceMatcher(None, tr_lower(o), tr_lower(n)).ratio() > 0.8:
        return True  # muhtemelen yazım düzeltmesi
    return False


def diff_pairs(old: str, new: str, context: int = 40) -> list[dict]:
    a, b = _tokens(old), _tokens(new)
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    pairs = []
    ops = sm.get_opcodes()
    # Yalnızca boşlukla ayrılmış ardışık değişiklikleri tek grup yap
    # ("kırmızı kabloyu kes" -> "kırmızı butona bas" tek çift olsun)
    groups, cur = [], None
    for k, (tag, i1, i2, j1, j2) in enumerate(ops):
        if tag != "equal":
            if cur is None:
                cur = [i1, i2, j1, j2]
            else:
                cur[1], cur[3] = i2, j2
            continue
        bridge = (cur is not None and "".join(a[i1:i2]).isspace()
                  and k + 1 < len(ops) and ops[k + 1][0] != "equal")
        if bridge:
            cur[1], cur[3] = i2, j2
        elif cur is not None:
            groups.append(cur)
            cur = None
    if cur:
        groups.append(cur)
    for i1, i2, j1, j2 in groups:
        o = "".join(a[i1:i2]).strip()
        n = "".join(b[j1:j2]).strip()
        o = o.strip(",.;:!? ")
        n = n.strip(",.;:!? ")
        if _is_trivial(o, n):
            continue
        start = len("".join(a[:i1]))
        pairs.append({
            "old": o,
            "new": n,
            "pos": start,
            "context": old[max(0, start - context): start + len(o) + context],
        })
    return pairs


def align_paragraphs(old_paras: list[str], new_paras: list[str]) -> list[tuple[str, str]]:
    """İki sürüm arasında değişmiş paragraf çiftlerini bulur."""
    sm = difflib.SequenceMatcher(None, old_paras, new_paras, autojunk=False)
    out = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag != "replace":
            continue
        olds, news = old_paras[i1:i2], new_paras[j1:j2]
        used = set()
        for o in olds:
            best, best_r = None, 0.5
            for k, n in enumerate(news):
                if k in used:
                    continue
                r = difflib.SequenceMatcher(None, o, n).ratio()
                if r > best_r:
                    best, best_r = k, r
            if best is not None:
                used.add(best)
                out.append((o, news[best]))
    return out


def similarity(old_paras: list[str], new_paras: list[str]) -> float:
    a = [p for p in old_paras if p.strip()]
    b = [p for p in new_paras if p.strip()]
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()


def pairs_between_versions(old_paras: list[str], new_paras: list[str]) -> list[dict]:
    pairs = []
    for o, n in align_paragraphs(old_paras, new_paras):
        pairs.extend(diff_pairs(o, n))
    return pairs


def pairs_to_rules(pairs: list[dict]) -> list[dict]:
    """Aynı eski ifade için önerileri birleştirir."""
    by_old: dict[str, dict] = {}
    for p in pairs:
        key = tr_lower(p["old"])
        r = by_old.setdefault(key, {
            "pattern": p["old"], "replacements": [],
            "match_type": "kelime" if len(p["old"].split()) == 1 else "ifade",
            "example": p["context"], "count": 0,
        })
        if p["new"] not in r["replacements"]:
            r["replacements"].append(p["new"])
        r["count"] += 1
    return list(by_old.values())
