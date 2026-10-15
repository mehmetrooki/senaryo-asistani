"use client";
import { useEffect, useState } from "react";
import { api, toast } from "@/lib/api";

export default function Export() {
  const [docs, setDocs] = useState<any[]>([]), [id, setId] = useState("");
  useEffect(() => { api<any[]>("/api/docs").then((d) => { setDocs(d); setId(d[0]?.id ?? ""); }); }, []);
  const d = docs.find((x) => x.id === id), c = d?.counts ?? {};
  async function download(tracked: boolean) {
    const r = await fetch(`/api/docs/${id}/export?tracked=${tracked}`);
    if (!r.ok) return toast("Export başarısız");
    const name = decodeURIComponent(r.headers.get("content-disposition")?.match(/filename\*?=(?:utf-8'')?"?([^";]+)/i)?.[1] ?? "senaryo.docx");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await r.blob()); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`${r.headers.get("X-Applied")} değişiklik uygulandı → ${name}`);
  }
  return (
    <section className="view active"><div className="page"><div className="page-inner"><div className="box">
      <h3>Export</h3>
      <p className="sub">Export, yüklediğiniz .docx dosyasının <b>kendisi</b> üzerine yapılır: yalnızca değiştirilen kelimeler değişir; sayfa yapısı, yazı tipi,
        karakter adı/diyalog/didaskali girintileri (Fransız senaryo formatı) birebir korunur.</p>
      <div className="form-row" style={{ maxWidth: 520 }}>
        <select value={id} onChange={(e) => setId(e.target.value)}>
          {docs.map((x, i) => <option key={x.id} value={x.id}>{x.name}{i === 0 ? "  — en son yüklenen" : ""}</option>)}
        </select>
      </div>
      {d && <div className="stat"><div><b>{c.kabul || 0}</b>uygulanacak</div><div><b>{c.bekliyor || 0}</b>bekleyen</div><div><b>{c.red || 0}</b>yok sayılan</div></div>}
      <div className="export-cards">
        <div className="export-card"><h4>Temiz kopya</h4><p>Kabul edilen değişiklikler doğrudan metne işlenir. Gönderime hazır son hâl.</p>
          <button className="primary" disabled={!d} onClick={() => download(false)}>Temiz .docx indir</button></div>
        <div className="export-card"><h4>İzlenen değişikliklerle</h4><p>Değişiklikler Word'ün "Değişiklikleri İzle" işaretleriyle gelir; yönetmen/yapımcı Word içinde tek tek onaylayabilir.</p>
          <button disabled={!d} onClick={() => download(true)}>İzlenen değişikliklerle indir</button></div>
      </div>
      {c.bekliyor ? <p className="sub" style={{ marginTop: 14 }}>Not: Bekleyen öneriler export'a dahil edilmez; yalnızca kabul ettikleriniz uygulanır.</p> : null}
    </div></div></div></section>
  );
}
