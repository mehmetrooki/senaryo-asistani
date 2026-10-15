"""Senaryo Asistanı — ekip sunucusu.

Tek bir sunucuda çalışır; ekipteki herkes tarayıcıdan aynı adrese girer ve aynı Bellek, kurallar ve
senaryoları görür. Aynı adres Claude için bir MCP bağlayıcısı (connector) da sunar.

Ortam değişkenleri:
  SENARYO_TAKIM_SIFRESI   (zorunlu) siteye giriş şifresi
  SENARYO_ASISTANI_DATA   veri klasörü (kalıcı disk), ör. /data
  PORT                    dinlenecek port (barındırma hizmeti verir), varsayılan 8000
  ANTHROPIC_API_KEY       (isteğe bağlı) sitedeki otomatik Claude incelemesi için
  SENARYO_MCP_ANAHTARI    (isteğe bağlı) Claude bağlayıcı adresindeki gizli parça; yoksa üretilir
"""
import contextlib
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

if not os.environ.get("SENARYO_TAKIM_SIFRESI"):
    sys.exit("SENARYO_TAKIM_SIFRESI ortam değişkeni tanımlı değil. Ekip sunucusu şifresiz açılmaz.")

import uvicorn  # noqa: E402
from mcp.server.transport_security import TransportSecuritySettings  # noqa: E402

import mcp_sunucu  # noqa: E402  (veritabanını hazırlar, MCP araçlarını tanımlar)
from senaryo_asistani import auth  # noqa: E402
from senaryo_asistani.app import app  # noqa: E402

# Claude bağlayıcısı: https://SITE/baglanti/<gizli-anahtar>/mcp
mcp_http = mcp_sunucu.mcp.streamable_http_app(
    streamable_http_path="/mcp",
    stateless_http=True,
    json_response=True,
    # Sunucu internetten kendi alan adıyla erişileceği için yerel-ağ (DNS rebinding) koruması kapatılır;
    # erişim, adresteki tahmin edilemez anahtarla sınırlıdır.
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)
app.mount(f"/baglanti/{auth.mcp_token()}", mcp_http)


@contextlib.asynccontextmanager
async def lifespan(_app):
    async with mcp_sunucu.mcp.session_manager.run():
        yield


app.router.lifespan_context = lifespan


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    import socket

    try:
        ips = sorted({ip for ip in socket.gethostbyname_ex(socket.gethostname())[2] if not ip.startswith("127.")})
    except OSError:
        ips = []
    print("Senaryo Asistanı ekip sunucusu çalışıyor.")
    print(f"  Bu bilgisayardan:      http://127.0.0.1:{port}")
    for ip in ips:
        print(f"  Aynı ağdaki herkes:    http://{ip}:{port}")
    print("  Kapatmak için bu pencerede Ctrl+C. Pencere açık kaldıkça site çalışır.")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info", proxy_headers=True, forwarded_allow_ips="*")
