#!/bin/bash
# Senaryo Asistanı — macOS başlatıcı.
# İlk açılış (bir kez): Terminal'e  bash  yazıp bu dosyayı pencereye sürükleyin, Enter'a basın.
# Sonraki açılışlar: dosyaya çift tıklamanız yeterli. Ayrıntı: MAC-KURULUM.md
cd "$(dirname "$0")" || exit 1
NODE_VER=24.20.0
LOG="$PWD/baslat-log.txt"
: > "$LOG"
adim() { echo "▶ $*"; echo "[$(date '+%H:%M:%S')] $*" >> "$LOG"; }
hata() {
  echo; echo "✖ $*"; echo "[$(date '+%H:%M:%S')] HATA: $*" >> "$LOG"
  echo "Ayrıntılar: $LOG  (sorun sürerse bu dosyayı gönderin)"
  echo "Kapatmak için Enter'a basın."; read -r; exit 1
}
{ echo "macOS $(sw_vers -productVersion 2>/dev/null) · $(uname -m) · klasör: $PWD"; } >> "$LOG"

# İndirilen dosyalardaki karantina işaretini kaldır: bundan sonra çift tıklayınca macOS engellemez
xattr -dr com.apple.quarantine . 2>/dev/null
chmod +x baslat.command ekip_sunucusu.command 2>/dev/null

node_ok() { command -v node >/dev/null 2>&1 && node -e "process.exit(+process.versions.node.split('.')[0]>=22?0:1)" 2>/dev/null; }
if [ -x .node/bin/node ]; then
  export PATH="$PWD/.node/bin:$PATH"
elif ! node_ok; then
  ARCH=$(uname -m); [ "$ARCH" = "arm64" ] || ARCH=x64
  N="node-v$NODE_VER-darwin-$ARCH"
  adim "Node.js bulunamadı; bu klasöre indiriliyor (bir kez, yaklaşık 50 MB)..."
  rm -rf "$N" .node
  curl -fL --progress-bar "https://nodejs.org/dist/v$NODE_VER/$N.tar.gz" -o node.tar.gz >>"$LOG" 2>&1 \
    || hata "Node.js indirilemedi. İnternet bağlantınızı kontrol edin."
  tar -xzf node.tar.gz >>"$LOG" 2>&1 && mv "$N" .node && rm -f node.tar.gz || hata "Node.js açılamadı."
  export PATH="$PWD/.node/bin:$PATH"
fi
adim "Node.js $(node -v) · npm $(npm -v)"

if [ ! -d node_modules ]; then
  adim "İlk kurulum yapılıyor (paketler), birkaç dakika sürer..."
  npm install --no-fund --no-audit >>"$LOG" 2>&1 || { rm -rf node_modules; hata "Paketler kurulamadı."; }
fi
[ -f .env ] || { adim "Erişim anahtarı üretiliyor..."; npm run -s anahtar >>"$LOG" 2>&1 || hata "Erişim anahtarı üretilemedi."; }
if [ ! -f frontend/out/index.html ]; then
  adim "Arayüz hazırlanıyor (bir kez)..."
  NEXT_TELEMETRY_DISABLED=1 npm run build >>"$LOG" 2>&1 || hata "Arayüz derlenemedi."
fi

export PORT="${PORT:-8765}"
[ -n "$SA_TARAYICI_ACMA" ] || export SA_TARAYICI=1   # sunucu hazır olunca tarayıcıyı doğru adresle açar
echo
echo "Senaryo Asistanı açılıyor (tarayıcı kendiliğinden açılır)..."
echo "Bu pencere açık kaldıkça uygulama çalışır. Kapatmak için pencereyi kapatın."
echo "Giriş anahtarı: bu klasördeki .env dosyasında (SENARYO_ERISIM_ANAHTARI)."
adim "Sunucu başlatılıyor"
npm start 2>&1 | tee -a "$LOG"
hata "Uygulama beklenmedik şekilde kapandı."
