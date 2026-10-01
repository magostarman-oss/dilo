import { describe, expect, it } from "vitest";
import { googleCalendarUrl, toCalendarEntry, type DiloItem } from "../src/index";

const item = (over: Partial<DiloItem>): DiloItem => ({
  id: "x", type: "event", title: "Cena con Giulia", details: null, date: "2026-10-03", time: "20:30", partOfDay: null,
  endDate: null, endTime: null, startsAt: null, window: null, deadline: null, recurrence: null,
  alertMinutesBefore: null, people: ["Giulia"], location: "da Mario", status: "ready", clarification: null,
  source: { text: "sabato cena con Giulia", utterance: "sabato cena con Giulia" },
  timezone: "Europe/Rome", createdAt: "2026-10-01T08:00:00.000Z", ...over,
});

const params = (url: string | null) => new URL(url!).searchParams;

describe("Google Calendar", () => {
  it("fills a timed event in UTC with a one hour default", () => {
    const p = params(googleCalendarUrl(item({})));
    expect(p.get("action")).toBe("TEMPLATE");
    expect(p.get("text")).toBe("Cena con Giulia");
    expect(p.get("dates")).toBe("20261003T183000Z/20261003T193000Z"); // 20:30 a Roma, ora legale
    expect(p.get("location")).toBe("da Mario");
    expect(p.get("details")).toContain("Con: Giulia");
    expect(p.get("ctz")).toBe("Europe/Rome");
  });

  it("uses all-day entries when there is no time, instead of inventing one", () => {
    const p = params(googleCalendarUrl(item({ type: "reminder", title: "Chiamare Marco", time: null, partOfDay: "sera", location: null })));
    expect(p.get("dates")).toBe("20261003/20261004");
    expect(p.has("location")).toBe(false);
  });

  it("adds the recurrence rule for routines", () => {
    const p = params(
      googleCalendarUrl(
        item({
          type: "routine", title: "Palestra", date: null, time: "07:30",
          recurrence: { frequency: "weekly", interval: 1, weekdays: [1, 4], dayOfMonth: null, month: null, startDate: "2026-10-05", until: null, count: null, text: "ogni lunedì e giovedì" },
        }),
      ),
    );
    expect(p.get("recur")).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO,TH");
    expect(p.get("dates")).toBe("20261005T053000Z/20261005T060000Z");
  });

  it("puts deadline-only tasks on their due day and skips notes, undated and unclear items", () => {
    const due = toCalendarEntry(item({ type: "task", title: "Pagare l'affitto", date: null, time: null, deadline: { date: "2026-10-05", time: null } }));
    expect(due).toMatchObject({ title: "Scadenza: Pagare l'affitto", allDay: true });
    expect(googleCalendarUrl(item({ type: "note" }))).toBeNull();
    expect(googleCalendarUrl(item({ date: null, time: null }))).toBeNull();
    expect(googleCalendarUrl(item({ status: "needs_clarification" }))).toBeNull();
  });
});
