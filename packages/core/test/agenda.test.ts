import { describe, expect, it } from "vitest";
import { buildAgenda, nextOccurrence, occursOn, resolveDraft } from "../src/index";
import { clock, ctx, date, draft, part, when } from "./helpers";

const weekly = (weekdays: number[], interval = 1) => ({
  frequency: "weekly" as const,
  interval,
  weekdays,
  dayOfMonth: null,
  month: null,
  until: null,
  count: null,
});

describe("occursOn", () => {
  const base = { dayOfMonth: null, month: null, until: null, count: null, startDate: "2026-09-30" };

  it("every 2 weeks on Friday", () => {
    const rule = { ...base, frequency: "weekly" as const, interval: 2, weekdays: [5] };
    expect(occursOn(rule, "2026-10-02")).toBe(true);
    expect(occursOn(rule, "2026-10-09")).toBe(false);
    expect(occursOn(rule, "2026-10-16")).toBe(true);
  });

  it("last day of the month", () => {
    const rule = { ...base, frequency: "monthly" as const, interval: 1, weekdays: [], dayOfMonth: -1 };
    expect(occursOn(rule, "2026-10-31")).toBe(true);
    expect(occursOn(rule, "2027-02-28")).toBe(true);
    expect(occursOn(rule, "2026-10-30")).toBe(false);
  });

  it("stops after count and until", () => {
    const daily = { ...base, frequency: "daily" as const, interval: 1, weekdays: [], count: 3 };
    expect(occursOn(daily, "2026-10-02")).toBe(true);
    expect(occursOn(daily, "2026-10-03")).toBe(false);
    const until = { ...base, frequency: "daily" as const, interval: 1, weekdays: [], until: "2026-10-05" };
    expect(nextOccurrence(until, "2026-10-06")).toBeNull();
  });
});

describe("buildAgenda (Oggi)", () => {
  const c = ctx();
  const items = [
    resolveDraft(draft({ type: "event", title: "Dentista", when: when(date({ kind: "relative_days", offset: 0 }), clock(15)) }), c),
    resolveDraft(draft({ type: "task", title: "Scrivere a Giulia", when: when(date({ kind: "relative_days", offset: 0 }), part("sera")) }), c),
    resolveDraft(draft({ type: "task", title: "Comprare il pane", when: when(date({ kind: "relative_days", offset: 0 })) }), c),
    resolveDraft(draft({ type: "routine", title: "Stretching", when: when(null, clock(12)), recurrence: weekly([3]) }), c),
    resolveDraft(draft({ type: "task", title: "Preventivo", deadline: { date: date({ kind: "relative_days", offset: 0 }), time: clock(18) } }), c),
    resolveDraft(draft({ type: "event", title: "Cena", when: when(date({ kind: "relative_days", offset: 1 }), clock(20)) }), c),
    resolveDraft(draft({ type: "note", title: "Codice del cancello 4512" }), c),
    resolveDraft(draft({ type: "reminder", title: "Chiamare Marco" }), c),
  ];

  it("shows today in time order, with vague times placed sensibly", () => {
    const a = buildAgenda(items, "2026-09-30");
    expect(a.schedule.map((e) => e.item.title)).toEqual(["Stretching", "Dentista", "Scrivere a Giulia"]);
    expect(a.anytime.map((e) => e.item.title)).toEqual(["Comprare il pane"]);
    expect(a.deadlines.map((e) => [e.item.title, e.time])).toEqual([["Preventivo", "18:00"]]);
    expect(a.toClarify.map((i) => i.title)).toEqual(["Chiamare Marco"]);
  });

  it("tomorrow shows the dinner and past undone tasks as overdue", () => {
    const a = buildAgenda(items, "2026-10-01");
    expect(a.schedule.map((e) => e.item.title)).toEqual(["Cena"]);
    expect(a.overdue.map((e) => e.item.title).sort()).toEqual(["Comprare il pane", "Preventivo", "Scrivere a Giulia"]);
    const done = buildAgenda(items, "2026-10-01", { isDone: (i) => i.title === "Comprare il pane" });
    expect(done.overdue.map((e) => e.item.title)).not.toContain("Comprare il pane");
  });
});
