import { describe, expect, it } from "vitest";
import { resolveDraft, summarizeItem } from "../src/index";
import { clock, ctx, date, draft, NOW, part, when } from "./helpers";

const R = (d: Parameters<typeof resolveDraft>[0], over = {}) => resolveDraft(d, ctx(over));

describe("date resolution (oggi = mercoledì 30 settembre 2026)", () => {
  it.each([
    ["oggi", date({ kind: "relative_days", offset: 0 }), "2026-09-30"],
    ["domani", date({ kind: "relative_days", offset: 1 }), "2026-10-01"],
    ["dopodomani", date({ kind: "relative_days", offset: 2 }), "2026-10-02"],
    ["tra 10 giorni", date({ kind: "relative_days", offset: 10 }), "2026-10-10"],
    ["venerdì", date({ kind: "weekday", weekday: 5 }), "2026-10-02"],
    ["lunedì", date({ kind: "weekday", weekday: 1 }), "2026-10-05"],
    ["mercoledì (oggi è mercoledì → il prossimo)", date({ kind: "weekday", weekday: 3 }), "2026-10-07"],
    ["questo venerdì", date({ kind: "weekday", weekday: 5, weekOffset: 0 }), "2026-10-02"],
    ["venerdì della settimana prossima", date({ kind: "weekday", weekday: 5, weekOffset: 1 }), "2026-10-09"],
    ["il 3 marzo (anno prossimo)", date({ kind: "calendar", day: 3, month: 3 }), "2027-03-03"],
    ["il 15 ottobre", date({ kind: "calendar", day: 15, month: 10 }), "2026-10-15"],
    ["il 30 settembre (oggi)", date({ kind: "calendar", day: 30, month: 9 }), "2026-09-30"],
    ["il 29 febbraio → prossimo anno bisestile", date({ kind: "calendar", day: 29, month: 2 }), "2028-02-29"],
    ["tra 2 settimane", date({ kind: "relative_weeks", offset: 2 }), "2026-10-14"],
    ["tra un mese", date({ kind: "relative_months", offset: 1 }), "2026-10-30"],
    ["a fine mese", date({ kind: "month_end", offset: 0 }), "2026-09-30"],
    ["a fine del mese prossimo", date({ kind: "month_end", offset: 1 }), "2026-10-31"],
  ])("%s", (_label, d, expected) => {
    const item = R(draft({ type: "task", title: "Fare", when: when(d) }));
    expect(item.date).toBe(expected);
    expect(item.status).toBe("ready");
  });

  it("vague periods become a window, not an invented day", () => {
    const week = R(draft({ type: "task", title: "Chiamare il commercialista", when: when(date({ kind: "week", weekOffset: 1 })) }));
    expect(week.date).toBeNull();
    expect(week.window).toEqual({ from: "2026-10-05", to: "2026-10-11" });

    const weekend = R(draft({ type: "task", title: "Pulire la cantina", when: when(date({ kind: "weekend" })) }));
    expect(weekend.window).toEqual({ from: "2026-10-03", to: "2026-10-04" });

    const nov = R(draft({ type: "task", title: "Rinnovare il passaporto", when: when(date({ kind: "month", month: 11 })) }));
    expect(nov.window).toEqual({ from: "2026-11-01", to: "2026-11-30" });

    const thisWeek = R(draft({ type: "task", title: "Finire il report", when: when(date({ kind: "week", weekOffset: 0 })) }));
    expect(thisWeek.window).toEqual({ from: "2026-09-30", to: "2026-10-04" });
  });

  it("an impossible date asks instead of guessing", () => {
    const item = R(draft({ type: "event", title: "Festa", when: when(date({ kind: "calendar", day: 31, month: 11 })) }));
    expect(item.status).toBe("needs_clarification");
    expect(item.clarification).toMatchObject({ field: "date", origin: "resolver" });
    expect(item.clarification!.question).toMatch(/31 novembre non esiste/);
  });

  it("a weekday of this week that already passed asks", () => {
    const item = R(draft({ type: "task", title: "Fare", when: when(date({ kind: "weekday", weekday: 1, weekOffset: 0 })) }));
    expect(item.status).toBe("needs_clarification");
    expect(item.clarification!.question).toMatch(/già passato/);
  });

  it("an explicit year in the past is flagged for tasks but fine for notes", () => {
    const d = date({ kind: "calendar", day: 1, month: 3, year: 2025 });
    expect(R(draft({ type: "event", title: "Concerto", when: when(d) })).status).toBe("needs_clarification");
    expect(R(draft({ type: "note", title: "Ho conosciuto Anna", when: when(d) })).status).toBe("ready");
  });
});

describe("time resolution", () => {
  it("clock time with date gives startsAt with the Rome offset", () => {
    const item = R(draft({ type: "reminder", title: "Chiamare Luca", when: when(date({ kind: "relative_days", offset: 1 }), clock(10)) }));
    expect(item.time).toBe("10:00");
    expect(item.startsAt).toBe("2026-10-01T10:00:00.000+02:00");
  });

  it("uses winter time after the DST change (25 ottobre 2026)", () => {
    const item = R(draft({ type: "event", title: "Riunione", when: when(date({ kind: "calendar", day: 26, month: 10 }), clock(9, 30)) }));
    expect(item.startsAt).toBe("2026-10-26T09:30:00.000+01:00");
  });

  it("time only, still ahead today → today", () => {
    const item = R(draft({ type: "task", title: "Chiamare Marco", when: when(null, clock(15)) }));
    expect(item.date).toBe("2026-09-30");
    expect(item.status).toBe("ready");
  });

  it("time only, already passed today → asks instead of assuming tomorrow", () => {
    const item = R(draft({ type: "task", title: "Chiamare Marco", when: when(null, clock(9)) }));
    expect(item.date).toBeNull();
    expect(item.clarification!.question).toBe("Le 09:00 di oggi sono già passate: intendi domani?");
  });

  it("today at a past time asks", () => {
    const item = R(draft({ type: "reminder", title: "Prendere la medicina", when: when(date({ kind: "relative_days", offset: 0 }), clock(8)) }));
    expect(item.status).toBe("needs_clarification");
  });

  it("relative time: tra 20 minuti", () => {
    const item = R(draft({
      type: "reminder",
      title: "Togliere la torta dal forno",
      when: when(null, { kind: "relative", hour: null, minute: null, partOfDay: null, offsetMinutes: 20 }),
    }));
    expect(item.date).toBe("2026-09-30");
    expect(item.time).toBe("10:20");
  });

  it("relative time crossing midnight", () => {
    const item = resolveDraft(
      draft({ type: "reminder", title: "Spegnere il forno", when: when(null, { kind: "relative", hour: null, minute: null, partOfDay: null, offsetMinutes: 90 }) }),
      ctx({ now: "2026-09-30T23:15:00+02:00" }),
    );
    expect(item.date).toBe("2026-10-01");
    expect(item.time).toBe("00:45");
  });

  it("part of day is kept vague", () => {
    const item = R(draft({ type: "task", title: "Scrivere a Giulia", when: when(date({ kind: "relative_days", offset: 0 }), part("sera")) }));
    expect(item.time).toBeNull();
    expect(item.partOfDay).toBe("sera");
    expect(item.status).toBe("ready");
  });

  it("end time before start crosses midnight", () => {
    const item = R(draft({
      type: "event",
      title: "Festa",
      when: { date: date({ kind: "weekday", weekday: 6 }), time: clock(22), endDate: null, endTime: clock(2) },
    }));
    expect(item.date).toBe("2026-10-03");
    expect(item.endDate).toBe("2026-10-04");
    expect(item.endTime).toBe("02:00");
  });

  it("invalid hour asks", () => {
    const item = R(draft({ type: "event", title: "Cena", when: when(date({ kind: "relative_days", offset: 1 }), clock(27)) }));
    expect(item.clarification).toMatchObject({ field: "time" });
  });
});

describe("missing information", () => {
  it("a reminder without any time asks when", () => {
    const item = R(draft({ type: "reminder", title: "Chiamare Marco" }));
    expect(item.clarification).toEqual({ question: "Quando vuoi che te lo ricordi?", field: "date", origin: "resolver" });
  });

  it("an undated task is fine", () => {
    expect(R(draft({ type: "task", title: "Comprare il latte" })).status).toBe("ready");
  });

  it("the model's own question wins over the resolver's", () => {
    const item = R(draft({ type: "reminder", title: "Chiamare Marco", clarification: { question: "Quale Marco?", field: "other" } }));
    expect(item.clarification).toEqual({ question: "Quale Marco?", field: "other", origin: "model" });
  });

  it("a routine without recurrence asks how often", () => {
    const item = R(draft({ type: "routine", title: "Andare a correre" }));
    expect(item.clarification!.field).toBe("recurrence");
  });

  it("weekly without a day asks which day", () => {
    const item = R(draft({
      type: "routine",
      title: "Andare in palestra",
      recurrence: { frequency: "weekly", interval: 1, weekdays: [], dayOfMonth: null, month: null, until: null, count: null },
    }));
    expect(item.clarification!.question).toBe("In quale giorno della settimana?");
  });
});

describe("deadlines", () => {
  it("entro venerdì", () => {
    const item = R(draft({ type: "task", title: "Consegnare il preventivo", deadline: { date: date({ kind: "weekday", weekday: 5 }), time: null } }));
    expect(item.deadline).toEqual({ date: "2026-10-02", time: null });
    expect(item.date).toBeNull();
  });

  it("entro la settimana prossima → end of that week", () => {
    const item = R(draft({ type: "task", title: "Pagare l'IMU", deadline: { date: date({ kind: "week", weekOffset: 1 }), time: null } }));
    expect(item.deadline!.date).toBe("2026-10-11");
  });
});

describe("recurrence", () => {
  it("ogni lunedì e giovedì alle 7:30 → next occurrence is Thursday", () => {
    const item = R(draft({
      type: "routine",
      title: "Andare a correre",
      when: when(null, clock(7, 30)),
      recurrence: { frequency: "weekly", interval: 1, weekdays: [4, 1], dayOfMonth: null, month: null, until: null, count: null },
    }));
    expect(item.status).toBe("ready");
    expect(item.date).toBe("2026-10-01");
    expect(item.time).toBe("07:30");
    expect(item.recurrence!.weekdays).toEqual([1, 4]);
    expect(item.recurrence!.text).toBe("ogni lunedì e giovedì");
    expect(summarizeItem(item, new Date(NOW))).toBe("Routine: Andare a correre — ogni lunedì e giovedì alle 7:30");
  });

  it("ogni primo del mese → monthly day 1", () => {
    const item = R(draft({
      type: "reminder",
      title: "Pagare l'affitto",
      recurrence: { frequency: "monthly", interval: 1, weekdays: [], dayOfMonth: 1, month: null, until: null, count: null },
    }));
    expect(item.date).toBe("2026-10-01");
    expect(item.recurrence!.text).toBe("ogni mese, il giorno 1");
  });

  it("compleanno ogni anno il 12 gennaio", () => {
    const item = R(draft({
      type: "event",
      title: "Compleanno della mamma",
      when: when(date({ kind: "calendar", day: 12, month: 1 })),
      recurrence: { frequency: "yearly", interval: 1, weekdays: [], dayOfMonth: 12, month: 1, until: null, count: null },
    }));
    expect(item.date).toBe("2027-01-12");
    expect(item.recurrence!.text).toBe("ogni anno, il 12 gennaio");
  });
});

describe("titles", () => {
  it("are trimmed and capitalised", () => {
    expect(R(draft({ type: "task", title: "  prenotare   il dentista. " })).title).toBe("Prenotare il dentista");
  });
});
