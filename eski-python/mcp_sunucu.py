"""Senaryo Asistanı MCP sunucusu (stdio).

Claude Desktop / Claude Code bu sunucu üzerinden masaüstü uygulamasıyla AYNI
kural listesine, belgelere ve önerilere erişir. Claude burada senaryoyu kendisi
okuyup bulgu ekleyebilir; bu yüzden MCP üzerinden API anahtarı gerekmez.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

try:  # mcp 2.x
    from mcp.server.mcpserver import MCPServer as _Server
except ImportError:  # mcp 1.x
    from mcp.server.fastmcp import FastMCP as _Server

from senaryo_asistani import docx_io, service, storage  # noqa: E402
from senaryo_asistani.matcher import tr_lower  # noqa: E402

if storage.init_db():  # güncellemeden sonraki ilk açılış
    import threading

    threading.Thread(target=service.rescan_all_rules, daemon=True).start()

mcp = _Server(
    "senaryo-asistani",
    instructions=(
        "Çocuk çizgi filmi senaryolarını denetleyen Senaryo Asistanı. Ekibin geçmiş notları Bellek'tedir "
        "(bellege_yukle ile eklenir). Bir senaryo incelenecekse: ÖNCE inceleme_yonergesi'ni çağır ve ona uy -> "
        "senaryo_yukle ile .docx yükle (ya da senaryolari_listele ile masaüstü uygulamasına yüklenmiş olanı seç; "
        "kural taraması otomatik yapılır) -> senaryo_metni ile metni parça parça oku -> her sorun ve iyileştirme "
        "fırsatı (argo, yazım, 'he' gibi nidalar, yabancı kelime, fazlalık, kötü örnek davranış, tehlikeli eylem, "
        "tutarsızlık) için bulgu_ekle -> kullanıcıya özet sun -> onaylananları oneri_uygula ile işaretle -> "
        "export_al ile orijinal biçimi (Fransız senaryo formatı dahil) koruyarak .docx üret. Masaüstü arayüzü de "
        "aynı veriyi kullanır; eklediğin bulgular orada da görünür."
    ),
)


def _doc_or_latest(belge_id: str | None) -> dict:
    doc = storage.get_document(belge_id) if belge_id else storage.latest_document()
    if not doc:
        raise ValueError("Belge bulunamadı. Önce senaryo_yukle ile bir .docx yükleyin.")
    return doc


def _finding_view(f: dict) -> dict:
    return {
        "bulgu_id": f["id"], "paragraf": f["paragraph"], "alinti": f["original"], "oneriler": f["suggestions"],
        "kategori": f["category"], "neden": f["reason"], "ciddiyet": f["severity"], "kaynak": f["source"],
        "durum": f["status"], "secilen": f["chosen"],
    }


@mcp.tool()
def senaryo_yukle(dosya_yolu: str, claude_api_ile_incele: bool = False) -> dict:
    """Bir .docx senaryo dosyasını yükler; içindeki izlenen değişikliklerden ve önceki sürümünden öğrenir,
    kural listesiyle tarar. claude_api_ile_incele=True ise ayarlardaki API anahtarıyla ayrıca Claude taraması yapar
    (MCP içinde genelde gerekmez; metni senaryo_metni ile okuyup bulgu_ekle kullanabilirsin)."""
    path = Path(dosya_yolu).expanduser()
    if not path.exists() or path.suffix.lower() != ".docx":
        raise ValueError(f"Geçerli bir .docx bulunamadı: {path}")
    doc = service.ingest(path, path.name, run_ai=claude_api_ile_incele)
    findings = storage.list_findings(doc["id"])
    return {
        "belge_id": doc["id"], "ad": doc["name"], "durum": doc["status"], "not": doc["status_detail"],
        "paragraf_sayisi": doc["paragraph_count"], "ogrenilen_degisiklik": doc["learned_count"],
        "onceki_surum_id": doc["previous_id"], "bulgular": [_finding_view(f) for f in findings],
    }


@mcp.tool()
def senaryolari_listele() -> list[dict]:
    """Yüklenmiş senaryoları (en yeni önce) ve bekleyen/kabul edilen öneri sayılarını listeler."""
    return [{"belge_id": d["id"], "ad": d["name"], "yuklenme": d["uploaded_at"], "durum": d["status"],
             "sayilar": d["counts"]} for d in storage.list_documents()]


@mcp.tool()
def senaryo_metni(belge_id: str | None = None, baslangic: int = 0, adet: int = 400) -> dict:
    """Senaryonun paragraflarını numaralarıyla döndürür (bulgu_ekle'de bu numaraları kullan).
    belge_id verilmezse en son yüklenen belge kullanılır."""
    doc = _doc_or_latest(belge_id)
    texts = docx_io.read_text_paragraphs(doc["stored_path"])
    part = [{"paragraf": i, "metin": t} for i, t in enumerate(texts) if t.strip()][baslangic:baslangic + adet]
    return {"belge_id": doc["id"], "ad": doc["name"], "toplam_paragraf": len(texts), "paragraflar": part}


@mcp.tool()
def bulgulari_listele(belge_id: str | None = None, durum: str = "bekliyor") -> list[dict]:
    """Bir belgedeki önerileri listeler. durum: bekliyor | kabul | red | tum"""
    doc = _doc_or_latest(belge_id)
    return [_finding_view(f) for f in storage.list_findings(doc["id"], None if durum == "tum" else durum)]


@mcp.tool()
def bulgu_ekle(belge_id: str, paragraf: int, alinti: str, oneriler: list[str], neden: str,
               kategori: str = "diğer", ciddiyet: str = "orta", bellek_kaynagi: str = "") -> dict:
    """Senaryoda bir sorunu ya da iyileştirme fırsatını işaretler. 'alinti' paragraftan harfi harfine, mümkün olan en
    kısa parça olmalı; 'oneriler' alıntının yerine doğrudan yazılacak 1-3 alternatif (tamamen silmek için "").
    ciddiyet: dusuk (iyileştirme) | orta | yuksek. İlk öneri Bellek'teki bir ekip düzeltmesine dayanıyorsa
    bellek_kaynagi'na o bölümün adını yaz (ör. "KUCHO-S1E51-DışSes-Senaryo"); arayüzde "Bellek" rozetiyle görünür."""
    doc = _doc_or_latest(belge_id)
    texts = docx_io.read_text_paragraphs(doc["stored_path"])
    if not 0 <= paragraf < len(texts):
        raise ValueError("Paragraf numarası geçersiz")
    text = texts[paragraf]
    pos = text.find(alinti)
    if pos < 0:
        pos = tr_lower(text).find(tr_lower(alinti))
    if pos < 0:
        raise ValueError(f"Alıntı {paragraf}. paragrafta bulunamadı. Paragraf: {text!r}")
    sugg = [{"text": t, "kaynak": "bellek" if (i == 0 and bellek_kaynagi) else "claude",
             "ref": bellek_kaynagi if i == 0 else ""} for i, t in enumerate(oneriler)]
    f = storage.add_finding(doc["id"], paragraf, pos, pos + len(alinti), text[pos:pos + len(alinti)], sugg,
                            category=kategori, reason=neden, severity=ciddiyet, source="mcp")
    return _finding_view(f)


@mcp.tool()
def oneri_uygula(bulgu_id: str, metin: str | None = None, oneri_no: int = 0) -> dict:
    """Bir öneriyi kabul eder. 'metin' verilirse o yazılır; verilmezse önerilerden oneri_no sıradaki (0'dan) seçilir."""
    f = storage.get_finding(bulgu_id)
    if not f:
        raise ValueError("Bulgu bulunamadı")
    if metin is None:
        if not f["suggestions"]:
            raise ValueError("Bu bulgunun hazır önerisi yok; 'metin' verin.")
        metin = f["suggestions"][min(max(oneri_no, 0), len(f["suggestions"]) - 1)]
    return _finding_view(service.decide(bulgu_id, "kabul", metin))


@mcp.tool()
def bulgu_reddet(bulgu_id: str) -> dict:
    """Bir öneriyi yok sayar (senaryoda değişiklik yapılmaz)."""
    res = service.decide(bulgu_id, "red")
    if not res:
        raise ValueError("Bulgu bulunamadı")
    return _finding_view(res)


@mcp.tool()
def export_al(belge_id: str | None = None, izlenen_degisiklik: bool = False, hedef_yol: str | None = None) -> dict:
    """Kabul edilen değişiklikleri uygulayıp .docx üretir. Belge orijinal dosyanın üzerine işlendiği için biçim
    (Fransız senaryo formatı, stiller, girintiler) aynen korunur. belge_id yoksa en son yüklenen belge kullanılır.
    izlenen_degisiklik=True ise değişiklikler Word'de 'Değişiklikleri İzle' olarak görünür."""
    doc = _doc_or_latest(belge_id)
    res = service.export(doc["id"], tracked=izlenen_degisiklik, dest=Path(hedef_yol).expanduser() if hedef_yol else None)
    return {"dosya": res["path"], "uygulanan": res["applied"], "bekleyen_oneri": res["pending"],
            "atlanan": res["skipped"]}


@mcp.tool()
def kural_ekle(ifade: str, yerine: list[str], tur: str = "kelime", kategori: str = "argo", neden: str = "") -> dict:
    """Kalıcı kural ekler. tur: kelime (tam kelime) | kok (kök + ekleri, ör. kudur -> kudurdu) | ifade (çok kelimeli)."""
    return storage.add_rule(ifade, yerine, tur, kategori, neden, source="manuel")


@mcp.tool()
def kurallari_listele(durum: str = "aktif") -> list[dict]:
    """Kuralları listeler. durum: aktif | aday (öğrenilmiş, onay bekleyen) | tum"""
    rules = storage.list_rules(None if durum == "tum" else durum)
    return [{"kural_id": r["id"], "ifade": r["pattern"], "yerine": r["replacements"], "tur": r["match_type"],
             "kategori": r["category"], "kaynak": r["source"], "durum": r["status"], "ornek": r["example"]}
            for r in rules]


@mcp.tool()
def kural_onayla(kural_id: str, yerine: list[str] | None = None) -> dict:
    """Öğrenilmiş (aday) bir kuralı aktif yapar; istenirse önerilerini günceller."""
    r = storage.update_rule(kural_id, status="aktif", replacements=yerine)
    if not r:
        raise ValueError("Kural bulunamadı")
    return r


@mcp.tool()
def kural_sil(kural_id: str) -> str:
    """Bir kuralı siler."""
    storage.delete_rule(kural_id)
    return "silindi"


@mcp.tool()
def surumlerden_ogren(eski: str, yeni: str) -> dict:
    """Aynı senaryonun eski ve düzeltilmiş sürümünü karşılaştırıp değiştirilen ifadeleri kural adayı olarak öğrenir.
    'eski' ve 'yeni' bir belge_id ya da .docx dosya yolu olabilir."""
    def resolve(x):
        d = storage.get_document(x)
        return d["stored_path"] if d else str(Path(x).expanduser())
    n = service.learn_from_versions(resolve(eski), resolve(yeni))
    return {"ogrenilen": n, "adaylar": kurallari_listele("aday")}


@mcp.tool()
def inceleme_yonergesi() -> str:
    """Bir senaryoyu incelemeden ÖNCE bunu çağır. Ekibin editör yönergesini, kural listesini ve Bellek'teki
    geçmiş notları (ekibin neye not düştüğü ve nasıl düzelttiği) tek metin olarak verir. İncelemeyi bu
    yönergeye göre, titizlikle ve paragraf paragraf yap; her bulguyu bulgu_ekle ile kaydet."""
    from senaryo_asistani import ai

    parts = [b["text"] for b in ai.build_system()]
    parts.append(
        "MCP ile çalışma şekli:\n"
        "- senaryo_metni ile metni parça parça oku (ör. 120 paragraflık aralıklar), her aralığı ayrıntılı incele.\n"
        "- Her sorun ve iyileştirme fırsatı için bulgu_ekle çağır; 'alinti' paragraftan harfi harfine en kısa parça.\n"
        "- Öneri Bellek'teki bir düzeltmeye dayanıyorsa bellek_kaynagi'na o bölümün adını yaz.\n"
        "- Kural taraması zaten yapılmıştır: bulgulari_listele ile mevcutları görüp tekrar ekleme.\n"
        "- Sonunda kullanıcıya bulguların özetini sun; onayladıklarını oneri_uygula ile uygula, sonra export_al.")
    return "\n\n".join(parts)


@mcp.tool()
def bellege_yukle(dosya_yollari: list[str]) -> dict:
    """Ekibin notlu senaryolarını ('-commented' adlı, Word yorumlu) ve son hâllerini belleğe ekler.
    Aynı bölümün iki dosyası adından eşleştirilir; her not, işaret ettiği kısım ve son hâlde nasıl
    düzeltildiği ile birlikte 'ders' olarak saklanır. Bir klasör yolu da verilebilir (içindeki tüm .docx)."""
    from senaryo_asistani import memory

    paths: list[Path] = []
    for p in dosya_yollari:
        p = Path(p).expanduser()
        paths += sorted(p.glob("*.docx")) if p.is_dir() else [p]
    out = []
    for p in paths:
        if p.suffix.lower() != ".docx" or p.name.startswith("~$") or not p.exists():
            continue
        out.append({"dosya": p.name, **memory.ingest_file(p, p.name)})
    return {"yuklenen": out, "toplam_ders": len(storage.list_lessons())}


@mcp.tool()
def bellek_notlari(kategori: str | None = None, arama: str | None = None, en_fazla: int = 60) -> dict:
    """Bellekteki ekip notlarını (dersleri) döndürür. Bir senaryoyu incelemeden önce bunu oku: ekibin hangi
    durumlara not düştüğünü ve nasıl düzelttiğini gösterir. kategori/arama ile süzülebilir."""
    lessons = storage.list_lessons(active_only=True)
    if kategori:
        lessons = [l for l in lessons if l["category"] == kategori]
    if arama:
        q = tr_lower(arama)
        lessons = [l for l in lessons if q in tr_lower(l["note"] + " " + l["anchor"])]
    cats: dict[str, int] = {}
    for l in storage.list_lessons(active_only=True):
        cats[l["category"]] = cats.get(l["category"], 0) + 1
    return {
        "kategoriler": cats,
        "notlar": [{"bolum": l["source_name"], "kategori": l["category"], "not": l["note"],
                    "isaretlenen": l["anchor"], "duzeltme": l["changes"], "sonuc": l["outcome"]}
                   for l in lessons[:en_fazla]],
    }


@mcp.tool()
def yeniden_tara(belge_id: str | None = None, claude_api_ile: bool = False) -> dict:
    """Güncel kurallarla belgeyi yeniden tarar (bekleyen eski kural bulguları yenilenir)."""
    doc = _doc_or_latest(belge_id)
    n = service.scan_rules(doc["id"])
    if claude_api_ile and service.ai_ready():
        n += service.scan_ai(doc["id"])
    return {"belge_id": doc["id"], "bulgu": n, "bulgular": bulgulari_listele(doc["id"])}


if __name__ == "__main__":
    mcp.run()
