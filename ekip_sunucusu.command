#!/bin/bash
# macOS: bu Mac'i ekip sunucusu yapar; aynı ağdaki herkes tarayıcıdan bağlanır (erişim anahtarıyla).
export HOST=0.0.0.0 PORT="${PORT:-8000}"
exec "$(dirname "$0")/baslat.command"
