"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const NAV = [["/", "Senaryo Geliştirme"], ["/bellek/", "Bellek"], ["/gelistir/", "Geliştir"], ["/kurallar/", "Kurallar & Öğrenilenler"], ["/export/", "Export"], ["/ayarlar/", "Ayarlar"]];

export default function Header() {
  const path = usePathname();
  const [st, setSt] = useState<any>(null);
  const login = path.startsWith("/giris");
  useEffect(() => { if (!login) api("/api/status").then(setSt).catch(() => {}); }, [login, path]);
  if (login) return null;
  const norm = (p: string) => (p.endsWith("/") ? p : p + "/");
  return (
    <header>
      <div className="brand"><span className="dot" />Senaryo Asistanı</div>
      <nav>
        {NAV.map(([href, label]) => <Link key={href} href={href} className={norm(path) === href ? "active" : ""}>{label}</Link>)}
      </nav>
      <span className={`status-chip ${st?.ai_ready ? "on" : ""}`}>{st ? (st.ai_ready ? "Claude bağlı" : "Yalnızca kurallar (Claude kapalı)") : "…"}</span>
      {st && <span className="status-chip" style={{ marginLeft: 0 }}>👤 {st.user}</span>}
      {st && <button className="ghost" onClick={async () => { await fetch("/api/cikis", { method: "POST" }); location.href = "/giris/"; }}>Çıkış</button>}
    </header>
  );
}
