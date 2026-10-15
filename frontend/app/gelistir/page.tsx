"use client";
// Geliştir: ekibin yapay zekâya güncellemeleri (yönerge, karakter, üslup…) + senaryolardan öğrenilen editör notları.
import { useEffect, useState } from "react";
import { api, toast } from "@/lib/api";

const KINDS = ["yönerge", "karakter", "üslup", "dünya / hikâye bilgisi", "yasaklı / tercih edilen ifade", "diğer"];

export default function Gelistir() {
  const [notes, setNotes] = useState<any[] | null>(null);
  const [kind, setKind] = useState(KINDS[0]), [text, setText] = useState(""), [edit, setEdit] = useState<{ id: string; text: string } | null>(null);
  const load = async () => setNotes(await api<any[]>("/api/notes"));
  useEffect(() => { load(); }, []);
  if (!notes) return null;
  const general = notes.filter((n) => n.scope === "genel"), fromScripts = notes.filter((n) => n.scope !== "genel");
  const patch = async (n: any, body: any) => { await api(`/api/notes/${n.id}`, { method: "PATCH", json: body }); load(); };
  const del = async (n: any) => { if (confirm("Silinsin mi?")) { await api(`/api/notes/${n.id}`, { method: "DELETE" }); load(); } };
  const share = async () => {
    try { await api("/api/notes", { json: { scope: "genel", kind, text } }); setText(""); toast("Güncelleme paylaşıldı; bir sonraki incelemeden itibaren uygulanır."); load(); }
    catch (e: any) { toast(e.message); }
  };

  return (
    <section className="view active"><div className="page"><div className="page-inner">
      <div className="box">
        <h3>Geliştir</h3>
        <p className="sub">Yapay zekâyı burada geliştirin. Yazdığınız her güncelleme ekipteki herkes için geçerlidir ve Claude her senaryo incelemesinde
          bunlara kesin talimat olarak uyar. Kural koymak, karakterleri tanıtmak, üslubu anlatmak ya da "bundan sonra şuna dikkat et" demek için kullanın;
          örnek vermek en etkili yoldur.</p>
        <div className="composer">
          <div className="row">
            <select value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
            <span className="grow">{kind === "karakter" ? "ör. Keday: 8 yaşında, meraklı ama kaba değil; 'ya', 'be' demez." :
              kind === "üslup" ? "ör. Replikler kısa olsun; okul öncesi çocuğun anlayacağı kelimeler." : "ör. Bundan sonra yabancı marka adı kullanmıyoruz."}</span>
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Güncellemenizi yazın…" rows={3}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && text.trim()) share(); }} />
          <div className="row"><span className="grow">Ctrl+Enter ile paylaşın</span><button className="primary" disabled={!text.trim()} onClick={share}>Paylaş</button></div>
        </div>
        <div className="stat" style={{ marginTop: 14 }}>
          <div><b>{general.filter((n) => n.learn).length}</b>güncelleme AI'da</div>
          <div><b>{fromScripts.filter((n) => n.learn).length}</b>senaryo notu öğreniliyor</div>
        </div>
      </div>

      <div className="box">
        <h3>Ekip güncellemeleri</h3>
        <div className="feed">
          {general.map((n) => (
            <div key={n.id} className={`notecard ${n.learn ? "" : "cozuldu"}`}>
              <div className="meta">
                <select value={n.kind} onChange={(e) => patch(n, { kind: e.target.value })} style={{ fontSize: 12, padding: "2px 6px" }}>
                  {[...new Set([n.kind, ...KINDS])].map((k) => <option key={k}>{k}</option>)}</select>
                <span>👤 {n.author} · {n.created_at.replace("T", " ").slice(0, 16)}</span>
                <label style={{ marginLeft: "auto" }}><input type="checkbox" checked={n.learn} onChange={(e) => patch(n, { learn: e.target.checked })} /> AI'da kullan</label>
              </div>
              {edit?.id === n.id ? <>
                <textarea value={edit!.text} rows={3} onChange={(e) => setEdit({ id: n.id, text: e.target.value })} style={{ width: "100%" }} />
                <div className="actions"><button className="primary" onClick={async () => { await patch(n, { text: edit!.text }); setEdit(null); }}>Kaydet</button>
                  <button className="ghost" onClick={() => setEdit(null)}>Vazgeç</button></div>
              </> : <>
                <div className="txt">{n.text}</div>
                <div className="actions"><button className="ghost" onClick={() => setEdit({ id: n.id, text: n.text })}>Düzenle</button>
                  <button className="ghost" onClick={() => del(n)}>Sil</button></div>
              </>}
            </div>))}
          {!general.length && <div style={{ color: "var(--muted)" }}>Henüz güncelleme yok.</div>}
        </div>
      </div>

      <div className="box">
        <h3>Senaryolardan öğrenilen editör notları</h3>
        <p className="sub">Senaryo Geliştirme'de yazılan AI notları. "Öğren" açık olanlar yeni senaryoların incelemesinde de Claude'a verilir.</p>
        <div className="feed">
          {fromScripts.map((n) => (
            <div key={n.id} className={`notecard ${n.learn ? "" : "cozuldu"}`}>
              <div className="meta">
                <span className="badge">{n.doc_name ?? "silinmiş senaryo"}</span>
                <span className="badge info">{n.scope === "yer" ? `¶ ${n.paragraph + 1}` : "senaryonun geneli"}</span>
                <span>👤 {n.author} · {n.created_at.replace("T", " ").slice(0, 16)}</span>
                <label style={{ marginLeft: "auto" }}><input type="checkbox" checked={n.learn} onChange={(e) => patch(n, { learn: e.target.checked })} /> Öğren</label>
              </div>
              {n.quote && <div className="qt">«{n.quote}»</div>}
              <div className="txt">{n.text}</div>
              <div className="actions"><button className="ghost" onClick={() => del(n)}>Sil</button></div>
            </div>))}
          {!fromScripts.length && <div style={{ color: "var(--muted)" }}>Henüz senaryo notu yok.</div>}
        </div>
      </div>
    </div></div></section>
  );
}
