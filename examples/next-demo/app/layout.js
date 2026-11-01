import Consent from "./consent.js";

export const metadata = { title: "Looku demo" };

export default function RootLayout({ children }) {
  return (
    <html lang="fi">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "40px auto", padding: "0 16px" }}>
        <nav style={{ display: "flex", gap: 16 }}>
          <a href="/">Etusivu</a>
          <a href="/oppaat">Oppaat</a>
          <a href="/tuotteet">Tuotteet</a>
          <a href="/?utm_source=demo&utm_campaign=kokeilu">Kampanjalinkki</a>
        </nav>
        {children}
        <Consent />
      </body>
    </html>
  );
}
