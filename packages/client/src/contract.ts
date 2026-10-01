import { z } from "zod";
import type { DiloItem } from "@dilo/core";

/**
 * The contract between DILO's apps (web, mobile) and DILO's server.
 * The server owns understanding (and the API key); apps own the UI and memory.
 */

export const MAX_TEXT_LENGTH = 2000;

const Text = z.string().trim().min(1).max(MAX_TEXT_LENGTH);
const Timezone = z
  .string()
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("it-IT", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Fuso orario non valido");

export const UnderstandRequest = z.object({
  text: Text,
  timezone: Timezone.optional(),
});
export type UnderstandRequest = z.infer<typeof UnderstandRequest>;

/** Pending items are echoed back by the app; only the fields the engine reads are checked. */
const PendingItem = z
  .object({
    id: z.string(),
    timezone: z.string(),
    source: z.object({ text: z.string().max(MAX_TEXT_LENGTH), utterance: z.string() }),
    clarification: z.object({ question: z.string().max(500), field: z.string(), origin: z.string() }).nullable(),
  })
  .passthrough();

export const AnswerRequest = z.object({
  pending: z.array(PendingItem).min(1).max(20),
  answer: Text,
  timezone: Timezone.optional(),
});
export type AnswerRequest = { pending: DiloItem[]; answer: string; timezone?: string };

export interface UnderstandResponse {
  items: DiloItem[];
  /** Items DILO still needs an answer for (subset of `items`). */
  questions: { itemId: string; question: string }[];
  /** DILO's words when nothing actionable was said. */
  reply: string | null;
}

export interface ErrorResponse {
  error: { code: "bad_request" | "not_configured" | "understanding_failed" | "internal"; message: string };
}

/** What an app needs from the server. */
export interface DiloApi {
  understand(req: UnderstandRequest): Promise<UnderstandResponse>;
  answer(req: AnswerRequest): Promise<UnderstandResponse>;
}

export class DiloApiError extends Error {
  constructor(
    message: string,
    readonly code: ErrorResponse["error"]["code"] | "network",
    readonly status: number | null,
  ) {
    super(message);
    this.name = "DiloApiError";
  }
}
