import { AnswerRequest, UnderstandRequest, type ErrorResponse, type UnderstandResponse } from "@dilo/client";
import type { DiloItem } from "@dilo/core";
import { DiloUnderstandingError, type DiloEngine } from "@dilo/nlu";

/**
 * DILO's HTTP API, independent of the web framework: the Next.js routes are
 * thin wrappers, and the same handlers can move to any other server.
 */

export interface ApiResult {
  status: number;
  body: UnderstandResponse | ErrorResponse;
}

const fail = (status: number, code: ErrorResponse["error"]["code"], message: string): ApiResult => ({
  status,
  body: { error: { code, message } },
});

export type EngineProvider = () => DiloEngine | null;

export async function handleUnderstand(json: unknown, getEngine: EngineProvider): Promise<ApiResult> {
  const req = UnderstandRequest.safeParse(json);
  if (!req.success) return fail(400, "bad_request", "Scrivi qualcosa da dire a DILO.");
  return run(getEngine, (engine) => engine.understand(req.data.text, { timezone: req.data.timezone }));
}

export async function handleAnswer(json: unknown, getEngine: EngineProvider): Promise<ApiResult> {
  const req = AnswerRequest.safeParse(json);
  if (!req.success) return fail(400, "bad_request", "Risposta non valida.");
  const pending = req.data.pending as unknown as DiloItem[];
  return run(getEngine, (engine) => engine.answer(pending, req.data.answer, { timezone: req.data.timezone }));
}

async function run(getEngine: EngineProvider, call: (engine: DiloEngine) => Promise<UnderstandResponse>): Promise<ApiResult> {
  const engine = getEngine();
  if (!engine) {
    return fail(503, "not_configured", "DILO non è ancora collegato: manca la chiave API sul server.");
  }
  try {
    return { status: 200, body: await call(engine) };
  } catch (err) {
    if (err instanceof DiloUnderstandingError) {
      console.error("[dilo] understanding failed:", err.reason, err.message);
      return fail(502, "understanding_failed", "Non sono riuscito a capire in questo momento. Riprova tra poco.");
    }
    console.error("[dilo] unexpected error:", err);
    return fail(500, "internal", "Qualcosa è andato storto. Riprova.");
  }
}
