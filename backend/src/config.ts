// Ortam, veri klasörü ve kullanıcı ayarları.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// .env (proje kökünde) — bağımlılıksız küçük okuyucu; gerçek ortam değişkenleri önceliklidir
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export const DATA_DIR = process.env.SENARYO_ASISTANI_DATA || path.join(os.homedir(), ".senaryo-asistani");
for (const sub of ["belgeler", "bellek", "exports"]) fs.mkdirSync(path.join(DATA_DIR, sub), { recursive: true });
export const DB_PATH = path.join(DATA_DIR, "veri.sqlite3");
const CONFIG_PATH = path.join(DATA_DIR, "ayarlar.json");

export const PORT = Number(process.env.PORT || 8765);
export const HOST = process.env.HOST || "127.0.0.1";

export type Config = { api_key: string; model: string; ai_enabled: boolean; auto_learn: boolean; author: string };
export const DEFAULT_CONFIG: Config = {
  api_key: "", model: "claude-opus-5-5", ai_enabled: true, auto_learn: false, author: "Senaryo Asistanı",
};

export function loadConfig(): Config {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(update: Partial<Config>): Config {
  const cfg = loadConfig();
  for (const k of Object.keys(DEFAULT_CONFIG) as (keyof Config)[]) {
    if (update[k] !== undefined) (cfg as any)[k] = update[k];
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
  return cfg;
}

export const now = () => {
  const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
export const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
