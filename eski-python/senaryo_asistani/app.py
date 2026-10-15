"""Arayüz sunucusu.

Kişisel kullanımda yalnızca 127.0.0.1 üzerinde çalışır. Ekip sunucusunda (SENARYO_TAKIM_SIFRESI tanımlı)
ekip şifresiyle giriş istenir; bkz. auth.py ve sunucu.py.
"""
from __future__ import annotations

import tempfile
import threading
from pathlib import Path

from fastapi import Body, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from starlette.background import BackgroundTask

from . import __version__, auth, docx_io, service, storage

STATIC = Path(__file__).parent / "static"
app = FastAPI(title="Senaryo Asistanı")


def _bg(fn, *args, **kwargs):
    threading.Thread(target=fn, args=args, kwargs=kwargs, daemon=True).start()


def _user(request: Request) -> str:
    return getattr(request.state, "user", None) or storage.default_user()


# ---------------------------------------------------------------- ekip girişi (sunucu modu)
_PUBLIC = ("/giris", "/api/giris", "/saglik", "/baglanti/")


@app.middleware("http")
async def require_login(request: Request, call_next):
    if auth.server_mode() and not request.url.path.startswith(_PUBLIC):
        user = auth.read_cookie(request.cookies.get(auth.COOKIE))
        if not user:
            if request.url.path.startswith("/api/"):
                return JSONResponse({"detail": "Oturum süresi doldu, yeniden giriş yapın."}, status_code=401)
            return RedirectResponse("/giris")
        request.state.user = user
    return await call_next(request)


@app.get("/giris", response_class=HTMLResponse)
def login_page():
    return auth.LOGIN_HTML


@app.post("/api/giris")
def login(ad: str = Body(...), sifre: str = Body(...)):
    name = " ".join(ad.split())[:40]
    if not name or not auth.check_password(sifre):
        raise HTTPException(401, "Şifre hatalı")
    resp = JSONResponse({"ok": True, "ad": name})
    resp.set_cookie(auth.COOKIE, auth.make_cookie(name), max_age=auth.MAX_AGE, httponly=True, samesite="lax",
                    secure=False)
    return resp


@app.post("/api/cikis")
def logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(auth.COOKIE)
    return resp


@app.get("/saglik")
def health():
    return {"ok": True}


@app.get("/", response_class=HTMLResponse)
def index():
    return (STATIC / "index.html").read_text(encoding="utf-8")


@app.get("/api/status")
def status(request: Request):
    out = {"ai_ready": service.ai_ready(), "data_dir": str(storage.data_dir()), "version": __version__,
           "server_mode": auth.server_mode(), "user": _user(request)}
    if auth.server_mode():
        out["mcp_path"] = f"/baglanti/{auth.mcp_token()}/mcp"
    return out


# ---------------------------------------------------------------- yedek / taşıma
@app.get("/api/yedek")
def backup_download():
    from . import backup

    path = backup.make_backup()
    return FileResponse(path, filename=path.name, media_type="application/zip",
                        background=BackgroundTask(lambda: Path(path).unlink(missing_ok=True)))


@app.post("/api/yedek")
async def backup_import(request: Request, file: UploadFile = File(...)):
    from . import backup

    with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as tmp:
        tmp.write(await file.read())
    try:
        stats = backup.import_backup(tmp.name, user=_user(request))
    except Exception as e:
        raise HTTPException(400, f"Yedek okunamadı: {e}")
    finally:
        Path(tmp.name).unlink(missing_ok=True)
    _bg(service.rescan_all_rules)
    return stats


# ---------------------------------------------------------------- belgeler
@app.get("/api/docs")
def docs():
    return storage.list_documents()


@app.post("/api/docs")
async def upload(request: Request, files: list[UploadFile] = File(...), run_ai: bool = Form(True)):
    created = []
    for uf in files:
        if not uf.filename.lower().endswith(".docx"):
            continue
        with tempfile.NamedTemporaryFile(delete=False, suffix=".docx") as tmp:
            tmp.write(await uf.read())
        try:
            docx_io.load(tmp.name)  # bozuk dosyayı erkenden reddet
        except Exception:
            Path(tmp.name).unlink(missing_ok=True)
            raise HTTPException(400, f"'{uf.filename}' okunamadı; geçerli bir .docx değil.")
        doc = storage.store_document(tmp.name, uf.filename, user=_user(request))
        Path(tmp.name).unlink(missing_ok=True)
        created.append(doc)
    if not created:
        raise HTTPException(400, "Yalnızca .docx dosyaları kabul edilir.")

    def work():  # sırayla işle: sonraki belge öncekinden öğrenilenleri kullanabilsin
        for d in created:
            service.process(d["id"], run_ai=run_ai)

    _bg(work)
    return created


@app.get("/api/docs/{doc_id}")
def doc_detail(doc_id: str):
    doc = storage.get_document(doc_id)
    if not doc:
        raise HTTPException(404, "Belge bulunamadı")
    paras = docx_io.describe(doc["stored_path"])
    findings = storage.list_findings(doc_id)
    by_p: dict[int, list] = {}
    for f in findings:
        by_p.setdefault(f["paragraph"], []).append(f)
    for p in paras:
        fs = by_p.get(p["index"], [])
        p["preview"] = service.preview_paragraph(p["text"], fs) if fs else p["text"]
    return {"doc": doc, "paragraphs": paras, "findings": findings}


@app.delete("/api/docs/{doc_id}")
def doc_delete(doc_id: str):
    storage.delete_document(doc_id)
    return {"ok": True}


@app.post("/api/docs/delete")
def docs_delete(ids: list[str] = Body(..., embed=True)):
    for doc_id in ids:
        storage.delete_document(doc_id)
    return {"deleted": len(ids)}


@app.post("/api/docs/to_memory")
def docs_to_memory(ids: list[str] = Body(..., embed=True)):
    """Yanlışlıkla Senaryo Geliştirme'ye yüklenmiş notlu/son hâl dosyalarını Bellek'e taşır."""
    from . import memory

    moved = 0
    for doc_id in ids:
        doc = storage.get_document(doc_id)
        if not doc:
            continue
        memory.ingest_file(doc["stored_path"], doc["name"], user=doc.get("uploaded_by") or None)
        storage.delete_document(doc_id)
        moved += 1
    return {"moved": moved, "lessons": len(storage.list_lessons())}


@app.post("/api/docs/{doc_id}/rescan")
def rescan(doc_id: str, ai: bool = Body(True, embed=True)):
    if not storage.get_document(doc_id):
        raise HTTPException(404)

    def work():
        storage.update_document(doc_id, status="analiz", status_detail="Kurallar taranıyor")
        service.scan_rules(doc_id)
        if ai and service.ai_ready():
            try:
                service.scan_ai(doc_id, progress=lambda d, t: storage.update_document(
                    doc_id, status_detail=f"Claude inceliyor ({d}/{t})"))
            except Exception as e:
                storage.update_document(doc_id, status="hazir", status_detail=f"Claude hatası: {e}")
                return
        storage.update_document(doc_id, status="hazir", status_detail="")

    _bg(work)
    return {"ok": True}


@app.post("/api/docs/{doc_id}/findings")
def manual_finding(doc_id: str, paragraph: int = Body(...), start: int = Body(...), end: int = Body(...),
                   suggestion: str = Body(""), reason: str = Body("Editör tarafından işaretlendi.")):
    doc = storage.get_document(doc_id)
    if not doc:
        raise HTTPException(404)
    texts = docx_io.read_text_paragraphs(doc["stored_path"])
    if paragraph >= len(texts) or not (0 <= start < end <= len(texts[paragraph])):
        raise HTTPException(400, "Geçersiz seçim")
    f = storage.add_finding(doc_id, paragraph, start, end, texts[paragraph][start:end],
                            [suggestion] if suggestion else [], category="editör", reason=reason, source="manuel")
    return f


@app.post("/api/docs/{doc_id}/edit")
def edit_paragraph(doc_id: str, paragraph: int = Body(...), text: str = Body(...)):
    if not storage.get_document(doc_id):
        raise HTTPException(404)
    try:
        f = service.edit_paragraph(doc_id, paragraph, text)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"finding": f}


@app.post("/api/docs/{doc_id}/accept_all")
def accept_all(doc_id: str):
    n = 0
    for f in storage.list_findings(doc_id, "bekliyor"):
        if f["suggestions"]:
            service.decide(f["id"], "kabul", f["suggestions"][0], remember=False)
            n += 1
    return {"accepted": n}


@app.get("/api/docs/{doc_id}/export")
def export(doc_id: str, tracked: bool = False):
    try:
        res = service.export(doc_id, tracked=tracked)
    except ValueError as e:
        raise HTTPException(404, str(e))
    return FileResponse(res["path"], filename=Path(res["path"]).name,
                        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        headers={"X-Applied": str(res["applied"]), "X-Pending": str(res["pending"])})


@app.post("/api/compare")
def compare(old_id: str = Body(...), new_id: str = Body(...)):
    old, new = storage.get_document(old_id), storage.get_document(new_id)
    if not old or not new:
        raise HTTPException(404)
    n = service.learn_from_versions(old["stored_path"], new["stored_path"], f"'{old['name']}' -> '{new['name']}'")
    return {"learned": n}


# ---------------------------------------------------------------- bulgular
@app.post("/api/findings/{fid}/decide")
def decide(fid: str, action: str = Body(...), text: str | None = Body(None)):
    if action == "geri":
        res = storage.decide_finding(fid, "bekliyor")
    else:
        res = service.decide(fid, action, text)
    if not res:
        raise HTTPException(404)
    return res


@app.post("/api/findings/{fid}/alternatives")
def alternatives(fid: str):
    from . import ai

    f = storage.get_finding(fid)
    if not f:
        raise HTTPException(404)
    if not service.ai_ready():
        raise HTTPException(400, "Claude bağlantısı yok. Ayarlar sekmesinden API anahtarı ekleyin.")
    doc = storage.get_document(f["doc_id"])
    text = docx_io.read_text_paragraphs(doc["stored_path"])[f["paragraph"]]
    try:
        new = ai.alternatives(f["original"], text, f["reason"], f["suggestions"])
    except Exception as e:
        raise HTTPException(502, f"Claude hatası: {e}")
    return storage.add_suggestions(fid, new)


# ---------------------------------------------------------------- bellek
@app.get("/api/memory")
def memory_get():
    from . import memory

    return {"pairs": storage.memory_pairs(), "lessons": storage.list_lessons(), "categories": memory.CATEGORIES}


@app.post("/api/memory")
async def memory_upload(request: Request, files: list[UploadFile] = File(...)):
    from . import memory

    results = []
    for uf in files:
        name = Path(uf.filename).name  # klasör seçiminde gelen alt yol kısmını at
        if not name.lower().endswith(".docx") or name.startswith("~$"):
            continue
        with tempfile.NamedTemporaryFile(delete=False, suffix=".docx") as tmp:
            tmp.write(await uf.read())
        try:
            res = memory.ingest_file(tmp.name, name, user=_user(request))
            res["name"] = name
        except Exception as e:
            res = {"name": name, "error": f"okunamadı: {e}"}
        finally:
            Path(tmp.name).unlink(missing_ok=True)
        results.append(res)
    return results


@app.delete("/api/memory/{pair_key}")
def memory_delete(pair_key: str):
    storage.delete_memory_pair(pair_key)
    return {"ok": True}


@app.patch("/api/lessons/{lesson_id}")
def lesson_update(lesson_id: str, active: bool | None = Body(None), category: str | None = Body(None),
                  changes: list[dict] | None = Body(None)):
    res = storage.update_lesson(lesson_id, active, category, changes)
    if not res:
        raise HTTPException(404)
    if changes is not None:
        # Elle yazılan düzeltme: bağlı kuralları güncelle, açık senaryolardaki Bellek önerilerini tazele
        res["rules_updated"] = storage.sync_lesson_rules(lesson_id, changes)
        _bg(service.rescan_all_rules)
    elif active is not None:
        _bg(service.rescan_all_rules)
    return res


@app.post("/api/lessons/{lesson_id}/rule")
def lesson_to_rule(lesson_id: str, old: str = Body(...), new: str = Body("")):
    lesson = next((l for l in storage.list_lessons() if l["id"] == lesson_id), None)
    if not lesson or not old.strip():
        raise HTTPException(400, "Geçersiz istek")
    return storage.add_rule(old, [new], match_type="kelime" if len(old.split()) == 1 else "ifade",
                            category=lesson["category"], reason=" ".join(lesson["note"].split())[:300],
                            source="ogrenilen", status="aktif", example=lesson["old_text"][:300],
                            lesson_id=lesson_id)


# ---------------------------------------------------------------- kurallar
@app.get("/api/rules")
def rules():
    return storage.list_rules()


@app.post("/api/rules")
def rule_add(pattern: str = Body(...), replacements: list[str] = Body([]), match_type: str = Body("kelime"),
             category: str = Body("argo"), reason: str = Body("")):
    if not pattern.strip():
        raise HTTPException(400, "Kelime/ifade boş olamaz")
    return storage.add_rule(pattern, replacements, match_type, category, reason, source="manuel")


@app.patch("/api/rules/{rid}")
def rule_update(rid: str, data: dict = Body(...)):
    r = storage.update_rule(rid, **data)
    if not r:
        raise HTTPException(404)
    return r


@app.delete("/api/rules/{rid}")
def rule_delete(rid: str):
    storage.delete_rule(rid)
    return {"ok": True}


# ---------------------------------------------------------------- ayarlar
@app.get("/api/settings")
def settings_get():
    cfg = storage.load_config()
    key = cfg.get("api_key") or ""
    cfg["api_key"] = (key[:7] + "…" + key[-4:]) if len(key) > 12 else ""
    cfg["api_key_set"] = bool(key)
    return cfg


@app.post("/api/settings")
def settings_set(data: dict = Body(...)):
    if "api_key" in data and "…" in (data["api_key"] or ""):
        data.pop("api_key")  # maskeli değer geri geldi, değiştirme
    storage.save_config(data)
    return settings_get()
