import type { DateExpr, ItemDraft, TimeExpr } from "../src/index";

/** Mercoledì 30 settembre 2026, ore 10:00 a Roma. */
export const NOW = "2026-09-30T10:00:00+02:00";
export const TZ = "Europe/Rome";

let n = 0;
export const ctx = (over: Partial<{ now: string; timezone: string }> = {}) => ({
  now: NOW,
  timezone: TZ,
  newId: () => `id-${++n}`,
  ...over,
});

export const date = (p: Partial<DateExpr> & Pick<DateExpr, "kind">): DateExpr => ({
  offset: null,
  weekday: null,
  weekOffset: null,
  day: null,
  month: null,
  year: null,
  ...p,
});

export const clock = (hour: number, minute: number | null = 0): TimeExpr => ({
  kind: "clock",
  hour,
  minute,
  partOfDay: null,
  offsetMinutes: null,
});

export const part = (partOfDay: NonNullable<TimeExpr["partOfDay"]>): TimeExpr => ({
  kind: "part_of_day",
  hour: null,
  minute: null,
  partOfDay,
  offsetMinutes: null,
});

export const draft = (p: Partial<ItemDraft> & Pick<ItemDraft, "type" | "title">): ItemDraft => ({
  details: null,
  when: null,
  deadline: null,
  recurrence: null,
  alertMinutesBefore: null,
  people: [],
  location: null,
  sourceText: p.title,
  clarification: null,
  ...p,
});

export const when = (d: DateExpr | null, t: TimeExpr | null = null) => ({ date: d, time: t, endDate: null, endTime: null });
