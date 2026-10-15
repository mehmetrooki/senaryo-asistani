"use client";
// Senaryo Geliştirme: senaryo listesi | işaretli senaryo | öneri kartları
import { useCallback, useEffect, useRef, useState } from "react";
import { STATUS, api, busy, docxOnly, toast } from "@/lib/api";

type F = any;
const CAT_SEV: Record<string, string> = { yuksek: "bad", orta: "warn", dusuk: "info" };
const SRC: Record<string, string> = { kural: "Kural", ai: "Claude", mcp: "MCP", manuel: "Editör" };
const IMPROVE = new Set(["fazlalık / gereksiz uzatma", "yabancı kelime", "iyileştirme", "kelime seçimi / üslup", "dil bilgisi / yazım", "tekrar / fazla kullanım"]);

function SrcBadge({ f, text }: { f: F; text: string }) {
  const i = f.suggestion_info?.[text] ?? {};
  if (i.kaynak === "bellek") return <span className="src bellek" title={i.note || "Ekibin geçmiş düzeltmesi"}>Bellek{i.ref ? " · " + i.ref.replace(/^KUCHO-/i, "") : ""}</span>;
  if (i.kaynak === "claude") return <span className="src claude" title="Claude'un hikâyeyi bozmadan önerdiği yeni metin">Claude</span>;
  if (i.kaynak === "kural") return <span className="src">Kural</span>;
  return null;
}
const Sugg = ({ f, onUse }: { f: F; onUse: (t: string) => void }) => (
  <div className="sugg">
    {f.suggestions.map((s: string, i: number) => (
      <button key={i} onClick={() => onUse(s)}>
        <span className="lbl">{s || <i>(tamamen kaldır)</i>}<SrcBadge f={f} text={s} /></span><span className="use">Bunu koy</span>
      </button>
    ))}
  </div>
);

export default function Gelistirme() {
  const [docs, setDocs] = useState<any[]>([]);
  const [cur, setCur] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [mode, setMode] = useState<"isaretli" | "revize">("isaretli");
  const [filter, setFilter] = useState("bekliyor");
  const [focus, setFocus] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [runAi, setRunAi] = useState(true);
  const [over, setOver] = useState(false);
  const [pop, setPop] = useState<{ id: string; top: number; left: number } | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [selBtn, setSelBtn] = useState<{ x: number; y: number; paragraph: number; start: number; end: number } | null>(null);
  const colRef = useRef<HTMLDivElement>(null), fileRef = useRef<HTMLInputElement>(null);
  const curRef = useRef(cur); curRef.current = cur;

  const loadDocs = useCallback(async () => {
    const d = await api<any[]>("/api/docs");
    setDocs(d);
    if (!curRef.current && d.length) setCur(d[0].id);
    return d;
  }, []);
  const loadDetail = useCallback(async (id = curRef.current) => {
    if (!id) return setDetail(null);
    try { setDetail(await api(`/api/docs/${id}`)); } catch { setCur(null); setDetail(null); }
  }, []);

  useEffect(() => { loadDocs().catch(() => {}); }, [loadDocs]); // 401'de api() zaten girişe yönlendirir
  useEffect(() => { setFocus(null); setPop(null); setEditing(null); loadDetail(cur); }, [cur, loadDetail]);
  // İnceleme sürerken sık, değilse seyrek yenile (başka üyelerin yüklemeleri de görünür)
  const sig = JSON.stringify(docs.map((d) => [d.id, d.status, d.status_detail, d.counts]));
  useEffect(() => {
    const anyBusy = docs.some(busy);
    const t = setInterval(async () => {
      if (document.visibilityState !== "visible" || editing !== null || pop) return;
      const d = await loadDocs().catch(() => null);
      if (!d) return;
      if (JSON.stringify(d.map((x) => [x.id, x.status, x.status_detail, x.counts])) !== sig) loadDetail();
    }, anyBusy ? 1500 : 6000);
    return () => clearInterval(t);
  }, [sig, docs, editing, pop, loadDocs, loadDetail]);

  const refresh = async () => { await loadDetail(); loadDocs(); };
  const decide = async (id: string, body: any) => {
    try { await api(`/api/findings/${id}/decide`, { json: body }); } catch (e: any) { toast(e.message); }
    setPop(null); refresh();
  };

  // ---------- yükleme
  async function upload(files: File[]) {
    files = docxOnly(files);
    if (!files.length) return toast("Yalnızca .docx dosyaları yüklenebilir.");
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    fd.append("run_ai", String(runAi));
    try {
      const created = await api<any[]>("/api/docs", { method: "POST", body: fd });
      toast(`${created.length} belge yüklendi, inceleniyor…`);
      await loadDocs(); setCur(created.at(-1).id);
    } catch (e: any) { toast(e.message, 4000); }
  }

  // ---------- liste işlemleri
  async function removeDocs(ids: string[]) {
    const n = ids.length === 1 ? `"${docs.find((d) => d.id === ids[0])?.name}"` : `${ids.length} senaryo`;
    if (!confirm(`${n} listeden kaldırılsın mı?\n(Bilgisayarınızdaki asıl dosyaya dokunulmaz.)`)) return;
    await api("/api/docs/delete", { json: { ids } });
    setSel(new Set()); if (ids.includes(cur!)) setCur(null);
    await loadDocs(); toast(`${ids.length} senaryo kaldırıldı`);
  }
  async function toMemory() {
    const ids = [...sel];
    if (!confirm(`${ids.length} dosya Bellek'e taşınsın mı? Notları öğrenilir ve bu listeden kaldırılır.`)) return;
    const r = await api("/api/docs/to_memory", { json: { ids } });
    setSel(new Set()); if (ids.includes(cur!)) setCur(null);
    await loadDocs(); toast(`${r.moved} dosya Bellek'e taşındı. Bellekte ${r.lessons} not var.`, 4000);
  }

  // ---------- senaryo görünümü
  const findings: F[] = detail?.findings ?? [];
  const byP: Record<number, F[]> = {};
  findings.forEach((f) => (byP[f.paragraph] ||= []).push(f));

  function paraNodes(p: any) {
    if (mode === "revize") return p.preview;
    const out: React.ReactNode[] = [];
    let pos = 0;
    for (const f of (byP[p.index] ?? []).filter((f) => f.status !== "red" || filter === "tum").sort((a, b) => a.start - b.start)) {
      if (f.start < pos) continue;
      out.push(p.text.slice(pos, f.start));
      const orig = p.text.slice(f.start, f.end);
      const cls = f.status === "kabul" ? "kabul" : f.status === "red" ? "red" : `sev-${f.severity}`;
      out.push(
        <mark key={f.id} className={`${cls} ${focus === f.id ? "focus" : ""}`} data-f={f.id} onClick={(e) => { e.stopPropagation(); openPop(f.id, e.currentTarget); }}>
          {f.status === "kabul" ? <><del>{orig}</del>{f.chosen ? <> <ins>{f.chosen}</ins></> : null}</> : orig}
        </mark>);
      pos = f.end;
    }
    out.push(p.text.slice(pos));
    return out;
  }

  function openPop(id: string, el: Element) {
    const col = colRef.current!, r = el.getBoundingClientRect(), c = col.getBoundingClientRect();
    setFocus(id);
    setPop({ id, top: r.bottom - c.top + col.scrollTop + 6, left: Math.max(8, Math.min(r.left - c.left, col.clientWidth - 430)) });
    document.querySelector(`.card[data-id="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function gotoFinding(f: F) {
    setMode("isaretli"); setFocus(f.id);
    requestAnimationFrame(() => {
      const m = document.querySelector(`#paper mark[data-f="${f.id}"]`), p = document.querySelector(`#paper p[data-p="${f.paragraph}"]`);
      (m ?? p)?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (p) { p.classList.remove("flash"); void (p as HTMLElement).offsetWidth; p.classList.add("flash"); }
      if (m) setTimeout(() => openPop(f.id, m), 450);
    });
  }
  function onMouseUp() {
    setTimeout(() => {
      const s = window.getSelection();
      if (mode !== "isaretli" || editing !== null || pop || !s?.rangeCount || s.isCollapsed) return setSelBtn(null);
      const range = s.getRangeAt(0), pEl = range.startContainer.parentElement?.closest("#paper p") as HTMLElement | null;
      if (!pEl || pEl !== range.endContainer.parentElement?.closest("#paper p")) return setSelBtn(null);
      const pre = document.createRange(); pre.selectNodeContents(pEl); pre.setEnd(range.startContainer, range.startOffset);
      const start = pre.toString().length, txt = s.toString(), idx = Number(pEl.dataset.p);
      const full = detail.paragraphs.find((p: any) => p.index === idx).text;
      if (full.slice(start, start + txt.length) !== txt) return setSelBtn(null);
      const r = range.getBoundingClientRect();
      setSelBtn({ x: r.left, y: r.bottom + 6, paragraph: idx, start, end: start + txt.length });
    }, 10);
  }
  async function markSelection() {
    const b = selBtn!; setSelBtn(null);
    const sug = prompt("Bu kısmın yerine ne gelsin? (boş bırakırsanız sonra seçebilirsiniz)");
    if (sug === null) return;
    const f = await api(`/api/docs/${cur}/findings`, { json: { paragraph: b.paragraph, start: b.start, end: b.end, suggestion: sug } });
    window.getSelection()?.removeAllRanges();
    await refresh(); setFocus(f.id);
  }

  const doc = detail?.doc, isBusy = doc && busy(doc);
  const list = findings.filter((f) => filter === "tum" || f.status === filter);
  const pending = findings.filter((f) => f.status === "bekliyor").length;
  const texts: Record<number, string> = Object.fromEntries((detail?.paragraphs ?? []).map((p: any) => [p.index, p.text]));
  const popF = pop && findings.find((f) => f.id === pop.id);

  return (
    <section className="view active" id="view-dev">
      <div id="dev">
        {/* ---------------- sol: senaryolar */}
        <aside className="col left">
          <label className={`drop ${over ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); upload([...e.dataTransfer.files]); }}>
            <b>Senaryo bırak (.docx)</b>Sürükle-bırak ya da tıkla — birden fazla dosya olabilir
            <input ref={fileRef} type="file" accept=".docx" multiple hidden onChange={(e) => { upload([...(e.target.files ?? [])]); e.target.value = ""; }} />
          </label>
          <label className="ai-toggle"><input type="checkbox" checked={runAi} onChange={(e) => setRunAi(e.target.checked)} /> Yüklerken Claude ile de incele</label>
          {docs.length > 0 && (
            <div className="docbar">
              <label><input type="checkbox" checked={sel.size === docs.length} onChange={(e) => setSel(e.target.checked ? new Set(docs.map((d) => d.id)) : new Set())} />
                {sel.size ? `${sel.size} seçili` : "Tümünü seç"}</label>
              {sel.size > 0 && <div className="bulk">
                <button className="danger" onClick={() => removeDocs([...sel])}>Kaldır</button>
                <button onClick={toMemory} title="Notlu/son hâl dosyalarını öğrenme için Bellek'e taşı">Bellek'e taşı</button>
                <button className="ghost" onClick={() => setSel(new Set())}>Vazgeç</button>
              </div>}
            </div>
          )}
          <div className="doclist">
            {docs.map((d) => {
              const c = d.counts || {};
              return (
                <div key={d.id} className={`docitem ${d.id === cur ? "active" : ""} ${sel.has(d.id) ? "sel" : ""}`} onClick={() => setCur(d.id)}>
                  <div className="dochead">
                    <input type="checkbox" checked={sel.has(d.id)} onClick={(e) => e.stopPropagation()}
                      onChange={(e) => { const s = new Set(sel); e.target.checked ? s.add(d.id) : s.delete(d.id); setSel(s); }} />
                    <div className="name">{d.name}</div>
                    <button className="ghost docdel" title="Bu senaryoyu kaldır" onClick={(e) => { e.stopPropagation(); removeDocs([d.id]); }}>✕</button>
                  </div>
                  <div className="meta">
                    {busy(d) ? <span className="badge info">{STATUS[d.status]}</span> : d.status === "hata" ? <span className="badge bad">Hata</span> : null}
                    {c.bekliyor ? <span className="badge warn">{c.bekliyor} bekleyen</span> : null}
                    {c.kabul ? <span className="badge ok">{c.kabul} kabul</span> : null}
                    {!busy(d) && !c.bekliyor && !c.kabul && d.status === "hazir" ? <span className="badge ok">Sorun yok</span> : null}
                    {d.learned_count ? <span className="badge info">{d.learned_count} öğrenildi</span> : null}
                    {d.uploaded_by ? <span className="badge" title="Yükleyen">👤 {d.uploaded_by}</span> : null}
                  </div>
                </div>
              );
            })}
            {!docs.length && <div style={{ color: "var(--muted)", fontSize: 13 }}>Yüklenen belge yok.</div>}
          </div>
        </aside>

        {/* ---------------- orta: senaryo */}
        <section className="col center" ref={colRef} onClick={() => setPop(null)}>
          {!detail ? (
            <div className="empty-state"><h3>Henüz bir senaryo seçilmedi</h3>
              <div>Soldaki alana .docx dosyalarınızı bırakın. Belge yüklenir yüklenmez<br />içindeki değişikliklerden öğrenilir ve uygunsuz kısımlar işaretlenir.</div></div>
          ) : (
            <div>
              <div className="toolbar">
                <h2>{doc.name}</h2>
                <div className="seg">
                  <button className={mode === "isaretli" ? "on" : ""} onClick={() => setMode("isaretli")}>İşaretli</button>
                  <button className={mode === "revize" ? "on" : ""} onClick={() => setMode("revize")}>Revize önizleme</button>
                </div>
                <button onClick={async () => { await api(`/api/docs/${cur}/rescan`, { json: { ai: runAi } }); toast("Yeniden taranıyor…"); loadDocs(); }}>Yeniden tara</button>
                <span className="hint" style={{ width: "100%" }}>İşaretli kısma tıklayarak değiştirin; bir paragrafı kendiniz yazmak için üzerine çift tıklayın.</span>
              </div>
              {(isBusy || (doc.status_detail && doc.status !== "hazir") || doc.status_detail?.startsWith("Claude hatası")) && (
                <div className="progress">{isBusy && <span className="spinner" />}<span>{doc.status_detail || STATUS[doc.status]}</span></div>
              )}
              <article className="paper" id="paper" onMouseUp={onMouseUp}>
                {detail.paragraphs.map((p: any) => {
                  const style: React.CSSProperties = { textAlign: p.align as any, paddingLeft: p.indent_cm ? `${Math.min(p.indent_cm, 9)}cm` : undefined,
                    fontWeight: p.bold ? 700 : undefined, fontStyle: p.italic ? "italic" : undefined };
                  if (editing === p.index) return <ParaEditor key={p.index} p={p} style={style} onDone={async (text) => {
                    if (text !== null) {
                      try { const r = await api(`/api/docs/${cur}/edit`, { json: { paragraph: p.index, text } }); toast(r.finding ? "Değişiklik kaydedildi" : "Değişiklik yok"); }
                      catch (e: any) { toast(e.message); }
                    }
                    setEditing(null); refresh();
                  }} />;
                  return <p key={p.index} data-p={p.index} className={p.text ? "" : "empty"} style={style}
                    onDoubleClick={(e) => { if (!(e.target as Element).closest("mark")) { window.getSelection()?.removeAllRanges(); setSelBtn(null); setPop(null); setEditing(p.index); } }}>
                    {paraNodes(p)}</p>;
                })}
              </article>
              {popF && pop && (
                <div className="pop" style={{ top: pop.top, left: pop.left }} onClick={(e) => e.stopPropagation()}>
                  <PopEditor f={popF} onUse={(t) => decide(popF.id, { action: "kabul", text: t })} onReject={() => decide(popF.id, { action: "red" })}
                    onUndo={() => decide(popF.id, { action: "geri" })} onPara={() => { setPop(null); setEditing(popF.paragraph); }} onClose={() => setPop(null)} />
                </div>
              )}
            </div>
          )}
          {selBtn && <button className="primary selbtn" style={{ display: "block", left: selBtn.x, top: selBtn.y }} onMouseDown={(e) => e.preventDefault()} onClick={markSelection}>Bu kısmı işaretle</button>}
        </section>

        {/* ---------------- sağ: öneriler */}
        <aside className="col right">
          <div className="right-head">
            <div className="row"><h3>Öneriler</h3><span className="badge">{detail ? `${pending} bekleyen / ${findings.length}` : ""}</span></div>
            <div className="row">
              <div className="seg">
                {[["bekliyor", "Bekleyen"], ["kabul", "Kabul"], ["tum", "Tümü"]].map(([k, l]) => <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>)}
              </div>
              <button title="Bekleyen her öneri için ilk seçeneği uygular" onClick={async () => {
                if (!cur || !confirm("Bekleyen tüm öneriler için ilk seçenek uygulanacak. Devam edilsin mi?")) return;
                const r = await api(`/api/docs/${cur}/accept_all`, { method: "POST" }); toast(`${r.accepted} öneri kabul edildi`); refresh();
              }}>Tümünü kabul et</button>
            </div>
          </div>
          <div className="cards">
            {detail && !list.length && <div className="empty-state" style={{ marginTop: 40 }}>{isBusy ? "İnceleme sürüyor…"
              : filter === "bekliyor" ? <><h3>Bekleyen öneri yok</h3>Bu senaryoda işaretlenecek başka bir şey bulunmadı.</> : "Kayıt yok."}</div>}
            {list.map((f) => <Card key={f.id} f={f} text={texts[f.paragraph] ?? ""} focus={focus === f.id} onGoto={() => gotoFinding(f)}
              onDecide={(b) => decide(f.id, b)} onAlt={async () => { try { await api(`/api/findings/${f.id}/alternatives`, { method: "POST" }); } catch (e: any) { toast(e.message); } refresh(); }} />)}
          </div>
        </aside>
      </div>
    </section>
  );
}

function Card({ f, text, focus, onGoto, onDecide, onAlt }: { f: F; text: string; focus: boolean; onGoto: () => void; onDecide: (b: any) => void; onAlt: () => Promise<void> }) {
  const [custom, setCustom] = useState(""), [thinking, setThinking] = useState(false);
  const a = Math.max(0, f.start - 45), b = Math.min(text.length, f.end + 45);
  const improve = IMPROVE.has(f.category) || (f.severity === "dusuk" && !["argo", "argo / kaba dil"].includes(f.category));
  return (
    <div className={`card ${f.status} ${focus ? "focus" : ""}`} data-id={f.id}>
      <div className="top"><span className={`badge ${CAT_SEV[f.severity] || "warn"}`}>{f.category || "uyarı"}</span>
        <span className="badge">{SRC[f.source] || f.source}</span><span className="badge">¶ {f.paragraph + 1}</span></div>
      <div className="warnline">{improve ? "Bu kısım iyileştirilebilir" : "Senaryodaki bu kısım uygun değil"}</div>
      <div className="quote" title="Senaryoda bu kısma git" onClick={onGoto}>
        {a > 0 ? "…" : ""}{text.slice(a, f.start)}<b>{text.slice(f.start, f.end)}</b>{text.slice(f.end, b)}{b < text.length ? "…" : ""}
        <span className="goto">↳ Senaryoda göster ve düzenle</span>
      </div>
      {f.reason && <div className="reason">{f.reason}</div>}
      {f.status === "kabul" ? <>
        <div className="chosen">→ {f.chosen ? f.chosen : <i>(kaldırıldı)</i>}</div>
        <div className="actions"><button className="ghost" onClick={() => onDecide({ action: "geri" })}>Geri al</button></div>
      </> : f.status === "red" ? <>
        <div className="reason">Yok sayıldı.</div>
        <div className="actions"><button className="ghost" onClick={() => onDecide({ action: "geri" })}>Geri al</button></div>
      </> : <>
        {f.suggestions.length ? <><div className="reason" style={{ marginBottom: 4 }}>Yerine şunu koyabilirsin:</div>
          <Sugg f={f} onUse={(t) => onDecide({ action: "kabul", text: t })} /></> : <div className="reason">Hazır öneri yok, aşağıya kendiniz yazın.</div>}
        <div className="custom">
          <input placeholder="Kendi versiyonunu yaz…" value={custom} onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onDecide({ action: "kabul", text: custom })} />
          <button onClick={() => onDecide({ action: "kabul", text: custom })}>Koy</button>
        </div>
        <div className="actions">
          <button className="ghost" disabled={thinking} onClick={async () => { setThinking(true); await onAlt(); setThinking(false); }}>{thinking ? "Claude düşünüyor…" : "✦ Claude'dan başka öneri"}</button>
          <button className="ghost" onClick={() => onDecide({ action: "red" })}>Sorun değil, yok say</button>
        </div>
      </>}
    </div>
  );
}

function PopEditor({ f, onUse, onReject, onUndo, onPara, onClose }: { f: F; onUse: (t: string) => void; onReject: () => void; onUndo: () => void; onPara: () => void; onClose: () => void }) {
  const [text, setText] = useState(f.status === "kabul" ? f.chosen ?? "" : f.original);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return <>
    {f.reason && <div className="reason">{f.reason}</div>}
    {f.status === "kabul" && <div className="reason">Şu an: <b>{f.chosen || "(kaldırıldı)"}</b></div>}
    {f.suggestions.length > 0 && <Sugg f={f} onUse={onUse} />}
    <textarea ref={ref} rows={2} value={text} onChange={(e) => setText(e.target.value)} title="Bu kısmın yerine yazılacak metin"
      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onUse(text); } if (e.key === "Escape") onClose(); }} />
    <div className="row">
      <button className="primary" onClick={() => onUse(text)}>Uygula</button>
      <button onClick={onPara} title="Bütün paragrafı kendiniz yazın">Paragrafı düzenle</button>
      {f.status === "bekliyor" ? <button className="ghost" onClick={onReject}>Yok say</button> : <button className="ghost" onClick={onUndo}>Geri al</button>}
      <button className="ghost x" onClick={onClose} title="Kapat">✕</button>
    </div>
  </>;
}

function ParaEditor({ p, style, onDone }: { p: any; style: React.CSSProperties; onDone: (t: string | null) => void }) {
  const [text, setText] = useState(p.preview);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const t = ref.current!; t.style.height = Math.max(60, t.scrollHeight + 4) + "px"; t.focus(); }, []);
  return (
    <p data-p={p.index} className="editing" style={style}>
      <textarea ref={ref} className="pedit" value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onDone(text); } if (e.key === "Escape") onDone(null); }} />
      <span className="pedit-bar"><button className="primary" onClick={() => onDone(text)}>Kaydet</button><button className="ghost" onClick={() => onDone(null)}>Vazgeç</button>
        <span>Ctrl+Enter kaydeder · Esc vazgeçer · yalnızca değiştirdiğiniz kelimeler işlenir, biçim korunur</span></span>
    </p>
  );
}
