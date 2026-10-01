import { describe, expect, it, vi } from "vitest";
import { summarizeItem } from "@dilo/core";
import { ClaudeExtractionModel, DiloEngine, repeatSpec, DiloUnderstandingError, SYSTEM_PROMPT, type Extraction, type ExtractionModel, type WireItem } from "../../src/index";

const NOW = new Date("2026-09-30T10:00:00+02:00"); // mercoledì

const item = (p: Partial<WireItem> & Pick<WireItem, "type" | "title">): WireItem => ({
  details: null, date: null, time: null, endDate: null, endTime: null, deadline: null, deadlineTime: null,
  repeat: null, alertMinutesBefore: null, people: [], location: null, sourceText: p.title,
  question: null, questionField: null, replaces: null, ...p,
});

/** A model that returns canned outputs and records what it was asked. */
class FakeModel implements ExtractionModel {
  calls: string[] = [];
  constructor(private readonly outputs: Extraction[]) {}
  async extract(message: string): Promise<Extraction> {
    this.calls.push(message);
    const out = this.outputs.shift();
    if (!out) throw new Error("no more canned outputs");
    return out;
  }
}

let n = 0;
const engine = (model: ExtractionModel) => new DiloEngine({ model, newId: () => `id-${++n}` });

describe("DiloEngine", () => {
  it("turns the product example into two resolved items", async () => {
    const model = new FakeModel([
      {
        reply: null, cancel: [],
        items: [
          item({
            type: "task",
            title: "Prenotare il dentista",
            date: "d+1",
            time: "15:00",
            sourceText: "Domani alle 15 prenota il dentista",
          }),
          item({
            type: "reminder",
            title: "Chiamare Marco",
            date: "d+1",
            people: ["Marco"],
            sourceText: "ricordami di chiamare Marco",
          }),
        ],
      },
    ]);
    const text = "Domani alle 15 prenota il dentista e ricordami di chiamare Marco.";
    const res = await engine(model).understand(text, { now: NOW });

    expect(res.items.map((i) => summarizeItem(i, NOW))).toEqual([
      "Attività: Prenotare il dentista — domani alle 15:00",
      "Promemoria: Chiamare Marco — domani",
    ]);
    expect(res.items[0]).toMatchObject({ date: "2026-10-01", time: "15:00", status: "ready", timezone: "Europe/Rome" });
    expect(res.items[1]!.source).toEqual({ text: "ricordami di chiamare Marco", utterance: text });
    expect(res.questions).toEqual([]);
    expect(res.reply).toBeNull();

    // The model gets the current moment in words, and the static prompt stays cacheable.
    expect(model.calls[0]).toContain("Adesso è mercoledì 30 settembre 2026, ore 10:00 (Europe/Rome).");
    expect(model.calls[0]).toContain(text);
    expect(SYSTEM_PROMPT).not.toMatch(/2026/);
  });

  it("asks, then completes the item with the user's answer", async () => {
    const model = new FakeModel([
      {
        reply: null, cancel: [],
        items: [
          item({
            type: "reminder",
            title: "Chiamare Marco",
            people: ["Marco"],
            sourceText: "ricordami di chiamare Marco",
            question: "Quando vuoi che te lo ricordi?",
            questionField: "date",
          }),
        ],
      },
      {
        reply: null, cancel: [],
        items: [
          item({
            type: "reminder",
            title: "Chiamare Marco",
            people: ["Marco"],
            date: "d+1",
            time: "18:00",
            sourceText: "ricordami di chiamare Marco",
          }),
        ],
      },
    ]);
    const dilo = engine(model);
    const first = await dilo.understand("ricordami di chiamare Marco", { now: NOW });
    expect(first.questions).toEqual([{ itemId: first.items[0]!.id, question: "Quando vuoi che te lo ricordi?" }]);
    expect(first.items[0]!.status).toBe("needs_clarification");

    const second = await dilo.answer(first.items, "domani alle 18", { now: NOW });
    expect(second.items[0]).toMatchObject({ date: "2026-10-01", time: "18:00", status: "ready" });
    expect(model.calls[1]).toContain("<dilo>Quando vuoi che te lo ricordi?</dilo>");
    expect(model.calls[1]).toContain("<risposta>domani alle 18</risposta>");
  });

  it("returns a reply when there is nothing to remember", async () => {
    const res = await engine(new FakeModel([{ items: [], cancel: [], reply: "Ciao! Dimmi pure." }])).understand("ciao DILO", { now: NOW });
    expect(res).toEqual({ items: [], questions: [], reply: "Ciao! Dimmi pure.", updated: [], cancelled: [] });
  });

  it("does not call the model for empty input", async () => {
    const model = new FakeModel([]);
    const res = await engine(model).understand("   ");
    expect(res.reply).toBe("Cosa hai in testa?");
    expect(model.calls).toHaveLength(0);
  });

  it("adds the resolver's question when the model misses an impossible date", async () => {
    const model = new FakeModel([
      {
        reply: null, cancel: [],
        items: [item({ type: "event", title: "Festa di Anna", date: "cal:31-11" })],
      },
    ]);
    const res = await engine(model).understand("il 31 novembre festa di Anna", { now: NOW });
    expect(res.items[0]!.clarification).toMatchObject({ origin: "resolver", field: "date" });
  });

  it("turns an unreadable spec into a question instead of guessing", async () => {
    const model = new FakeModel([{ reply: null, cancel: [], items: [item({ type: "event", title: "Cena", date: "giovedì" })] }]);
    const res = await engine(model).understand("cena giovedì", { now: NOW });
    expect(res.items[0]!.clarification).toEqual({ question: "Non ho capito bene il giorno: quando?", field: "date", origin: "resolver" });
  });

  it("maps deadlines and repeats", async () => {
    const model = new FakeModel([
      {
        reply: null, cancel: [],
        items: [
          item({ type: "task", title: "Consegnare il preventivo", deadline: "wd:5", deadlineTime: "18:00" }),
          item({ type: "routine", title: "Correre", time: "07:00", repeat: "weekly:1,4" }),
        ],
      },
    ]);
    const [a, b] = (await engine(model).understand("x", { now: NOW })).items;
    expect(a!.deadline).toEqual({ date: "2026-10-02", time: "18:00" });
    expect(b).toMatchObject({ date: "2026-10-01", time: "07:00", status: "ready" });
    expect(b!.recurrence!.text).toBe("ogni lunedì e giovedì");
  });
});

describe("ClaudeExtractionModel", () => {
  const fakeClient = (response: object) => {
    const parse = vi.fn().mockResolvedValue(response);
    return { client: { beta: { messages: { parse } } } as never, parse };
  };

  it("sends a structured-output request with fallbacks and a cached system prompt", async () => {
    const output: Extraction = { items: [], cancel: [], reply: "Ciao!" };
    const { client, parse } = fakeClient({ stop_reason: "end_turn", parsed_output: output });
    const model = new ClaudeExtractionModel({ client });
    await expect(model.extract("ciao")).resolves.toEqual(output);

    const req = parse.mock.calls[0]![0];
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.fallbacks).toBe("default");
    expect(req.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(req.output_config.effort).toBe("medium");
    expect(req.output_config.format.type).toBe("json_schema");
    expect(req.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(req.thinking).toBeUndefined();
  });

  it("surfaces refusals and truncation as typed errors", async () => {
    for (const stop_reason of ["refusal", "max_tokens"] as const) {
      const { client } = fakeClient({ stop_reason, parsed_output: null });
      await expect(new ClaudeExtractionModel({ client }).extract("x")).rejects.toMatchObject({
        name: "DiloUnderstandingError",
        reason: stop_reason,
      });
    }
    const { client } = fakeClient({ stop_reason: "end_turn", parsed_output: null });
    await expect(new ClaudeExtractionModel({ client }).extract("x")).rejects.toBeInstanceOf(DiloUnderstandingError);
  });

  it("changes and cancels saved items, keeping their identity", async () => {
    const saved = (await engine(new FakeModel([{ reply: null, cancel: [], items: [
      item({ type: "event", title: "Cena con Giulia", date: "wd:6", time: "20:30", people: ["Giulia"], location: "Da Mario" }),
      item({ type: "task", title: "Comprare il latte", date: "d+1" }),
    ] }])).understand("x", { now: NOW })).items;

    const model = new FakeModel([{ reply: null, cancel: ["k2"], items: [
      item({ type: "event", title: "Cena con Giulia", date: "cal:03-10-2026", time: "21:00", people: ["Giulia"], location: "Da Mario", replaces: "k1", sourceText: "sposta la cena alle 21" }),
    ] }]);
    const res = await engine(model).understand("sposta la cena alle 21 e il latte non serve più", { now: NOW, known: saved });

    expect(model.calls[0]).toContain('<salvato ref="k1" type="event" title="Cena con Giulia" date="cal:03-10-2026" time="20:30"');
    expect(model.calls[0]).toContain('<salvato ref="k2" type="task"');
    expect(res.items[0]).toMatchObject({ id: saved[0]!.id, createdAt: saved[0]!.createdAt, time: "21:00", date: "2026-10-03" });
    expect(res.updated).toEqual([saved[0]!.id]);
    expect(res.cancelled).toEqual([saved[1]!.id]);
    expect(res.reply).toBeNull();
  });

  it("writes recurrences back as repeat specs", () => {
    expect(repeatSpec({ frequency: "weekly", interval: 2, weekdays: [1, 4], dayOfMonth: null, month: null, startDate: "2026-10-01", until: "2026-12-31", count: null, text: "" }))
      .toBe("weekly/2:1,4;until=cal:31-12-2026");
    expect(repeatSpec({ frequency: "yearly", interval: 1, weekdays: [], dayOfMonth: 12, month: 1, startDate: "2026-10-01", until: null, count: 3, text: "" }))
      .toBe("yearly:12-01;count=3");
  });
});
