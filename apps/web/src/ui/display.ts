import { describeWhen, ITEM_TYPE_LABEL_IT, type DiloItem, type PartOfDay } from "@dilo/core";

const PART_OF_DAY: Record<PartOfDay, string> = {
  mattina: "Mattina",
  mezzogiorno: "Mezzogiorno",
  pomeriggio: "Pomeriggio",
  sera: "Sera",
  notte: "Notte",
};

export const typeLabel = (item: DiloItem) => ITEM_TYPE_LABEL_IT[item.type];

/** Short time for the agenda's left column: "9:30", "Sera". */
export function clockLabel(time: string | null, partOfDay: PartOfDay | null): string {
  if (time) return time.replace(/^0(\d)/, "$1");
  if (partOfDay) return PART_OF_DAY[partOfDay];
  return "";
}

/** "domani alle 15:00 · con Marco · dal dentista" */
export function itemMeta(item: DiloItem, now: Date, { withWhen = true } = {}): string {
  const parts: string[] = [];
  if (withWhen) {
    const when = describeWhen(item, now);
    if (when) parts.push(when);
  } else if (item.recurrence) {
    parts.push(item.recurrence.text);
  }
  if (item.people.length) parts.push(`con ${item.people.join(", ")}`);
  if (item.location) parts.push(item.location);
  if (item.alertMinutesBefore) parts.push(`avviso ${item.alertMinutesBefore} min prima`);
  return parts.join(" · ");
}

const DAY_FMT = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** "giovedì 1 ottobre" for an ISO date. */
export function longDay(iso: string): string {
  return DAY_FMT.format(new Date(`${iso}T12:00:00Z`));
}
