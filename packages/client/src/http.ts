import {
  DiloApiError,
  type AnswerRequest,
  type DiloApi,
  type ErrorResponse,
  type UnderstandRequest,
  type UnderstandResponse,
} from "./contract";

type Fetch = (input: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** Talks to DILO's server over HTTP. `baseUrl` is "" on the web (same origin), a full URL on mobile. */
export class HttpDiloApi implements DiloApi {
  constructor(
    private readonly baseUrl = "",
    private readonly fetchImpl: Fetch = (input, init) => fetch(input, init),
  ) {}

  understand(req: UnderstandRequest): Promise<UnderstandResponse> {
    return this.post("/api/understand", req);
  }

  answer(req: AnswerRequest): Promise<UnderstandResponse> {
    return this.post("/api/answer", req);
  }

  private async post(path: string, body: unknown): Promise<UnderstandResponse> {
    let res;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new DiloApiError("Non riesco a raggiungere DILO. Controlla la connessione.", "network", null);
    }
    const data = (await res.json().catch(() => null)) as UnderstandResponse | ErrorResponse | null;
    if (!res.ok || !data || "error" in data) {
      const err = data && "error" in data ? data.error : null;
      throw new DiloApiError(err?.message ?? "Qualcosa è andato storto. Riprova.", err?.code ?? "internal", res.status);
    }
    return data;
  }
}
