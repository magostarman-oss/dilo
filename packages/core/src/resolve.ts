import { DateTime } from "luxon";
import type { DateExpr, DeadlineExpr, PartOfDay, RecurrenceExpr, TimeExpr, WhenExpr } from "./temporal";
import { MONTHS_IT, WEEKDAYS_IT } from "./temporal";
import type { ItemDraft } from "./draft";
import type { Clarification, ClarificationField, DiloItem, ResolvedRecurrence } from "./item";
import { describeRecurrence, nextOccurrence } from "./recurrence";

export const DEFAULT_TIMEZONE = "Europe/Rome";

export interface ResolveContext {
  /** The moment the user spoke. */
  now: Date | string;
  /** IANA timezone of the user. */
  timezone?: string;
  /** The full utterance, stored on each item for traceability. */
  utterance?: string;
  /** Injected for tests and for platforms without crypto.randomUUID. */
  newId?: () => string;
}

type Ctx = { now: DateTime; today: DateTime; timezone: string };

/** Result of resolving a date expression. */
export type DateResolution =
  | { kind: "day"; date: DateTime }
  | { kind: "window"; from: DateTime; to: DateTime }
  | { kind: "invalid"; question: string };

export type TimeResolution =
  | { kind: "clock"; hour: number; minute: number }
  | { kind: "part_of_day"; partOfDay: PartOfDay }
  | { kind: "instant"; at: DateTime }
  | { kind: "invalid"; question: string };

function makeCtx(now: Date | string, timezone: string): Ctx {
  const base = typeof now === "string" ? DateTime.fromISO(now, { setZone: true }) : DateTime.fromJSDate(now);
  if (!base.isValid) throw new Error(`Invalid "now": ${String(now)}`);
  const zoned = base.setZone(timezone);
  if (!zoned.isValid) throw new Error(`Invalid timezone: ${timezone}`);
  return { now: zoned, today: zoned.startOf("day"), timezone };
}

const isoDate = (d: DateTime) => d.toISODate()!;
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (h: number, m: number) => `${pad(h)}:${pad(m)}`;

export function describeDayIt(date: DateTime, today: DateTime): string {
  const diff = Math.round(date.startOf("day").diff(today.startOf("day"), "days").days);
  if (diff === 0) return "oggi";
  if (diff === 1) return "domani";
  if (diff === 2) return "dopodomani";
  if (diff === -1) return "ieri";
  const base = `${WEEKDAYS_IT[date.weekday - 1]} ${date.day} ${MONTHS_IT[date.month - 1]}`;
  return date.year === today.year ? base : `${base} ${date.year}`;
}

function startOfIsoWeek(d: DateTime): DateTime {
  return d.startOf("day").minus({ days: d.weekday - 1 });
}

function calendarDate(year: number, month: number, day: number, zone: string): DateTime | null {
  const d = DateTime.fromObject({ year, month, day }, { zone });
  return d.isValid ? d : null;
}

export function resolveDateExpr(expr: DateExpr, ctx: Ctx): DateResolution {
  const { today } = ctx;
  switch (expr.kind) {
    case "relative_days":
      return { kind: "day", date: today.plus({ days: expr.offset ?? 0 }) };

    case "relative_weeks":
      return { kind: "day", date: today.plus({ weeks: expr.offset ?? 1 }) };

    case "relative_months":
      return { kind: "day", date: today.plus({ months: expr.offset ?? 1 }) };

    case "weekday": {
      const wd = expr.weekday;
      if (wd == null || wd < 1 || wd > 7) return { kind: "invalid", question: "Quale giorno intendi?" };
      if (expr.weekOffset == null) {
        const ahead = (wd - today.weekday + 7) % 7 || 7;
        return { kind: "day", date: today.plus({ days: ahead }) };
      }
      const date = startOfIsoWeek(today).plus({ weeks: expr.weekOffset, days: wd - 1 });
      if (date < today) {
        return {
          kind: "invalid",
          question: `${cap(WEEKDAYS_IT[wd - 1]!)} di questa settimana è già passato: intendi ${WEEKDAYS_IT[wd - 1]} prossimo?`,
        };
      }
      return { kind: "day", date };
    }

    case "calendar": {
      const { day, month, year } = expr;
      if (day == null || month == null || month < 1 || month > 12 || day < 1 || day > 31) {
        return { kind: "invalid", question: "Quale data intendi?" };
      }
      if (year != null) {
        const d = calendarDate(year, month, day, ctx.timezone);
        if (!d) return { kind: "invalid", question: `Il ${day} ${MONTHS_IT[month - 1]} ${year} non esiste: quale giorno intendi?` };
        return { kind: "day", date: d };
      }
      // No year: the next occurrence from today (today included). Skip years
      // where the date does not exist (29 febbraio).
      for (let y = today.year; y <= today.year + 8; y++) {
        const d = calendarDate(y, month, day, ctx.timezone);
        if (d && d >= today) return { kind: "day", date: d };
      }
      return { kind: "invalid", question: `Il ${day} ${MONTHS_IT[month - 1]} non esiste: quale giorno intendi?` };
    }

    case "week": {
      const start = startOfIsoWeek(today).plus({ weeks: expr.weekOffset ?? 0 });
      const from = start < today ? today : start;
      return { kind: "window", from, to: start.plus({ days: 6 }) };
    }

    case "weekend": {
      let saturday: DateTime;
      if (expr.weekOffset == null) {
        // Upcoming weekend; if we are already in it, this weekend.
        saturday = today.weekday >= 6 ? startOfIsoWeek(today).plus({ days: 5 }) : today.plus({ days: 6 - today.weekday });
      } else {
        saturday = startOfIsoWeek(today).plus({ weeks: expr.weekOffset, days: 5 });
      }
      const sunday = saturday.plus({ days: 1 });
      if (sunday < today) return { kind: "invalid", question: "Quale weekend intendi?" };
      return { kind: "window", from: saturday < today ? today : saturday, to: sunday };
    }

    case "month": {
      let start: DateTime;
      if (expr.month != null) {
        if (expr.month < 1 || expr.month > 12) return { kind: "invalid", question: "Quale mese intendi?" };
        const year = expr.year ?? (expr.month >= today.month ? today.year : today.year + 1);
        start = DateTime.fromObject({ year, month: expr.month, day: 1 }, { zone: ctx.timezone });
      } else {
        start = today.startOf("month").plus({ months: expr.offset ?? 0 });
      }
      const end = start.endOf("month").startOf("day");
      if (end < today) return { kind: "invalid", question: "Quel mese è già passato: quale intendi?" };
      return { kind: "window", from: start < today ? today : start, to: end };
    }

    case "month_end":
      return { kind: "day", date: today.startOf("month").plus({ months: expr.offset ?? 0 }).endOf("month").startOf("day") };
  }
}

export function resolveTimeExpr(expr: TimeExpr, ctx: Ctx): TimeResolution {
  switch (expr.kind) {
    case "clock": {
      const hour = expr.hour;
      const minute = expr.minute ?? 0;
      if (hour == null || hour < 0 || hour > 24 || minute < 0 || minute > 59 || (hour === 24 && minute > 0)) {
        return { kind: "invalid", question: "Non ho capito l'orario: a che ora?" };
      }
      return { kind: "clock", hour: hour % 24, minute };
    }
    case "part_of_day":
      if (!expr.partOfDay) return { kind: "invalid", question: "In che momento della giornata?" };
      return { kind: "part_of_day", partOfDay: expr.partOfDay };
    case "relative": {
      if (expr.offsetMinutes == null || expr.offsetMinutes <= 0) {
        return { kind: "invalid", question: "Tra quanto tempo?" };
      }
      return { kind: "instant", at: ctx.now.plus({ minutes: expr.offsetMinutes }).startOf("minute") };
    }
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Needs an explicit day or time to be useful. Tasks and notes can be undated. */
const NEEDS_WHEN: Record<DiloItem["type"], boolean> = {
  task: false,
  note: false,
  reminder: true,
  event: true,
  routine: false,
};

/** Items for which a moment in the past makes no sense. */
const FUTURE_ONLY: Record<DiloItem["type"], boolean> = {
  task: true,
  reminder: true,
  event: true,
  routine: true,
  note: false,
};

function defaultId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `dilo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

interface WhenResult {
  date: DateTime | null;
  time: string | null;
  partOfDay: PartOfDay | null;
  endDate: DateTime | null;
  endTime: string | null;
  window: { from: DateTime; to: DateTime } | null;
  /** True when the user explicitly named a day. */
  explicitDate: boolean;
  problem: { question: string; field: ClarificationField } | null;
}

function resolveWhen(when: WhenExpr | null, ctx: Ctx): WhenResult {
  const out: WhenResult = {
    date: null,
    time: null,
    partOfDay: null,
    endDate: null,
    endTime: null,
    window: null,
    explicitDate: false,
    problem: null,
  };
  if (!when) return out;
  const fail = (question: string, field: ClarificationField) => {
    out.problem ??= { question, field };
  };

  if (when.date) {
    const r = resolveDateExpr(when.date, ctx);
    if (r.kind === "invalid") fail(r.question, "date");
    else if (r.kind === "day") {
      out.date = r.date;
      out.explicitDate = true;
    } else out.window = { from: r.from, to: r.to };
  }

  if (when.time) {
    const r = resolveTimeExpr(when.time, ctx);
    if (r.kind === "invalid") fail(r.question, "time");
    else if (r.kind === "instant") {
      out.date = r.at.startOf("day");
      out.time = r.at.toFormat("HH:mm");
      out.explicitDate = true;
    } else if (r.kind === "part_of_day") out.partOfDay = r.partOfDay;
    else {
      out.time = hhmm(r.hour, r.minute);
      if (when.time.partOfDay) out.partOfDay = when.time.partOfDay;
    }
  }

  if (when.endDate) {
    const r = resolveDateExpr(when.endDate, ctx);
    if (r.kind === "invalid") fail(r.question, "date");
    else out.endDate = r.kind === "day" ? r.date : r.to;
  }
  if (when.endTime) {
    const r = resolveTimeExpr(when.endTime, ctx);
    if (r.kind === "clock") out.endTime = hhmm(r.hour, r.minute);
    else if (r.kind === "invalid") fail(r.question, "time");
  }

  // "dalle 22 alle 2": the end falls on the next day.
  if (out.date && out.time && out.endTime && !out.endDate && out.endTime <= out.time) {
    out.endDate = out.date.plus({ days: 1 });
  }
  if (out.date && out.endDate && out.endDate < out.date) {
    fail("La fine viene prima dell'inizio: puoi ricontrollare le date?", "date");
  }
  return out;
}

function toClarification(p: { question: string; field: ClarificationField }, origin: Clarification["origin"]): Clarification {
  return { question: p.question.trim(), field: p.field, origin };
}

function resolveRecurrence(
  expr: RecurrenceExpr,
  start: DateTime,
  explicitStart: boolean,
  ctx: Ctx,
): { recurrence: ResolvedRecurrence | null; problem: { question: string; field: ClarificationField } | null } {
  const interval = Math.max(1, expr.interval || 1);
  let weekdays = [...new Set(expr.weekdays.filter((d) => d >= 1 && d <= 7))].sort((a, b) => a - b);
  let dayOfMonth = expr.dayOfMonth;
  let month = expr.month;

  if (expr.frequency === "weekly" && weekdays.length === 0) {
    if (!explicitStart) return { recurrence: null, problem: { question: "In quale giorno della settimana?", field: "recurrence" } };
    weekdays = [start.weekday];
  }
  if (expr.frequency === "monthly" && dayOfMonth == null) {
    if (!explicitStart) return { recurrence: null, problem: { question: "In quale giorno del mese?", field: "recurrence" } };
    dayOfMonth = start.day;
  }
  if (expr.frequency === "yearly" && (dayOfMonth == null || month == null)) {
    if (!explicitStart) return { recurrence: null, problem: { question: "In quale giorno dell'anno?", field: "recurrence" } };
    dayOfMonth ??= start.day;
    month ??= start.month;
  }
  if (dayOfMonth != null && (dayOfMonth === 0 || dayOfMonth > 31 || dayOfMonth < -1)) {
    return { recurrence: null, problem: { question: "In quale giorno del mese?", field: "recurrence" } };
  }

  let until: string | null = null;
  if (expr.until) {
    const r = resolveDateExpr(expr.until, ctx);
    if (r.kind === "invalid") return { recurrence: null, problem: { question: "Fino a quando si ripete?", field: "recurrence" } };
    until = isoDate(r.kind === "day" ? r.date : r.to);
  }

  const base = {
    frequency: expr.frequency,
    interval,
    weekdays,
    dayOfMonth,
    month,
    startDate: isoDate(start),
    until,
    count: expr.count != null && expr.count > 0 ? expr.count : null,
  };
  return { recurrence: { ...base, text: describeRecurrence(base) }, problem: null };
}

/**
 * Turns an understood item into a fully resolved `DiloItem`.
 * Deterministic: the same draft, `now` and timezone always give the same dates.
 */
export function resolveDraft(draft: ItemDraft, context: ResolveContext): DiloItem {
  const timezone = context.timezone ?? DEFAULT_TIMEZONE;
  const ctx = makeCtx(context.now, timezone);
  const w = resolveWhen(draft.when, ctx);
  const problems: { question: string; field: ClarificationField }[] = [];
  if (w.problem) problems.push(w.problem);

  let date = w.date;

  // Recurrence: anchor on the given day (or today) and point `date` at the next occurrence.
  let recurrence: ResolvedRecurrence | null = null;
  if (draft.recurrence) {
    const start = date ?? ctx.today;
    const r = resolveRecurrence(draft.recurrence, start, w.explicitDate, ctx);
    if (r.problem) problems.push(r.problem);
    recurrence = r.recurrence;
    if (recurrence) {
      const next = nextOccurrence(recurrence, isoDate(start));
      date = next ? DateTime.fromISO(next, { zone: timezone }) : date;
    }
  }

  // Only a time was given ("alle 15 chiama Marco"): today if still ahead, otherwise ask.
  if (!date && !w.window && w.time && !recurrence) {
    const [h, m] = w.time.split(":").map(Number) as [number, number];
    const todayAt = ctx.today.set({ hour: h, minute: m });
    if (todayAt > ctx.now) date = ctx.today;
    else problems.push({ question: `Le ${w.time} di oggi sono già passate: intendi domani?`, field: "date" });
  }

  let deadline: DiloItem["deadline"] = null;
  if (draft.deadline) {
    const r = resolveDeadline(draft.deadline, ctx);
    if ("problem" in r) problems.push(r.problem);
    else deadline = r.deadline;
  }

  // Things that must happen in the future cannot be in the past.
  if (FUTURE_ONLY[draft.type] && date && !recurrence) {
    if (date < ctx.today) {
      problems.push({ question: `${cap(describeDayIt(date, ctx.today))} è già passato: quando intendi?`, field: "date" });
    } else if (w.time && date.hasSame(ctx.today, "day")) {
      const [h, m] = w.time.split(":").map(Number) as [number, number];
      if (ctx.today.set({ hour: h, minute: m }) < ctx.now.startOf("minute")) {
        problems.push({ question: `Le ${w.time} di oggi sono già passate: intendi domani?`, field: "time" });
      }
    }
  }

  if (NEEDS_WHEN[draft.type] && !date && !w.window && !w.partOfDay && !deadline && !recurrence) {
    problems.push({
      question: draft.type === "reminder" ? "Quando vuoi che te lo ricordi?" : "Quando?",
      field: "date",
    });
  }
  if (draft.type === "routine" && !draft.recurrence) {
    problems.push({ question: "Ogni quanto si ripete?", field: "recurrence" });
  }
  if (!draft.title.trim()) problems.push({ question: "Di cosa si tratta?", field: "title" });

  // The model's own question wins: it has the context of the whole sentence.
  const clarification = draft.clarification
    ? toClarification(draft.clarification, "model")
    : problems[0]
      ? toClarification(problems[0], "resolver")
      : null;

  const time = w.time;
  const startsAt = date && time ? date.set({ hour: Number(time.slice(0, 2)), minute: Number(time.slice(3, 5)) }).toISO() : null;

  return {
    id: (context.newId ?? defaultId)(),
    type: draft.type,
    title: normalizeTitle(draft.title),
    details: draft.details?.trim() || null,
    date: date ? isoDate(date) : null,
    time,
    partOfDay: w.partOfDay,
    endDate: w.endDate ? isoDate(w.endDate) : null,
    endTime: w.endTime,
    startsAt,
    window: w.window ? { from: isoDate(w.window.from), to: isoDate(w.window.to) } : null,
    deadline,
    recurrence,
    alertMinutesBefore: draft.alertMinutesBefore != null && draft.alertMinutesBefore > 0 ? draft.alertMinutesBefore : null,
    people: draft.people.map((p) => p.trim()).filter(Boolean),
    location: draft.location?.trim() || null,
    status: clarification ? "needs_clarification" : "ready",
    clarification,
    source: { text: draft.sourceText, utterance: context.utterance ?? draft.sourceText },
    timezone,
    createdAt: ctx.now.toISO()!,
  };
}

function resolveDeadline(
  expr: DeadlineExpr,
  ctx: Ctx,
): { deadline: NonNullable<DiloItem["deadline"]> } | { problem: { question: string; field: ClarificationField } } {
  const d = resolveDateExpr(expr.date, ctx);
  if (d.kind === "invalid") return { problem: { question: d.question, field: "deadline" } };
  const day = d.kind === "day" ? d.date : d.to; // "entro la settimana prossima" = by the end of it
  if (day < ctx.today) return { problem: { question: "Quella scadenza è già passata: entro quando?", field: "deadline" } };
  let time: string | null = null;
  if (expr.time) {
    const t = resolveTimeExpr(expr.time, ctx);
    if (t.kind === "clock") time = hhmm(t.hour, t.minute);
    else if (t.kind === "invalid") return { problem: { question: t.question, field: "deadline" } };
  }
  return { deadline: { date: isoDate(day), time } };
}

function normalizeTitle(title: string): string {
  const t = title.trim().replace(/\s+/g, " ").replace(/[.!]+$/, "");
  return t ? cap(t) : t;
}

/** Resolves several drafts from the same utterance. */
export function resolveDrafts(drafts: ItemDraft[], context: ResolveContext): DiloItem[] {
  return drafts.map((d) => resolveDraft(d, context));
}
