"""Claude ile bağlamsal senaryo denetimi.

Kural listesi "ha", "kudur" gibi bilinen kelimeleri yakalar; Claude ise listede
olmayan ama çocuklar için uygunsuz olan durumları (taklit edilebilir tehlikeli
eylemler, zorbalık, kötü örnek davranışlar...) bağlamdan anlar. Ekibin daha
önce yaptığı düzeltmeler örnek olarak verilir; böylece önerileri ekibin
üslubuna benzer.
"""
from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor

import anthropic

from . import storage

FALLBACK_BETA = "server-side-fallback-2026-07-01"

SYSTEM_PROMPT = """Sen çocuklara yönelik animasyon dizileri için çalışan deneyimli bir senaryo editörüsün.
Yapımcı/kanal ekibinin senaryolara düştüğü notların aynısını, aynı bakış açısıyla önceden yakalamak
istiyoruz. Görevin, sana verilen senaryoda ekibin işaretleyeceği yerleri bulmak ve sahnenin anlamını,
karakterin sesini ve hikâyenin akışını bozmadan düzeltme önermek.

Neleri işaretlemelisin:
- Çocuk güvenliği: çocukların taklit edebileceği tehlikeli eylemler (kablo kesmek, prize dokunmak,
  kulağın dibinde yüksek ses, ağzı doluyken uyumak, kapalı kutuda nefessiz kalmak...). Güvenli
  bir eylemle değiştir (ör. "kırmızı kabloyu kes" -> "kırmızı butona bas").
- Kötü örnek davranış: çocukların taklit edebileceği her türlü olumsuz davranış. Örnekler:
  "mini bir trompeti Keday'ın kulağının dibinde çalmaya başlar" (kulağın dibinde müzik aleti çalmak),
  "Kahveyi Keday'ın ağzına döker" (zorla içirme ya da üstüne bilerek dökme izlenimi),
  "Keday'ın kafasını buz dolu kaseye daldırıp çıkarır" (birinin kafasını zorla bir şeye daldırmak),
  kandırmak, eşyaları fırlatmak, saygısızlık, kural çiğnemeyi özendirmek. Davranışı, sahnenin
  amacını koruyan güvenli bir davranışla değiştir.
- Şiddet / sert söylem, tehdit; hakaret ve alay (ör. "kuş beyinli", burunla dalga geçmek).
- Argo / kaba dil ve yasaklı kelimeler; argo deyimleri de yakala ("gaza gelip" -> "iyice havaya girip",
  "kafayı yemek" -> "çılgına dönmek", "kral" hitabı, "kanka", "efsane!"). Ekip "ya / be / he" gibi nidaları ve cümle sonundaki
  vurgulu "ha"yı ("...mü ha?") kaba buluyor. AMA gülme ("Ha ha ha!"), hecelenmiş kelime ("Ha-tır-la")
  ve cümle başındaki anlama ünlemi ("Ha, o mu?", "Ha şimdi anladım!") sorun DEĞİLDİR.
- Uygunsuz çağrışım: uyuşturucu izlenimi veren görüntüler (helezon gözler), ilişki/evlilik,
  fal/büyü, dövme/piercing, politik göndermeler, müstehcen çağrışımlı espriler.
- Yaş grubuna uygunluk: hedef kitlenin anlayamayacağı kavramlar.
- Telif / reklam / RTÜK: gerçek marka ve mekân adları (reklam sayılır), film/eser göndermeleri.
- Yabancı kelimeler: Türkçesini öner ("Önce bir star gibi yaşayacaksın" -> "Önce bir dünya yıldızı gibi
  yaşayacaksın", "One" -> "Bir", "Yey" -> "Yaşasın", "cool" -> "havalı").
- Fazlalık / gereksiz uzatma: aynı anlamı daha kısa veren ifade ("yalı dairene" -> "yalına",
  "tekrar yeniden" -> "yeniden"), gereksiz tekrar eden kelimeler.
- Kelime seçimi ve üslup: daha doğru/açık ifade,
  daha doğru/açık ifade.
- Dil bilgisi ve yazım hataları (TDK yazımı: "herkez" -> "herkes", "tabi ki" -> "tabii ki", ayrı/bitişik
  yazılan "de/da", "ki", "mi" ekleri, yanlış ek kullanımı: "kostümleri" -> "kostümlerini").
- Tekrar / fazla kullanım: aynı kelime ya da replik çok tekrarlanıyorsa.
- Mantık / tutarlılık: sahneler arası çelişki, sebebi açıklanmayan durumlar, sinopsis ile hikâye
  uyumsuzluğu, atlanan sahne numaraları, eksik şarkı sözleri.

Kurallar:
- Ekibin geçmiş notları aşağıda verilmişse, onların hassasiyetini ve önerme biçimini örnek al.
- TİTİZ ol: verilen aralıktaki her paragrafı tek tek, satır satır incele. Ekibin işaretleyeceği her
  sorunu VE senaryoyu iyileştirecek her fırsatı (fazlalık, yabancı kelime, yazım, daha akıcı/çocuğa
  uygun ifade) işaretle. Kesin sorunlarda severity "orta" ya da "yuksek", iyileştirme önerilerinde
  "dusuk" kullan. Bir sahnede birden çok sorun varsa her birini ayrı bulgu yap.
- Açıkça zararsız olanları işaretleme: gülme ("Ha ha ha!"), karakter adları, sahne başlıkları.
- "quote" alanı, paragraf metninden HARFİ HARFİNE kopyalanmış, olabildiğince kısa bir parça olmalı
  (yalnızca değişmesi gereken kelime ya da ifade; tüm cümle değil).
- "suggestions": her öneri bir nesne: "text" quote'un yerine doğrudan yazılacak metin; "kaynak" ve "ref".
  * Bellek'te aynı ya da çok benzer bir duruma ekibin yaptığı bir düzeltme varsa, önce onu uyarlayarak
    öner: kaynak "bellek", ref = o notun geldiği bölüm adı (ör. "KUCHO-S1E51-DışSes-Senaryo").
  * Ayrıca sahnenin amacını, karakterin sesini ve hikâyenin akışını koruyarak boşluğu dolduran kendi
    önerini ver: kaynak "yeni", ref "". Bir eylemi değiştiriyorsan hikâyede aynı işlevi gören güvenli bir
    eylem seç (ör. kablo kesmek yerine butona basmak; ikisi de makineyi durdurur).
  Toplam 1-3 öneri; her biri cümlenin geri kalanıyla dilbilgisi olarak uyumlu olmalı. Tamamen çıkarmak en iyisiyse önerilerden biri "" olabilir. Sorun metin
  değişikliğiyle çözülemiyorsa (ör. şarkı sözü eksik, sahne yeniden kurgulanmalı) boş liste ver
  ve ne yapılması gerektiğini "reason"da yaz.
- "reason": ekibin not üslubunda kısa, net Türkçe açıklama (ör. "Taklit edilebilir olumsuz örnek.
  Vuvuzelayı kulağının dibinde çalmamalı.").
- Karakter adları, sahne başlıkları ve teknik yönergeler (CUT, geniş plan) kendi başına sorun değildir."""

CATEGORIES = [
    "çocuk güvenliği", "kötü örnek davranış", "şiddet / sert söylem", "hakaret / alay", "argo / kaba dil",
    "uygunsuz çağrışım", "yaş grubuna uygunluk", "telif / reklam / RTÜK", "kelime seçimi / üslup",
    "dil bilgisi / yazım", "tekrar / fazla kullanım", "mantık / tutarlılık",
    "fazlalık / gereksiz uzatma", "yabancı kelime", "iyileştirme", "diğer",
]

SCHEMA = {
    "type": "object",
    "properties": {
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "paragraph": {"type": "integer"},
                    "quote": {"type": "string"},
                    "category": {"type": "string", "enum": CATEGORIES},
                    "severity": {"type": "string", "enum": ["dusuk", "orta", "yuksek"]},
                    "reason": {"type": "string"},
                    "suggestions": {"type": "array", "items": {
                        "type": "object",
                        "properties": {
                            "text": {"type": "string"},
                            "kaynak": {"type": "string", "enum": ["bellek", "yeni"]},
                            "ref": {"type": "string"},
                        },
                        "required": ["text", "kaynak", "ref"],
                        "additionalProperties": False,
                    }},
                },
                "required": ["paragraph", "quote", "category", "severity", "reason", "suggestions"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["findings"],
    "additionalProperties": False,
}

ALT_SCHEMA = {
    "type": "object",
    "properties": {"suggestions": {"type": "array", "items": {
        "type": "object",
        "properties": {
            "text": {"type": "string"},
            "kaynak": {"type": "string", "enum": ["bellek", "yeni"]},
            "ref": {"type": "string"},
        },
        "required": ["text", "kaynak", "ref"],
        "additionalProperties": False,
    }}},
    "required": ["suggestions"],
    "additionalProperties": False,
}


class AIUnavailable(RuntimeError):
    pass


def _client(cfg: dict) -> anthropic.Anthropic:
    key = (cfg.get("api_key") or "").strip()
    try:
        return anthropic.Anthropic(api_key=key) if key else anthropic.Anthropic()
    except Exception as e:  # kimlik bilgisi yok
        raise AIUnavailable("Claude API anahtarı bulunamadı. Ayarlar sekmesinden ekleyin.") from e


def available(cfg: dict | None = None) -> bool:
    cfg = cfg or storage.load_config()
    if not cfg.get("ai_enabled", True):
        return False
    try:
        _client(cfg)
        return True
    except AIUnavailable:
        return False


def _house_examples(limit: int = 60) -> str:
    rules = [r for r in storage.list_rules("aktif") if r["replacements"] and r["match_type"] != "desen"]
    rules.sort(key=lambda r: (r["source"] != "ogrenilen", -r["hits"]))
    lines = []
    for r in rules[:limit]:
        reps = " | ".join(f'"{x}"' if x else "(kaldır)" for x in r["replacements"][:3])
        lines.append(f'- "{r["pattern"]}" -> {reps}  [{r["category"]}]')
    return "\n".join(lines)


def build_system() -> list[dict]:
    """Sistem istemi + kural örnekleri + Bellek'teki ekip notları.

    Bellek bölümü uzun olabildiği için önbelleğe alınır; aynı belge parçalarında tekrar ödenmez.
    """
    from . import memory

    blocks = [{"type": "text", "text": SYSTEM_PROMPT}]
    extra = []
    examples = _house_examples()
    if examples:
        extra.append("Ekibin kural listesi (bu ifadeler görüldüğünde benzer öneriler ver):\n" + examples)
    lessons = memory.prompt_examples()
    if lessons:
        extra.append("BELLEK — ekibin geçmiş senaryolara düştüğü notlar ve yaptığı düzeltmeler. Yeni senaryoda "
                     "aynı türden durumları aynı hassasiyetle işaretle; bölüme özgü notları (ör. belirli bir "
                     "karakterin adı) genelleme:\n\n" + lessons)
    if extra:
        blocks.append({"type": "text", "text": "\n\n".join(extra), "cache_control": {"type": "ephemeral"}})
    return blocks


def _call_json(client, cfg: dict, system, user, schema: dict, max_tokens: int = 64000,
               effort: str = "medium") -> dict | None:
    with client.beta.messages.stream(
        model=cfg.get("model") or "claude-opus-5-5",
        max_tokens=max_tokens,
        system=system,
        betas=[FALLBACK_BETA],
        fallbacks="default",
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
        messages=[{"role": "user", "content": user}],
    ) as stream:
        msg = stream.get_final_message()
    if msg.stop_reason == "refusal":
        return None
    text = next((b.text for b in msg.content if b.type == "text"), None)
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None  # max_tokens ile kesilmiş olabilir


def _chunks(paras: list[tuple[int, str]], max_chars: int = 9000):
    # Büyük parçalar: tutarlılık/sahne numarası/tekrar kontrolleri için senaryonun bütünü görülmeli
    cur, size = [], 0
    for idx, text in paras:
        if cur and size + len(text) > max_chars:
            yield cur
            cur, size = [], 0
        cur.append((idx, text))
        size += len(text) + 10
    if cur:
        yield cur


def analyze(paragraph_texts: list[str], progress=None) -> list[dict]:
    """Senaryoyu Claude'a inceletir; konumu doğrulanmış bulgular döndürür.

    Senaryonun tamamı her istekte (önbelleğe alınmış olarak) verilir; böylece Claude tutarlılık ve tekrarları
    görebilir. Ama her istekte yalnızca küçük bir paragraf aralığını ayrıntılı incelemesi istenir — tek seferde
    tüm senaryoyu istemek, uzun metinlerde bulguların gözden kaçmasına yol açıyor.
    """
    cfg = storage.load_config()
    client = _client(cfg)
    system = build_system()  # yönerge + kurallar + Bellek'teki ekip notları
    paras = [(i, t) for i, t in enumerate(paragraph_texts) if t.strip()]
    chunks = list(_chunks(paras))
    full = "\n".join(f"[{i}] {t}" for i, t in paras)
    script_block = {"type": "text", "text": "<senaryo>\n" + full + "\n</senaryo>",
                    "cache_control": {"type": "ephemeral"}}
    done = 0

    def run(chunk):
        a, b = chunk[0][0], chunk[-1][0]
        ask = (f"Yukarıdaki senaryonun YALNIZCA [{a}] ile [{b}] arasındaki paragraflarını ayrıntılı incele "
               "(sahne bağlamı için senaryonun geri kalanına bakabilirsin). Paragraf başındaki [sayı] paragraf "
               "numarasıdır; bulgularda bu numarayı kullan. Bu aralıkta bulduğun her sorunu ve iyileştirme "
               "fırsatını listele.")
        content = [script_block, {"type": "text", "text": ask}]
        return _call_json(client, cfg, system, content, SCHEMA, effort="high") or {"findings": []}

    datas = []
    if chunks:
        datas.append(run(chunks[0]))  # ilk istek önbelleği doldurur, diğerleri ondan okur
        done = 1
        if progress:
            progress(done, len(chunks))
    with ThreadPoolExecutor(max_workers=4) as ex:
        for data in ex.map(run, chunks[1:]):
            datas.append(data)
            done += 1
            if progress:
                progress(done, len(chunks))

    from .matcher import tr_lower

    results: list[dict] = []
    for data in datas:
        for f in data.get("findings", []):
            pi = f.get("paragraph")
            quote = (f.get("quote") or "").strip()
            if not isinstance(pi, int) or pi < 0 or pi >= len(paragraph_texts) or not quote:
                continue
            text = paragraph_texts[pi]
            pos = text.find(quote)
            if pos < 0:
                pos = tr_lower(text).find(tr_lower(quote))
            if pos < 0:
                continue
            f["start"], f["end"] = pos, pos + len(quote)
            f["original"] = text[pos:pos + len(quote)]
            f["suggestions"] = _suggestion_objects(f.get("suggestions", []))
            results.append(f)
    return results


def _suggestion_objects(items: list) -> list[dict]:
    out = []
    for it in items:
        if isinstance(it, str):
            it = {"text": it, "kaynak": "yeni", "ref": ""}
        out.append({"text": it.get("text", ""), "kaynak": "bellek" if it.get("kaynak") == "bellek" else "claude",
                    "ref": it.get("ref", "") if it.get("kaynak") == "bellek" else ""})
    return out


def alternatives(original: str, paragraph_text: str, reason: str = "", existing: list[str] | None = None) -> list[dict]:
    cfg = storage.load_config()
    client = _client(cfg)
    user = (f"Paragraf: {paragraph_text}\n\nDeğiştirilecek kısım: \"{original}\"\n"
            f"Neden: {reason or '-'}\n"
            f"Zaten önerilenler: {json.dumps(existing or [], ensure_ascii=False)}\n\n"
            "Bu kısmın yerine yazılabilecek, çocuklara uygun, cümleye dilbilgisi olarak oturan 3 YENİ alternatif ver. "
            "Bellek'te benzer bir düzeltme varsa birini ona dayandır (kaynak 'bellek'); diğerleri hikâyeyi bozmadan "
            "sahneyi tamamlayan kendi önerilerin olsun (kaynak 'yeni').")
    data = _call_json(client, cfg, build_system(), user, ALT_SCHEMA, max_tokens=8000)
    return [x for x in _suggestion_objects((data or {}).get("suggestions", [])) if x["text"] not in (existing or [])]
