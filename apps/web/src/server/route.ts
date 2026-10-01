import type { ApiResult, EngineProvider } from "./handlers";
import { getEngine } from "./engine";

/** Wraps a framework-free handler as a Next.js POST route. */
export function postRoute(handler: (json: unknown, getEngine: EngineProvider) => Promise<ApiResult>) {
  return async (request: Request): Promise<Response> => {
    const json = await request.json().catch(() => null);
    const { status, body } = await handler(json, getEngine);
    return Response.json(body, { status, headers: { "cache-control": "no-store" } });
  };
}
