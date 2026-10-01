import { DateTime } from "luxon";
import type { DiloItem, IsoDate, LocalTime } from "./item";
import type { PartOfDay } from "./temporal";
import { occursOn } from "./recurrence";
import { DEFAULT_TIMEZONE } from "./resolve";

/**
 * The "Oggi" view: what DILO shows for a given day, computed from stored items.
 */

export interface AgendaEntry {
  item: DiloItem;
  /** Why it is on this day. */
  reason: "scheduled" | "recurring" | "deadline" | "overdue";
  time: LocalTime | null;
  partOfDay: PartOfDay | null;
}

export interface Agenda {
  date: IsoDate;
  /** Timed and part-of-day entries, in order. */
  schedule: AgendaEntry[];
  /** Things for today without a time ("in giornata"). */
  anytime: AgendaEntry[];
  /** Deadlines falling today. */
  deadlines: AgendaEntry[];
  /** Past tasks and reminders not done yet. */
  overdue: AgendaEntry[];
  /** Items waiting for the user's answer. */
  toClarify: DiloItem[];
}

/** Approximate sort position of vague times, so "stasera" lands after "alle 15". */
const PART_OF_DAY_SORT: Record<PartOfDay, LocalTime> = {
  mattina: "09:00",
  mezzogiorno: "12:30",
  pomeriggio: "15:30",
  sera: "20:00",
  notte: "23:00",
};

export interface AgendaOptions {
  /** IDs of completed items, to leave out of overdue. */
  isDone?: (item: DiloItem) => boolean;
  timezone?: string;
}

export function todayIso(now: Date = new Date(), timezone = DEFAULT_TIMEZONE): IsoDate {
  return DateTime.fromJSDate(now).setZone(timezone).toISODate()!;
}

export function buildAgenda(items: DiloItem[], date: IsoDate, options: AgendaOptions = {}): Agenda {
  const isDone = options.isDone ?? (() => false);
  const agenda: Agenda = { date, schedule: [], anytime: [], deadlines: [], overdue: [], toClarify: [] };

  for (const item of items) {
    if (item.status === "needs_clarification") {
      agenda.toClarify.push(item);
      continue;
    }
    if (item.type === "note") continue;

    const entry = (reason: AgendaEntry["reason"]): AgendaEntry => ({
      item,
      reason,
      time: item.time,
      partOfDay: item.partOfDay,
    });

    let placed = false;
    if (item.recurrence) {
      if (occursOn(item.recurrence, date)) {
        place(agenda, entry("recurring"));
        placed = true;
      }
    } else if (item.date && (item.date === date || (item.endDate && item.date < date && date <= item.endDate))) {
      place(agenda, entry("scheduled"));
      placed = true;
    } else if (
      item.date &&
      item.date < date &&
      (item.type === "task" || item.type === "reminder") &&
      !isDone(item)
    ) {
      agenda.overdue.push(entry("overdue"));
      placed = true;
    }

    if (item.deadline?.date === date && !placed) {
      agenda.deadlines.push({ ...entry("deadline"), time: item.deadline.time, partOfDay: null });
    } else if (item.deadline && item.deadline.date < date && !isDone(item) && !placed) {
      agenda.overdue.push(entry("overdue"));
    }
  }

  const key = (e: AgendaEntry) => e.time ?? (e.partOfDay ? PART_OF_DAY_SORT[e.partOfDay] : "99:99");
  agenda.schedule.sort((a, b) => key(a).localeCompare(key(b)));
  agenda.deadlines.sort((a, b) => key(a).localeCompare(key(b)));
  return agenda;
}

function place(agenda: Agenda, e: AgendaEntry) {
  if (e.time || e.partOfDay) agenda.schedule.push(e);
  else agenda.anytime.push(e);
}
