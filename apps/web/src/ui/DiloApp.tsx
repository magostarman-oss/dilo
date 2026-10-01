"use client";

import { useDilo } from "./useDilo";
import { Composer } from "./Composer";
import { Understood } from "./Understood";
import { Agenda } from "./Agenda";
import { CalendarStatus } from "./CalendarStatus";
import { CloseIcon } from "./icons";

export function DiloApp() {
  const dilo = useDilo();

  return (
    <main className="app">
      <header className="top">
        <span className="wordmark">DILO</span>
      </header>

      <section className="hero">
        <Composer dilo={dilo} headline={<h1 className="headline">Cosa hai in testa?</h1>} />
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
      <CalendarStatus dilo={dilo} />
      <Agenda dilo={dilo} />

      <footer className="payoff">Tu dillo. DILO ci pensa.</footer>
    </main>
  );
}
