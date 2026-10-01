import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { Extraction } from "./schema";
import { SYSTEM_PROMPT } from "./prompt";

/**
 * The language model behind DILO's understanding, behind a small interface so
 * the engine can be tested without network and the provider can change later.
 */
export interface ExtractionModel {
  extract(userMessage: string): Promise<Extraction>;
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ClaudeModelOptions {
  /** Defaults to a client reading ANTHROPIC_API_KEY from the environment. */
  client?: Anthropic;
  apiKey?: string;
  model?: string;
  /** Thinking depth. Higher is slower and more expensive. */
  effort?: Effort;
}

export const DEFAULT_MODEL = "claude-opus-5-5";
export const DEFAULT_EFFORT: Effort = "medium";

export class DiloUnderstandingError extends Error {
  constructor(
    message: string,
    readonly reason: "refusal" | "max_tokens" | "invalid_output" | "api_error",
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DiloUnderstandingError";
  }
}

export class ClaudeExtractionModel implements ExtractionModel {
  private readonly client: Anthropic;
  readonly model: string;
  readonly effort: Effort;

  constructor(options: ClaudeModelOptions = {}) {
    this.client = options.client ?? new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
    this.model = options.model ?? DEFAULT_MODEL;
    this.effort = options.effort ?? DEFAULT_EFFORT;
  }

  async extract(userMessage: string): Promise<Extraction> {
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        // If a safety classifier declines, the API retries on a suitable model instead of failing.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userMessage }],
        output_config: { effort: this.effort, format: betaZodOutputFormat(Extraction) },
      });
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        throw new DiloUnderstandingError(`Claude API error ${err.status ?? ""}: ${err.message}`, "api_error", err);
      }
      throw err;
    }

    if (response.stop_reason === "refusal") {
      throw new DiloUnderstandingError("The model declined this request.", "refusal");
    }
    if (response.stop_reason === "max_tokens") {
      throw new DiloUnderstandingError("The answer was cut off (max_tokens).", "max_tokens");
    }
    if (!response.parsed_output) {
      throw new DiloUnderstandingError("The model output did not match the schema.", "invalid_output");
    }
    return response.parsed_output;
  }
}
