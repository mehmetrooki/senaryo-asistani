"""Yedek alma ve birleştirerek içe aktarma.

Bir bilgisayardaki tüm veriyi (Bellek, kurallar, senaryolar ve üzerlerindeki kararlar) tek bir .zip olarak
indirir; bu .zip başka bir kuruluma ya da ortak sunucuya yüklendiğinde mevcut verinin ÜZERİNE YAZMAZ,
onunla birleşir:
  - Bellek dosyaları bölüm adlarından eşleşir; aynı bölüm zaten varsa tekrar eklenmez.
  - Elle düzeltilmiş notlar, kapatılan notlar ve değiştirilen kategoriler taşınır.
  - Elle eklenen / öğrenilen kurallar eklenir (aynı ifade varsa önerileri birleşir).
  - Senaryolar ve üzerlerindeki öneri/karar kayıtları taşınır; aynı dosya zaten varsa atlanır.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

from . import memory, storage


def _sha1(path: Path) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def make_backup() -> Path:
    """Tüm verinin tutarlı bir kopyasını .zip olarak oluşturur (API anahtarı dahil edilmez)."""
    out = Path(tempfile.gettempdir()) / f"senaryo-asistani-yedek-{datetime.now():%Y%m%d-%H%M}.zip"
    with tempfile.TemporaryDirectory() as tmp:
        snap = Path(tmp) / "veri.sqlite3"
        src = sqlite3.connect(storage.DB_PATH)
        dst = sqlite3.connect(snap)
        with dst:
            src.backup(dst)  # yazma sürerken bile tutarlı anlık görüntü
        src.close()
        dst.close()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(snap, "veri.sqlite3")
            for sub in ("belgeler", "bellek"):
                for f in (storage.data_dir() / sub).glob("*.docx"):
                    z.write(f, f"{sub}/{f.name}")
            z.writestr("bilgi.json", json.dumps({"olusturma": datetime.now().isoformat(timespec="seconds"),
                                                 "surum": 1}, ensure_ascii=False))
    return out


def import_backup(zip_path: str | Path, user: str = "") -> dict:
    stats = {"bellek_dosyasi": 0, "bellek_atlandi": 0, "not_duzeltmesi": 0, "kural": 0, "senaryo": 0,
             "senaryo_atlandi": 0}
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        with zipfile.ZipFile(zip_path) as z:
            names = z.namelist()
            if "veri.sqlite3" not in names:
                raise ValueError("Bu dosya bir Senaryo Asistanı yedeği değil.")
            for n in names:
                if n == "veri.sqlite3" or n.startswith(("belgeler/", "bellek/")) and n.endswith(".docx"):
                    target = (tmp / n).resolve()
                    if tmp.resolve() not in target.parents:  # zip içinde ../ ile kaçış engeli
                        continue
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(z.read(n))
        src = sqlite3.connect(tmp / "veri.sqlite3")
        src.row_factory = sqlite3.Row

        def rows(sql, params=()):
            try:
                return [dict(r) for r in src.execute(sql, params).fetchall()]
            except sqlite3.OperationalError:
                return []  # eski sürüm yedeğinde tablo/kolon yok

        def local_file(sub, stored_path):
            name = Path(str(stored_path).replace("\\", "/")).name
            f = tmp / sub / name
            return f if f.exists() else None

        # 1) Bellek: notlu + son hâl dosyaları
        existing_mem = {(f["pair_key"], f["kind"]) for f in storage.memory_files()}
        for f in rows("SELECT * FROM memory_files"):
            if (f["pair_key"], f["kind"]) in existing_mem:
                stats["bellek_atlandi"] += 1
                continue
            path = local_file("bellek", f["stored_path"])
            if path:
                memory.ingest_file(path, f["name"], user=f.get("uploaded_by") or user)
                stats["bellek_dosyasi"] += 1

        # 2) Notlar üzerindeki elle yapılan değişiklikler
        target = {(l["pair_key"], l["note"], l["anchor"]): l for l in storage.list_lessons()}
        for l in rows("SELECT * FROM lessons"):
            t = target.get((l["pair_key"], l["note"], l["anchor"]))
            if not t:
                continue
            changes = json.loads(l["changes"]) if l.get("edited") and not t["edited"] else None
            active = bool(l["active"]) if not l["active"] else None
            category = l["category"] if l["category"] != t["category"] else None
            if changes is not None or active is not None or category:
                storage.update_lesson(t["id"], active=active, category=category, changes=changes)
                stats["not_duzeltmesi"] += 1

        # 3) Kurallar (varsayılanlar her kurulumda zaten var)
        for r in rows("SELECT * FROM rules WHERE source != 'varsayilan'"):
            storage.add_rule(r["pattern"], json.loads(r["replacements"]), r["match_type"], r["category"],
                             r["reason"], source=r["source"], status=r["status"], example=r.get("example") or "",
                             context=r.get("context") or "kesin")
            stats["kural"] += 1

        # 4) Senaryolar ve öneri/karar kayıtları
        have = {_sha1(Path(d["stored_path"])) for d in storage.list_documents() if Path(d["stored_path"]).exists()}
        for d in rows("SELECT * FROM documents"):
            path = local_file("belgeler", d["stored_path"])
            if not path:
                continue
            digest = _sha1(path)
            if digest in have:
                stats["senaryo_atlandi"] += 1
                continue
            have.add(digest)
            new = storage.store_document(path, d["name"], user=d.get("uploaded_by") or user)
            storage.update_document(new["id"], status=d["status"] if d["status"] in ("hazir", "hata") else "hazir",
                                    paragraph_count=d.get("paragraph_count") or 0,
                                    learned_count=d.get("learned_count") or 0)
            for f in rows("SELECT * FROM findings WHERE doc_id=?", (d["id"],)):
                sugg = json.loads(f["suggestions"])
                info = json.loads(f.get("suggestion_info") or "{}")
                items = [{"text": t, **info.get(t, {})} for t in sugg]
                storage.add_finding(new["id"], f["paragraph"], f["start"], f["end"], f["original"], items,
                                    category=f["category"], reason=f["reason"], severity=f["severity"],
                                    source=f["source"], rule_id=f.get("rule_id"), status=f["status"],
                                    chosen=f.get("chosen"))
            stats["senaryo"] += 1
        src.close()
    return stats
