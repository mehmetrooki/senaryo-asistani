#!/bin/bash
# macOS: Finder'da çift tıklayın (ilk seferde sağ tık > Aç). İlk çalıştırmada kurulum yapar.
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null || { echo "Node.js bulunamadı: https://nodejs.org (LTS)"; read -r; exit 1; }
[ -d node_modules ] || { echo "İlk kurulum yapılıyor..."; npm install || { read -r; exit 1; }; }
[ -f .env ] || npm run anahtar
[ -f frontend/out/index.html ] || { echo "Arayüz hazırlanıyor..."; npm run build || { read -r; exit 1; }; }
export PORT="${PORT:-8765}"
(sleep 3; open "http://127.0.0.1:$PORT") &
npm start
