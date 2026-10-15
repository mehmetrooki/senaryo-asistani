"""Senaryo Asistanı MCP sunucusunu Claude Desktop'a ekler (Windows ve macOS).

Kullanım:  python mcp_kur.py          -> yapılandırmayı gösterir, onay ister, ekler
           python mcp_kur.py --evet   -> sormadan ekler
           python mcp_kur.py --yazdir -> yalnızca yapılandırmayı yazdırır

Windows'ta Claude Desktop Microsoft Store'dan kurulduysa ayarlarını kendi paket klasöründe
(…\\Packages\\Claude_xxx\\LocalCache\\Roaming\\Claude) tutar; betik bulduğu her ayar dosyasını günceller.
Dosyadaki diğer ayarlara dokunulmaz, önce yedek alınır.
"""
import json
import os
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
NAME = "senaryo-asistani"


def python_path() -> str:
    """Projenin .venv ortamı varsa onu kullan (gerekli paketler orada kurulu)."""
    for cand in (HERE / ".venv" / "Scripts" / "python.exe", HERE / ".venv" / "bin" / "python"):
        if cand.exists():
            return str(cand)
    return sys.executable


def config_paths() -> list[Path]:
    if sys.platform == "darwin":
        return [Path.home() / "Library" / "Application Support" / "Claude" / "claude_desktop_config.json"]
    if os.name == "nt":
        paths = [Path(os.environ["APPDATA"]) / "Claude" / "claude_desktop_config.json"]
        packages = Path(os.environ.get("LOCALAPPDATA", "")) / "Packages"
        if packages.exists():
            for pkg in packages.glob("Claude_*"):
                p = pkg / "LocalCache" / "Roaming" / "Claude" / "claude_desktop_config.json"
                if p.parent.exists():
                    paths.append(p)
        return paths
    return [Path.home() / ".config" / "Claude" / "claude_desktop_config.json"]


def install(path: Path, entry: dict) -> None:
    data = {}
    if path.exists():
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw) if raw.strip() else {}
        shutil.copyfile(path, path.with_name(path.name + ".yedek"))
    path.parent.mkdir(parents=True, exist_ok=True)
    data.setdefault("mcpServers", {})[NAME] = entry
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def main():
    entry = {"command": python_path(), "args": [str(HERE / "mcp_sunucu.py")]}
    print("Eklenecek MCP sunucusu:\n" + json.dumps({NAME: entry}, indent=2, ensure_ascii=False))
    print(f"\nClaude Code için:\n  claude mcp add {NAME} -- \"{entry['command']}\" \"{entry['args'][0]}\"\n")
    if "--yazdir" in sys.argv:
        return
    paths = config_paths()
    print("Güncellenecek ayar dosyaları:\n  " + "\n  ".join(str(p) for p in paths))
    if "--evet" not in sys.argv:
        if input("Claude Desktop'a eklensin mi? [e/H]: ").strip().lower() not in ("e", "evet", "y"):
            print("Değişiklik yapılmadı.")
            return
    for p in paths:
        try:
            install(p, entry)
            print(f"  ✓ {p}")
        except Exception as e:  # biri yazılamasa da diğerleri denensin
            print(f"  ✗ {p}: {e}")
    print("\nEklendi. Claude Desktop'ı tamamen kapatın (görev çubuğundaki simgeden 'Quit') ve yeniden açın.")


if __name__ == "__main__":
    main()
