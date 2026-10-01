import type { DiloItem, ItemType } from "@dilo/core";

/**
 * Realistic Italian sentences and what DILO must understand from them.
 * "Now" is mercoledì 30 settembre 2026, 10:00, Europe/Rome.
 * Only the fields listed are checked, so the cases describe behaviour, not wording.
 */
export const LIVE_NOW = new Date("2026-09-30T10:00:00+02:00");

export interface ExpectedItem {
  type: ItemType | ItemType[];
  title?: RegExp;
  date?: string | null;
  time?: string | null;
  partOfDay?: DiloItem["partOfDay"];
  window?: DiloItem["window"];
  deadline?: string;
  weekdays?: number[];
  frequency?: string;
  alertMinutesBefore?: number;
  /** true: must ask; false: must not ask; undefined: either. */
  asks?: boolean;
}

export interface LiveCase {
  text: string;
  items: ExpectedItem[];
  /** Expect no items and a reply. */
  replyOnly?: boolean;
}

export const CASES: LiveCase[] = [
  {
    text: "Domani alle 10 devo chiamare Luca per l'evento, ricordamelo.",
    items: [{ type: "reminder", title: /chiamare luca/i, date: "2026-10-01", time: "10:00", asks: false }],
  },
  {
    text: "Domani alle 15 prenota il dentista e ricordami di chiamare Marco.",
    items: [
      { type: "task", title: /dentista/i, date: "2026-10-01", time: "15:00", asks: false },
      { type: "reminder", title: /chiamare marco/i, date: "2026-10-01", time: null, asks: false },
    ],
  },
  {
    text: "Ricordami di chiamare Marco",
    items: [{ type: "reminder", title: /chiamare marco/i, asks: true }],
  },
  {
    text: "Venerdì sera cena con Giulia da Mario",
    items: [{ type: "event", title: /cena/i, date: "2026-10-02", time: null, partOfDay: "sera", asks: false }],
  },
  {
    text: "Ogni lunedì e giovedì alle 7 vado a correre",
    items: [{ type: "routine", title: /corr/i, frequency: "weekly", weekdays: [1, 4], time: "07:00", asks: false }],
  },
  {
    text: "Devo consegnare il preventivo entro venerdì",
    items: [{ type: "task", title: /preventivo/i, deadline: "2026-10-02", asks: false }],
  },
  {
    text: "Il codice del cancello di casa di mia madre è 4512",
    items: [{ type: "note", title: /4512|cancello/i, asks: false }],
  },
  {
    text: "Tra 20 minuti ricordami di togliere la torta dal forno",
    items: [{ type: "reminder", title: /torta/i, date: "2026-09-30", time: "10:20", asks: false }],
  },
  {
    text: "La settimana prossima devo chiamare il commercialista",
    items: [{ type: ["task", "reminder"], title: /commercialista/i, date: null, window: { from: "2026-10-05", to: "2026-10-11" } }],
  },
  {
    text: "Ricordami quella cosa domani",
    items: [{ type: ["reminder", "task"], asks: true }],
  },
  { text: "Ciao DILO, come va?", items: [], replyOnly: true },
  {
    text: "Il 15 ottobre alle 9 e mezza ho la visita dal cardiologo, avvisami un'ora prima",
    items: [{ type: "event", title: /cardiolog/i, date: "2026-10-15", time: "09:30", alertMinutesBefore: 60, asks: false }],
  },
  {
    text: "Compra latte, pane e uova e stasera chiama la nonna",
    items: [
      { type: "task", title: /latte|spesa/i },
      { type: ["task", "reminder"], title: /nonna/i, date: "2026-09-30", partOfDay: "sera" },
    ],
  },
  {
    text: "Ogni primo del mese devo pagare l'affitto",
    items: [{ type: ["routine", "reminder", "task"], title: /affitto/i, frequency: "monthly", date: "2026-10-01", asks: false }],
  },
  {
    text: "Domattina alle 8 prendo il treno per Milano e alle 11 ho la riunione con il cliente",
    items: [
      { type: ["event", "task"], title: /treno/i, date: "2026-10-01", time: "08:00" },
      { type: "event", title: /riunione/i, date: "2026-10-01", time: "11:00" },
    ],
  },
  {
    text: "Il 31 novembre festa di Anna",
    items: [{ type: "event", title: /anna/i, asks: true }],
  },
  {
    text: "Mercoledì prossimo alle 5 call con il team di marketing",
    items: [{ type: "event", title: /call|team/i, date: "2026-10-07" }],
  },
  {
    text: "Dopodomani devo portare la macchina dal meccanico e ritirare il vestito in lavanderia",
    items: [
      { type: "task", title: /macchina|meccanico/i, date: "2026-10-02" },
      { type: "task", title: /vestito|lavanderia/i, date: "2026-10-02" },
    ],
  },
  {
    text: "Idea per il weekend: fare un podcast sulla cucina siciliana",
    items: [{ type: "note", title: /podcast/i }],
  },
  {
    text: "Stamattina alle 9 dovevo chiamare Paolo",
    items: [{ type: ["task", "reminder"], title: /paolo/i, asks: true }],
  },
  {
    text: "sabato alle 21 concerto dei Coldplay a San Siro con Fede e Marti",
    items: [{ type: "event", title: /coldplay|concerto/i, date: "2026-10-03", time: "21:00", asks: false }],
  },
  {
    text: "a giorni alterni annaffiare le piante del balcone",
    items: [{ type: "routine", title: /piante/i, frequency: "daily" }],
  },
];
