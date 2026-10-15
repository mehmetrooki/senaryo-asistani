// Yerel MCP sunucusunu Claude Desktop'a ekler (Windows Store sürümünün paket içi ayar dosyası dahil).
// Kullanım: npm run mcp:kur            (sorar)   |   npm run mcp:kur -- --evet   (sormadan)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { ROOT } from "./config.js";

const entry = { command: process.execPath, args: [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), path.join(ROOT, "backend/src/mcp-stdio.ts")] };

function configPaths() {
  if (process.platform === "darwin") return [path.join(os.homedir(), "Library/Application Support/Claude/claude_desktop_config.json")];
  if (process.platform !== "win32") return [path.join(os.homedir(), ".config/Claude/claude_desktop_config.json")];
  const out = [path.join(process.env.APPDATA!, "Claude/claude_desktop_config.json")];
  const pk = path.join(process.env.LOCALAPPDATA ?? "", "Packages");
  if (fs.existsSync(pk)) for (const d of fs.readdirSync(pk).filter((x) => x.startsWith("Claude_"))) {
    const p = path.join(pk, d, "LocalCache/Roaming/Claude/claude_desktop_config.json");
    if (fs.existsSync(path.dirname(p))) out.push(p);
  }
  return out;
}

console.log("Eklenecek MCP sunucusu:\n" + JSON.stringify({ "senaryo-asistani": entry }, null, 2));
const paths = configPaths();
console.log("Güncellenecek ayar dosyaları:\n  " + paths.join("\n  "));
if (!process.argv.includes("--evet")) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question("Claude Desktop'a eklensin mi? [e/H]: ")).trim().toLowerCase();
  rl.close();
  if (!["e", "evet", "y"].includes(a)) process.exit(console.log("Değişiklik yapılmadı.") ?? 0);
}
for (const p of paths) {
  try {
    let data: any = {};
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, "utf8");
      data = raw.trim() ? JSON.parse(raw) : {};
      fs.copyFileSync(p, p + ".yedek");
    }
    (data.mcpServers ??= {})["senaryo-asistani"] = entry;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p + ".tmp", JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(p + ".tmp", p);
    console.log("  ✓ " + p);
  } catch (e: any) {
    console.log(`  ✗ ${p}: ${e.message}`);
  }
}
console.log("\nClaude Desktop'ı tamamen kapatıp (Quit) yeniden açın.");
