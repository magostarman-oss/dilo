import { describe, expect, it } from "vitest";
import type { DiloItem } from "@dilo/core";
import { KeyValueItemStore, MemoryStorage } from "@dilo/memory";
import { AnswerRequest, DiloApiError, DiloAssistant, HttpDiloApi, UnderstandRequest, type DiloApi, type UnderstandResponse } from "../src/index";

const item = (id: string, over: Partial<DiloItem> = {}): DiloItem => ({
  id, type: "reminder", title: "Chiamare Marco", details: null, date: "2026-10-01", time: null, partOfDay: null,
  endDate: null, endTime: null, startsAt: null, window: null, deadline: null, recurrence: null,
  alertMinutesBefore: null, people: ["Marco"], location: null, status: "ready", clarification: null,
  source: { text: "ricordami di chiamare Marco", utterance: "ricordami di chiamare Marco" },
  timezone: "Europe/Rome", createdAt: "2026-09-30T08:00:00.000Z", ...over,
});

const respond = (items: DiloItem[], reply: string | null = null): UnderstandResponse => ({
  items,
  reply,
  questions: items.filter((i) => i.clarification).map((i) => ({ itemId: i.id, question: i.clarification!.question })),
});

describe("DiloAssistant", () => {
  it("remembers what it understood, then replaces a clarified item", async () => {
    const pending = item("p", {
      date: null, status: "needs_clarification",
      clarification: { question: "Quando?", field: "date", origin: "resolver" },
    });
    const calls: unknown[] = [];
    const api: DiloApi = {
      understand: async (req) => (calls.push(req), respond([item("a"), pending])),
      answer: async (req) => (calls.push(req), respond([item("p2", { date: "2026-10-02" })])),
    };
    const store = new KeyValueItemStore(new MemoryStorage());
    const dilo = new DiloAssistant(api, store, "Europe/Rome");

    await dilo.say("Domani...");
    expect((await store.all()).map((e) => e.item.id)).toEqual(["a", "p"]);

    await dilo.answer(pending, "venerdì");
    expect((await store.all()).map((e) => e.item.id)).toEqual(["a", "p2"]);
    expect(calls[1]).toEqual({ pending: [pending], answer: "venerdì", timezone: "Europe/Rome" });

    await dilo.forget([item("a")]);
    expect((await store.all()).map((e) => e.item.id)).toEqual(["p2"]);
  });
});

describe("HttpDiloApi", () => {
  it("turns server errors into DiloApiError with the server's Italian message", async () => {
    const api = new HttpDiloApi("", async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: { code: "not_configured", message: "Manca la chiave" } }),
    }));
    await expect(api.understand({ text: "ciao" })).rejects.toMatchObject({ code: "not_configured", status: 503, message: "Manca la chiave" });
  });

  it("reports network failures", async () => {
    const api = new HttpDiloApi("", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(api.understand({ text: "ciao" })).rejects.toBeInstanceOf(DiloApiError);
  });
});

describe("request contract", () => {
  it("validates text, timezone and pending items", () => {
    expect(UnderstandRequest.safeParse({ text: "  ", timezone: "Europe/Rome" }).success).toBe(false);
    expect(UnderstandRequest.safeParse({ text: "ciao", timezone: "Mars/Base" }).success).toBe(false);
    expect(UnderstandRequest.safeParse({ text: "ciao", timezone: "Europe/Rome" }).success).toBe(true);
    expect(AnswerRequest.safeParse({ pending: [], answer: "sì" }).success).toBe(false);
    expect(AnswerRequest.safeParse({ pending: [item("a")], answer: "sì" }).success).toBe(true);
  });
});
