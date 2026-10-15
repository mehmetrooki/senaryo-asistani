// 256 baytlık erişim anahtarı üretir ve proje kökündeki .env dosyasına yazar.
// Kullanım: npm run anahtar            (yoksa üretir)
//           npm run anahtar -- --yeni  (yenisini üretir; eski anahtarla girenlerin oturumu kapanır)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.js";

const file = path.join(ROOT, ".env");
let env = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
const has = /^SENARYO_ERISIM_ANAHTARI=[0-9a-f]{512}\s*$/m.test(env);
if (has && !process.argv.includes("--yeni")) {
  console.log(`Anahtar zaten var: ${file}\nYenisi için: npm run anahtar -- --yeni`);
} else {
  const line = `SENARYO_ERISIM_ANAHTARI=${crypto.randomBytes(256).toString("hex")}`;
  env = /^SENARYO_ERISIM_ANAHTARI=.*$/m.test(env) ? env.replace(/^SENARYO_ERISIM_ANAHTARI=.*$/m, line) : (env && !env.endsWith("\n") ? env + "\n" : env) + line + "\n";
  fs.writeFileSync(file, env, { encoding: "utf8", mode: 0o600 });
  console.log(`256 baytlık yeni erişim anahtarı ${file} dosyasına yazıldı.\nGiriş için bu dosyadaki SENARYO_ERISIM_ANAHTARI değerini kullanın; kimseyle paylaşmadığınız bir yerde saklayın.`);
}
