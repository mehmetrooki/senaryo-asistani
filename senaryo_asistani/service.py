"""Arayüz ve MCP sunucusunun ortak kullandığı iş akışları."""
from __future__ import annotations

import os
import threading
import re
from pathlib import Path

from . import docx_io, learn, matcher, storage


def ai_ready() -> bool:
    cfg = storage.load_config()
    if not cfg.get("ai_enabled", True):
        return False
    return bool(cfg.get("api_key") or os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


# ---------------------------------------------------------------- öğrenme
def _save_learned(pairs: list[dict], source_label: str) -> int:
    if not pairs:
        return 0
    cfg = storage.load_config()
    status = "aktif" if cfg.get("auto_learn") else "aday"
    n = 0
    for r in learn.pairs_to_rules(pairs):
        storage.add_rule(r["pattern"], r["replacements"], match_type=r["match_type"], category="öğrenilen",
                         reason=f"{source_label} içinde ekip tarafından değiştirildi.", source="ogrenilen",
                         status=status, example=r["example"])
        n += 1
    return n


def learn_from_versions(old_path: str | Path, new_path: str | Path, label: str = "Sürüm karşılaştırması") -> int:
    old = docx_io.read_text_paragraphs(old_path)
    new = docx_io.read_text_paragraphs(new_path)
    return _save_learned(learn.pairs_between_versions(old, new), label)


def _find_previous_version(doc: dict, texts: list[str]) -> dict | None:
    best, best_sim = None, 0.6
    for other in storage.list_documents()[:30]:
        if other["id"] == doc["id"] or other["uploaded_at"] > doc["uploaded_at"]:
            continue
        try:
            other_texts = docx_io.read_text_paragraphs(other["stored_path"])
        except Exception:
            continue
        sim = learn.similarity(other_texts, texts)
        if 0.6 < sim < 0.9999 and sim > best_sim:
            best, best_sim = other, sim
    return best


# ---------------------------------------------------------------- tarama
def scan_rules(doc_id: str) -> int:
    doc = storage.get_document(doc_id)
    texts = docx_io.read_text_paragraphs(doc["stored_path"])
    rules = storage.list_rules("aktif")
    storage.clear_findings(doc_id, "kural")
    from . import memory

    mem_index = memory.suggestion_index()
    n = 0
    for pi, text in enumerate(texts):
        if not text.strip():
            continue
        for h in matcher.scan_paragraph(text, rules):
            # Önce ekibin geçmişte aynı ifade için yaptığı düzeltmeler (Bellek), sonra kural önerileri
            sugg = [dict(m, text=matcher.match_case(h["original"], _fit_punctuation(h["original"], m["text"])))
                    for m in memory.suggestions_for(h["original"], mem_index)]
            sugg += [{"text": t, "kaynak": "kural", "ref": ""} for t in h["suggestions"]]
            storage.add_finding(doc_id, pi, h["start"], h["end"], h["original"], sugg,
                                category=h["category"], reason=h["reason"], severity=h["severity"],
                                source="kural", rule_id=h["rule_id"])
            n += 1
    return n


_PUNCT = ".,;:!?…"


def _fit_punctuation(original: str, suggestion: str) -> str:
    """Bellek'teki düzeltme noktalama içerebilir ("demek?"); bulgu noktalamasızsa ("ha") onu at."""
    s = suggestion.strip()
    if not original.endswith(tuple(_PUNCT)):
        s = s.rstrip(_PUNCT + " ")
    if not original.startswith(tuple(_PUNCT)):
        s = s.lstrip(_PUNCT + " ")
    return s


_rescan_lock = threading.Lock()
_rescan_again = threading.Event()


def rescan_all_rules() -> None:
    """Kurallar ya da Bellek değişince bekleyen kural bulgularını tazeler.

    Art arda birkaç düzenleme yapılırsa taramalar üst üste binmez: süren tarama bitince bir kez daha çalışır.
    """
    if not _rescan_lock.acquire(blocking=False):
        _rescan_again.set()
        return
    try:
        while True:
            _rescan_again.clear()
            for d in storage.list_documents():
                try:
                    scan_rules(d["id"])
                except Exception:
                    pass
            if not _rescan_again.is_set():
                break
    finally:
        _rescan_lock.release()


def scan_ai(doc_id: str, progress=None) -> int:
    from . import ai

    doc = storage.get_document(doc_id)
    texts = docx_io.read_text_paragraphs(doc["stored_path"])
    storage.clear_findings(doc_id, "ai")
    n = 0
    for f in ai.analyze(texts, progress=progress):
        storage.add_finding(doc_id, f["paragraph"], f["start"], f["end"], f["original"], f["suggestions"],
                            category=f["category"], reason=f["reason"], severity=f["severity"], source="ai")
        n += 1
    return n


def process(doc_id: str, run_ai: bool = True) -> dict:
    """Yükleme sonrası tam akış: öğren -> kural taraması -> Claude taraması."""
    doc = storage.get_document(doc_id)
    try:
        storage.update_document(doc_id, status="analiz", status_detail="Belge okunuyor")
        texts = docx_io.read_text_paragraphs(doc["stored_path"])
        storage.update_document(doc_id, paragraph_count=len(texts))

        learned = 0
        storage.update_document(doc_id, status_detail="Değişikliklerden öğreniliyor")
        tracked = docx_io.tracked_change_versions(doc["stored_path"])
        if tracked:
            pairs = []
            for _, old, new in tracked:
                pairs.extend(learn.diff_pairs(old, new))
            learned += _save_learned(pairs, f"'{doc['name']}' (izlenen değişiklikler)")
        prev = _find_previous_version(doc, texts)
        if prev:
            storage.update_document(doc_id, previous_id=prev["id"])
            learned += learn_from_versions(prev["stored_path"], doc["stored_path"],
                                           f"'{prev['name']}' -> '{doc['name']}'")
        storage.update_document(doc_id, learned_count=learned)

        storage.update_document(doc_id, status_detail="Kurallar taranıyor")
        scan_rules(doc_id)

        if run_ai and ai_ready():
            def prog(done, total):
                storage.update_document(doc_id, status_detail=f"Claude inceliyor ({done}/{total})")
            prog(0, "?")
            try:
                scan_ai(doc_id, progress=prog)
            except Exception as e:  # AI hatası kural sonuçlarını bozmasın
                storage.update_document(doc_id, status="hazir", status_detail=f"Claude hatası: {e}")
                return storage.get_document(doc_id)
        storage.update_document(doc_id, status="hazir", status_detail="")
    except Exception as e:
        storage.update_document(doc_id, status="hata", status_detail=str(e))
    return storage.get_document(doc_id)


def ingest(path: str | Path, name: str | None = None, run_ai: bool = True, user: str | None = None) -> dict:
    doc = storage.store_document(path, name, user=user)
    return process(doc["id"], run_ai=run_ai)


# ---------------------------------------------------------------- kararlar
def decide(finding_id: str, action: str, text: str | None = None, remember: bool = True) -> dict | None:
    """action: 'kabul' (text = seçilen öneri) ya da 'red'."""
    f = storage.get_finding(finding_id)
    if not f:
        return None
    if action == "red":
        return storage.decide_finding(finding_id, "red")
    chosen = text if text is not None else (f["suggestions"][0] if f["suggestions"] else "")
    res = storage.decide_finding(finding_id, "kabul", chosen)
    # Ekip kararı -> gelecekte aynı ifade için kural adayı
    if remember and f["source"] != "kural" and len(f["original"].split()) <= 6:
        storage.add_rule(f["original"], [chosen], match_type="kelime" if len(f["original"].split()) == 1 else "ifade",
                         category=f["category"] or "öğrenilen", reason=f["reason"], source="ogrenilen",
                         status="aktif" if storage.load_config().get("auto_learn") else "aday",
                         example=f["original"])
    return res


def preview_paragraph(text: str, findings: list[dict]) -> str:
    """Kabul edilen bulgular uygulanmış hâli (yalnızca önizleme)."""
    items = sorted([f for f in findings if f["status"] == "kabul"], key=lambda f: f["start"], reverse=True)
    for f in items:
        s, e, new = f["start"], f["end"], f.get("chosen") or ""
        if text[s:e] != f["original"]:
            continue
        if new == "":
            s, e, new = docx_io.smart_removal_range(text, s, e)
        text = text[:s] + new + text[e:]
    return text


# ---------------------------------------------------------------- export
def _safe_name(name: str) -> str:
    return re.sub(r'[<>:"/\\|?*]+', "_", name)


def export(doc_id: str, tracked: bool = False, dest: str | Path | None = None) -> dict:
    doc = storage.get_document(doc_id)
    if not doc:
        raise ValueError("Belge bulunamadı")
    accepted = storage.list_findings(doc_id, "kabul")
    stem = Path(doc["name"]).stem
    suffix = "_revize_izlenen" if tracked else "_revize"
    out = Path(dest) if dest else storage.data_dir() / "exports" / _safe_name(f"{stem}{suffix}.docx")
    out.parent.mkdir(parents=True, exist_ok=True)
    cfg = storage.load_config()
    result = docx_io.apply_changes(doc["stored_path"], out, accepted, tracked=tracked,
                                   author=cfg.get("author") or "Senaryo Asistanı")
    result["path"] = str(out)
    result["pending"] = len(storage.list_findings(doc_id, "bekliyor"))
    return result


# ---------------------------------------------------------------- elle düzenleme
def _word_aligned_diff(old: str, new: str) -> tuple[int, int, int, int]:
    """old ile new arasındaki farklı bölgeyi kelime sınırlarına genişleterek bulur.

    Döndürür: (old_start, old_end, new_start, new_end)
    """
    p = 0
    while p < min(len(old), len(new)) and old[p] == new[p]:
        p += 1
    s = 0
    while s < min(len(old), len(new)) - p and old[len(old) - 1 - s] == new[len(new) - 1 - s]:
        s += 1
    os_, oe, ns, ne = p, len(old) - s, p, len(new) - s
    # kelime sınırına genişlet (ortak önek/sonek iki metinde de aynı olduğu için birlikte kayar)
    while os_ > 0 and not old[os_ - 1].isspace():
        os_ -= 1
        ns -= 1
    while oe < len(old) and not old[oe].isspace():
        oe += 1
        ne += 1
    return os_, oe, ns, ne


def edit_paragraph(doc_id: str, paragraph: int, new_text: str) -> dict | None:
    """Kullanıcının senaryoda doğrudan yazdığı paragrafı kabul edilmiş bir değişikliğe çevirir.

    Paragrafın tamamı değil, yalnızca değişen kelimeler kaydedilir; böylece export'ta paragrafın
    geri kalanının biçimi (kalın/italik/girinti) korunur.
    """
    doc = storage.get_document(doc_id)
    texts = docx_io.read_text_paragraphs(doc["stored_path"])
    if not 0 <= paragraph < len(texts):
        raise ValueError("Geçersiz paragraf")
    old = texts[paragraph]
    new_text = new_text.replace("\r\n", "\n")
    # Kullanıcı, kabul edilmiş değişiklikler uygulanmış hâli düzenliyor; hiçbir şey değişmediyse dokunma
    para_findings = [f for f in storage.list_findings(doc_id) if f["paragraph"] == paragraph]
    if new_text == preview_paragraph(old, para_findings):
        return None
    if new_text == old:  # orijinale geri döndürüldü
        storage.delete_findings_in_range(doc_id, paragraph, 0, len(old))
        return None
    os_, oe, ns, ne = _word_aligned_diff(old, new_text)
    storage.delete_findings_in_range(doc_id, paragraph, os_, oe)
    return storage.add_finding(doc_id, paragraph, os_, oe, old[os_:oe], [], category="editör",
                               reason="Editör tarafından senaryoda doğrudan düzenlendi.", severity="dusuk",
                               source="manuel", status="kabul", chosen=new_text[ns:ne])
