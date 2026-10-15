# Senaryo Asistanı

Çocuk çizgi filmi senaryolarındaki uygunsuz ifadeleri (argo, hakaret, şiddet,
taklit edilebilir tehlikeli eylemler, kötü örnek davranışlar) bulan, yerine
öneri sunan, ekibin yaptığı düzeltmelerden öğrenen ve senaryoyu **orijinal
.docx biçimini (Fransız formatı dahil) bozmadan** geri veren masaüstü aracı.
Aynı veriler bir **MCP sunucusu** üzerinden Claude Desktop / Claude Code ile de
kullanılabilir. Windows ve macOS'ta çalışır.

> **Ekip olarak kullanmak** (herkes aynı Bellek ve senaryoları görsün, kurulum gerekmesin):
> [EKIP-KURULUMU.md](EKIP-KURULUMU.md)

## Kurulum ve çalıştırma

Gerekli: Python 3.10 veya üzeri (https://www.python.org/downloads/).
macOS'ta `python3` genelde hazır gelir.

| Sistem  | Nasıl açılır |
|---------|--------------|
| Windows | `baslat.bat` dosyasına çift tıklayın |
| macOS   | `baslat.command` dosyasına çift tıklayın (ilk seferde sağ tık → Aç). Gerekirse terminalde bir kez: `chmod +x baslat.command` |

İlk açılışta gerekli paketler `.venv` klasörüne kurulur; ardından uygulama
tarayıcıda `http://127.0.0.1:8765` adresinde açılır. Uygulama yalnızca sizin
bilgisayarınızda çalışır, dışarıya açık değildir.

## Pencereler

**Senaryo Geliştirme**
- Sol alana istediğiniz kadar .docx sürükleyip bırakın.
- Belge yüklendiği anda:
  1. Belgede Word'ün *Değişiklikleri İzle* işaretleri varsa “silinen → eklenen”
     çiftleri öğrenilir (ör. “kırmızı kabloyu kes” → “kırmızı butona bas”).
  2. Aynı senaryonun daha önce yüklenmiş bir sürümü varsa iki sürüm otomatik
     karşılaştırılır ve değiştirilen ifadeler öğrenilir.
  3. Kural listesiyle taranır (“ha”, “kudur…”, “lan”…).
  4. Claude açıksa bağlamsal inceleme yapılır (listede olmayan sorunlar).
- Sağda her bulgu için *“Senaryodaki bu kısım uygun değil — yerine şunu koyabilirsin”*
  kartı çıkar: hazır önerilerden birini seçin, kendi versiyonunuzu yazın,
  “Claude'dan başka öneri” isteyin ya da yok sayın.
- Metinde fareyle bir kısmı seçip **“Bu kısmı işaretle”** diyerek elle bulgu ekleyebilirsiniz.
- **Revize önizleme** ile kabul edilenler uygulanmış hâli görebilirsiniz.

**Bellek** — asistanın ekibinizden öğrendiği yer.
- Notlu senaryoları (adında `commented` geçen, Word notlu dosyalar) ve son hâllerini buraya
  bırakın; tek tek, toplu ya da **Klasör seç** ile bütün bir klasör olarak.
- `KUCHO-S1E51-DışSes-Senaryo-commented.docx` ile `KUCHO-S1E51-DışSes-Senaryo.docx` adlarından
  otomatik eşleşir (büyük/küçük harf fark etmez).
- Her not bir "ders" olur: notun metni (ör. *“Taklit edilebilir olumsuz örnek / davranış.
  Vuvuzelayı kulağının dibinde olmayacak şekilde çalmalı”*), işaret ettiği kısım ve son hâlde
  ekibin yaptığı düzeltme (*“kulağının dibinde” çıkarıldı*).
- Son hâldeki ikinci tur notlar da öğrenilir. Son hâli henüz gelmemiş bölümlerin notları yine kullanılır.
- Notlar kategorilere ayrılır (çocuk güvenliği, kötü örnek davranış, argo/kaba dil, uygunsuz çağrışım,
  telif/reklam/RTÜK, dil bilgisi, tutarlılık…). Kategori düzeltilebilir; bölüme özgü notlar
  (ör. karakterin yeniden adlandırılması) "Öğrenmede kullan" kutusundan kapatılabilir.
- Claude, Senaryo Geliştirme'de yüklediğiniz yeni senaryoyu bu notların hassasiyetiyle inceler.
  Bellek bu yüzden en çok Claude açıkken işe yarar; Claude kapalıyken yalnızca kural listesi çalışır.
  Bir düzeltmeyi her senaryoda aranacak kalıcı kurala çevirmek için "Kural yap"a basın.
- Otomatik çıkarılan düzeltme yanlış ya da eksikse (ör. "köpek → şey"), satıra tıklayıp doğrusunu
  kendiniz yazın ("şanslı köpek → şanslı köpecik") ve **Kaydet ve öğren**'e basın. Asistan bundan
  sonra sizin yazdığınızı esas alır: Claude'a "editörün onayladığı düzeltme" olarak verilir, açık
  senaryolardaki öneriler ve bu düzeltmeden yapılmış kurallar kendiliğinden güncellenir; dosyalar
  belleğe yeniden yüklense de elle yazdığınız korunur.

**Hazır kural setleri** (Claude olmadan da çalışır, Kurallar sekmesinden düzenlenebilir)
- *Yabancı kelimeler* → Türkçesi: star → yıldız / dünya yıldızı, cool → havalı, wow → vay…
  ("star’a" → "yıldıza" gibi ekli hâller de)
- *Fazlalık / gereksiz uzatma*: "yalı dairene" → "yalına", "tekrar yeniden" → "yeniden"…
- *Kötü örnek davranış kalıpları*: kulağının dibinde çalmak, ağzına dökmek, kafasını bir şeye
  daldırmak, tokat/tekme/çelme, prize dokunmak, camdan sarkmak…
- *Argo deyimler*: "gaza gelip" → "iyice havaya girip", "kafayı yemek" → "çılgına dönmek", kanka, oha…
- *Yazım hataları*: herkez → herkes, tabiki → tabii ki, birşey → bir şey, yanlız → yalnız…
- *Nidalar*: "he" her yerde, "ha" cümle sonunda işaretlenir (gülme "Ha ha!" hariç).

Kurallar yalnızca bilinen kalıpları yakalar. Mantık hataları, tutarsızlıklar, kurallarda olmayan kötü
örnekler ve genel iyileştirme önerileri için **Ayarlar**'dan Claude API anahtarı girin: Claude her
senaryoyu Bellek'teki ekip notlarıyla birlikte, küçük parçalar hâlinde satır satır inceler.

**Kurallar & Öğrenilenler** — öğrenilen değişiklikleri onaylayın/düzenleyin,
iki sürümü elle karşılaştırın, yeni kural ekleyin. Kural türleri:
- *Tam kelime*: “ha” yakalanır, “hava” yakalanmaz.
- *Bağlama bağlı* (ha, he, be): gülme (“Ha ha ha!”), hecelenmiş kelime (“Ha-tır-la”) ve cümle
  başındaki ünlem (“Ha, o mu?”) işaretlenmez; yalnızca cümle sonundaki kaba vurgu
  (“…mü ha?”, “güzelmiş he”) düşük önemle işaretlenir.
- *Kök + ekler*: “kudur” → kudurdu, kuduruyor, kudurmuş; öneri eki ünlü uyumuyla taşır
  (“kudurdun mu” → “sinirlendin mi”).
- *İfade*: birden çok kelime (“kırmızı kabloyu kes”).

**Export** — varsayılan olarak en son yüklenen belge seçilidir.
- *Temiz kopya*: kabul edilenler doğrudan metne işlenir.
- *İzlenen değişikliklerle*: değişiklikler Word'de “Değişiklikleri İzle” olarak gelir.

Export, yüklediğiniz dosyanın kendisi üzerinde yapılır: yalnızca değiştirilen
kelimelerin metni değişir; sayfa yapısı, yazı tipleri, karakter adı / diyalog /
didaskali girintileri, stiller, üst/alt bilgiler birebir korunur.

**Ayarlar** — Claude API anahtarı (https://console.anthropic.com), model,
otomatik öğrenme ve izlenen değişikliklerde görünecek yazar adı. API anahtarı
olmadan kural tabanlı tarama ve öğrenme yine çalışır.

## MCP (Claude Desktop / Claude Code)

API anahtarı gerekmez: inceleme Claude Desktop'taki Claude hesabınızla yapılır.

1. Uygulamayı en az bir kez `baslat.bat` / `baslat.command` ile açın (gerekli paketler `.venv`'e kurulur).
2. Proje klasöründe şu komutu çalıştırın (Windows: `.venv\Scripts\python mcp_kur.py`,
   macOS: `.venv/bin/python mcp_kur.py`). Komut Claude Desktop ayar dosyasına `senaryo-asistani`
   sunucusunu ekler; önce yedek alır, diğer ayarlara dokunmaz. Microsoft Store'dan kurulan Claude
   Desktop'ın paket içindeki ayar dosyası da güncellenir.
3. Claude Desktop'ı tamamen kapatıp (görev çubuğu simgesi → Quit) yeniden açın.
4. Sohbette örneğin: *"Senaryo asistanıyla İndirilenler'deki KUCHO-S1E53-Senaryo.docx'i incele."*
   Claude önce `inceleme_yonergesi` ile ekibin yönergesini ve Bellek notlarını okur, senaryoyu parça parça
   inceler, bulguları kaydeder. Bulgular masaüstü uygulamasında da (Senaryo Geliştirme) görünür; orada
   kabul edip export alabilirsiniz.

MCP araçları: `senaryo_yukle`, `senaryolari_listele`, `senaryo_metni`,
`bulgulari_listele`, `bulgu_ekle`, `oneri_uygula`, `bulgu_reddet`, `export_al`,
`kural_ekle`, `kurallari_listele`, `kural_onayla`, `kural_sil`,
`surumlerden_ogren`, `yeniden_tara`, `bellege_yukle` (dosya ya da klasör), `bellek_notlari`,
`inceleme_yonergesi`.

Örnek: Claude Desktop'ta *“Masaüstündeki Bolum14.docx'i yükle, çocuklara uygun
olmayan yerleri bul, bana seçenekleri sun, onayladıklarımla izlenen
değişiklikli export al.”*

Masaüstü uygulaması ve MCP aynı veri klasörünü kullanır
(`~/.senaryo-asistani`); birinde yapılan her şey diğerinde de görünür.

## Klasör yapısı

```
baslat.py / baslat.bat / baslat.command   uygulamayı kişisel kullanım için açar
sunucu.py, ekip_sunucusu.bat/.command    ekip sunucusu (giriş şifreli, ortak veri, Claude bağlayıcısı)
Dockerfile, render.yaml                  ekip sunucusunu internete koymak için (bkz. EKIP-KURULUMU.md)
mcp_sunucu.py                             MCP sunucusu (stdio)
mcp_kur.py                                Claude Desktop'a ekler
senaryo_asistani/
  docx_io.py      .docx okuma, izlenen değişiklikleri okuma, biçimi koruyan yazma
  matcher.py      kural eşleştirme (Türkçe büyük/küçük harf, ünlü uyumu)
  learn.py        sürüm farkı / izlenen değişikliklerden öğrenme
  memory.py       Bellek: notlu + son hâl eşleştirme, notlardan ders çıkarma
  ai.py           Claude ile bağlamsal inceleme
  service.py      ortak iş akışları
  storage.py      SQLite veri deposu
  auth.py         ekip girişi (sunucu modu)
  backup.py       yedek indirme ve birleştirerek içe aktarma
  app.py          arayüz sunucusu
  static/index.html  arayüz
ornekler/         deneme amaçlı örnek senaryolar
```
