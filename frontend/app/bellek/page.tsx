"use client";
// Bellek: ekibin notlu (commented) senaryoları + son hâllerinden öğrenilen notlar.
import { useEffect, useRef, useState } from "react";
import { api, docxOnly, filesFromDrop, toast } from "@/lib/api";

const OUTCOME: Record<string, [string, string]> = { revize: ["ok", "Revize edildi"], degismedi: ["", "Değiştirilmemiş"], son_yok: ["warn", "Son hâl yok"] };

export default function Bellek() {
  const [data, setData] = useState<any>(null);
  const [cat, setCat] = useState(""), [q, setQ] = useState(""), [off, setOff] = useState(false), [limit, setLimit] = useState(80);
  const [progress, setProgress] = useState(""), [over, setOver] = useState(false);
  const filesRef = useRef<HTMLInputElement>(null), dirRef = useRef<HTMLInputElement>(null);
  const load = async () => setData(await api("/api/memory"));
  useEffect(() => { load(); dirRef.current?.setAttribute("webkitdirectory", ""); }, []);

  async function upload(files: File[]) {
    files = docxOnly(files);
    if (!files.length) return toast("Seçilenlerde .docx bulunamadı.");
    let errors = 0;
    for (let i = 0; i < files.length; i += 6) {
      setProgress(`Belleğe ekleniyor… ${i}/${files.length}`);
      const fd = new FormData();
      files.slice(i, i + 6).forEach((f) => fd.append("files", f, f.name));
      try { (await api<any[]>("/api/memory", { method: "POST", body: fd })).forEach((x) => x.error && errors++); }
      catch { errors += Math.min(6, files.length - i); }
    }
    setProgress("");
    const d = await api("/api/memory");
    setData(d);
    toast(`${files.length} dosya işlendi${errors ? `, ${errors} dosya okunamadı` : ""}. Bellekte ${d.lessons.length} not var.`, 4000);
  }

  if (!data) return null;
  const L: any[] = data.lessons, counts: Record<string, number> = {};
  L.forEach((l) => (counts[l.category] = (counts[l.category] ?? 0) + 1));
  const ql = q.toLocaleLowerCase("tr");
  const list = L.filter((l) => (!cat || l.category === cat) && (off || l.active) && (!ql || `${l.note} ${l.anchor} ${l.source_name}`.toLocaleLowerCase("tr").includes(ql)));
  const patch = (l: any, body: any) => api(`/api/lessons/${l.id}`, { method: "PATCH", json: body }).then((r) => { Object.assign(l, r); setData({ ...data }); return r; });
  const who = (x: any) => (x?.uploaded_by ? <span className="badge">👤 {x.uploaded_by}</span> : null);

  return (
    <section className="view active"><div className="page"><div className="page-inner">
      <div className="box">
        <h3>Bellek</h3>
        <p className="sub">Ekibin notlu senaryolarını (adında <b>commented</b> geçen, Word notlu dosyalar) ve son hâllerini buraya bırakın. Aynı bölümün iki
          dosyası adından eşleştirilir; her not, işaret ettiği kısım ve son hâlde nasıl düzeltildiğiyle birlikte öğrenilir. Öneri almak istediğiniz senaryoyu
          ise <b>Senaryo Geliştirme</b>'ye yükleyin.</p>
        <div className="mem-drop">
          <label className={`drop ${over ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={async (e) => { e.preventDefault(); setOver(false); upload(await filesFromDrop(e.dataTransfer)); }}>
            <b>Notlu + son hâl dosyalarını bırak</b>Birden çok dosya ya da bütün bir klasör
            <input ref={filesRef} type="file" accept=".docx" multiple hidden onChange={(e) => { upload([...(e.target.files ?? [])]); e.target.value = ""; }} />
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button onClick={() => filesRef.current?.click()}>Dosya seç</button>
            <button onClick={() => dirRef.current?.click()}>Klasör seç</button>
            <input ref={dirRef} type="file" multiple hidden onChange={(e) => { upload([...(e.target.files ?? [])]); e.target.value = ""; }} />
          </div>
        </div>
        {progress && <div className="progress" style={{ marginTop: 12 }}><span className="spinner" /><span>{progress}</span></div>}
        <div className="stat" style={{ marginTop: 14 }}>
          <div><b>{data.pairs.length}</b>bölüm</div><div><b>{L.length}</b>not</div>
          <div><b>{L.filter((l) => l.outcome === "revize").length}</b>revizesiyle</div><div><b>{L.filter((l) => l.active).length}</b>öğrenmede kullanılıyor</div>
        </div>
      </div>

      <div className="box">
        <h3>Bölümler</h3>
        <p className="sub">Son hâli eksik olan bölümlerin notları yine öğrenilir; son hâl gelince "ekip nasıl düzeltti" bilgisi de eklenir.</p>
        <table><thead><tr><th>Bölüm</th><th>Notlu hâl</th><th>Son hâl</th><th>Not</th><th /></tr></thead><tbody>
          {data.pairs.map((p: any) => (
            <tr key={p.pair_key}>
              <td><b>{p.pair_key.toLocaleUpperCase("tr")}</b></td>
              <td>{p.notlu ? <><span className="badge ok">✓</span> {p.notlu.name} {who(p.notlu)}</> : <span className="badge warn">bekleniyor</span>}</td>
              <td>{p.son ? <><span className="badge ok">✓</span> {p.son.name} {who(p.son)}</> : <span className="badge warn">bekleniyor</span>}</td>
              <td>{Object.values(p.outcomes ?? {}).reduce((a: number, b: any) => a + b, 0) as number}</td>
              <td><button className="ghost" onClick={async () => {
                if (!confirm("Bu bölüm ve notları bellekten silinsin mi?")) return;
                await api(`/api/memory/${encodeURIComponent(p.pair_key)}`, { method: "DELETE" }); load();
              }}>Sil</button></td>
            </tr>))}
          {!data.pairs.length && <tr><td colSpan={5} style={{ color: "var(--muted)" }}>Bellek boş.</td></tr>}
        </tbody></table>
      </div>

      <div className="box">
        <h3>Öğrenilen notlar</h3>
        <p className="sub">Bölüme özgü notları "Öğrenmede kullan" kutusundan kapatabilir, kategoriyi düzeltebilirsiniz. Düzeltme satırına tıklayıp doğrusunu
          kendiniz yazabilirsiniz; asistan bundan sonra onu esas alır. "Kural yap" düzeltmeyi her senaryoda aranacak kalıcı kurala çevirir.</p>
        <div className="filters">
          <select value={cat} onChange={(e) => { setCat(e.target.value); setLimit(80); }}>
            <option value="">Tüm kategoriler ({L.length})</option>
            {data.categories.filter((c: string) => counts[c]).map((c: string) => <option key={c} value={c}>{c} ({counts[c]})</option>)}
          </select>
          <input placeholder="Notlarda ara…" value={q} onChange={(e) => { setQ(e.target.value); setLimit(80); }} style={{ flex: 1, minWidth: 180 }} />
          <label style={{ fontSize: 13, color: "var(--muted)" }}><input type="checkbox" checked={off} onChange={(e) => setOff(e.target.checked)} /> Kapalıları da göster</label>
        </div>
        <div className="lessons">
          {list.slice(0, limit).map((l) => <Lesson key={l.id} l={l} categories={data.categories} patch={patch} />)}
          {!list.length && <div style={{ color: "var(--muted)" }}>Kayıt yok.</div>}
        </div>
        {list.length > limit && <div style={{ textAlign: "center", marginTop: 10 }}><button onClick={() => setLimit(limit + 80)}>Daha fazla göster</button></div>}
      </div>
    </div></div></section>
  );
}

function Lesson({ l, categories, patch }: { l: any; categories: string[]; patch: (l: any, b: any) => Promise<any> }) {
  const [edit, setEdit] = useState<any[] | null>(null), [made, setMade] = useState<Set<number>>(new Set());
  const [cls, label] = OUTCOME[l.outcome] ?? ["", l.outcome];
  const start = () => setEdit((l.changes.length ? l.changes : [{ old: l.anchor.split("\n")[0], new: "" }]).map((c: any) => ({ ...c, orig_old: c.old })));
  async function save() {
    const kept = new Set(edit!.map((c) => c.orig_old));
    const changes = [...edit!, ...l.changes.filter((c: any) => !kept.has(c.old)).map((c: any) => ({ orig_old: c.old, old: "", new: "" }))];
    try {
      const r = await patch(l, { changes });
      setEdit(null);
      toast(`Düzeltme kaydedildi; asistan bundan sonra bunu esas alacak${r.rules_updated ? `, ${r.rules_updated} kural güncellendi` : ""}.`, 4000);
    } catch (e: any) { toast(e.message); }
  }
  return (
    <div className={`lesson ${l.active ? "" : "off"}`}>
      <div className="top">
        <select value={l.category} onChange={(e) => patch(l, { category: e.target.value })}>{categories.map((c) => <option key={c}>{c}</option>)}</select>
        <span className="badge">{l.source_name.replace(/\.docx$/i, "")}</span><span className={`badge ${cls}`}>{label}</span>
        {l.edited && <span className="badge info" title="Bu düzeltmeyi siz yazdınız; asistan bunu esas alır">Elle düzeltildi</span>}
        <label className="sp"><input type="checkbox" checked={l.active} onChange={(e) => patch(l, { active: e.target.checked })} /> Öğrenmede kullan</label>
      </div>
      <div className="note">{l.note}</div>
      {l.anchor && <div className="anchor">{l.anchor}</div>}
      {edit ? (
        <div className="ledit">
          {edit.map((c, i) => (
            <div className="erow" key={i}>
              <input className="o" value={c.old} placeholder="olmaması gereken" onChange={(e) => setEdit(edit.map((x, j) => (j === i ? { ...x, old: e.target.value } : x)))}
                onKeyDown={(e) => e.key === "Enter" && save()} />
              <span className="arr">→</span>
              <input className="n" value={c.new} placeholder="yerine (boş = çıkar)" autoFocus={i === 0} onChange={(e) => setEdit(edit.map((x, j) => (j === i ? { ...x, new: e.target.value } : x)))}
                onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEdit(null); }} />
              <button className="ghost" title="Bu satırı sil" onClick={() => setEdit(edit.filter((_, j) => j !== i))}>✕</button>
            </div>))}
          <div className="bar">
            <button className="primary" onClick={save}>Kaydet ve öğren</button>
            <button onClick={() => setEdit([...edit, { old: "", new: "", orig_old: "" }])}>+ Düzeltme ekle</button>
            <button className="ghost" onClick={() => setEdit(null)}>Vazgeç</button>
            <span className="hint">Sol: senaryoda olmaması gereken · Sağ: yerine gelecek (boş = çıkarılsın)</span>
          </div>
        </div>
      ) : <>
        {l.changes.map((c: any, i: number) => (
          <div className="change clickable" key={i} title="Düzeltmeyi kendiniz yazmak için tıklayın" onClick={start}>
            {c.old ? <del>{c.old}</del> : <i>(ekleme)</i>} → {c.new ? <ins>{c.new}</ins> : <i>(çıkarıldı)</i>}
            <button disabled={made.has(i)} title="Bu düzeltmeyi kalıcı kural yap" onClick={async (e) => {
              e.stopPropagation();
              await api(`/api/lessons/${l.id}/rule`, { json: { old: c.old, new: c.new } });
              setMade(new Set(made).add(i));
            }}>{made.has(i) ? "Kural eklendi ✓" : "Kural yap"}</button>
            <span className="pen">✎ düzenle</span>
          </div>))}
        <div className="change"><button onClick={start}>{l.changes.length ? "✎ Düzeltmeyi değiştir" : "✎ Düzeltme yaz"}</button></div>
      </>}
    </div>
  );
}
