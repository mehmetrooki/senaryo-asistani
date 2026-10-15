"""Ortak veri deposu.

Masaüstü arayüzü ve MCP sunucusu aynı SQLite veritabanını ve aynı belge
klasörünü kullanır; böylece birinde öğrenilen kural ya da onaylanan öneri
diğerinde de anında görünür.
"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path


def data_dir() -> Path:
    custom = os.environ.get("SENARYO_ASISTANI_DATA")
    base = Path(custom) if custom else Path.home() / ".senaryo-asistani"
    (base / "belgeler").mkdir(parents=True, exist_ok=True)
    (base / "exports").mkdir(parents=True, exist_ok=True)
    return base


DB_PATH = data_dir() / "veri.sqlite3"
CONFIG_PATH = data_dir() / "ayarlar.json"
_lock = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    pattern TEXT NOT NULL,
    match_type TEXT NOT NULL DEFAULT 'kelime',   -- kelime | kok | ifade
    replacements TEXT NOT NULL DEFAULT '[]',     -- JSON liste
    category TEXT NOT NULL DEFAULT 'argo',
    reason TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manuel',       -- varsayilan | manuel | ogrenilen
    status TEXT NOT NULL DEFAULT 'aktif',        -- aktif | aday | pasif
    hits INTEGER NOT NULL DEFAULT 0,
    example TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    uploaded_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'bekliyor',     -- bekliyor | analiz | hazir | hata
    status_detail TEXT NOT NULL DEFAULT '',
    previous_id TEXT,
    paragraph_count INTEGER NOT NULL DEFAULT 0,
    learned_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS findings (
    id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL,
    paragraph INTEGER NOT NULL,
    start INTEGER NOT NULL,
    end INTEGER NOT NULL,
    original TEXT NOT NULL,
    suggestions TEXT NOT NULL DEFAULT '[]',
    category TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    severity TEXT NOT NULL DEFAULT 'orta',       -- dusuk | orta | yuksek
    source TEXT NOT NULL DEFAULT 'kural',        -- kural | ai | mcp
    rule_id TEXT,
    status TEXT NOT NULL DEFAULT 'bekliyor',     -- bekliyor | kabul | red
    chosen TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_findings_doc ON findings(doc_id);
-- Bellek: notlu (commented) senaryolar ve son hâlleri
CREATE TABLE IF NOT EXISTS memory_files (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,                          -- notlu | son
    pair_key TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    comment_count INTEGER NOT NULL DEFAULT 0,
    uploaded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lessons (
    id TEXT PRIMARY KEY,
    pair_key TEXT NOT NULL,
    source_name TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL,
    anchor TEXT NOT NULL DEFAULT '',
    old_text TEXT NOT NULL DEFAULT '',
    new_text TEXT NOT NULL DEFAULT '',
    changes TEXT NOT NULL DEFAULT '[]',          -- [{"old":..,"new":..}]
    category TEXT NOT NULL DEFAULT 'diğer',
    outcome TEXT NOT NULL DEFAULT 'son_yok',     -- revize | degismedi | son_yok
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lessons_pair ON lessons(pair_key);
"""


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def new_id() -> str:
    return uuid.uuid4().hex[:12]


@contextmanager
def db():
    with _lock:
        conn = sqlite3.connect(DB_PATH, timeout=30)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()


def init_db() -> bool:
    """Veritabanını hazırlar. Eski sürümden güncellendiyse True döner (belgeler yeniden taranmalı)."""
    migrated = False
    with db() as c:
        c.executescript(SCHEMA)
        # Aynı anda birden çok kişi/işlem okuyup yazabilsin (sunucu modu, MCP + arayüz)
        c.execute("PRAGMA journal_mode=WAL")
        for table in ("documents", "memory_files"):
            tcols = {r["name"] for r in c.execute(f"PRAGMA table_info({table})").fetchall()}
            if "uploaded_by" not in tcols:
                c.execute(f"ALTER TABLE {table} ADD COLUMN uploaded_by TEXT NOT NULL DEFAULT ''")
        lcols = {r["name"] for r in c.execute("PRAGMA table_info(lessons)").fetchall()}
        if "edited" not in lcols:
            # 1: kullanıcı düzeltmeleri elle yazdı; Bellek yeniden işlense de korunur
            c.execute("ALTER TABLE lessons ADD COLUMN edited INTEGER NOT NULL DEFAULT 0")
        rcols = {r["name"] for r in c.execute("PRAGMA table_info(rules)").fetchall()}
        if "lesson_id" not in rcols:
            c.execute("ALTER TABLE rules ADD COLUMN lesson_id TEXT")
        fcols = {r["name"] for r in c.execute("PRAGMA table_info(findings)").fetchall()}
        if "suggestion_info" not in fcols:
            c.execute("ALTER TABLE findings ADD COLUMN suggestion_info TEXT NOT NULL DEFAULT '{}'")
            migrated = True  # mevcut bulgular Bellek önerileriyle yeniden taransın
        cols = {r["name"] for r in c.execute("PRAGMA table_info(rules)").fetchall()}
        if "context" not in cols:
            migrated = True
            # sürüm farkından öğrenilmiş anlamsız aday parçaları temizle ("k", "’yi", "KUCHO"...)
            from .learn import is_junk_pattern

            for r in c.execute("SELECT id, pattern FROM rules WHERE status='aday' AND source='ogrenilen'").fetchall():
                if is_junk_pattern(r["pattern"]):
                    c.execute("DELETE FROM rules WHERE id=?", (r["id"],))
            # kesin: her geçtiği yerde işaretle | baglamsal: yalnızca kaba/uygunsuz kullanıldığında
            c.execute("ALTER TABLE rules ADD COLUMN context TEXT NOT NULL DEFAULT 'kesin'")
            c.execute("UPDATE rules SET context='baglamsal', replacements=?, reason=? "
                      "WHERE source='varsayilan' AND lower(pattern)='ha'",
                      (json.dumps(["", "demek", "değil mi", "yani"], ensure_ascii=False),
                       "Bağlama bağlı: gülme ('Ha ha!'), hece ve cümle başı ünlem ('Ha, o mu?') işaretlenmez; "
                       "cümle sonundaki kaba vurgu ('…mü ha?') işaretlenir."))
        from .seed_rules import SEED_RULES
        from .seed_rules_extra import EXTRA_RULES

        SEED_RULES = SEED_RULES + EXTRA_RULES

        c.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        row = c.execute("SELECT value FROM meta WHERE key='seed_version'").fetchone()
        seed_version = row["value"] if row else ("1.1" if "context" in cols else "1.0")
        empty = c.execute("SELECT COUNT(*) FROM rules").fetchone()[0] == 0
        if migrated:
            # Varsayılan bir kuralla aynı ifade yalnızca öğrenilmiş aday olarak duruyorsa, varsayılanı kullan
            for r in SEED_RULES:
                if r.get("added"):
                    c.execute("DELETE FROM rules WHERE lower(pattern)=? AND status='aday' AND source='ogrenilen'",
                              (r["pattern"].lower(),))
        existing = {r[0].lower() for r in c.execute("SELECT pattern FROM rules")}
        for r in SEED_RULES:
            # sonradan eklenen varsayılan kurallar, güncellemede mevcut kurulumlara da bir kez eklenir
            newer = r.get("added") and r["added"] > seed_version
            if empty or (newer and r["pattern"].lower() not in existing):
                c.execute(
                    "INSERT INTO rules (id, pattern, match_type, replacements, category, reason, source, status,"
                    " context, created_at) VALUES (?,?,?,?,?,?, 'varsayilan', 'aktif', ?, ?)",
                    (new_id(), r["pattern"], r["match_type"], json.dumps(r["replacements"], ensure_ascii=False),
                     r["category"], r["reason"], r.get("context", "kesin"), now()),
                )
        latest = max([r.get("added", "1.0") for r in SEED_RULES] + [seed_version])
        if latest != seed_version or not row:
            c.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('seed_version', ?)", (latest,))
            if latest != seed_version:
                migrated = True  # yeni varsayılan kurallar geldi: belgeler yeniden taransın
    return migrated


# ---------------------------------------------------------------- ayarlar
DEFAULT_CONFIG = {
    "api_key": "",
    "model": "claude-opus-5-5",
    "ai_enabled": True,
    "auto_learn": False,  # True ise öğrenilen kurallar onaysız aktif olur
    "author": "Senaryo Asistanı",
}


def load_config() -> dict:
    cfg = dict(DEFAULT_CONFIG)
    if CONFIG_PATH.exists():
        try:
            cfg.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            pass
    return cfg


def save_config(update: dict) -> dict:
    cfg = load_config()
    cfg.update({k: v for k, v in update.items() if k in DEFAULT_CONFIG})
    CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    return cfg


# ---------------------------------------------------------------- kurallar
def _rule_row(r: sqlite3.Row) -> dict:
    d = dict(r)
    d["replacements"] = json.loads(d["replacements"])
    return d


def list_rules(status: str | None = None) -> list[dict]:
    with db() as c:
        if status:
            rows = c.execute("SELECT * FROM rules WHERE status=? ORDER BY created_at DESC", (status,)).fetchall()
        else:
            rows = c.execute("SELECT * FROM rules ORDER BY status, created_at DESC").fetchall()
    return [_rule_row(r) for r in rows]


def add_rule(pattern: str, replacements: list[str], match_type: str = "kelime", category: str = "argo",
             reason: str = "", source: str = "manuel", status: str = "aktif", example: str = "",
             context: str = "kesin", lesson_id: str | None = None) -> dict:
    pattern = pattern.strip()
    with db() as c:
        existing = c.execute("SELECT * FROM rules WHERE lower(pattern)=lower(?)", (pattern,)).fetchone()
        if existing:
            reps = json.loads(existing["replacements"])
            for rep in replacements:
                if rep and rep not in reps:
                    reps.append(rep)
            new_status = existing["status"]
            if status == "aktif" or existing["status"] == "pasif":
                new_status = status if existing["status"] != "aktif" else "aktif"
            c.execute("UPDATE rules SET replacements=?, status=?, hits=hits+?, lesson_id=COALESCE(lesson_id, ?)"
                      " WHERE id=?",
                      (json.dumps(reps, ensure_ascii=False), new_status, 1 if source == "ogrenilen" else 0,
                       lesson_id, existing["id"]))
            rid = existing["id"]
        else:
            rid = new_id()
            c.execute(
                "INSERT INTO rules (id, pattern, match_type, replacements, category, reason, source, status, example,"
                " context, lesson_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (rid, pattern, match_type, json.dumps([r for r in replacements if r], ensure_ascii=False),
                 category, reason, source, status, example, context, lesson_id, now()),
            )
        return _rule_row(c.execute("SELECT * FROM rules WHERE id=?", (rid,)).fetchone())


def update_rule(rule_id: str, **fields) -> dict | None:
    allowed = {"pattern", "match_type", "replacements", "category", "reason", "status", "context"}
    sets, vals = [], []
    for k, v in fields.items():
        if k in allowed and v is not None:
            sets.append(f"{k}=?")
            vals.append(json.dumps(v, ensure_ascii=False) if k == "replacements" else v)
    with db() as c:
        if sets:
            c.execute(f"UPDATE rules SET {', '.join(sets)} WHERE id=?", (*vals, rule_id))
        row = c.execute("SELECT * FROM rules WHERE id=?", (rule_id,)).fetchone()
    return _rule_row(row) if row else None


def delete_rule(rule_id: str) -> None:
    with db() as c:
        c.execute("DELETE FROM rules WHERE id=?", (rule_id,))


# ---------------------------------------------------------------- belgeler
def _rebase(d: dict, sub: str) -> dict:
    """Kayıttaki dosya yolu başka bir bilgisayarın yoluysa, bu veri klasöründeki karşılığını kullan."""
    p = Path(d["stored_path"])
    if not p.exists():
        d["stored_path"] = str(data_dir() / sub / p.name.split("\\")[-1])
    return d


def default_user() -> str:
    """Yerel kullanımda değişiklikleri yapan kişinin adı (Ayarlar > Değişiklik yazarı ya da bilgisayar kullanıcısı)."""
    author = (load_config().get("author") or "").strip()
    if author and author != DEFAULT_CONFIG["author"]:
        return author
    return os.environ.get("USERNAME") or os.environ.get("USER") or ""


def store_document(src: Path | str, name: str | None = None, user: str | None = None) -> dict:
    src = Path(src)
    doc_id = new_id()
    dest = data_dir() / "belgeler" / f"{doc_id}.docx"
    shutil.copyfile(src, dest)
    with db() as c:
        c.execute("INSERT INTO documents (id, name, stored_path, uploaded_at, uploaded_by) VALUES (?,?,?,?,?)",
                  (doc_id, name or src.name, str(dest), now(), user if user is not None else default_user()))
    return get_document(doc_id)


def get_document(doc_id: str) -> dict | None:
    with db() as c:
        row = c.execute("SELECT * FROM documents WHERE id=?", (doc_id,)).fetchone()
    return _rebase(dict(row), "belgeler") if row else None


def list_documents() -> list[dict]:
    with db() as c:
        rows = c.execute("SELECT * FROM documents ORDER BY uploaded_at DESC, rowid DESC").fetchall()
        out = []
        for r in rows:
            d = _rebase(dict(r), "belgeler")
            counts = c.execute(
                "SELECT status, COUNT(*) n FROM findings WHERE doc_id=? GROUP BY status", (r["id"],)).fetchall()
            d["counts"] = {x["status"]: x["n"] for x in counts}
            out.append(d)
    return out


def latest_document() -> dict | None:
    docs = list_documents()
    return docs[0] if docs else None


def update_document(doc_id: str, **fields) -> None:
    allowed = {"status", "status_detail", "previous_id", "paragraph_count", "learned_count", "name"}
    sets = [f"{k}=?" for k in fields if k in allowed]
    vals = [v for k, v in fields.items() if k in allowed]
    if sets:
        with db() as c:
            c.execute(f"UPDATE documents SET {', '.join(sets)} WHERE id=?", (*vals, doc_id))


def delete_document(doc_id: str) -> None:
    doc = get_document(doc_id)
    with db() as c:
        c.execute("DELETE FROM findings WHERE doc_id=?", (doc_id,))
        c.execute("DELETE FROM documents WHERE id=?", (doc_id,))
    if doc:
        Path(doc["stored_path"]).unlink(missing_ok=True)


# ---------------------------------------------------------------- bulgular
def _finding_row(r: sqlite3.Row) -> dict:
    d = dict(r)
    d["suggestions"] = json.loads(d["suggestions"])
    # Her önerinin kaynağı: {"öneri metni": {"kaynak": "bellek|claude|kural", "ref": "KUCHO-S1E51..."}}
    d["suggestion_info"] = json.loads(d.get("suggestion_info") or "{}")
    return d


def _normalize_suggestions(suggestions: list, default_source: str) -> tuple[list[str], dict]:
    """Öneriler düz metin ya da {"text", "kaynak", "ref"} olarak gelebilir."""
    texts, info = [], {}
    for s in suggestions:
        if isinstance(s, dict):
            t = s.get("text", "")
            if t not in info:  # aynı öneri birden çok kaynaktan gelirse ilki (ör. Bellek) geçerli
                info[t] = {"kaynak": s.get("kaynak") or default_source, "ref": s.get("ref") or ""}
                if s.get("note"):
                    info[t]["note"] = s["note"]
        else:
            t = s
            info.setdefault(t, {"kaynak": default_source, "ref": ""})
        if t not in texts:
            texts.append(t)
    return texts, info


def add_finding(doc_id: str, paragraph: int, start: int, end: int, original: str, suggestions: list,
                category: str = "", reason: str = "", severity: str = "orta", source: str = "kural",
                rule_id: str | None = None, status: str = "bekliyor", chosen: str | None = None) -> dict | None:
    """Aynı aralıkla çakışan bir bulgu varsa önerileri birleştirir."""
    texts, info = _normalize_suggestions(suggestions, "claude" if source == "ai" else source)
    with db() as c:
        overlaps = c.execute(
            "SELECT * FROM findings WHERE doc_id=? AND paragraph=? AND start<? AND end>?",
            (doc_id, paragraph, end, start)).fetchall()
        if overlaps and status == "bekliyor":
            f = overlaps[0]
            sugg = json.loads(f["suggestions"])
            old_info = json.loads(f["suggestion_info"] or "{}")
            for t in texts:
                if t not in sugg:
                    sugg.append(t)
                old_info.setdefault(t, info[t])
            sj, ij = json.dumps(sugg, ensure_ascii=False), json.dumps(old_info, ensure_ascii=False)
            # Daha geniş aralığı tut (ör. kural "kes", AI "kırmızı kabloyu kes")
            if (end - start) > (f["end"] - f["start"]):
                c.execute("UPDATE findings SET start=?, end=?, original=?, suggestions=?, suggestion_info=?, reason=?"
                          " WHERE id=?", (start, end, original, sj, ij, reason or f["reason"], f["id"]))
            else:
                c.execute("UPDATE findings SET suggestions=?, suggestion_info=?, reason=? WHERE id=?",
                          (sj, ij, f["reason"] or reason, f["id"]))
            return _finding_row(c.execute("SELECT * FROM findings WHERE id=?", (f["id"],)).fetchone())
        fid = new_id()
        c.execute(
            "INSERT INTO findings (id, doc_id, paragraph, start, end, original, suggestions, suggestion_info,"
            " category, reason, severity, source, rule_id, status, chosen, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (fid, doc_id, paragraph, start, end, original, json.dumps(texts, ensure_ascii=False),
             json.dumps(info, ensure_ascii=False), category, reason, severity, source, rule_id, status, chosen,
             now()))
        return _finding_row(c.execute("SELECT * FROM findings WHERE id=?", (fid,)).fetchone())


def delete_findings_in_range(doc_id: str, paragraph: int, start: int, end: int) -> int:
    """Elle yeniden yazılan aralıkla çakışan bulguları siler (yeni metin onları kapsıyor)."""
    with db() as c:
        cur = c.execute("DELETE FROM findings WHERE doc_id=? AND paragraph=? AND start<? AND end>?",
                        (doc_id, paragraph, max(end, start + 1), start))
        return cur.rowcount


def list_findings(doc_id: str, status: str | None = None) -> list[dict]:
    q = "SELECT * FROM findings WHERE doc_id=?"
    args: list = [doc_id]
    if status:
        q += " AND status=?"
        args.append(status)
    q += " ORDER BY paragraph, start"
    with db() as c:
        return [_finding_row(r) for r in c.execute(q, args).fetchall()]


def get_finding(fid: str) -> dict | None:
    with db() as c:
        row = c.execute("SELECT * FROM findings WHERE id=?", (fid,)).fetchone()
    return _finding_row(row) if row else None


def decide_finding(fid: str, status: str, chosen: str | None = None) -> dict | None:
    with db() as c:
        c.execute("UPDATE findings SET status=?, chosen=? WHERE id=?",
                  (status, chosen if status == "kabul" else None, fid))
        row = c.execute("SELECT * FROM findings WHERE id=?", (fid,)).fetchone()
    return _finding_row(row) if row else None


def add_suggestions(fid: str, suggestions: list) -> dict | None:
    f = get_finding(fid)
    if not f:
        return None
    texts, info = _normalize_suggestions(suggestions, "claude")
    sugg, old_info = f["suggestions"], f["suggestion_info"]
    for t in texts:
        if t not in sugg:
            sugg.append(t)
        old_info.setdefault(t, info[t])
    with db() as c:
        c.execute("UPDATE findings SET suggestions=?, suggestion_info=? WHERE id=?",
                  (json.dumps(sugg, ensure_ascii=False), json.dumps(old_info, ensure_ascii=False), fid))
        row = c.execute("SELECT * FROM findings WHERE id=?", (fid,)).fetchone()
    return _finding_row(row) if row else None


def clear_findings(doc_id: str, source: str | None = None) -> None:
    with db() as c:
        if source:
            c.execute("DELETE FROM findings WHERE doc_id=? AND source=? AND status='bekliyor'", (doc_id, source))
        else:
            c.execute("DELETE FROM findings WHERE doc_id=? AND status='bekliyor'", (doc_id,))


# ---------------------------------------------------------------- bellek
def _lesson_row(r: sqlite3.Row) -> dict:
    d = dict(r)
    d["changes"] = json.loads(d["changes"])
    d["active"] = bool(d["active"])
    d["edited"] = bool(d.get("edited"))
    return d


def add_memory_file(src: Path | str, name: str, kind: str, pair_key: str, comment_count: int,
                    user: str | None = None) -> dict:
    """Aynı bölümün aynı türden eski dosyası varsa yerine geçer."""
    fid = new_id()
    dest = data_dir() / "bellek" / f"{fid}.docx"
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dest)
    with db() as c:
        for old in c.execute("SELECT * FROM memory_files WHERE pair_key=? AND kind=?", (pair_key, kind)).fetchall():
            Path(_rebase(dict(old), "bellek")["stored_path"]).unlink(missing_ok=True)
            c.execute("DELETE FROM memory_files WHERE id=?", (old["id"],))
        c.execute("INSERT INTO memory_files (id, name, kind, pair_key, stored_path, comment_count, uploaded_at,"
                  " uploaded_by) VALUES (?,?,?,?,?,?,?,?)",
                  (fid, name, kind, pair_key, str(dest), comment_count, now(),
                   user if user is not None else default_user()))
        return dict(c.execute("SELECT * FROM memory_files WHERE id=?", (fid,)).fetchone())


def memory_files(pair_key: str | None = None) -> list[dict]:
    with db() as c:
        if pair_key:
            rows = c.execute("SELECT * FROM memory_files WHERE pair_key=?", (pair_key,)).fetchall()
        else:
            rows = c.execute("SELECT * FROM memory_files ORDER BY pair_key, kind").fetchall()
    return [_rebase(dict(r), "bellek") for r in rows]


def memory_pairs() -> list[dict]:
    pairs: dict[str, dict] = {}
    for f in memory_files():
        p = pairs.setdefault(f["pair_key"], {"pair_key": f["pair_key"], "notlu": None, "son": None})
        p[f["kind"]] = {"id": f["id"], "name": f["name"], "uploaded_at": f["uploaded_at"],
                        "comment_count": f["comment_count"], "uploaded_by": f.get("uploaded_by") or ""}
    with db() as c:
        for row in c.execute("SELECT pair_key, outcome, COUNT(*) n FROM lessons GROUP BY pair_key, outcome"):
            if row["pair_key"] in pairs:
                pairs[row["pair_key"]].setdefault("outcomes", {})[row["outcome"]] = row["n"]
    return sorted(pairs.values(), key=lambda p: p["pair_key"])


def delete_memory_pair(pair_key: str) -> None:
    with db() as c:
        for f in c.execute("SELECT * FROM memory_files WHERE pair_key=?", (pair_key,)).fetchall():
            Path(_rebase(dict(f), "bellek")["stored_path"]).unlink(missing_ok=True)
        c.execute("DELETE FROM memory_files WHERE pair_key=?", (pair_key,))
        c.execute("DELETE FROM lessons WHERE pair_key=?", (pair_key,))


def replace_lessons(pair_key: str, lessons: list[dict]) -> int:
    with db() as c:
        # kullanıcının daha önce kapattığı/kategorisini değiştirdiği dersleri koru
        kept = {(r["note"], r["anchor"]): dict(r) for r in
                c.execute("SELECT id, note, anchor, active, category, edited, changes, outcome FROM lessons"
                          " WHERE pair_key=?", (pair_key,))}
        c.execute("DELETE FROM lessons WHERE pair_key=?", (pair_key,))
        for l in lessons:
            prev = kept.get((l["note"], l["anchor"]))
            lid = prev["id"] if prev else new_id()  # aynı kimlik: bağlı kurallar kopmasın
            active = prev["active"] if prev else 1
            category = prev["category"] if prev else l["category"]
            edited = prev["edited"] if prev else 0
            changes = json.loads(prev["changes"]) if edited else l["changes"]
            outcome = prev["outcome"] if edited else l["outcome"]
            c.execute(
                "INSERT INTO lessons (id, pair_key, source_name, author, note, anchor, old_text, new_text, changes,"
                " category, outcome, active, edited, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (lid, pair_key, l["source_name"], l.get("author", ""), l["note"], l["anchor"], l["old_text"],
                 l["new_text"], json.dumps(changes, ensure_ascii=False), category, outcome,
                 int(active), int(edited), now()))
    return len(lessons)


def list_lessons(active_only: bool = False) -> list[dict]:
    q = "SELECT * FROM lessons" + (" WHERE active=1" if active_only else "") + " ORDER BY created_at DESC, pair_key"
    with db() as c:
        return [_lesson_row(r) for r in c.execute(q).fetchall()]


def update_lesson(lesson_id: str, active: bool | None = None, category: str | None = None,
                  changes: list[dict] | None = None) -> dict | None:
    with db() as c:
        if changes is not None:
            clean = [{"old": (ch.get("old") or "").strip(), "new": (ch.get("new") or "").strip()}
                     for ch in changes if (ch.get("old") or "").strip() or (ch.get("new") or "").strip()]
            c.execute("UPDATE lessons SET changes=?, edited=1, outcome=? WHERE id=?",
                      (json.dumps(clean, ensure_ascii=False), "revize" if clean else "degismedi", lesson_id))
        if active is not None:
            c.execute("UPDATE lessons SET active=? WHERE id=?", (int(active), lesson_id))
        if category:
            c.execute("UPDATE lessons SET category=? WHERE id=?", (category, lesson_id))
        row = c.execute("SELECT * FROM lessons WHERE id=?", (lesson_id,)).fetchone()
    return _lesson_row(row) if row else None


def sync_lesson_rules(lesson_id: str, edits: list[dict]) -> int:
    """Bir dersten "Kural yap" ile üretilmiş kuralları, dersteki düzeltme elle değişince günceller.

    edits: [{"orig_old": düzenlemeden önceki ifade, "old": yeni ifade, "new": yeni öneri}]
    """
    n = 0
    with db() as c:
        for e in edits:
            key = (e.get("orig_old") or "").strip().lower()
            if not key:
                continue
            for r in c.execute("SELECT id FROM rules WHERE lesson_id=? AND lower(pattern)=?", (lesson_id, key)):
                old, new = (e.get("old") or "").strip(), (e.get("new") or "").strip()
                if not old:  # düzeltme satırı silindi
                    c.execute("DELETE FROM rules WHERE id=?", (r["id"],))
                else:
                    c.execute("UPDATE rules SET pattern=?, replacements=?, match_type=? WHERE id=?",
                              (old, json.dumps([new], ensure_ascii=False),
                               "kelime" if len(old.split()) == 1 else "ifade", r["id"]))
                n += 1
    return n
