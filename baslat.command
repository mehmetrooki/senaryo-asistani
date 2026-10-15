#!/bin/bash
# Senaryo Asistanı'nı tek tıkla açar (macOS). İlk çalıştırmada gerekenleri kendisi kurar (bir kez, birkaç dakika).
# Node.js yoksa (ya da eskiyse) yönetici şifresi istemeden bu klasöre taşınabilir sürümünü indirir.
cd "$(dirname "$0")" || exit 1
NODE_VER=24.20.0
xattr -dr com.apple.quarantine . 2>/dev/null   # sonraki açılışlarda macOS uyarısı çıkmasın

node_ok() { command -v node >/dev/null && node -e "process.exit(+process.versions.node.split('.')[0]>=22?0:1)" 2>/dev/null; }
if [ -x .node/bin/node ]; then
  export PATH="$PWD/.node/bin:$PATH"
elif ! node_ok; then
  ARCH=$(uname -m); [ "$ARCH" = "arm64" ] || ARCH=x64
  echo "Node.js bulunamadı; bu klasöre indiriliyor (bir kez, yaklaşık 50 MB)..."
  N="node-v$NODE_VER-darwin-$ARCH"
  if curl -fsSL "https://nodejs.org/dist/v$NODE_VER/$N.tar.gz" | tar -xz && mv "$N" .node; then
    export PATH="$PWD/.node/bin:$PATH"
  else
    echo "Node.js indirilemedi. İnternet bağlantınızı kontrol edin ya da https://nodejs.org adresinden LTS sürümünü kurun."
    read -r; exit 1
  fi
fi

[ -d node_modules ] || { echo "İlk kurulum yapılıyor, birkaç dakika sürer..."; npm install --no-fund --no-audit || { echo "Kurulum başarısız."; read -r; exit 1; }; }
[ -f .env ] || npm run anahtar
[ -f frontend/out/index.html ] || { echo "Arayüz hazırlanıyor..."; npm run build || { read -r; exit 1; }; }
export PORT="${PORT:-8765}"
echo
echo "Senaryo Asistanı açılıyor: http://127.0.0.1:$PORT"
echo "Bu pencere açık kaldıkça uygulama çalışır. Kapatmak için pencereyi kapatın."
echo "Giriş anahtarı: bu klasördeki .env dosyasında (SENARYO_ERISIM_ANAHTARI)."
(sleep 4; open "http://127.0.0.1:$PORT") &
npm start
