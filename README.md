# Senaryo Asistanı

Çocuk animasyon senaryolarında uygunsuz ifadeleri (argo, hakaret, şiddet, taklit edilebilir tehlikeli
davranışlar, yabancı kelime, fazlalık, yazım hataları…) bulan; ekibin notlu senaryolarından öğrenen
(**Bellek**), öneri sunan ve senaryoyu **orijinal .docx biçimini (Fransız formatı dahil) bozmadan**
geri veren araç. Aynı veriler **MCP** ile Claude Desktop / claude.ai'den de kullanılır.

> Ekip olarak kullanmak (herkes aynı Bellek ve senaryoları görsün): [EKIP-KURULUMU.md](EKIP-KURULUMU.md)

## Çalıştırma

Gerekli: [Node.js](https://nodejs.org) 22.5+ (LTS önerilir).

| Sistem  | |
|---------|---|
| Windows | `baslat.bat`'a çift tıklayın |
| macOS   | `baslat.command`'a çift tıklayın (ilk seferde sağ tık → Aç; gerekirse `chmod +x baslat.command`) |

İlk açılışta paketler kurulur, `.env` içinde **256 baytlık erişim anahtarı** üretilir ve arayüz
derlenir. Tarayıcıda `http://127.0.0.1:8765` açılır.

**Giriş:** adınızı ve `.env` dosyasındaki `SENARYO_ERISIM_ANAHTARI` değerini girin. Anahtarı bilen
herkes adıyla üye olur (Ayarlar → Üyeler). Anahtarı yenilemek için `npm run anahtar -- --yeni`
(herkesin oturumu kapanır).

Komutlar:

```bash
npm run dev        # geliştirme: API :8765 + Next.js :3000 (sıcak yenileme)
npm run build      # arayüzü derler (frontend/out)
npm start          # API + derlenmiş arayüz
npm run mcp:kur    # Claude Desktop'a yerel MCP sunucusunu ekler
```

## Yapı

```
backend/   Fastify + TypeScript (tsx ile derlemesiz çalışır)
  src/server.ts    API, üyelik, statik arayüz, Claude bağlayıcısı (/baglanti/<gizli>/mcp)
  src/db.ts        SQLite (node:sqlite) — Python sürümüyle aynı şema, veriler ortak
  src/docx.ts      .docx okuma, yorumlar, izlenen değişiklikler, biçimi koruyan yazma
  src/text.ts      Türkçe küçük harf, ünlü uyumu, kural taraması, metin farkı
  src/memory.ts    Bellek: notlu + son hâl eşleştirme, notlardan ders çıkarma
  src/ai.ts        Claude incelemesi (yönerge + kurallar + Bellek, önbellekli)
  src/service.ts   iş akışları  ·  src/backup.ts yedek/birleştirme  ·  src/auth.ts erişim anahtarı
  src/mcp.ts       17 MCP aracı (stdio: mcp-stdio.ts, HTTP: server.ts)
  src/data.json    varsayılan kurallar, Claude yönergesi, kategoriler
frontend/  Next.js (App Router, statik çıktı) — her pencere bir sayfa
  app/page.tsx (Senaryo Geliştirme) · bellek/ · kurallar/ · export/ · ayarlar/ · giris/
eski-python/  önceki Python sürümü (yalnızca başvuru için)
```

## Pencereler (özet)

- **Senaryo Geliştirme:** .docx bırakın; kurallar + Bellek + (varsa) Claude tarar. Karttaki alıntıya
  tıklayınca senaryoda o kısma gidilir ve yerinde düzenlenir; paragrafa çift tıklayıp kendiniz yazabilirsiniz.
  Öneriler kaynağıyla gelir: **Bellek · bölüm**, **Claude**, **Kural**.
- **Bellek:** `-commented` notlu senaryolar + son hâlleri; notlar, işaretlenen kısım ve ekibin düzeltmesiyle
  öğrenilir. Yanlış çıkarılan düzeltmeyi satıra tıklayıp kendiniz yazabilirsiniz.
- **Kurallar:** hazır setler (yabancı kelime, fazlalık, kötü örnek davranış kalıpları, argo, yazım, ha/he/be),
  onay bekleyen öğrenilenler, sürüm karşılaştırma, yeni kural.
- **Export:** temiz ya da izlenen değişiklikli .docx; yalnızca değişen kelimeler değişir.
- **Ayarlar:** Claude API anahtarı (isteğe bağlı), üyeler, Claude bağlayıcı adresi, yedek indir/birleştir.

Veriler `~/.senaryo-asistani` klasöründedir (Python sürümüyle aynı; geçişte hiçbir şey kaybolmaz).
