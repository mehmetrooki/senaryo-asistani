"use client";
import { useEffect, useState } from "react";
import { api, toast } from "@/lib/api";

const TYPE: Record<string, string> = { kelime: "Tam kelime", kok: "Kök + ekler", ifade: "İfade", desen: "Desen" };
const SRCN: Record<string, string> = { varsayilan: "Varsayılan", manuel: "Elle", ogrenilen: "Öğrenilen" };
const CATS = ["argo", "kaba dil", "hakaret", "şiddet", "tehlikeli davranış", "kötü örnek davranış", "korku", "yabancı kelime", "fazlalık / gereksiz uzatma", "dil bilgisi / yazım", "diğer"];

export default function Kurallar() {
  const [rules, setRules] = useState<any[]>([]), [docs, setDocs] = useState<any[]>([]), [q, setQ] = useState("");
  const [form, setForm] = useState({ pattern: "", reps: "", match_type: "kelime", category: "argo" });
  const [cmp, setCmp] = useState({ old: "", nw: "" }), [reps, setReps] = useState<Record<string, string>>({});
  const load = async () => {
    const [r, d] = await Promise.all([api<any[]>("/api/rules"), api<any[]>("/api/docs")]);
    setRules(r); setDocs(d);
    setCmp((c) => (c.old || !d.length ? c : { old: d[1]?.id ?? d[0].id, nw: d[0].id }));
  };
  useEffect(() => { load(); }, []);
  const cands = rules.filter((r) => r.status === "aday"), ql = q.toLocaleLowerCase("tr");
  const active = rules.filter((r) => r.status === "aktif" && (!ql || (r.pattern + " " + r.replacements.join(" ")).toLocaleLowerCase("tr").includes(ql)));

  return (
    <section className="view active"><div className="page"><div className="page-inner">
      <div className="box">
        <h3>Onay bekleyen öğrenilenler</h3>
        <p className="sub">Yüklediğiniz belgelerdeki izlenen değişikliklerden ve aynı senaryonun önceki sürümleriyle karşılaştırmadan çıkarıldı. Onayladıklarınız bundan sonraki taramalarda kural olarak kullanılır.</p>
        <table><thead><tr><th>Olmaması gereken</th><th>Yerine geçen</th><th>Örnek bağlam</th><th /></tr></thead><tbody>
          {cands.map((r) => (
            <tr key={r.id}>
              <td><b>{r.pattern}</b></td>
              <td><input value={reps[r.id] ?? r.replacements.join(", ")} onChange={(e) => setReps({ ...reps, [r.id]: e.target.value })} style={{ width: "100%" }} /></td>
              <td style={{ color: "var(--muted)", fontSize: 12.5 }}>{r.example}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button className="primary" onClick={async () => { await api(`/api/rules/${r.id}`, { method: "PATCH", json: { status: "aktif", replacements: (reps[r.id] ?? r.replacements.join(", ")).split(",").map((s: string) => s.trim()) } }); load(); }}>Onayla</button>{" "}
                <button className="ghost" onClick={async () => { await api(`/api/rules/${r.id}`, { method: "DELETE" }); load(); }}>Reddet</button>
              </td>
            </tr>))}
          {!cands.length && <tr><td colSpan={4} style={{ color: "var(--muted)" }}>Onay bekleyen öğrenilmiş değişiklik yok.</td></tr>}
        </tbody></table>
      </div>
      <div className="box">
        <h3>Sürüm karşılaştır ve öğren</h3>
        <p className="sub">Aynı bölümün eski ve düzeltilmiş hâlini seçin; yapılan değişiklikler öğrenilir.</p>
        <div className="form-row">
          <select value={cmp.old} onChange={(e) => setCmp({ ...cmp, old: e.target.value })}>{docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <span style={{ flex: "none", color: "var(--muted)" }}>→</span>
          <select value={cmp.nw} onChange={(e) => setCmp({ ...cmp, nw: e.target.value })}>{docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <button className="primary" onClick={async () => {
            if (cmp.old === cmp.nw) return toast("İki farklı belge seçin.");
            const r = await api("/api/compare", { json: { old_id: cmp.old, new_id: cmp.nw } }); toast(`${r.learned} değişiklik öğrenildi`); load();
          }}>Karşılaştır</button>
        </div>
      </div>
      <div className="box">
        <h3>Yeni kural</h3>
        <div className="form-row">
          <input placeholder="Olmaması gereken (ör. kudur)" value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })} />
          <input placeholder="Yerine (virgülle: öfkelen, sinirlen)" value={form.reps} onChange={(e) => setForm({ ...form, reps: e.target.value })} />
          <select style={{ flex: "none", minWidth: 150 }} value={form.match_type} onChange={(e) => setForm({ ...form, match_type: e.target.value })}>
            {Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{k === "desen" ? "Desen (ileri düzey)" : v}</option>)}
          </select>
          <select style={{ flex: "none", minWidth: 150 }} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select>
          <button className="primary" onClick={async () => {
            try {
              await api("/api/rules", { json: { pattern: form.pattern, replacements: form.reps.split(",").map((s) => s.trim()), match_type: form.match_type, category: form.category } });
              setForm({ ...form, pattern: "", reps: "" }); toast("Kural eklendi. Belgeleri yeniden tarayarak uygulayabilirsiniz."); load();
            } catch (e: any) { toast(e.message); }
          }}>Ekle</button>
        </div>
      </div>
      <div className="box">
        <div className="form-row" style={{ marginBottom: 10 }}><h3 style={{ flex: 1 }}>Aktif kurallar ({active.length})</h3>
          <input placeholder="Ara…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 240 }} /></div>
        <table><thead><tr><th>Olmaması gereken</th><th>Tür</th><th>Önerilenler</th><th>Kategori</th><th>Kaynak</th><th /></tr></thead><tbody>
          {active.map((r) => (
            <tr key={r.id}>
              <td><b style={{ wordBreak: "break-word" }}>{r.pattern}</b>{r.context === "baglamsal" && <> <span className="badge info" title={r.reason}>bağlama bağlı</span></>}</td>
              <td>{TYPE[r.match_type] ?? r.match_type}</td>
              <td><div className="reps">{r.replacements.map((x: string, i: number) => <span key={i} className="badge ok">{x || "(kaldır)"}</span>)}</div></td>
              <td>{r.category}</td><td><span className="badge">{SRCN[r.source] ?? r.source}</span></td>
              <td><button className="ghost" onClick={async () => { if (confirm("Bu kural silinsin mi?")) { await api(`/api/rules/${r.id}`, { method: "DELETE" }); load(); } }}>Sil</button></td>
            </tr>))}
        </tbody></table>
      </div>
    </div></div></section>
  );
}

