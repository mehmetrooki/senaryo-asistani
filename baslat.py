"""Senaryo Asistanı'nı başlatır ve tarayıcıda açar (Windows ve macOS).

Seçenekler: --no-browser   tarayıcıyı açma
            --port N       sabit port
            --veri KLASOR  veri klasörü (varsayılan: ~/.senaryo-asistani)
"""
import os
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))


def _arg(name):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return None


if _arg("--veri"):
    os.environ["SENARYO_ASISTANI_DATA"] = _arg("--veri")

import uvicorn  # noqa: E402

from senaryo_asistani import storage  # noqa: E402
from senaryo_asistani.app import app  # noqa: E402

PREFERRED_PORT = 8765


def free_port() -> int:
    for port in (PREFERRED_PORT, 0):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return s.getsockname()[1]
            except OSError:
                continue
    raise RuntimeError("Boş port bulunamadı")


def main():
    if storage.init_db():
        from senaryo_asistani import service

        threading.Thread(target=service.rescan_all_rules, daemon=True).start()
        print("Güncelleme uygulandı; belgeler yeni kurallarla yeniden taranıyor.")
    port = int(_arg("--port") or 0) or free_port()
    url = f"http://127.0.0.1:{port}"
    if "--no-browser" not in sys.argv:
        threading.Thread(target=lambda: (time.sleep(1.2), webbrowser.open(url)), daemon=True).start()
    print(f"Senaryo Asistanı çalışıyor: {url}  (kapatmak için bu pencerede Ctrl+C)")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
