import { describe, expect, it } from "vitest";
import { parseDateSpec, parseRepeatSpec, parseTimeSpec } from "../src/index";

describe("specs", () => {
  it.each([
    ["d+1", { kind: "relative_days", offset: 1 }],
    ["d0", { kind: "relative_days", offset: 0 }],
    ["wd:5", { kind: "weekday", weekday: 5, weekOffset: null }],
    ["wd:5@1", { kind: "weekday", weekday: 5, weekOffset: 1 }],
    ["cal:03-03", { kind: "calendar", day: 3, month: 3, year: null }],
    ["cal:15/10/2027", { kind: "calendar", day: 15, month: 10, year: 2027 }],
    ["w+2", { kind: "relative_weeks", offset: 2 }],
    ["m+1", { kind: "relative_months", offset: 1 }],
    ["week@1", { kind: "week", weekOffset: 1 }],
    ["weekend", { kind: "weekend", weekOffset: null }],
    ["month:11", { kind: "month", month: 11 }],
    ["month@1", { kind: "month", offset: 1 }],
    ["monthend@0", { kind: "month_end", offset: 0 }],
  ])("date %s", (spec, expected) => {
    const r = parseDateSpec(spec);
    expect(r.ok && r.value).toMatchObject(expected);
  });

  it("rejects unknown dates", () => {
    expect(parseDateSpec("venerdì").ok).toBe(false);
    expect(parseDateSpec("wd:8").ok).toBe(false);
  });

  it("times", () => {
    expect(parseTimeSpec("15:30")).toMatchObject({ ok: true, value: { kind: "clock", hour: 15, minute: 30 } });
    expect(parseTimeSpec("9")).toMatchObject({ ok: true, value: { kind: "clock", hour: 9, minute: 0 } });
    expect(parseTimeSpec("sera")).toMatchObject({ ok: true, value: { kind: "part_of_day", partOfDay: "sera" } });
    expect(parseTimeSpec("+20m")).toMatchObject({ ok: true, value: { kind: "relative", offsetMinutes: 20 } });
    expect(parseTimeSpec("+2h")).toMatchObject({ ok: true, value: { kind: "relative", offsetMinutes: 120 } });
    expect(parseTimeSpec("presto").ok).toBe(false);
  });

  it("repeats", () => {
    expect(parseRepeatSpec("weekly:1,4")).toMatchObject({ ok: true, value: { frequency: "weekly", interval: 1, weekdays: [1, 4] } });
    expect(parseRepeatSpec("daily/2")).toMatchObject({ ok: true, value: { frequency: "daily", interval: 2 } });
    expect(parseRepeatSpec("monthly:-1")).toMatchObject({ ok: true, value: { dayOfMonth: -1 } });
    expect(parseRepeatSpec("yearly:12-01")).toMatchObject({ ok: true, value: { dayOfMonth: 12, month: 1 } });
    expect(parseRepeatSpec("daily;until=monthend@0;count=5")).toMatchObject({
      ok: true,
      value: { until: { kind: "month_end", offset: 0 }, count: 5 },
    });
    expect(parseRepeatSpec("weekly:9").ok).toBe(false);
    expect(parseRepeatSpec("sometimes").ok).toBe(false);
  });
});
