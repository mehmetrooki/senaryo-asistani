// Üyelik: .env'deki 256 baytlık erişim anahtarıyla giriş; imzalı oturum çerezi; MCP bağlantı yolu.
import crypto from "node:crypto";

export const COOKIE = "sa_oturum";
export const MAX_AGE = 60 * 60 * 24 * 90; // 90 gün

export function accessKey(): string {
  const k = (process.env.SENARYO_ERISIM_ANAHTARI || "").trim();
  if (!/^[0-9a-f]{512}$/i.test(k)) {
    throw new Error("SENARYO_ERISIM_ANAHTARI .env dosyasında yok ya da 256 bayt (512 onaltılık karakter) değil. `npm run anahtar` ile üretin.");
  }
  return k.toLowerCase();
}

const hmac = (label: string, msg: string) => crypto.createHmac("sha256", accessKey()).update(label + ":" + msg).digest("hex");

/** Sabit süreli karşılaştırma (boşluk/satır sonu kopyalama hatalarına toleranslı). */
export function checkKey(given: string) {
  const a = Buffer.from(given.replace(/\s+/g, "").toLowerCase()), b = Buffer.from(accessKey());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function makeSession(name: string) {
  const payload = Buffer.from(`${name}|${Math.floor(Date.now() / 1000)}`).toString("base64url");
  return `${payload}.${hmac("oturum", payload).slice(0, 40)}`;
}

export function readSession(v?: string): string | null {
  if (!v || !v.includes(".")) return null;
  const [payload, sig] = v.split(".");
  const want = hmac("oturum", payload).slice(0, 40);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  const [name, ts] = Buffer.from(payload, "base64url").toString().split(/\|(?=\d+$)/);
  return name && Date.now() / 1000 - Number(ts) < MAX_AGE ? name : null;
}

/** Claude bağlayıcısının gizli yolu (anahtardan türetilir; anahtar değişirse bu da değişir). */
export const mcpToken = () => hmac("mcp", "baglanti").slice(0, 32);
