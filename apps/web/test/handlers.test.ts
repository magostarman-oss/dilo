import { describe, expect, it } from "vitest";
import { DiloEngine, DiloUnderstandingError, type Extraction, type ExtractionModel, type WireItem } from "@dilo/nlu";
import { handleAnswer, handleUnderstand } from "../src/server/handlers";

const wire = (p: Partial<WireItem> & Pick<WireItem, "type" | "title">): WireItem => ({
  details: null, date: null, time: null, endDate: null, endTime: null, deadline: null, deadlineTime: null,
  repeat: null, alertMinutesBefore: null, people: [], location: null, sourceText: p.title,
  question: null, questionField: null, ...p,
});

const engineWith = (...outputs: (Extraction | Error)[]) => {
  const model: ExtractionModel = {
    extract: async () => {
      const out = outputs.shift();
      if (!out) throw new Error("no output");
      if (out instanceof Error) throw out;
      return out;
    },
  };
  return () => new DiloEngine({ model });
};

describe("API handlers", () => {
  it("understands a sentence", async () => {
    const res = await handleUnderstand(
      { text: "Domani alle 15 prenota il dentista", timezone: "Europe/Rome" },
      engineWith({ reply: null, items: [wire({ type: "task", title: "Prenotare il dentista", date: "d+1", time: "15:00" })] }),
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ items: [{ type: "task", title: "Prenotare il dentista", time: "15:00", status: "ready" }] });
  });

  it("answers a clarification by replacing the pending item", async () => {
    const getEngine = engineWith(
      { reply: null, items: [wire({ type: "reminder", title: "Chiamare Marco", question: "Quando?", questionField: "date" })] },
      { reply: null, items: [wire({ type: "reminder", title: "Chiamare Marco", date: "d+1", time: "09:00" })] },
    );
    const first = await handleUnderstand({ text: "ricordami di chiamare Marco" }, getEngine);
    const pending = "items" in first.body ? first.body.items : [];
    expect(pending[0]?.status).toBe("needs_clarification");

    const second = await handleAnswer({ pending, answer: "domani alle 9" }, getEngine);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ items: [{ title: "Chiamare Marco", time: "09:00", status: "ready" }], questions: [] });
  });

  it("rejects bad input, missing configuration and model failures with Italian messages", async () => {
    expect((await handleUnderstand({ text: "" }, engineWith())).status).toBe(400);
    expect((await handleUnderstand(null, engineWith())).status).toBe(400);

    const missing = await handleUnderstand({ text: "ciao" }, () => null);
    expect(missing).toMatchObject({ status: 503, body: { error: { code: "not_configured" } } });

    const failed = await handleUnderstand({ text: "ciao" }, engineWith(new DiloUnderstandingError("x", "refusal")));
    expect(failed).toMatchObject({ status: 502, body: { error: { code: "understanding_failed" } } });
  });
});
