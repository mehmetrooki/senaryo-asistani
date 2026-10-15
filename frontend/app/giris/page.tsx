"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function Giris() {
  const [ad, setAd] = useState(""), [anahtar, setAnahtar] = useState(""), [err, setErr] = useState(""), [wait, setWait] = useState(false);
  useEffect(() => { try { setAd(localStorage.getItem("sa_ad") || ""); } catch {} }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setWait(true); setErr("");
    try {
      await api("/api/giris", { json: { ad, anahtar } });
      try { localStorage.setItem("sa_ad", ad); } catch {}
      location.href = "/";
    } catch (x: any) { setErr(x.message); setWait(false); }
  };
  return (
    <div className="login">
      <form onSubmit={submit}>
        <h1><span className="dot" />Senaryo Asistanı</h1>
        <p className="sub">Üye girişi. Bellek, kurallar ve senaryolar tüm ekip tarafından ortak kullanılır.</p>
        <label>Adınız<input value={ad} onChange={(e) => setAd(e.target.value)} autoComplete="name" required placeholder="ör. Zümrüt" /></label>
        <label>Erişim anahtarı (256 bayt)
          <textarea value={anahtar} onChange={(e) => setAnahtar(e.target.value)} required rows={4} spellCheck={false}
            placeholder=".env dosyasındaki SENARYO_ERISIM_ANAHTARI değerini yapıştırın" autoComplete="current-password" />
        </label>
        <div className="err">{err}</div>
        <button className="primary" disabled={wait}>{wait ? "Giriş yapılıyor…" : "Giriş yap"}</button>
      </form>
    </div>
  );
}
