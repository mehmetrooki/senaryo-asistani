import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

// Üretimde statik çıktı (frontend/out) — Fastify sunar. Geliştirmede API isteklerini backend'e yönlendir.
export default (phase) => phase === PHASE_DEVELOPMENT_SERVER
  ? { async rewrites() { return ["/api/:p*", "/baglanti/:p*"].map((source) => ({ source, destination: `http://127.0.0.1:${process.env.API_PORT || 8765}${source}` })); } }
  : { output: "export", trailingSlash: true, images: { unoptimized: true } };
