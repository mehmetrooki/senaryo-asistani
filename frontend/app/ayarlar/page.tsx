"use client";
import { useEffect, useRef, useState } from "react";
import { api, toast } from "@/lib/api";

export default function Ayarlar() {
  const [s, setS] = useState<any>(null), [st, setSt] = useState<any>(null), [result, setResult] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { api("/api/settings").then(setS); api("/api/status").then(setSt); }, []);
  if (!s || !st) return null;
  const mcpUrl = (typeof location !== "undefined" ? location.origin : "") + st.mcp_path;
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast("Kopyalandı"); } catch { toast("Kopyalanamadı; metni seçip kopyalayın."); } };

  return (
    <section className="view active"><div className="page"><div className="page-inner">
      <div className="box">
        <h3>Claude bağlantısı</h3>
        <p className="sub">Kural listesi API anahtarı olmadan da çalışır. Claude, listede olmayan ama bağlamdan anlaşılan sorunları bulur ve öneri üretir.</p>
        <div className="kv">
          <label>API anahtarı</label><input type="password" placeholder="sk-ant-…" value={s.api_key} onChange={(e) => setS({ ...s, api_key: e.target.value })} />
          <label>Model</label><input value={s.model} onChange={(e) => setS({ ...s, model: e.target.value })} />
          <label>Claude ile incele</label><label><input type="checkbox" checked={s.ai_enabled} onChange={(e) => setS({ ...s, ai_enabled: e.target.checked })} /> Yüklemelerde Claude'u kullan</label>
          <label>Otomatik öğrenme</label><label><input type="checkbox" checked={s.auto_learn} onChange={(e) => setS({ ...s, auto_learn: e.target.checked })} /> Öğrenilenleri onay beklemeden kural yap</label>
          <label>Değişiklik yazarı</label><input placeholder="İzlenen değişikliklerde görünen ad" value={s.author} onChange={(e) => setS({ ...s, author: e.target.value })} />
        </div>
        <div style={{ marginTop: 14 }}><button className="primary" onClick={async () => { setS(await api("/api/settings", { json: s })); toast("Ayarlar kaydedildi"); }}>Kaydet</button></div>
      </div>

      <div className="box">
        <h3>Üyeler</h3>
        <p className="sub">Giriş, .env dosyasındaki 256 baytlık erişim anahtarıyla yapılır; anahtarı bilen herkes adını yazarak üye olur. Anahtarı değiştirmek için
          sunucuda <code>npm run anahtar -- --yeni</code> çalıştırın (herkesin oturumu kapanır).</p>
        <table><thead><tr><th>Ad</th><th>İlk giriş</th><th>Son giriş</th><th>Giriş sayısı</th></tr></thead><tbody>
          {st.members.map((m: any) => <tr key={m.name}><td><b>{m.name}</b></td><td>{m.first_login.replace("T", " ")}</td><td>{m.last_login.replace("T", " ")}</td><td>{m.logins}</td></tr>)}
        </tbody></table>
      </div>

      <div className="box">
        <h3>Claude bağlayıcısı (MCP)</h3>
        <p className="sub">Claude Desktop ya da claude.ai'de <b>Ayarlar → Bağlayıcılar → Özel bağlayıcı ekle</b> ile aşağıdaki adresi ekleyin (site internete açıksa).
          Kendi bilgisayarınızdaki Claude Desktop için ise proje klasöründe <code>npm run mcp:kur</code> çalıştırın. Adresi gizli tutun.</p>
        <div className="copyrow"><code>{mcpUrl}</code><button onClick={() => copy(mcpUrl)}>Kopyala</button></div>
      </div>

      <div className="box">
        <h3>Yedek ve taşıma</h3>
        <p className="sub">Tüm veriyi tek dosya olarak indirin. Başka bir kuruluma yüklediğinizde mevcut veriyle <b>birleşir</b>; hiçbir şeyin üzerine yazılmaz.
          Eski (Python) sürümün yedekleri de yüklenebilir.</p>
        <div className="form-row" style={{ maxWidth: 520 }}>
          <button className="primary" onClick={() => (location.href = "/api/yedek")}>Yedeği indir (.zip)</button>
          <button onClick={() => fileRef.current?.click()}>Yedek yükle ve birleştir</button>
          <input ref={fileRef} type="file" accept=".zip" hidden onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = "";
            if (!f) return;
            setResult("Yedek birleştiriliyor… (büyük yedeklerde birkaç dakika sürebilir)");
            const fd = new FormData(); fd.append("file", f);
            try {
              const r = await api("/api/yedek", { method: "POST", body: fd });
              setResult(`Birleştirildi: ${r.bellek_dosyasi} Bellek dosyası eklendi (${r.bellek_atlandi} zaten vardı), ${r.senaryo} senaryo eklendi (${r.senaryo_atlandi} zaten vardı), ${r.kural} kural, ${r.not_duzeltmesi} not düzeltmesi.`);
            } catch (x: any) { setResult(x.message); }
          }} />
        </div>
        {result && <p className="sub" style={{ marginTop: 10 }}>{result}</p>}
        <p className="sub" style={{ marginTop: 10 }}>Veri klasörü: <code>{st.data_dir}</code></p>
      </div>
    </div></div></section>
  );
}
