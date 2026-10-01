import { DateTime } from "luxon";
import { MONTHS_IT, WEEKDAYS_IT } from "./temporal";
import type { IsoDate, ResolvedRecurrence } from "./item";

type Rule = Omit<ResolvedRecurrence, "text">;

const day = (iso: IsoDate) => DateTime.fromISO(iso, { zone: "UTC" });

function listIt(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} e ${words[words.length - 1]}`;
}

/** Italian description of a rule, e.g. "ogni lunedì e giovedì", "ogni 2 settimane, il venerdì". */
export function describeRecurrence(rule: Rule): string {
  const every = (singular: string, plural: string) => (rule.interval === 1 ? `ogni ${singular}` : `ogni ${rule.interval} ${plural}`);
  let text: string;
  switch (rule.frequency) {
    case "daily":
      text = rule.interval === 2 ? "a giorni alterni" : every("giorno", "giorni");
      break;
    case "weekly": {
      const wd = rule.weekdays;
      const names = wd.map((d) => WEEKDAYS_IT[d - 1]!);
      if (rule.interval === 1) {
        if (wd.join() === "1,2,3,4,5") text = "nei giorni feriali";
        else if (wd.join() === "6,7") text = "ogni weekend";
        else if (wd.length === 7) text = "ogni giorno";
        else text = `ogni ${listIt(names)}`;
      } else {
        text = `ogni ${rule.interval} settimane, ${names.length === 1 ? "il" : "di"} ${listIt(names)}`;
      }
      break;
    }
    case "monthly": {
      const which = rule.dayOfMonth === -1 ? "l'ultimo giorno" : `il giorno ${rule.dayOfMonth}`;
      text = `${every("mese", "mesi")}, ${which}`;
      break;
    }
    case "yearly": {
      const d = rule.dayOfMonth === -1 ? "l'ultimo giorno di" : `il ${rule.dayOfMonth}`;
      text = `${every("anno", "anni")}, ${d} ${MONTHS_IT[(rule.month ?? 1) - 1]}`;
      break;
    }
  }
  if (rule.until) {
    const u = day(rule.until);
    text += `, fino al ${u.day} ${MONTHS_IT[u.month - 1]}`;
  }
  if (rule.count) text += `, per ${rule.count} volte`;
  return text;
}

function matchesPattern(rule: Rule, d: DateTime, start: DateTime): boolean {
  switch (rule.frequency) {
    case "daily":
      return Math.round(d.diff(start, "days").days) % rule.interval === 0;
    case "weekly": {
      if (!rule.weekdays.includes(d.weekday)) return false;
      const weekStart = (x: DateTime) => x.minus({ days: x.weekday - 1 });
      const weeks = Math.round(weekStart(d).diff(weekStart(start), "weeks").weeks);
      return weeks % rule.interval === 0;
    }
    case "monthly": {
      const months = (d.year - start.year) * 12 + (d.month - start.month);
      if (months % rule.interval !== 0) return false;
      return rule.dayOfMonth === -1 ? d.day === d.daysInMonth : d.day === rule.dayOfMonth;
    }
    case "yearly": {
      if ((d.year - start.year) % rule.interval !== 0) return false;
      if (d.month !== rule.month) return false;
      return rule.dayOfMonth === -1 ? d.day === d.daysInMonth : d.day === rule.dayOfMonth;
    }
  }
}

/** Does the rule produce an occurrence on this calendar day? */
export function occursOn(rule: Rule, date: IsoDate): boolean {
  const start = day(rule.startDate);
  const d = day(date);
  if (d < start) return false;
  if (rule.until && d > day(rule.until)) return false;
  if (!matchesPattern(rule, d, start)) return false;
  if (rule.count != null) {
    let n = 0;
    for (let x = start; x <= d; x = x.plus({ days: 1 })) {
      if (matchesPattern(rule, x, start)) n++;
      if (n > rule.count) return false;
    }
  }
  return true;
}

/** First occurrence on or after `from`, looking ahead up to ~4 years; null if none. */
export function nextOccurrence(rule: Rule, from: IsoDate): IsoDate | null {
  let d = day(from);
  const start = day(rule.startDate);
  if (d < start) d = start;
  for (let i = 0; i < 1500; i++, d = d.plus({ days: 1 })) {
    if (rule.until && d > day(rule.until)) return null;
    if (occursOn(rule, d.toISODate()!)) return d.toISODate()!;
  }
  return null;
}
