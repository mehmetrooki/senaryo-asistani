"""Sunucu modu: ekip şifresiyle giriş, kullanıcı adı, MCP bağlantı anahtarı.

SENARYO_TAKIM_SIFRESI ortam değişkeni tanımlıysa uygulama "sunucu modunda" çalışır: siteye yalnızca bu
şifreyi bilenler girebilir; her kişi girişte adını yazar, eklediği senaryo ve Bellek dosyaları adıyla görünür.
Tanımlı değilse (kişisel bilgisayarda) giriş istenmez.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time

from . import storage

COOKIE = "sa_oturum"
MAX_AGE = 60 * 60 * 24 * 90  # 90 gün


def team_password() -> str:
    return os.environ.get("SENARYO_TAKIM_SIFRESI", "")


def server_mode() -> bool:
    return bool(team_password())


def _persistent_secret(env: str, filename: str, nbytes: int) -> str:
    value = os.environ.get(env, "").strip()
    if value:
        return value
    path = storage.data_dir() / filename
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    value = secrets.token_urlsafe(nbytes)
    path.write_text(value, encoding="utf-8")
    return value


def _secret() -> bytes:
    return _persistent_secret("SENARYO_GIZLI_ANAHTAR", ".gizli_anahtar", 32).encode()


def mcp_token() -> str:
    """Claude bağlayıcısının adresindeki gizli parça (adresi bilen MCP araçlarını kullanabilir)."""
    return _persistent_secret("SENARYO_MCP_ANAHTARI", ".mcp_anahtari", 24)


def check_password(given: str) -> bool:
    return bool(team_password()) and hmac.compare_digest(given.encode(), team_password().encode())


def make_cookie(name: str) -> str:
    payload = f"{name}|{int(time.time())}".encode()
    sig = hmac.new(_secret(), payload, hashlib.sha256).hexdigest()[:32]
    return base64.urlsafe_b64encode(payload).decode() + "." + sig


def read_cookie(value: str | None) -> str | None:
    if not value or "." not in value:
        return None
    raw, sig = value.rsplit(".", 1)
    try:
        payload = base64.urlsafe_b64decode(raw.encode())
    except Exception:
        return None
    expected = hmac.new(_secret(), payload, hashlib.sha256).hexdigest()[:32]
    if not hmac.compare_digest(sig, expected):
        return None
    name, _, ts = payload.decode("utf-8", "replace").rpartition("|")
    if not ts.isdigit() or time.time() - int(ts) > MAX_AGE:
        return None
    return name or None


LOGIN_HTML = """<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Senaryo Asistanı · Giriş</title>
<style>
:root{--bg:#f4f3ef;--panel:#fff;--line:#e3e0d8;--text:#1f1d1a;--muted:#6d685f;--accent:#3b5bdb;--bad:#c92a2a}
@media (prefers-color-scheme: dark){:root{--bg:#161614;--panel:#1f1e1b;--line:#35332e;--text:#ecebe6;--muted:#a19d94;--accent:#8ea2ff;--bad:#ff8787}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);
font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:16px}
form{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:28px;width:min(380px,100%);display:flex;flex-direction:column;gap:12px}
h1{font-size:19px;margin:0 0 4px;display:flex;gap:10px;align-items:center}
h1 span{width:24px;height:24px;border-radius:7px;background:linear-gradient(135deg,#ff922b,#f06595 55%,#7950f2)}
p{margin:0 0 6px;color:var(--muted);font-size:13.5px}label{font-size:13px;color:var(--muted)}
input{font:inherit;padding:9px 12px;border:1px solid var(--line);border-radius:9px;background:var(--panel);color:var(--text);width:100%}
button{font:inherit;padding:10px;border-radius:9px;border:0;background:var(--accent);color:#fff;cursor:pointer;margin-top:6px}
.err{color:var(--bad);font-size:13.5px;min-height:1em}
</style></head><body>
<form id="f"><h1><span></span>Senaryo Asistanı</h1>
<p>Ekip çalışma alanı. Bellek, kurallar ve senaryolar tüm ekip tarafından ortak kullanılır.</p>
<label>Adınız<input name="ad" autocomplete="name" required placeholder="ör. Zümrüt"></label>
<label>Ekip şifresi<input name="sifre" type="password" autocomplete="current-password" required></label>
<div class="err" id="e"></div><button>Giriş yap</button></form>
<script>
try { document.querySelector("[name=ad]").value = localStorage.getItem("sa_ad") || ""; } catch {}
document.getElementById("f").onsubmit = async ev => {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const r = await fetch("/api/giris", {method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ad: fd.get("ad"), sifre: fd.get("sifre")})});
  if (r.ok) { try { localStorage.setItem("sa_ad", fd.get("ad")); } catch {} location.href = "/"; }
  else document.getElementById("e").textContent = "Şifre hatalı.";
};
</script></body></html>"""
