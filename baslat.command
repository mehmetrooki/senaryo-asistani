#!/bin/bash
# macOS: Finder'da çift tıklayarak çalıştırın (ilk seferde: sağ tık > Aç).
cd "$(dirname "$0")" || exit 1
if [ ! -x ".venv/bin/python" ]; then
  echo "İlk kurulum yapılıyor, bu bir kez birkaç dakika sürer..."
  python3 -m venv .venv || { echo "Python 3 bulunamadı: https://www.python.org/downloads/"; read -r; exit 1; }
  .venv/bin/python -m pip install --upgrade pip >/dev/null
  .venv/bin/python -m pip install -r requirements.txt || { echo "Kurulum başarısız."; read -r; exit 1; }
fi
.venv/bin/python baslat.py
