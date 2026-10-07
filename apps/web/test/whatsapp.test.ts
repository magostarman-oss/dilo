import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DiloEngine, type Extraction, type ExtractionModel, type WireItem } from "@dilo/nlu";
import { validSignature, type WhatsAppApi } from "../src/server/whatsapp/cloud-api";
import { GoogleCalendarApi } from "@dilo/actions";
import { chat, syncCalendar, type ChatCalendar } from "../src/server/whatsapp/conversation";
import { authorizeUrl, connectLink } from "../src/server/whatsapp/google";
import { MemoryKv } from "../src/server/whatsapp/kv";
import { incomingMessages, parseAllowed, processMessage, verifyWebhook, type IncomingMessage } from "../src/server/whatsapp/webhook";

const wire = (p: Partial<WireItem> & Pick<WireItem, "type" | "title">): WireItem => ({
  details: null, date: null, time: null, endDate: null, endTime: null, deadline: null, deadlineTime: null,
  repeat: null, alertMinutesBefore: null, people: [], location: null, sourceText: p.title,
  question: null, questionField: null, replaces: null, ...p,
});

/** An engine that answers with the given extractions in order, recording what it was asked. */
const scripted = (...outputs: Extraction[]) => {
  const asked: string[] = [];
  const model: ExtractionModel = {
    extract: async (message) => {
      asked.push(JSON.stringify(message));
      const out = outputs.shift();
      if (!out) throw new Error("no output");
      return out;
    },
  };
  const engine = new DiloEngine({ model });
  return { getEngine: () => engine, asked };
};

// The engine resolves dates against the real clock, so the conversation does too.
const deps = (getEngine: () => DiloEngine | null, kv = new MemoryKv()) => ({ getEngine, kv, timezone: "Europe/Rome" });

describe("WhatsApp conversation", () => {
  it("remembers several items from one message and lists them by day", async () => {
    const { getEngine } = scripted({
      reply: null,
      cancel: [],
      items: [
        wire({ type: "task", title: "Prenotare il dentista", date: "d+1", time: "15:00" }),
        wire({ type: "reminder", title: "Chiamare Marco", date: "d+1" }),
      ],
    });
    const d = deps(getEngine);
    const reply = await chat("39333", "Domani alle 15 prenota il dentista e ricordami di chiamare Marco", d);
    expect(reply).toContain("Ho capito, mi segno:");
    expect(reply).toContain("• Attività: *Prenotare il dentista* — domani alle 15:00");
    expect(reply).toContain("• Promemoria: *Chiamare Marco* — domani");

    const tomorrow = await chat("39333", "Cosa ho domani?", d);
    expect(tomorrow).toMatch(/^\*Domani, /);
    expect(tomorrow).toContain("• 15:00 Prenotare il dentista");
    expect(tomorrow).toContain("*In giornata*\n• Chiamare Marco");
    expect(await chat("39333", "oggi", d)).toMatch(/^\*Oggi, .*\*\nNon hai niente in programma\.$/);
  });

  it("keeps each phone number's memory apart", async () => {
    const { getEngine } = scripted({ reply: null, cancel: [], items: [wire({ type: "task", title: "Pagare F24", date: "d+0" })] });
    const d = deps(getEngine);
    await chat("39111", "oggi pago l'F24", d);
    expect(await chat("39222", "oggi", d)).toContain("Non hai niente in programma.");
  });

  it("asks when something is missing and reads the next message as the answer", async () => {
    const { getEngine, asked } = scripted(
      { reply: null, cancel: [], items: [wire({ type: "reminder", title: "Chiamare Luca", question: "Quando te lo ricordo?", questionField: "date" })] },
      { reply: null, cancel: [], items: [wire({ type: "reminder", title: "Chiamare Luca", date: "d+1", time: "10:00" })] },
    );
    const d = deps(getEngine);
    const first = await chat("39333", "ricordami di chiamare Luca", d);
    expect(first).toContain("Quando te lo ricordo?");

    const second = await chat("39333", "domani alle 10", d);
    expect(asked[1]).toContain("Quando te lo ricordo?");
    expect(second).toContain("*Chiamare Luca* — domani alle 10:00");
    expect(second).not.toContain("?");
    expect(await chat("39333", "domani", d)).toContain("• 10:00 Chiamare Luca");
  });

  it("takes back the last message with annulla", async () => {
    const { getEngine } = scripted({ reply: null, cancel: [], items: [wire({ type: "event", title: "Cena con Giulia", date: "d+0", time: "20:30" })] });
    const d = deps(getEngine);
    await chat("39333", "stasera alle 20:30 cena con Giulia", d);
    expect(await chat("39333", "Annulla", d)).toContain("ho annullato");
    expect(await chat("39333", "oggi", d)).toContain("Non hai niente in programma.");
    expect(await chat("39333", "annulla", d)).toBe("Non c'è niente da annullare.");
  });

  it("greets and explains itself without calling the model", async () => {
    const d = deps(() => null);
    expect(await chat("39333", "Ciao!", d)).toContain("Ciao, sono DILO");
    expect(await chat("39333", "aiuto", d)).toContain("*oggi*");
  });

  it("says so in Italian when the server has no API key", async () => {
    expect(await chat("39333", "domani dentista", deps(() => null))).toContain("manca la chiave API");
  });
});

describe("WhatsApp webhook", () => {
  const fakeWhatsApp = () => {
    const sent: { to: string; text: string }[] = [];
    const api: WhatsAppApi = {
      sendText: async (to, text) => void sent.push({ to, text }),
      downloadMedia: async () => ({ data: new ArrayBuffer(8), mimeType: "audio/ogg; codecs=opus" }),
    };
    return { api, sent };
  };
  const text = (body: string, id = "wamid.1", from = "393331234567"): IncomingMessage => ({ id, from, type: "text", text: { body } });

  it("verifies the address only with the right token", () => {
    const params = (token: string) => new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": token, "hub.challenge": "42" });
    expect(verifyWebhook(params("segreto"), "segreto")).toEqual({ status: 200, body: "42" });
    expect(verifyWebhook(params("altro"), "segreto").status).toBe(403);
    expect(verifyWebhook(params(""), undefined).status).toBe(403);
  });

  it("accepts only bodies signed with the app secret", async () => {
    const body = '{"object":"whatsapp_business_account"}';
    const sig = "sha256=" + createHmac("sha256", "app-secret").update(body).digest("hex");
    expect(await validSignature(body, sig, "app-secret")).toBe(true);
    expect(await validSignature(body + " ", sig, "app-secret")).toBe(false);
    expect(await validSignature(body, null, "app-secret")).toBe(false);
  });

  it("finds user messages and ignores delivery receipts", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [{ changes: [
        { field: "messages", value: { messages: [text("ciao")] } },
        { field: "messages", value: { statuses: [{ status: "read" }] } },
      ] }],
    };
    expect(incomingMessages(payload)).toHaveLength(1);
    expect(incomingMessages({ object: "page" })).toEqual([]);
  });

  it("answers an allowed number once, even if Meta delivers the message twice", async () => {
    const { api, sent } = fakeWhatsApp();
    const { getEngine } = scripted({ reply: null, cancel: [], items: [wire({ type: "task", title: "Comprare il latte", date: "d+0" })] });
    const d = { ...deps(getEngine), whatsapp: api, transcribe: null, allowed: ["393331234567"] };
    await processMessage(text("oggi compra il latte"), d);
    await processMessage(text("oggi compra il latte"), d);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "393331234567" });
    expect(sent[0]!.text).toContain("*Comprare il latte*");
  });

  it("turns away numbers that are not allowed, without calling the model", async () => {
    const { api, sent } = fakeWhatsApp();
    await processMessage(text("ciao", "wamid.2", "391111"), { ...deps(() => null), whatsapp: api, transcribe: null, allowed: [] });
    expect(sent[0]!.text).toContain("prova privata");
  });

  it("listens to voice notes and shows what it heard", async () => {
    const { api, sent } = fakeWhatsApp();
    const { getEngine } = scripted({ reply: null, cancel: [], items: [wire({ type: "reminder", title: "Chiamare Luca", date: "d+1", time: "10:00" })] });
    const voice: IncomingMessage = { id: "wamid.3", from: "393331234567", type: "audio", audio: { id: "media-1", mime_type: "audio/ogg; codecs=opus", voice: true } };
    const transcribe = async () => "Domani alle 10 devo chiamare Luca, ricordamelo";
    await processMessage(voice, { ...deps(getEngine), whatsapp: api, transcribe, allowed: "all" });
    expect(sent[0]!.text).toMatch(/^🎙️ «Domani alle 10 devo chiamare Luca, ricordamelo»/);
    expect(sent[0]!.text).toContain("*Chiamare Luca* — domani alle 10:00");
  });

  it("asks for text when voice notes are not set up", async () => {
    const { api, sent } = fakeWhatsApp();
    const voice: IncomingMessage = { id: "wamid.4", from: "39333", type: "audio", audio: { id: "m" } };
    await processMessage(voice, { ...deps(() => null), whatsapp: api, transcribe: null, allowed: "all" });
    expect(sent[0]!.text).toContain("non riesco ad ascoltare i vocali");
  });

  it("reads the allowed numbers however they are written", () => {
    expect(parseAllowed("+39 333 123 4567, 39347000")).toEqual(["393331234567", "39347000"]);
    expect(parseAllowed("*")).toBe("all");
    expect(parseAllowed(undefined)).toEqual([]);
  });
});

describe("WhatsApp and Google Calendar", () => {
  /** A calendar that records what DILO writes, through the real API client. */
  const fakeCalendar = () => {
    const events = new Map<string, { summary?: string }>();
    let next = 1;
    const api = new GoogleCalendarApi(
      () => "token",
      async (url, init) => {
        const id = decodeURIComponent(url.split("/events")[1]?.replace(/^\//, "") ?? "");
        if (init.method === "POST") {
          const eid = `ev${next++}`;
          events.set(eid, JSON.parse(init.body!));
          return { ok: true, status: 200, json: async () => ({ id: eid }) };
        }
        if (init.method === "DELETE") events.delete(id);
        if (init.method === "PUT") events.set(id, JSON.parse(init.body!));
        return { ok: true, status: 200, json: async () => ({ id }) };
      },
    );
    return { api, events };
  };
  const calendarDeps = (connected: () => GoogleCalendarApi | null): ChatCalendar => ({
    open: async () => connected(),
    connectLink: async (user) => `https://dilo.test/api/google/connect?s=${user}`,
  });

  it("writes what DILO remembers to the connected calendar, and takes it out on annulla", async () => {
    const { api, events } = fakeCalendar();
    const { getEngine } = scripted({ reply: null, cancel: [], items: [wire({ type: "event", title: "Cena con Giulia", date: "d+1", time: "20:30" })] });
    const d = { ...deps(getEngine), calendar: calendarDeps(() => api) };
    const reply = await chat("39333", "domani alle 20:30 cena con Giulia", d);
    expect(reply).not.toContain("calendario");
    expect([...events.values()].map((e) => e.summary)).toEqual(["Cena con Giulia"]);
    await chat("39333", "annulla", d);
    expect(events.size).toBe(0);
  });

  it("suggests connecting the calendar once, and sends the link on «calendario»", async () => {
    const { getEngine } = scripted(
      { reply: null, cancel: [], items: [wire({ type: "task", title: "Pagare F24", date: "d+1" })] },
      { reply: null, cancel: [], items: [wire({ type: "task", title: "Comprare il pane", date: "d+1" })] },
    );
    const d = { ...deps(getEngine), calendar: calendarDeps(() => null) };
    expect(await chat("39333", "domani pago l'F24", d)).toContain("Scrivi *calendario*");
    expect(await chat("39333", "domani compro il pane", d)).not.toContain("calendario");
    const link = await chat("39333", "Collega Google Calendar", d);
    expect(link).toContain("https://dilo.test/api/google/connect?s=39333");
  });

  it("writes what was saved before connecting, once connected", async () => {
    const { api, events } = fakeCalendar();
    let connected: GoogleCalendarApi | null = null;
    const { getEngine } = scripted({ reply: null, cancel: [], items: [wire({ type: "reminder", title: "Chiamare Luca", date: "d+1", time: "10:00" })] });
    const d = { ...deps(getEngine), calendar: calendarDeps(() => connected) };
    await chat("39333", "domani alle 10 ricordami di chiamare Luca", d);
    expect(events.size).toBe(0);
    connected = api;
    expect(await syncCalendar("39333", d)).toBe(true);
    expect([...events.values()].map((e) => e.summary)).toEqual(["Chiamare Luca"]);
    expect(await chat("39333", "calendario", d)).toContain("già collegato");
  });

  it("signs connect links per number and rejects tampered or expired ones", async () => {
    const g = { clientId: "cid", clientSecret: "cs", stateSecret: "secret", baseUrl: "https://dilo.test" };
    const link = await connectLink(g, "39333", 1_000);
    const state = new URL(link).searchParams.get("s")!;
    const url = await authorizeUrl(g, state, 2_000);
    expect(url).toContain("accounts.google.com");
    expect(new URL(url!).searchParams.get("redirect_uri")).toBe("https://dilo.test/api/google/callback");
    expect(await authorizeUrl(g, state.replace("39333", "39444"), 2_000)).toBeNull();
    expect(await authorizeUrl(g, state, 1_000 + 2 * 60 * 60 * 1000)).toBeNull();
  });
});
