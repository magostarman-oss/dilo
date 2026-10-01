import type { DateExpr, PartOfDay, RecurrenceExpr, TimeExpr } from "./temporal";

/**
 * Compact text notation for the temporal IR, used on the wire with the
 * language model. Structured-output grammars grow quickly with nested
 * nullable objects, so the model writes short strings like "d+1", "wd:5",
 * "15:30", "weekly:1,4" and this deterministic parser turns them into the
 * DateExpr / TimeExpr / RecurrenceExpr objects the resolver works on.
 *
 * Dates
 *   d+N | d-N | d0         relative days (oggi=d0, domani=d+1)
 *   wd:N | wd:N@K          weekday 1-7 (lun=1), next one; @K = calendar week offset (0 this, 1 next)
 *   cal:DD-MM[-YYYY]       calendar date, year only if said
 *   w+N | m+N              in N weeks / N months
 *   week@K                 a whole week (0 this, 1 next)
 *   weekend | weekend@K    a weekend
 *   month:MM[-YYYY] | month@K   a whole month
 *   monthend@K             last day of this (0) or next (1) month
 * Times
 *   HH:MM | mattina | mezzogiorno | pomeriggio | sera | notte | +Nm (in N minutes)
 * Repeats
 *   daily[/N] | weekly[/N][:D,D] | monthly[/N][:DAY] (DAY -1 = last) | yearly[/N][:DD-MM]
 *   followed by optional ";until=<date>" and ";count=N"
 */

export type SpecResult<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): SpecResult<T> => ({ ok: true, value });
const err = <T>(error: string): SpecResult<T> => ({ ok: false, error });

const emptyDate: Omit<DateExpr, "kind"> = { offset: null, weekday: null, weekOffset: null, day: null, month: null, year: null };
const int = (s: string | undefined) => (s === undefined || s === "" ? null : Number.parseInt(s, 10));

export function parseDateSpec(input: string): SpecResult<DateExpr> {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  let m: RegExpMatchArray | null;
  const at = (k: string | undefined) => (k === undefined ? null : Number.parseInt(k, 10));

  if ((m = s.match(/^d([+-]?\d+)$/))) return ok({ ...emptyDate, kind: "relative_days", offset: Number.parseInt(m[1]!, 10) });
  if ((m = s.match(/^wd:([1-7])(?:@([+-]?\d+))?$/)))
    return ok({ ...emptyDate, kind: "weekday", weekday: int(m[1]), weekOffset: at(m[2]) });
  if ((m = s.match(/^cal:(\d{1,2})[-/](\d{1,2})(?:[-/](\d{4}))?$/)))
    return ok({ ...emptyDate, kind: "calendar", day: int(m[1]), month: int(m[2]), year: int(m[3]) });
  if ((m = s.match(/^w\+?(\d+)$/))) return ok({ ...emptyDate, kind: "relative_weeks", offset: int(m[1]) });
  if ((m = s.match(/^m\+?(\d+)$/))) return ok({ ...emptyDate, kind: "relative_months", offset: int(m[1]) });
  if ((m = s.match(/^week(?:@([+-]?\d+))?$/))) return ok({ ...emptyDate, kind: "week", weekOffset: at(m[1]) ?? 0 });
  if ((m = s.match(/^weekend(?:@([+-]?\d+))?$/))) return ok({ ...emptyDate, kind: "weekend", weekOffset: at(m[1]) });
  if ((m = s.match(/^month:(\d{1,2})(?:-(\d{4}))?$/))) return ok({ ...emptyDate, kind: "month", month: int(m[1]), year: int(m[2]) });
  if ((m = s.match(/^month(?:@([+-]?\d+))?$/))) return ok({ ...emptyDate, kind: "month", offset: at(m[1]) ?? 0 });
  if ((m = s.match(/^monthend(?:@([+-]?\d+))?$/))) return ok({ ...emptyDate, kind: "month_end", offset: at(m[1]) ?? 0 });
  return err(`Unknown date spec "${input}"`);
}

const PARTS: PartOfDay[] = ["mattina", "mezzogiorno", "pomeriggio", "sera", "notte"];

export function parseTimeSpec(input: string): SpecResult<TimeExpr> {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{1,2})(?:[:.](\d{2}))?$/)))
    return ok({ kind: "clock", hour: int(m[1]), minute: int(m[2]) ?? 0, partOfDay: null, offsetMinutes: null });
  if ((m = s.match(/^\+(\d+)m(?:in)?$/)))
    return ok({ kind: "relative", hour: null, minute: null, partOfDay: null, offsetMinutes: int(m[1]) });
  if ((m = s.match(/^\+(\d+)h$/)))
    return ok({ kind: "relative", hour: null, minute: null, partOfDay: null, offsetMinutes: int(m[1])! * 60 });
  if ((PARTS as string[]).includes(s))
    return ok({ kind: "part_of_day", hour: null, minute: null, partOfDay: s as PartOfDay, offsetMinutes: null });
  return err(`Unknown time spec "${input}"`);
}

export function parseRepeatSpec(input: string): SpecResult<RecurrenceExpr> {
  const [head = "", ...opts] = input.trim().toLowerCase().replace(/\s+/g, "").split(";");
  const m = head.match(/^(daily|weekly|monthly|yearly)(?:\/(\d+))?(?::(.+))?$/);
  if (!m) return err(`Unknown repeat spec "${input}"`);
  const frequency = m[1] as RecurrenceExpr["frequency"];
  const rec: RecurrenceExpr = {
    frequency,
    interval: int(m[2]) ?? 1,
    weekdays: [],
    dayOfMonth: null,
    month: null,
    until: null,
    count: null,
  };
  const arg = m[3];
  if (arg) {
    if (frequency === "weekly") {
      const days = arg.split(",").map((d) => Number.parseInt(d, 10));
      if (days.some((d) => !(d >= 1 && d <= 7))) return err(`Bad weekdays in "${input}"`);
      rec.weekdays = days;
    } else if (frequency === "monthly") {
      const d = Number.parseInt(arg, 10);
      if (Number.isNaN(d)) return err(`Bad day in "${input}"`);
      rec.dayOfMonth = d;
    } else if (frequency === "yearly") {
      const dm = arg.match(/^(-?\d{1,2})-(\d{1,2})$/);
      if (!dm) return err(`Bad date in "${input}"`);
      rec.dayOfMonth = int(dm[1]);
      rec.month = int(dm[2]);
    } else {
      return err(`Unexpected argument in "${input}"`);
    }
  }
  for (const opt of opts) {
    if (!opt) continue;
    const [key, value = ""] = opt.split("=");
    if (key === "until") {
      const d = parseDateSpec(value);
      if (!d.ok) return err(d.error);
      rec.until = d.value;
    } else if (key === "count" && /^\d+$/.test(value)) {
      rec.count = Number.parseInt(value, 10);
    } else {
      return err(`Unknown option "${opt}" in "${input}"`);
    }
  }
  return ok(rec);
}
