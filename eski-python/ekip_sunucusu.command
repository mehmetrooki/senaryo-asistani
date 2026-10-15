#!/bin/bash
# macOS: bu Mac'i ekip sunucusu yapar; aynı ağdaki herkes tarayıcıdan bağlanır.
cd "$(dirname "$0")" || exit 1
if [ ! -x ".venv/bin/python" ]; then
  echo "İlk kurulum yapılıyor, bu bir kez birkaç dakika sürer..."
  python3 -m venv .venv || { echo "Python 3 bulunamadı: https://www.python.org/downloads/"; read -r; exit 1; }
  .venv/bin/python -m pip install --upgrade pip >/dev/null
  .venv/bin/python -m pip install -r requirements.txt || { echo "Kurulum başarısız."; read -r; exit 1; }
fi
if [ ! -f ekip_sifresi.txt ]; then
  read -r -p "Ekip şifresi belirleyin (ekip arkadaşlarınıza bunu vereceksiniz): " YENI
  printf '%s' "$YENI" > ekip_sifresi.txt
fi
export SENARYO_TAKIM_SIFRESI="$(cat ekip_sifresi.txt)"
export PORT="${PORT:-8000}"
.venv/bin/python sunucu.py
