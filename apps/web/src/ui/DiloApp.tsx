"use client";

import { useDilo } from "./useDilo";
import { Composer } from "./Composer";
import { Understood } from "./Understood";
import { Agenda } from "./Agenda";
import { CloseIcon } from "./icons";

export function DiloApp() {
  const dilo = useDilo();

  return (
    <main className="app">
      <header className="top">
        <span className="wordmark">DILO</span>
      </header>

      <section className="hero">
        <h1 className="headline">Cosa hai in testa?</h1>
        <Composer dilo={dilo} />
      </section>

      {dilo.error && (
        <div className="toast" role="alert">
          <span>{dilo.error}</span>
          <button className="icon-btn" onClick={dilo.dismissError} aria-label="Chiudi">
            <CloseIcon />
          </button>
        </div>
      )}

      <Understood dilo={dilo} />
      <Agenda dilo={dilo} />

      <footer className="payoff">Tu dillo. DILO ci pensa.</footer>
    </main>
  );
}
