# Mac'te kurulum (bir kez, 2 dakika)

macOS, internetten inen ve Apple imzası olmayan dosyaları ilk açılışta engeller ("hasar görmüş",
"doğrulanamadı" gibi uyarılar). Dosya bozuk değildir; **Çöp Sepeti'ne taşımayın.** İlk açılışı
Terminal'den yapınca bu engel devreye girmez.

1. GitHub'da **Code → Download ZIP** ile indirin. ZIP dosyasına **çift tıklayıp** Mac'in kendi aracıyla
   açın (Cos Zip, The Unarchiver gibi başka programlarla açmayın).
2. **Terminal**'i açın: ⌘ + Boşluk → "Terminal" yazın → Enter.
3. Terminal'e `bash` yazıp **bir boşluk** bırakın.
4. Finder'da açtığınız klasördeki **`baslat.command`** dosyasını Terminal penceresine **sürükleyip bırakın**.
   Satır şuna benzer: `bash /Users/adiniz/Downloads/senaryo-asistani-main/baslat.command`
5. **Enter**'a basın. İlk açılışta Node.js ve paketler kendiliğinden kurulur (birkaç dakika), sonra
   tarayıcıda uygulama açılır.

**Sonraki açılışlarda** `baslat.command` dosyasına çift tıklamanız yeterli; ilk açılış karantina
işaretini kaldırır.

**Giriş:** klasördeki `.env` dosyasını açın (Finder'da gizliyse ⌘ + Shift + . ile gizli dosyaları
gösterin) ve `SENARYO_ERISIM_ANAHTARI=` satırındaki değeri giriş ekranına yapıştırın. Windows'taki
kurulumunuzla aynı anahtarı kullanmak isterseniz oradaki `.env` dosyasını bu klasöre kopyalayın.

## Sorun olursa

- Betik her çalıştığında adımları klasördeki **`baslat-log.txt`** dosyasına yazar. Sorun sürerse bu
  dosyayı ya da Terminal penceresinin ekran görüntüsünü gönderin.
- "Permission denied" görürseniz 3. adımda `bash` yazmayı unutmuşsunuzdur.
- Kurulumu baştan yapmak için klasördeki `node_modules` ve `.node` klasörlerini silip tekrar çalıştırın
  (veriniz `~/.senaryo-asistani` klasöründedir, silinmez).

## Mac'e hiçbir şey kurmadan

Ekip sunucusu kurulursa (bkz. EKIP-KURULUMU.md) Mac'ten yalnızca tarayıcıyla girilir; hiçbir kurulum ve
macOS uyarısı olmaz.
