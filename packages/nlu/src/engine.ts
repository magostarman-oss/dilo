import { DEFAULT_TIMEZONE, resolveDraft, type DiloItem } from "@dilo/core";
import { ClaudeExtractionModel, type ClaudeModelOptions, type ExtractionModel } from "./model";
import { buildClarificationMessage, buildUserMessage, type ClarificationTurn, type KnownItem } from "./prompt";
import { toDraft, type WireItem } from "./schema";

const PROBLEM_QUESTION = {
  date: "Non ho capito bene il giorno: quando?",
  time: "Non ho capito bene l'orario: a che ora?",
  deadline: "Non ho capito la scadenza: entro quando?",
  recurrence: "Non ho capito ogni quanto si ripete: me lo ridici?",
} as const;

export interface UnderstandOptions {
  /** When the user spoke. Defaults to now. */
  now?: Date;
  /** The user's IANA timezone. Defaults to the engine's. */
  timezone?: string;
  /** Items the user already saved, so a message can change or cancel them. */
  known?: DiloItem[];
}

export interface Understanding {
  items: DiloItem[];
  /** Items DILO still needs an answer for (subset of `items`). */
  questions: { itemId: string; question: string }[];
  /** A reply when nothing actionable was said ("Cosa vuoi che ricordi?"). */
  reply: string | null;
  /** Ids of saved items that `items` replace (same id: the item was changed). */
  updated: string[];
  /** Ids of saved items the user cancelled. */
  cancelled: string[];
}

export interface DiloEngineOptions {
  /** A custom model (tests, other providers). Defaults to Claude. */
  model?: ExtractionModel;
  claude?: ClaudeModelOptions;
  timezone?: string;
  newId?: () => string;
}

/**
 * PARLI → DILO CAPISCE. Turns free Italian text into resolved DILO items.
 * Stateless: storing items (memory) and acting on them are separate layers.
 */
export class DiloEngine {
  private readonly model: ExtractionModel;
  private readonly timezone: string;
  private readonly newId?: () => string;

  constructor(options: DiloEngineOptions = {}) {
    this.model = options.model ?? new ClaudeExtractionModel(options.claude);
    this.timezone = options.timezone ?? DEFAULT_TIMEZONE;
    this.newId = options.newId;
  }

  /** Understands a new message from the user. */
  async understand(text: string, options: UnderstandOptions = {}): Promise<Understanding> {
    const now = options.now ?? new Date();
    const timezone = options.timezone ?? this.timezone;
    if (!text.trim()) return { items: [], questions: [], reply: "Cosa hai in testa?", updated: [], cancelled: [] };

    const known: KnownItem[] = (options.known ?? []).map((item, i) => ({ ref: `k${i + 1}`, item }));
    const byRef = new Map(known.map((k) => [k.ref, k.item]));
    const extraction = await this.model.extract(buildUserMessage(text, { now, timezone }, known));
    const result = this.finish(extraction.items, extraction.reply, text, now, timezone, extraction.cancel?.length ?? 0);

    // A changed item keeps its identity, so memory and the calendar update it in place.
    const updated = new Set<string>();
    extraction.items.forEach((w, i) => {
      const before = w.replaces ? byRef.get(w.replaces.trim()) : undefined;
      if (!before || updated.has(before.id)) return;
      const item = result.items[i]!;
      const oldId = item.id;
      item.id = before.id;
      item.createdAt = before.createdAt;
      updated.add(before.id);
      for (const q of result.questions) if (q.itemId === oldId) q.itemId = before.id;
    });
    const cancelled = [...new Set((extraction.cancel ?? []).map((r) => byRef.get(r.trim())?.id))].filter(
      (id): id is string => !!id && !updated.has(id),
    );
    return { ...result, updated: [...updated], cancelled };
  }

  /**
   * The user answered DILO's question about one or more pending items.
   * Returns the updated items that replace them (they may be ready now, or ask again).
   */
  async answer(pending: DiloItem[], answer: string, options: UnderstandOptions = {}): Promise<Understanding> {
    const now = options.now ?? new Date();
    const timezone = options.timezone ?? pending[0]?.timezone ?? this.timezone;
    const turns: ClarificationTurn[] = pending
      .filter((i) => i.clarification)
      .map((i) => ({ original: i.source.text, question: i.clarification!.question, answer }));
    if (turns.length === 0) return { items: pending, questions: [], reply: null, updated: [], cancelled: [] };

    const extraction = await this.model.extract(buildClarificationMessage(turns, { now, timezone }));
    const utterance = `${pending.map((i) => i.source.text).join(" / ")} → ${answer}`;
    return this.finish(extraction.items, extraction.reply, utterance, now, timezone, 0);
  }

  private finish(
    wire: WireItem[],
    reply: string | null,
    utterance: string,
    now: Date,
    timezone: string,
    cancellations: number,
  ): Understanding {
    const items = wire.map((w) => {
      const { draft, problems } = toDraft(w);
      const item = resolveDraft(draft, { now, timezone, utterance, newId: this.newId });
      const problem = problems[0];
      if (problem && item.clarification?.origin !== "model") {
        const question = PROBLEM_QUESTION[problem.field as keyof typeof PROBLEM_QUESTION] ?? "Puoi spiegarmi meglio?";
        item.clarification = { question, field: problem.field, origin: "resolver" };
        item.status = "needs_clarification";
      }
      return item;
    });
    return {
      items,
      questions: items.filter((i) => i.clarification).map((i) => ({ itemId: i.id, question: i.clarification!.question })),
      reply:
        items.length === 0 && cancellations === 0
          ? reply?.trim() || "Non ho trovato niente da ricordare. Cosa hai in testa?"
          : null,
      updated: [],
      cancelled: [],
    };
  }
}

export function createDilo(options: DiloEngineOptions = {}): DiloEngine {
  return new DiloEngine(options);
}
