// API istemcisi ve küçük yardımcılar (tüm sayfalar ortak kullanır).
export async function api<T = any>(url: string, o: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...init } = o;
  if (json !== undefined) {
    init.body = JSON.stringify(json);
    init.headers = { "Content-Type": "application/json" };
    init.method ||= "POST";
  }
  const r = await fetch(url, init);
  if (r.status === 401 && !url.startsWith("/api/giris")) {
    location.href = "/giris/";
    return new Promise<T>(() => {}); // yönlendirme sürerken sessizce bekle
  }
  if (!r.ok) {
    let m = r.statusText;
    try { m = (await r.json()).detail || m; } catch {}
    throw new Error(m);
  }
  return r.json();
}

export function toast(msg: string, ms = 2600) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout((t as any)._h);
  (t as any)._h = setTimeout(() => t.classList.remove("show"), ms);
}

export const STATUS: Record<string, string> = { bekliyor: "Sırada", analiz: "İnceleniyor", hazir: "Hazır", hata: "Hata" };
export const busy = (d: { status: string }) => d.status === "analiz" || d.status === "bekliyor";

/** Sürüklenen klasörlerin içindeki dosyaları da toplar. */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = [...(dt.items || [])].map((i) => (i as any).webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dt.files];
  const out: File[] = [];
  const walk = (e: any): Promise<void> => new Promise((res) => {
    if (e.isFile) e.file((f: File) => { out.push(f); res(); }, () => res());
    else if (e.isDirectory) {
      const reader = e.createReader(), all: any[] = [];
      const read = () => reader.readEntries(async (ents: any[]) => {
        if (!ents.length) { for (const x of all) await walk(x); res(); } else { all.push(...ents); read(); }
      }, () => res());
      read();
    } else res();
  });
  for (const e of entries) await walk(e);
  return out;
}

export const docxOnly = (files: File[]) => files.filter((f) => f.name.toLowerCase().endsWith(".docx") && !f.name.startsWith("~$"));
