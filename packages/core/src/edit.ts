import { DateTime } from "luxon";
import type { DiloItem, IsoDate, LocalTime } from "./item";

/** What the user can change by hand on an item already saved. */
export interface ItemEdit {
  title?: string;
  /** null clears the day (the item goes back to "senza data"). */
  date?: IsoDate | null;
  /** null clears the time. */
  time?: LocalTime | null;
  location?: string | null;
}

const minutes = (t: LocalTime) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const daysBetween = (a: IsoDate, b: IsoDate) =>
  Math.round(DateTime.fromISO(b, { zone: "UTC" }).diff(DateTime.fromISO(a, { zone: "UTC" }), "days").days);
const plusDays = (d: IsoDate, n: number) => DateTime.fromISO(d, { zone: "UTC" }).plus({ days: n }).toISODate()!;

/**
 * Applies a manual change to an item and keeps it coherent: the end moves with
 * the start (same duration), a precise day replaces a vague period, a precise
 * time replaces a part of the day, and the absolute start is recomputed.
 * The id stays the same, so memory and the calendar update the same item.
 */
export function applyEdit(item: DiloItem, edit: ItemEdit): DiloItem {
  const next: DiloItem = { ...item };

  if (edit.title !== undefined && edit.title.trim()) next.title = edit.title.trim().replace(/\s+/g, " ");
  if (edit.location !== undefined) next.location = edit.location?.trim() || null;

  if (edit.date !== undefined && edit.date !== item.date) {
    next.date = edit.date;
    if (edit.date) {
      next.window = null;
      if (item.endDate && item.date) next.endDate = plusDays(item.endDate, daysBetween(item.date, edit.date));
      else if (item.endDate && item.endDate < edit.date) next.endDate = null;
      if (item.recurrence) next.recurrence = { ...item.recurrence, startDate: edit.date };
    } else {
      next.endDate = null;
    }
  }

  if (edit.time !== undefined && edit.time !== item.time) {
    next.time = edit.time;
    if (edit.time) {
      next.partOfDay = null;
      if (item.endTime && item.time && !next.endDate) {
        const end = minutes(item.endTime) + minutes(edit.time) - minutes(item.time);
        next.endTime = end > minutes(edit.time) && end < 24 * 60 ? clock(end) : null;
      } else if (item.endTime && !item.time) {
        next.endTime = minutes(item.endTime) > minutes(edit.time) ? item.endTime : null;
      }
    } else {
      next.endTime = null;
    }
  }

  next.startsAt =
    next.date && next.time
      ? DateTime.fromISO(`${next.date}T${next.time}`, { zone: item.timezone }).toISO()
      : null;
  return next;
}
