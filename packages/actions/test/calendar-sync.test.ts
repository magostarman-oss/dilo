import { describe, expect, it } from "vitest";
import type { DiloItem } from "@dilo/core";
import { KeyValueItemStore, MemoryStorage } from "@dilo/memory";
import { CalendarSyncedStore, GoogleCalendarApi } from "../src/index";

const item = (id: string, over: Partial<DiloItem> = {}): DiloItem => ({
  id, type: "event", title: `Evento ${id}`, details: null, date: "2026-10-03", time: "20:30", partOfDay: null,
  endDate: null, endTime: null, startsAt: null, window: null, deadline: null, recurrence: null,
  alertMinutesBefore: null, people: [], location: null, status: "ready", clarification: null,
  source: { text: id, utterance: id }, timezone: "Europe/Rome", createdAt: "2026-10-01T08:00:00.000Z", ...over,
});

/** A fake Google Calendar that records calls. */
function fakeGoogle() {
  const events = new Map<string, unknown>();
  const calls: string[] = [];
  let n = 0;
  let token: string | null = null;
  const api = new GoogleCalendarApi(
    () => token,
    async (url, init) => {
      calls.push(`${init.method} ${url.split("/events")[1] || "/"}`);
      if (init.headers.authorization !== "Bearer ok") return { ok: false, status: 401, json: async () => ({}) };
      if (init.method === "POST") {
        const id = `ev${++n}`;
        events.set(id, JSON.parse(init.body!));
        return { ok: true, status: 200, json: async () => ({ id }) };
      }
      const id = url.split("/").pop()!;
      const had = events.delete(id);
      return { ok: had, status: had ? 204 : 404, json: async () => ({}) };
    },
    () => (token = null),
  );
  return { api, events, calls, connect: (t = "ok") => (token = t), disconnect: () => (token = null) };
}

const setup = () => {
  const google = fakeGoogle();
  const results: { written: number; waiting: number }[] = [];
  const store = new CalendarSyncedStore(new KeyValueItemStore(new MemoryStorage()), google.api, () => "2026-10-01", (r) => results.push(r));
  return { google, store, results };
};

describe("CalendarSyncedStore", () => {
  it("waits while not connected, then writes everything with a day and links it", async () => {
    const { google, store } = setup();
    await store.save([item("a"), item("note", { type: "note" }), item("past", { date: "2026-09-20" }), item("q", { status: "needs_clarification" })]);
    expect(await store.sync()).toEqual({ written: 0, waiting: 1 });

    google.connect();
    expect(await store.sync()).toEqual({ written: 1, waiting: 0 });
    const a = (await store.all()).find((e) => e.item.id === "a")!;
    expect(a.calendar).toMatchObject({ provider: "google", eventId: "ev1" });

    // Nothing is written twice.
    expect(await store.sync()).toEqual({ written: 0, waiting: 0 });
    expect(google.events.size).toBe(1);
  });

  it("removes the calendar event when the item is undone or deleted", async () => {
    const { google, store } = setup();
    google.connect();
    await store.save([item("a"), item("b")]);
    await store.sync();
    expect(google.events.size).toBe(2);

    await store.remove(["a"]);
    expect(google.events.size).toBe(1);
    expect((await store.all()).map((e) => e.item.id)).toEqual(["b"]);
  });

  it("stops at an expired token, forgets it and keeps the rest waiting", async () => {
    const { google, store, results } = setup();
    google.connect("expired");
    await store.save([item("a"), item("b")]);
    await store.sync();
    await store.sync();
    expect(google.calls.filter((c) => c.startsWith("POST"))).toHaveLength(1);
    expect(google.api.connected).toBe(false);
    expect(results.at(-1)).toEqual({ written: 0, waiting: 2 });
  });
});
