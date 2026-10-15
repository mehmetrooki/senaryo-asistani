import type { Metadata } from "next";
import Header from "./header";
import "./globals.css";

export const metadata: Metadata = { title: "Senaryo Asistanı", description: "Çocuk animasyon senaryoları için denetim asistanı" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>
        <Header />
        <main>{children}</main>
        <div className="toast" id="toast" />
      </body>
    </html>
  );
}
