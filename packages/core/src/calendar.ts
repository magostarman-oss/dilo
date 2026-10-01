import { DateTime } from "luxon";
import type { DiloItem, ResolvedRecurrence } from "./item";
import { DEFAULT_TIMEZONE } from "./resolve";

/**
 * Turning a DILO item into a calendar entry (DILO AGISCE, first step):
 * a Google Calendar "add event" link the user confirms with one tap.
 * Never invents a time: without one, the entry is all-day.
 */

export interface CalendarEntry {
  title: string;
  /** All-day: ISO dates, end exclusive. Timed: UTC instants. */
  allDay: boolean;
  start: DateTime;
  end: DateTime;
  recurrence: string | null;
  location: string | null;
  details: string;
}

const DEFAULT_MINUTES = { event: 60, task: 30, reminder: 15, routine: 30, note: 30 } as const;
const BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/** The calendar entry for an item, or null when it has no day to put it on. */
export function toCalendarEntry(item: DiloItem): CalendarEntry | null {
  if (item.status !== "ready" || item.type === "note") return null;
  const tz = item.timezone || DEFAULT_TIMEZONE;
  const isDeadline = !item.date && !item.recurrence && !!item.deadline;
  const date = item.date ?? item.recurrence?.startDate ?? item.deadline?.date ?? null;
  if (!date) return null;
  const time = isDeadline ? item.deadline!.time : item.time;

  let allDay: boolean;
  let start: DateTime;
  let end: DateTime;
  if (time) {
    allDay = false;
    start = DateTime.fromISO(`${date}T${time}`, { zone: tz });
    if (item.endTime) {
      end = DateTime.fromISO(`${item.endDate ?? date}T${item.endTime}`, { zone: tz });
      if (end <= start) end = start.plus({ minutes: DEFAULT_MINUTES[item.type] });
    } else {
      end = start.plus({ minutes: DEFAULT_MINUTES[item.type] });
    }
  } else {
    allDay = true;
    start = DateTime.fromISO(date, { zone: tz });
    end = DateTime.fromISO(item.endDate && item.endDate > date ? item.endDate : date, { zone: tz }).plus({ days: 1 });
  }

  const notes: string[] = [];
  if (item.details) notes.push(item.details);
  if (item.people.length) notes.push(`Con: ${item.people.join(", ")}`);
  if (item.deadline && !isDeadline) {
    notes.push(`Scadenza: ${item.deadline.date}${item.deadline.time ? ` ${item.deadline.time}` : ""}`);
  }
  notes.push(`Da DILO: “${item.source.text}”`);

  return {
    title: isDeadline ? `Scadenza: ${item.title}` : item.title,
    allDay,
    start,
    end,
    recurrence: item.recurrence ? toRRule(item.recurrence) : null,
    location: item.location,
    details: notes.join("\n"),
  };
}

/** RFC 5545 rule, e.g. "RRULE:FREQ=WEEKLY;BYDAY=MO,TH". */
export function toRRule(r: ResolvedRecurrence): string {
  const parts = [`FREQ=${r.frequency.toUpperCase()}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.weekdays.length) parts.push(`BYDAY=${r.weekdays.map((d) => BYDAY[d - 1]).join(",")}`);
  if (r.month) parts.push(`BYMONTH=${r.month}`);
  if (r.dayOfMonth) parts.push(`BYMONTHDAY=${r.dayOfMonth}`);
  if (r.until) parts.push(`UNTIL=${r.until.replace(/-/g, "")}`);
  else if (r.count) parts.push(`COUNT=${r.count}`);
  return `RRULE:${parts.join(";")}`;
}

/** A link that opens Google Calendar with the event filled in; the user only taps Save. */
export function googleCalendarUrl(item: DiloItem): string | null {
  const e = toCalendarEntry(item);
  if (!e) return null;
  const fmt = (d: DateTime) => (e.allDay ? d.toFormat("yyyyLLdd") : d.toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'"));
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${fmt(e.start)}/${fmt(e.end)}`,
    details: e.details,
    ctz: item.timezone || DEFAULT_TIMEZONE,
  });
  if (e.location) params.set("location", e.location);
  if (e.recurrence) params.set("recur", e.recurrence);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Body for the Google Calendar API (events.insert). */
export interface GoogleEventBody {
  summary: string;
  description: string;
  location?: string;
  start: { date: string } | { dateTime: string; timeZone: string };
  end: { date: string } | { dateTime: string; timeZone: string };
  recurrence?: string[];
  reminders: { useDefault: boolean; overrides?: { method: "popup"; minutes: number }[] };
  extendedProperties: { private: { diloItemId: string } };
}

/** The event DILO writes to the user's Google Calendar for an item, or null if it has no day. */
export function toGoogleEvent(item: DiloItem): GoogleEventBody | null {
  const e = toCalendarEntry(item);
  if (!e) return null;
  const tz = item.timezone || DEFAULT_TIMEZONE;
  const at = (d: DateTime) =>
    e.allDay ? { date: d.toISODate()! } : { dateTime: d.setZone(tz).toISO({ suppressMilliseconds: true })!, timeZone: tz };
  // "Ricordamelo" means a notification at that moment; an explicit "avvisami X minuti prima" wins.
  const minutes = item.alertMinutesBefore ?? (item.type === "reminder" && !e.allDay ? 0 : null);
  return {
    summary: e.title,
    description: e.details,
    ...(e.location ? { location: e.location } : {}),
    start: at(e.start),
    end: at(e.end),
    ...(e.recurrence ? { recurrence: [e.recurrence] } : {}),
    reminders: minutes === null ? { useDefault: true } : { useDefault: false, overrides: [{ method: "popup", minutes }] },
    extendedProperties: { private: { diloItemId: item.id } },
  };
}
