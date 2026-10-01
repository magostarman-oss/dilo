"use client";

import type { Dilo } from "./useDilo";
import { Clarify } from "./Clarify";
import { CloseIcon } from "./icons";
import { CalendarLink } from "./CalendarLink";
import { itemMeta, typeLabel } from "./display";

/** What DILO understood from the last message, already remembered. */
export function Understood({ dilo }: { dilo: Dilo }) {
  const last = dilo.lastHeard;
  if (!last) return null;

  if (last.items.length === 0) {
    return (
      <section className="card understood" aria-live="polite">
        <header className="card-head">
          <p className="said">“{last.text}”</p>
          <button className="icon-btn" onClick={dilo.dismissLast} aria-label="Chiudi">
            <CloseIcon />
          </button>
        </header>
        <p className="dilo-reply">{last.reply}</p>
      </section>
    );
  }

  const asking = last.items.filter((i) => i.clarification).length;
  const title =
    asking === last.items.length
      ? "Mi serve un dettaglio"
      : last.items.length === 1
        ? "Ho capito"
        : `Ho capito ${last.items.length} cose`;

  return (
    <section className="card understood" aria-live="polite">
      <header className="card-head">
        <div>
          <h2 className="card-title">{title}</h2>
          <p className="said">“{last.text}”</p>
        </div>
        <button className="icon-btn" onClick={dilo.dismissLast} aria-label="Chiudi">
          <CloseIcon />
        </button>
      </header>

      <ol className="understood-list">
        {last.items.map((item) => (
          <li key={item.id} className={`understood-item type-${item.type}`}>
            <span className="type-chip">{typeLabel(item)}</span>
            <p className="item-title">{item.title}</p>
            {itemMeta(item, dilo.now) && <p className="item-meta">{itemMeta(item, dilo.now)}</p>}
            {item.clarification ? <Clarify item={item} dilo={dilo} /> : <CalendarLink item={item} synced={dilo.entries.some((e) => e.item.id === item.id && e.calendar)} />}
          </li>
        ))}
      </ol>

      <footer className="card-foot">
        <span>{asking ? "Il resto l'ho già salvato." : "Salvato. Ci penso io."}</span>
        <button className="text-btn" onClick={() => void dilo.undoLast()}>
          Annulla
        </button>
      </footer>
    </section>
  );
}
