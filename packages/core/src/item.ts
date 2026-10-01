import { z } from "zod";
import { Frequency, PartOfDay } from "./temporal";

/**
 * DILO's domain model: what the rest of the product (UI, memory, notifications,
 * future agents) works with. Every date here is already resolved.
 */

export const ItemType = z.enum(["task", "reminder", "event", "note", "routine"]);
export type ItemType = z.infer<typeof ItemType>;

export const ITEM_TYPE_LABEL_IT: Record<ItemType, string> = {
  task: "Attività",
  reminder: "Promemoria",
  event: "Evento",
  note: "Nota",
  routine: "Routine",
};

/** ISO calendar date, e.g. "2026-10-01". */
export type IsoDate = string;
/** Local wall-clock time, e.g. "15:00". */
export type LocalTime = string;

export const ClarificationField = z.enum(["type", "title", "date", "time", "recurrence", "deadline", "other"]);
export type ClarificationField = z.infer<typeof ClarificationField>;

export interface Clarification {
  /** A short question in Italian, e.g. "A che ora?" */
  question: string;
  field: ClarificationField;
  /** Where the question came from: the language model or a deterministic check. */
  origin: "model" | "resolver";
}

export interface ResolvedRecurrence {
  frequency: Frequency;
  interval: number;
  weekdays: number[];
  dayOfMonth: number | null;
  month: number | null;
  /** First day the rule applies from. */
  startDate: IsoDate;
  until: IsoDate | null;
  count: number | null;
  /** Human readable, e.g. "ogni lunedì e giovedì". */
  text: string;
}

export interface DiloItem {
  id: string;
  type: ItemType;
  title: string;
  details: string | null;

  /** Day the item happens (task/reminder/event) or first day of a routine. */
  date: IsoDate | null;
  time: LocalTime | null;
  /** Set when only a vague part of the day is known ("stasera"). */
  partOfDay: PartOfDay | null;
  endDate: IsoDate | null;
  endTime: LocalTime | null;
  /** Absolute start instant with offset, when both date and time are known. */
  startsAt: string | null;
  /** A vague period instead of a day ("la settimana prossima", "a novembre"). */
  window: { from: IsoDate; to: IsoDate } | null;

  deadline: { date: IsoDate; time: LocalTime | null } | null;
  recurrence: ResolvedRecurrence | null;
  /** Minutes before the start to notify ("avvisami 10 minuti prima"). */
  alertMinutesBefore: number | null;

  people: string[];
  location: string | null;

  status: "ready" | "needs_clarification";
  clarification: Clarification | null;

  source: {
    /** The part of the utterance this item came from. */
    text: string;
    utterance: string;
  };
  timezone: string;
  createdAt: string;
}
