"use client";

import type { Dilo } from "./useDilo";
import { CalendarIcon } from "./icons";

/** Connect DILO to Google Calendar once; then everything with a day is written there by itself. */
export function CalendarStatus({ dilo }: { dilo: Dilo }) {
  const c = dilo.calendar;
  if (!c.available || !dilo.ready) return null;

  if (!c.wanted) {
    return (
      <button className="cal-status" onClick={() => void c.connect()} disabled={c.busy}>
        <CalendarIcon />
        <span>
          <strong>Collega Google Calendar</strong>
          <small>Salvo da solo i tuoi impegni nel calendario</small>
        </span>
      </button>
    );
  }
  if (!c.connected) {
    return (
      <button className="cal-status is-warning" onClick={() => void c.connect()} disabled={c.busy}>
        <CalendarIcon />
        <span>
          <strong>Ricollega Google Calendar</strong>
          <small>{c.waiting > 0 ? `${c.waiting} ${c.waiting === 1 ? "impegno" : "impegni"} in attesa` : "Il collegamento è scaduto"}</small>
        </span>
      </button>
    );
  }
  return (
    <div className="cal-status is-on">
      <CalendarIcon />
      <span>
        <strong>Google Calendar collegato</strong>
        <small>Ci penso io a salvarci i tuoi impegni</small>
      </span>
      <button className="text-btn" onClick={c.disconnect}>
        Scollega
      </button>
    </div>
  );
}
