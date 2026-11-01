"use client";

import { useEffect, useState } from "react";
import { event, start, stop } from "@looku/browser";

// A minimal consent banner. The browser collector starts only after "Salli".
// The choice is remembered by the site (here in localStorage), not by Looku.
export default function Consent() {
  const [choice, setChoice] = useState(null);

  useEffect(() => {
    const saved = localStorage.getItem("demo-consent");
    setChoice(saved);
    if (saved === "yes") start();
  }, []);

  const decide = (value) => {
    localStorage.setItem("demo-consent", value);
    setChoice(value);
    if (value === "yes") start();
    else stop();
  };

  return (
    <footer style={{ marginTop: 48, padding: 12, border: "1px solid #ccc", borderRadius: 6 }}>
      {choice === null ? (
        <p>
          Saako tämä sivu mitata lukuajan ja vierityksen?{" "}
          <button onClick={() => decide("yes")}>Salli</button> <button onClick={() => decide("no")}>Kiellä</button>
        </p>
      ) : (
        <p>
          Mittaus: {choice === "yes" ? "sallittu" : "kielletty"}.{" "}
          <button onClick={() => decide(choice === "yes" ? "no" : "yes")}>Vaihda</button>{" "}
          {choice === "yes" && <button onClick={() => event("demo_click", { target: "footer" })}>Lähetä tapahtuma</button>}
        </p>
      )}
    </footer>
  );
}
