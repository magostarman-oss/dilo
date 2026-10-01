import { z } from "zod";
import {
  ClarificationField,
  ItemType,
  parseDateSpec,
  parseRepeatSpec,
  parseTimeSpec,
  type ItemDraft,
  type SpecResult,
} from "@dilo/core";

/**
 * What the language model returns. Temporal fields are compact text specs
 * (see `@dilo/core` spec.ts) so the structured-output grammar stays small;
 * `toDraft` parses them into the resolver's IR.
 */
export const WireItem = z.object({
  type: ItemType,
  title: z.string(),
  details: z.string().nullable(),
  date: z.string().nullable().describe("Date spec, e.g. d+1, wd:5, cal:15-10, week@1"),
  time: z.string().nullable().describe("Time spec, e.g. 15:30, sera, +20m"),
  endDate: z.string().nullable(),
  endTime: z.string().nullable(),
  deadline: z.string().nullable().describe("Date spec of a deadline"),
  deadlineTime: z.string().nullable(),
  repeat: z.string().nullable().describe("Repeat spec, e.g. weekly:1,4"),
  alertMinutesBefore: z.number().int().nullable(),
  people: z.array(z.string()),
  location: z.string().nullable(),
  sourceText: z.string(),
  question: z.string().nullable(),
  questionField: ClarificationField.nullable(),
  replaces: z.string().nullable().describe("Ref of the saved item this item changes, e.g. k2; null for a new item"),
});
export type WireItem = z.infer<typeof WireItem>;

export const Extraction = z.object({
  items: z.array(WireItem),
  /** Refs of saved items the user cancelled ("la cena di sabato non c'è più"). */
  cancel: z.array(z.string()),
  reply: z.string().nullable(),
});
export type Extraction = z.infer<typeof Extraction>;

export interface DraftConversion {
  draft: ItemDraft;
  /** Specs the parser could not read; the engine turns them into a question. */
  problems: { field: ClarificationField; error: string }[];
}

export function toDraft(w: WireItem): DraftConversion {
  const problems: DraftConversion["problems"] = [];
  const read = <T>(value: string | null, parse: (s: string) => SpecResult<T>, field: ClarificationField): T | null => {
    if (value == null || value.trim() === "") return null;
    const r = parse(value);
    if (r.ok) return r.value;
    problems.push({ field, error: r.error });
    return null;
  };

  const date = read(w.date, parseDateSpec, "date");
  const time = read(w.time, parseTimeSpec, "time");
  const endDate = read(w.endDate, parseDateSpec, "date");
  const endTime = read(w.endTime, parseTimeSpec, "time");
  const deadlineDate = read(w.deadline, parseDateSpec, "deadline");
  const deadlineTime = read(w.deadlineTime, parseTimeSpec, "deadline");
  const recurrence = read(w.repeat, parseRepeatSpec, "recurrence");

  const draft: ItemDraft = {
    type: w.type,
    title: w.title,
    details: w.details,
    when: date || time || endDate || endTime ? { date, time, endDate, endTime } : null,
    deadline: deadlineDate ? { date: deadlineDate, time: deadlineTime } : null,
    recurrence,
    alertMinutesBefore: w.alertMinutesBefore,
    people: w.people,
    location: w.location,
    sourceText: w.sourceText,
    clarification: w.question?.trim() ? { question: w.question.trim(), field: w.questionField ?? "other" } : null,
  };
  return { draft, problems };
}
