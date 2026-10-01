import { DateTime } from "luxon";
import { ITEM_TYPE_LABEL_IT, type DiloItem } from "./item";
import { describeDayIt, DEFAULT_TIMEZONE } from "./resolve";

const PART_OF_DAY_IT = {
  mattina: "in mattinata",
  mezzogiorno: "a mezzogiorno",
  pomeriggio: "nel pomeriggio",
  sera: "in serata",
  notte: "di notte",
} as const;

/** Human, Italian description of when an item happens: "domani alle 15:00", "ogni lunedì alle 7:30". */
export function describeWhen(item: DiloItem, now: Date = new Date()): string {
  const tz = item.timezone || DEFAULT_TIMEZONE;
  const today = DateTime.fromJSDate(now).setZone(tz).startOf("day");
  const parts: string[] = [];
  const day = (iso: string) => describeDayIt(DateTime.fromISO(iso, { zone: tz }), today);

  if (item.recurrence) {
    parts.push(item.recurrence.text);
  } else if (item.date) {
    parts.push(day(item.date));
  } else if (item.window) {
    parts.push(`tra ${day(item.window.from)} e ${day(item.window.to)}`);
  }
  if (item.time) parts.push(`alle ${item.time.replace(/^0(\d)/, "$1")}`);
  else if (item.partOfDay) parts.push(PART_OF_DAY_IT[item.partOfDay]);
  if (item.endTime) parts.push(`fino alle ${item.endTime.replace(/^0(\d)/, "$1")}`);
  if (item.endDate && item.endDate !== item.date && !item.endTime) parts.push(`fino a ${day(item.endDate)}`);
  if (item.deadline) {
    parts.push(`entro ${day(item.deadline.date)}${item.deadline.time ? ` alle ${item.deadline.time}` : ""}`);
  }
  return parts.join(" ");
}

/** One-line summary: "Attività: Prenotare il dentista — domani alle 15". */
export function summarizeItem(item: DiloItem, now: Date = new Date()): string {
  const when = describeWhen(item, now);
  const head = `${ITEM_TYPE_LABEL_IT[item.type]}: ${item.title}`;
  const line = when ? `${head} — ${when}` : head;
  return item.clarification ? `${line}  (? ${item.clarification.question})` : line;
}
