import { CalendarSyncedStore, type GoogleCalendarApi } from "@dilo/actions";
import { DiloApiError, DiloAssistant, type DiloApi, type Heard, type UnderstandResponse } from "@dilo/client";
import { buildAgenda, todayIso, toGoogleEvent, type AgendaEntry, type DiloItem, type IsoDate } from "@dilo/core";
import { isDoneOn, KeyValueItemStore, type ItemStore, type MemoryEntry } from "@dilo/memory";
import { clockLabel, itemMeta, longDay, typeLabel } from "../../ui/display";
import { handleAnswer, handleUnderstand, type ApiResult, type EngineProvider } from "../handlers";
import type { ServerKv } from "./kv";

/**
 * DILO as a chat: one WhatsApp message in, one reply out. The same assistant
 * as the web app (understand, remember, change, cancel), with memory kept on
 * the server per phone number instead of in the browser.
 */

export interface ChatDeps {
  getEngine: EngineProvider;
  kv: ServerKv;
  timezone: string;
  now?: () => Date;
  /** The user's Google Calendar, when the server is set up for it. */
  calendar?: ChatCalendar | null;
}

export interface ChatCalendar {
  /** The user's calendar, or null while they have not connected it. */
  open(userId: string): Promise<GoogleCalendarApi | null>;
  /** The link that connects it. */
  connectLink(userId: string): Promise<string>;
}

/** What DILO remembers about the conversation itself, beyond the items. */
interface ChatState {
  /** The question DILO just asked, so the next message is read as its answer. */
  pending?: { itemId: string; askedAt: string } | null;
  /** What the last message did, so "annulla" can take it back. */
  last?: Pick<Heard, "items" | "previous" | "cancelled"> | null;
  /** DILO already suggested connecting Google Calendar once. */
  calendarHinted?: boolean;
}

/** An answer counts only shortly after the question; later, a message is something new. */
const ANSWER_WINDOW_MS = 2 * 60 * 60 * 1000;

export const HELP_TEXT = [
  "Scrivimi o mandami un vocale con quello che hai in testa, ci penso io.",
  "",
  "Per esempio: «Domani alle 15 prenota il dentista e ricordami di chiamare Marco».",
  "",
  "Puoi anche scrivere:",
  "• *oggi* per vedere cosa hai in programma oggi",
  "• *domani* per vedere domani",
  "• *annulla* se ho capito male l'ultimo messaggio",
  "• *calendario* per collegare il tuo Google Calendar",
].join("\n");

const WELCOME = `Ciao, sono DILO. Tu dillo, DILO ci pensa.\n\n${HELP_TEXT}`;

const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const COMMANDS: { match: RegExp; command: "greet" | "help" | "today" | "tomorrow" | "undo" | "calendar" }[] = [
  { match: /^(ciao|salve|hey|ehi|buongiorno|buonasera|start|inizia)( dilo)?$/, command: "greet" },
  { match: /^(aiuto|help|\?|come funziona|cosa sai fare)$/, command: "help" },
  { match: /^((cosa|che) (ho|c e|devo fare) )?oggi$/, command: "today" },
  { match: /^((cosa|che) (ho|c e|devo fare) )?domani$/, command: "tomorrow" },
  { match: /^(annulla|annullalo|cancella l ultimo|undo)$/, command: "undo" },
  { match: /^(collega )?(il )?(mio )?(google )?calendar(io)?( google)?$/, command: "calendar" },
];

export async function chat(userId: string, text: string, deps: ChatDeps): Promise<string> {
  const now = deps.now ?? (() => new Date());
  const prefix = `dilo:wa:${userId}`;
  const memory = new KeyValueItemStore(deps.kv, `${prefix}:memory`, now);
  const state = await readState(deps.kv, `${prefix}:state`);
  const save = (next: ChatState) => deps.kv.setItem(`${prefix}:state`, JSON.stringify({ ...state, ...next }));

  const normalized = normalize(text);
  const command = COMMANDS.find((c) => c.match.test(normalized))?.command;
  switch (command) {
    case "greet":
      return WELCOME;
    case "help":
      return HELP_TEXT;
    case "today":
    case "tomorrow": {
      const today = todayIso(now(), deps.timezone);
      const day = command === "today" ? today : addDays(today, 1);
      return formatAgenda(await memory.all(), day, command === "today" ? "Oggi" : "Domani", now());
    }
    case "calendar":
      return calendarReply(userId, deps, memory, now);
  }

  // From here on DILO may change memory, and the calendar follows.
  const { store, sync } = await withCalendar(userId, deps, memory, now);
  const assistant = new DiloAssistant(inProcessApi(deps.getEngine), store, deps.timezone, now);

  if (command === "undo") {
    if (!state.last) return "Non c'è niente da annullare.";
    await assistant.forget(state.last);
    await save({ pending: null, last: null });
    await sync();
    return "Fatto, ho annullato l'ultimo messaggio.";
  }

  try {
    let heard: Heard;
    const pendingItem = await openQuestion(state, await memory.all(), now());
    if (pendingItem) {
      heard = await assistant.answer(pendingItem, text);
      // The answer replaced the item that asked: undo brings that one back.
      heard = { ...heard, previous: [pendingItem], cancelled: [] };
    } else {
      heard = await assistant.say(text);
    }
    const question = heard.items.find((i) => i.clarification);
    const synced = await sync();
    // Once, when something with a date arrives and the calendar could be connected: say so.
    const hint = !!deps.calendar && !synced && !state.calendarHinted && heard.items.some((i) => toGoogleEvent(i));
    await save({
      pending: question ? { itemId: question.id, askedAt: now().toISOString() } : null,
      last: heard.items.length || heard.cancelled.length ? heard : state.last ?? null,
      ...(hint ? { calendarHinted: true } : {}),
    });
    const reply = formatHeard(heard, now());
    return hint ? `${reply}\n\nVuoi ritrovarlo anche nel tuo Google Calendar? Scrivi *calendario*.` : reply;
  } catch (err) {
    if (err instanceof DiloApiError) return err.message;
    throw err;
  }
}

/**
 * Memory wrapped so that the user's Google Calendar follows it, when connected.
 * `sync` writes what changed and says whether the calendar is connected.
 */
async function withCalendar(
  userId: string,
  deps: ChatDeps,
  memory: ItemStore,
  now: () => Date,
): Promise<{ store: ItemStore; sync: () => Promise<boolean> }> {
  let api: GoogleCalendarApi | null = null;
  try {
    api = (await deps.calendar?.open(userId)) ?? null;
  } catch (err) {
    console.error("[dilo] google calendar unavailable:", err);
  }
  if (!api) return { store: memory, sync: async () => false };
  const store = new CalendarSyncedStore(memory, api, () => todayIso(now(), deps.timezone), undefined, now);
  return {
    store,
    sync: async () => {
      await store.sync();
      return true;
    },
  };
}

/** Writes everything DILO remembers with a date to the calendar, e.g. right after connecting it. */
export async function syncCalendar(userId: string, deps: ChatDeps): Promise<boolean> {
  const now = deps.now ?? (() => new Date());
  const memory = new KeyValueItemStore(deps.kv, `dilo:wa:${userId}:memory`, now);
  return (await withCalendar(userId, deps, memory, now)).sync();
}

async function calendarReply(userId: string, deps: ChatDeps, memory: ItemStore, now: () => Date): Promise<string> {
  if (!deps.calendar) return "Il collegamento con Google Calendar non è ancora attivo.";
  const { sync } = await withCalendar(userId, deps, memory, now);
  if (await sync()) return "Il tuo Google Calendar è già collegato ✅ Tutto quello che ha una data lo scrivo lì.";
  const link = await deps.calendar.connectLink(userId);
  return `Tocca qui per collegare il tuo Google Calendar (il link vale un'ora):\n${link}\n\nDa quel momento tutto quello che ha una data lo scrivo anche lì.`;
}

/** The pending item, if DILO's last question is still open and recent. */
async function openQuestion(state: ChatState, entries: MemoryEntry[], now: Date): Promise<DiloItem | null> {
  const p = state.pending;
  if (!p || now.getTime() - Date.parse(p.askedAt) > ANSWER_WINDOW_MS) return null;
  const item = entries.find((e) => e.item.id === p.itemId)?.item;
  return item?.status === "needs_clarification" ? item : null;
}

async function readState(kv: ServerKv, key: string): Promise<ChatState> {
  try {
    const raw = await kv.getItem(key);
    return raw ? (JSON.parse(raw) as ChatState) : {};
  } catch {
    return {};
  }
}

/** The engine called directly, behind the same interface the apps use over HTTP. */
function inProcessApi(getEngine: EngineProvider): DiloApi {
  const unwrap = ({ body, status }: ApiResult): UnderstandResponse => {
    if ("error" in body) throw new DiloApiError(body.error.message, body.error.code, status);
    return body;
  };
  return {
    understand: async (req) => unwrap(await handleUnderstand(req, getEngine)),
    answer: async (req) => unwrap(await handleAnswer(req, getEngine)),
  };
}

function itemLine(item: DiloItem, now: Date): string {
  const meta = itemMeta(item, now);
  return `• ${typeLabel(item)}: *${item.title}*${meta ? ` — ${meta}` : ""}`;
}

export function formatHeard(heard: Heard, now: Date): string {
  if (heard.items.length === 0 && heard.cancelled.length === 0) {
    return heard.reply ?? "Non ho trovato niente da ricordare. Cosa hai in testa?";
  }
  const blocks: string[] = [];
  const changed = new Set(heard.updated);
  const added = heard.items.filter((i) => !changed.has(i.id));
  const updated = heard.items.filter((i) => changed.has(i.id));
  const list = (title: string, lines: string[]) => blocks.push([title, ...lines].join("\n"));
  if (added.length) list(added.length === 1 ? "Ho capito, me lo segno:" : "Ho capito, mi segno:", added.map((i) => itemLine(i, now)));
  if (updated.length) list("Ho cambiato:", updated.map((i) => itemLine(i, now)));
  if (heard.cancelled.length) list("Ho tolto:", heard.cancelled.map((i) => `• ${i.title}`));
  const question = heard.items.find((i) => i.clarification)?.clarification?.question;
  if (question) blocks.push(question);
  return blocks.join("\n\n");
}

export function formatAgenda(entries: MemoryEntry[], date: IsoDate, label: string, now: Date): string {
  const byId = new Map(entries.map((e) => [e.item.id, e]));
  const isDone = (item: DiloItem) => {
    const e = byId.get(item.id);
    return e ? isDoneOn(e, date) : false;
  };
  const agenda = buildAgenda(
    entries.map((e) => e.item),
    date,
    { isDone },
  );
  const open = (list: AgendaEntry[]) => list.filter((e) => !isDone(e.item));
  const line = (e: AgendaEntry) => {
    const clock = clockLabel(e.time, e.partOfDay);
    return `• ${clock ? `${clock} ` : ""}${e.item.title}`;
  };

  const sections: string[] = [];
  const schedule = open(agenda.schedule);
  const anytime = open(agenda.anytime);
  const deadlines = open(agenda.deadlines);
  if (schedule.length) sections.push(schedule.map(line).join("\n"));
  if (anytime.length) sections.push(["*In giornata*", ...anytime.map(line)].join("\n"));
  if (deadlines.length) sections.push(["*Scadenze*", ...deadlines.map(line)].join("\n"));
  if (label === "Oggi" && agenda.overdue.length) {
    sections.push(["*Rimasto indietro*", ...agenda.overdue.map((e) => itemLine(e.item, now))].join("\n"));
  }
  if (label === "Oggi" && agenda.toClarify.length) {
    sections.push(["*Da chiarire*", ...agenda.toClarify.map((i) => `• ${i.title}: ${i.clarification?.question ?? ""}`)].join("\n"));
  }

  const head = `*${label}, ${longDay(date)}*`;
  if (sections.length === 0) return `${head}\nNon hai niente in programma.`;
  return [head, ...sections].join("\n\n");
}

function addDays(iso: IsoDate, n: number): IsoDate {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
