import { describe, expect, it } from "vitest";
import { applyEdit, type DiloItem } from "../src/index";

const item = (over: Partial<DiloItem> = {}): DiloItem => ({
  id: "a", type: "event", title: "Cena con Giulia", details: null, date: "2026-10-03", time: "20:30", partOfDay: null,
  endDate: null, endTime: "22:30", startsAt: "2026-10-03T20:30:00.000+02:00", window: null, deadline: null, recurrence: null,
  alertMinutesBefore: null, people: ["Giulia"], location: "Da Mario", status: "ready", clarification: null,
  source: { text: "x", utterance: "x" }, timezone: "Europe/Rome", createdAt: "2026-10-01T08:00:00.000Z", ...over,
});

describe("applyEdit", () => {
  it("moves the time and keeps the duration and the id", () => {
    const e = applyEdit(item(), { time: "21:00" });
    expect(e).toMatchObject({ id: "a", time: "21:00", endTime: "23:00", startsAt: "2026-10-03T21:00:00.000+02:00" });
  });

  it("moves the day, the end day with it, and leaves the rest alone", () => {
    const e = applyEdit(item({ endDate: "2026-10-04", endTime: null }), { date: "2026-10-10", title: "  Cena  da Mario " });
    expect(e).toMatchObject({ date: "2026-10-10", endDate: "2026-10-11", title: "Cena da Mario", people: ["Giulia"] });
  });

  it("a precise day or time replaces a vague one; clearing the time clears the start", () => {
    const vague = item({ date: null, time: null, endTime: null, startsAt: null, partOfDay: "sera", window: { from: "2026-10-05", to: "2026-10-11" } });
    expect(applyEdit(vague, { date: "2026-10-06", time: "19:00" })).toMatchObject({ window: null, partOfDay: null, startsAt: "2026-10-06T19:00:00.000+02:00" });
    expect(applyEdit(item(), { time: null })).toMatchObject({ time: null, endTime: null, startsAt: null });
  });

  it("drops an end time that would pass midnight", () => {
    expect(applyEdit(item(), { time: "23:00" }).endTime).toBeNull();
  });
});
