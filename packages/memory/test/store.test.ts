import { describe, expect, it } from "vitest";
import type { DiloItem } from "@dilo/core";
import { isDoneOn, KeyValueItemStore, MemoryStorage, STORAGE_KEY } from "../src/index";

const item = (id: string, over: Partial<DiloItem> = {}): DiloItem => ({
  id, type: "task", title: `Item ${id}`, details: null, date: "2026-10-01", time: null, partOfDay: null,
  endDate: null, endTime: null, startsAt: null, window: null, deadline: null, recurrence: null,
  alertMinutesBefore: null, people: [], location: null, status: "ready", clarification: null,
  source: { text: id, utterance: id }, timezone: "Europe/Rome", createdAt: "2026-09-30T08:00:00.000Z", ...over,
});

const now = () => new Date("2026-10-01T08:00:00Z");

describe("KeyValueItemStore", () => {
  it("saves, replaces and removes items, and persists them across instances", async () => {
    const storage = new MemoryStorage();
    const store = new KeyValueItemStore(storage, STORAGE_KEY, now);
    await store.save([item("a"), item("b")]);
    await store.save([item("a", { title: "Nuovo titolo" })]);
    await store.remove(["b"]);

    const reopened = new KeyValueItemStore(storage);
    const entries = await reopened.all();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ item: { id: "a", title: "Nuovo titolo" }, savedAt: "2026-10-01T08:00:00.000Z" });
  });

  it("marks one-off items done, and recurring items done per day", async () => {
    const store = new KeyValueItemStore(new MemoryStorage(), STORAGE_KEY, now);
    const routine = item("r", {
      type: "routine",
      recurrence: { frequency: "daily", interval: 1, weekdays: [], dayOfMonth: null, month: null, startDate: "2026-10-01", until: null, count: null, text: "ogni giorno" },
    });
    await store.save([item("t"), routine]);
    await store.setDone("t", true, "2026-10-01");
    await store.setDone("r", true, "2026-10-01");

    const [t, r] = await store.all();
    expect(isDoneOn(t!, "2026-10-05")).toBe(true);
    expect(isDoneOn(r!, "2026-10-01")).toBe(true);
    expect(isDoneOn(r!, "2026-10-02")).toBe(false);

    await store.setDone("t", false, "2026-10-01");
    expect(isDoneOn((await store.all())[0]!, "2026-10-01")).toBe(false);
  });

  it("notifies subscribers and survives corrupt storage", async () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, "{not json");
    const store = new KeyValueItemStore(storage);
    expect(await store.all()).toEqual([]);

    let calls = 0;
    const off = store.subscribe(() => calls++);
    await store.save([item("a")]);
    off();
    await store.save([item("b")]);
    expect(calls).toBe(1);
  });
});
