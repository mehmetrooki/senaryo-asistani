// MCP araçları: Claude Desktop (stdio) ve web bağlayıcısı (HTTP) aynı tanımları kullanır.
import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as db from "./db.js";
import { aiReady, buildSystem } from "./ai.js";
import { readTexts } from "./docx.js";
import { ingestFile } from "./memory.js";
import * as svc from "./service.js";
import { trLower } from "./text.js";

const INSTRUCTIONS = "Çocuk çizgi filmi senaryolarını denetleyen Senaryo Asistanı. Ekibin geçmiş notları Bellek'tedir (bellege_yukle ile "
  + "eklenir). Bir senaryo incelenecekse: ÖNCE inceleme_yonergesi'ni çağır ve ona uy -> senaryo_yukle ile .docx yükle (ya da "
  + "senaryolari_listele ile arayüzde yüklenmiş olanı seç; kural taraması otomatik yapılır) -> senaryo_metni ile metni parça parça oku -> "
  + "her sorun ve iyileştirme fırsatı (argo, yazım, 'he' gibi nidalar, yabancı kelime, fazlalık, kötü örnek davranış, tehlikeli eylem, "
  + "tutarsızlık) için bulgu_ekle -> kullanıcıya özet sun -> onaylananları oneri_uygula ile işaretle -> export_al ile orijinal biçimi "
  + "(Fransız senaryo formatı dahil) koruyarak .docx üret. Web arayüzü de aynı veriyi kullanır; eklediğin bulgular orada da görünür.";

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });
const docOrLatest = (id?: string) => {
  const d = id ? db.getDocument(id) : db.latestDocument();
  if (!d) throw new Error("Belge bulunamadı. Önce senaryo_yukle ile bir .docx yükleyin.");
  return d;
};
const view = (f: any) => ({ bulgu_id: f.id, paragraf: f.paragraph, alinti: f.original, oneriler: f.suggestions, kategori: f.category,
  neden: f.reason, ciddiyet: f.severity, kaynak: f.source, durum: f.status, secilen: f.chosen });
const home = (p: string) => p.replace(/^~(?=$|[\\/])/, process.env.USERPROFILE || process.env.HOME || "~");

export function createMcpServer(user = "Claude") {
  const s = new McpServer({ name: "senaryo-asistani", version: "2.0.0" }, { instructions: INSTRUCTIONS });
  const tool = (name: string, description: string, shape: z.ZodRawShape, fn: (a: any) => unknown) =>
    s.registerTool(name, { description, inputSchema: shape }, async (a: any) => ok(await fn(a)));

  tool("inceleme_yonergesi", "Bir senaryoyu incelemeden ÖNCE çağır: ekibin editör yönergesi, kural listesi ve Bellek'teki geçmiş notlar.",
    {}, () => [...buildSystem().map((b) => b.text), "MCP ile çalışma şekli:\n- senaryo_metni ile metni parça parça oku (ör. 120 paragraf), "
      + "her aralığı ayrıntılı incele.\n- Her sorun/iyileştirme için bulgu_ekle; 'alinti' paragraftan harfi harfine en kısa parça.\n"
      + "- Öneri Bellek'teki bir düzeltmeye dayanıyorsa bellek_kaynagi'na o bölümün adını yaz.\n- Kural taraması zaten yapıldı: "
      + "bulgulari_listele ile bak, tekrar ekleme.\n- Sonunda özet sun; onaylananları oneri_uygula ile uygula, sonra export_al."].join("\n\n"));

  tool("senaryo_yukle", "Bir .docx senaryoyu yükler; değişikliklerden öğrenir ve kural listesiyle tarar.",
    { dosya_yolu: z.string(), claude_api_ile_incele: z.boolean().optional() }, async (a) => {
      const f = path.resolve(home(a.dosya_yolu));
      if (!fs.existsSync(f) || !f.toLowerCase().endsWith(".docx")) throw new Error(`Geçerli bir .docx bulunamadı: ${f}`);
      const d = await svc.ingest(f, path.basename(f), !!a.claude_api_ile_incele, user);
      return { belge_id: d.id, ad: d.name, durum: d.status, not: d.status_detail, paragraf_sayisi: d.paragraph_count,
        ogrenilen_degisiklik: d.learned_count, bulgular: db.listFindings(d.id).map(view) };
    });
  tool("senaryolari_listele", "Yüklenmiş senaryolar (en yeni önce) ve öneri sayıları.", {},
    () => db.listDocuments().map((d) => ({ belge_id: d.id, ad: d.name, yukleyen: d.uploaded_by, yuklenme: d.uploaded_at, durum: d.status, sayilar: d.counts })));
  tool("senaryo_metni", "Senaryonun paragraflarını numaralarıyla verir (bulgu_ekle'de bu numaralar kullanılır).",
    { belge_id: z.string().optional(), baslangic: z.number().int().optional(), adet: z.number().int().optional() }, async (a) => {
      const d = docOrLatest(a.belge_id), t = await readTexts(d.stored_path), b = a.baslangic ?? 0;
      return { belge_id: d.id, ad: d.name, toplam_paragraf: t.length,
        paragraflar: t.map((metin, paragraf) => ({ paragraf, metin })).filter((p) => p.metin.trim()).slice(b, b + (a.adet ?? 400)) };
    });
  tool("bulgulari_listele", "Bir belgedeki öneriler. durum: bekliyor | kabul | red | tum",
    { belge_id: z.string().optional(), durum: z.string().optional() },
    (a) => db.listFindings(docOrLatest(a.belge_id).id, a.durum === "tum" ? undefined : a.durum ?? "bekliyor").map(view));
  tool("bulgu_ekle", "Bir sorunu/iyileştirme fırsatını işaretler. 'alinti' paragraftan harfi harfine en kısa parça; 'oneriler' yerine yazılacak "
    + "1-3 metin (silmek için \"\"). ciddiyet: dusuk|orta|yuksek. İlk öneri Bellek'e dayanıyorsa bellek_kaynagi'na bölüm adını yaz.",
    { belge_id: z.string(), paragraf: z.number().int(), alinti: z.string(), oneriler: z.array(z.string()), neden: z.string(),
      kategori: z.string().optional(), ciddiyet: z.string().optional(), bellek_kaynagi: z.string().optional() }, async (a) => {
      const d = docOrLatest(a.belge_id), t = (await readTexts(d.stored_path))[a.paragraf];
      if (t === undefined) throw new Error("Paragraf numarası geçersiz");
      let pos = t.indexOf(a.alinti);
      if (pos < 0) pos = trLower(t).indexOf(trLower(a.alinti));
      if (pos < 0) throw new Error(`Alıntı ${a.paragraf}. paragrafta bulunamadı. Paragraf: ${JSON.stringify(t)}`);
      const sugg = a.oneriler.map((text: string, i: number) => ({ text, kaynak: i === 0 && a.bellek_kaynagi ? "bellek" : "claude", ref: i === 0 ? a.bellek_kaynagi ?? "" : "" }));
      return view(db.addFinding(d.id, a.paragraf, pos, pos + a.alinti.length, t.slice(pos, pos + a.alinti.length), sugg,
        { category: a.kategori ?? "diğer", reason: a.neden, severity: a.ciddiyet ?? "orta", source: "mcp" }));
    });
  tool("oneri_uygula", "Öneriyi kabul eder; 'metin' verilmezse önerilerden oneri_no (0'dan) seçilir.",
    { bulgu_id: z.string(), metin: z.string().optional(), oneri_no: z.number().int().optional() }, (a) => {
      const f = db.getFinding(a.bulgu_id);
      if (!f) throw new Error("Bulgu bulunamadı");
      const text = a.metin ?? f.suggestions[Math.min(Math.max(a.oneri_no ?? 0, 0), f.suggestions.length - 1)];
      if (text === undefined) throw new Error("Bu bulgunun hazır önerisi yok; 'metin' verin.");
      return view(svc.decide(a.bulgu_id, "kabul", text));
    });
  tool("bulgu_reddet", "Öneriyi yok sayar.", { bulgu_id: z.string() }, (a) => {
    const r = svc.decide(a.bulgu_id, "red");
    if (!r) throw new Error("Bulgu bulunamadı");
    return view(r);
  });
  tool("export_al", "Kabul edilenleri uygulayıp .docx üretir; orijinal biçim (Fransız formatı) aynen korunur. izlenen_degisiklik=true: Word'de izlenen değişiklik.",
    { belge_id: z.string().optional(), izlenen_degisiklik: z.boolean().optional(), hedef_yol: z.string().optional() }, async (a) => {
      const r = await svc.exportDoc(docOrLatest(a.belge_id).id, !!a.izlenen_degisiklik, a.hedef_yol ? path.resolve(home(a.hedef_yol)) : undefined);
      return { dosya: r.path, uygulanan: r.applied, bekleyen_oneri: r.pending, atlanan: r.skipped };
    });
  tool("kural_ekle", "Kalıcı kural. tur: kelime | kok (kök+ekler) | ifade | desen (düzenli ifade).",
    { ifade: z.string(), yerine: z.array(z.string()), tur: z.string().optional(), kategori: z.string().optional(), neden: z.string().optional() },
    (a) => db.addRule(a.ifade, a.yerine, { match_type: a.tur ?? "kelime", category: a.kategori ?? "argo", reason: a.neden ?? "" }));
  tool("kurallari_listele", "Kurallar. durum: aktif | aday (öğrenilmiş, onay bekleyen) | tum", { durum: z.string().optional() },
    (a) => db.listRules(a.durum === "tum" ? undefined : a.durum ?? "aktif").map((r) => ({ kural_id: r.id, ifade: r.pattern, yerine: r.replacements,
      tur: r.match_type, kategori: r.category, kaynak: r.source, durum: r.status })));
  tool("kural_onayla", "Öğrenilmiş (aday) kuralı aktif yapar.", { kural_id: z.string(), yerine: z.array(z.string()).optional() },
    (a) => db.updateRule(a.kural_id, { status: "aktif", replacements: a.yerine }));
  tool("kural_sil", "Kuralı siler.", { kural_id: z.string() }, (a) => (db.deleteRule(a.kural_id), "silindi"));
  tool("surumlerden_ogren", "Aynı senaryonun eski ve düzeltilmiş sürümünden (belge_id ya da .docx yolu) değişiklikleri öğrenir.",
    { eski: z.string(), yeni: z.string() }, async (a) => {
      const r = (x: string) => db.getDocument(x)?.stored_path ?? path.resolve(home(x));
      return { ogrenilen: await svc.learnFromVersions(r(a.eski), r(a.yeni)) };
    });
  tool("yeniden_tara", "Güncel kurallarla belgeyi yeniden tarar.", { belge_id: z.string().optional(), claude_api_ile: z.boolean().optional() }, async (a) => {
    const d = docOrLatest(a.belge_id);
    let n = await svc.scanRules(d.id);
    if (a.claude_api_ile && aiReady()) n += await svc.scanAi(d.id);
    return { belge_id: d.id, bulgu: n, bulgular: db.listFindings(d.id).map(view) };
  });
  tool("bellege_yukle", "Ekibin notlu ('-commented') senaryolarını ve son hâllerini belleğe ekler; klasör yolu da verilebilir.",
    { dosya_yollari: z.array(z.string()) }, async (a) => {
      const files = a.dosya_yollari.flatMap((p: string) => {
        p = path.resolve(home(p));
        return fs.existsSync(p) && fs.statSync(p).isDirectory() ? fs.readdirSync(p).sort().map((f) => path.join(p, f)) : [p];
      }).filter((f: string) => f.toLowerCase().endsWith(".docx") && !path.basename(f).startsWith("~$") && fs.existsSync(f));
      const yuklenen: any[] = [];
      for (const f of files) yuklenen.push({ dosya: path.basename(f), ...(await ingestFile(f, path.basename(f), user)) });
      void svc.rescanAllRules();
      return { yuklenen, toplam_ders: db.listLessons().length };
    });
  tool("bellek_notlari", "Bellekteki ekip notları (ekip neye not düştü, nasıl düzeltti).",
    { kategori: z.string().optional(), arama: z.string().optional(), en_fazla: z.number().int().optional() }, (a) => {
      const all = db.listLessons(true), q = a.arama ? trLower(a.arama) : "";
      const cats: Record<string, number> = {};
      for (const l of all) cats[l.category] = (cats[l.category] ?? 0) + 1;
      return { kategoriler: cats, notlar: all.filter((l) => (!a.kategori || l.category === a.kategori) && (!q || trLower(l.note + " " + l.anchor).includes(q)))
        .slice(0, a.en_fazla ?? 60).map((l) => ({ bolum: l.source_name, kategori: l.category, not: l.note, isaretlenen: l.anchor, duzeltme: l.changes, sonuc: l.outcome })) };
    });
  return s;
}
