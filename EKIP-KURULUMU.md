# Senaryo Asistanı — Ekip Kurulumu

Amaç: Ekipte herkes aynı Bellek'i, kuralları ve senaryoları görsün. Siz 52. bölümü eklediğinizde
arkadaşınız da görsün; o 60. bölüme kadar eklediğinde siz de görün.

Bunun için uygulama **tek bir yerde** (ekip sunucusu) çalışır, herkes **tarayıcıdan** aynı adrese girer.
Başka bilgisayarlara hiçbir şey kurmak gerekmez; Windows ya da Mac fark etmez.

İki yol var:

| | A) İnternet sitesi (Render) | B) Ofis bilgisayarı |
|---|---|---|
| Nereden erişilir | Her yerden (ev, ofis, telefon) | Yalnızca ofis ağından |
| Maliyet | Aylık yaklaşık 7–8 $ (sunucu + 1 GB kalıcı disk; güncel fiyat render.com'da) | Ücretsiz |
| Bilgisayar açık kalmalı mı | Hayır | Evet, sunucu bilgisayarı açık kalmalı |
| Claude bağlayıcısı (claude.ai / Claude Desktop) | Çalışır | Çalışmaz (internete açık değil) |
| Kurulum | 15–20 dk, bir kez | 2 dk |

---

## A) İnternet sitesi olarak (önerilen)

### 1. Kodu GitHub'a koyun
1. https://github.com adresinde bir hesap açın (yoksa).
2. Sağ üstte **+ → New repository**. Ad: `senaryo-asistani`, **Private** seçin, oluşturun.
3. Bu klasörü o depoya yükleyin. En kolayı: depo sayfasında **uploading an existing file** bağlantısına
   tıklayıp bu klasördeki dosyaları sürükleyin (`.venv` klasörünü ve `ekip_sifresi.txt`'yi **yüklemeyin**).

### 2. Render'da siteyi açın
1. https://render.com adresinde GitHub hesabınızla giriş yapın.
2. **New + → Blueprint** seçin, `senaryo-asistani` deposunu seçin. Render, depodaki `render.yaml`
   dosyasını okuyup her şeyi kendisi ayarlar.
3. Sizden iki değer ister:
   - **SENARYO_TAKIM_SIFRESI**: siteye giriş şifresi. Güçlü bir şifre belirleyin; ekibe bunu vereceksiniz.
   - **ANTHROPIC_API_KEY**: isteğe bağlı. Girerseniz site, yüklenen her senaryoyu Claude ile otomatik
     inceler. Boş bırakabilirsiniz; Claude Desktop/claude.ai bağlayıcısıyla da inceleme yapılabilir.
4. **Apply** deyin. Birkaç dakika sonra siteniz `https://senaryo-asistani-xxxx.onrender.com` gibi bir
   adreste açılır.

### 3. Mevcut verinizi siteye taşıyın
Bilgisayarınızdaki uygulamada şimdiye kadar biriken Bellek (342+ not), kurallar ve senaryolar kaybolmaz:
1. Kendi bilgisayarınızda uygulamayı açın (`baslat.bat`) → **Ayarlar → Yedeği indir**.
2. Siteye girin → **Ayarlar → Yedek yükle ve birleştir** → indirdiğiniz .zip'i seçin.

Arkadaşınızın bilgisayarında da veri varsa o da aynı şekilde yükler. Veriler **birleşir**; hiçbir şey
silinmez, aynı bölüm iki kez eklenmez.

### 4. Ekibe dağıtın
- Arkadaşlarınıza site adresini ve ekip şifresini verin. Girişte herkes adını yazar; eklediği bölümler ve
  senaryolar adıyla görünür (👤 Ali, 👤 Zümrüt…).
- "Tıkla çalıştır" kolaylığı için: tarayıcıda siteyi açıp **Paylaş → Masaüstüne kısayol** (Edge/Chrome:
  ⋮ → Kaydet ve paylaş → Kısayol oluştur → "Pencere olarak aç") ya da Safari'de **Dosya → Dock'a ekle**.
  Böylece masaüstünde uygulama gibi bir simge olur.

### 5. Claude bağlayıcısı (isteğe bağlı, API anahtarı gerekmez)
1. Sitede **Ayarlar → Ekip bağlantısı → Claude bağlayıcı adresi**'ni kopyalayın.
2. Claude Desktop ya da claude.ai'de **Ayarlar → Bağlayıcılar (Connectors) → Özel bağlayıcı ekle**:
   ad `Senaryo Asistanı`, adres: kopyaladığınız adres.
3. Sohbette: *"Senaryo asistanıyla son yüklenen senaryoyu incele."* Claude'un bulguları sitede herkese görünür.

Bağlayıcı adresini ekip dışına vermeyin: adresi bilen, senaryo araçlarını kullanabilir.

### Yedek
Render diski kalıcıdır, ama yine de ayda bir **Ayarlar → Yedeği indir** ile yedek almanız iyi olur.

---

## B) Ofisteki bir bilgisayarda (ücretsiz)

1. Her zaman açık kalacak bir bilgisayarda bu klasörde **`ekip_sunucusu.bat`** (Mac: `ekip_sunucusu.command`)
   dosyasına çift tıklayın.
2. İlk açılışta bir ekip şifresi belirlemeniz istenir.
3. Pencerede `Aynı ağdaki herkes: http://192.168.x.x:8000` gibi bir adres yazar. Ofisteki herkes bu
   adresi tarayıcısına yazıp ekip şifresiyle girer.
4. Windows "erişime izin verilsin mi" diye sorarsa **Özel ağlar** için izin verin.

Bu yolda bilgisayarınızdaki mevcut veri olduğu gibi kullanılır; taşımaya gerek yoktur. Pencere açık
kaldıkça site çalışır.

---

## Kişisel kullanım hâlâ mümkün
`baslat.bat` / `baslat.command` eskisi gibi yalnızca sizin bilgisayarınızda, giriş istemeden çalışır.
Kişisel kurulumla ekip sitesi arasında veri taşımak için **Ayarlar → Yedeği indir / Yedek yükle ve
birleştir** kullanılır.
