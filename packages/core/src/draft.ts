import { z } from "zod";
import { ClarificationField, ItemType } from "./item";
import { DeadlineExpr, RecurrenceExpr, WhenExpr } from "./temporal";

/**
 * An item as understood from the user's words, before date resolution.
 * This is the contract between the understanding layer (`@dilo/nlu`) and the
 * domain layer: the model fills it, `resolveDraft` turns it into a `DiloItem`.
 */
export const ItemDraft = z.object({
  type: ItemType.describe(
    "task = something the user has to do (attività); reminder = the user explicitly asks to be reminded (ricordami, ricordamelo, non farmi dimenticare); event = an appointment/meeting/occasion happening at a time, often with others or somewhere (appuntamento, riunione, cena, compleanno, visita); note = information to remember, no action or time (idea, appunto, 'il codice del cancello è...'); routine = a recurring habit or recurring commitment (ogni mattina, tutti i lunedì).",
  ),
  title: z
    .string()
    .describe(
      "Short Italian title, starting with a capital letter. For tasks and reminders use the infinitive ('Chiamare Luca per l'evento', 'Prenotare il dentista'). For events a noun phrase ('Cena con Giulia', 'Riunione con il team'). No dates or times in the title.",
    ),
  details: z.string().nullable().describe("Extra useful details the user gave that do not fit elsewhere, else null."),
  when: WhenExpr.nullable().describe("When it happens; null if the user gave no temporal information for this item."),
  deadline: DeadlineExpr.nullable().describe("Only for explicit deadlines ('entro', 'scade', 'prima di'), else null."),
  recurrence: RecurrenceExpr.nullable().describe("Only if the user said it repeats, else null."),
  alertMinutesBefore: z
    .number()
    .int()
    .nullable()
    .describe("Only if the user asked for an advance notice ('avvisami mezz'ora prima' = 30), else null."),
  people: z.array(z.string()).describe("People mentioned, as written ('Luca', 'mia madre'). Empty if none."),
  location: z.string().nullable().describe("Place, if said ('dal dentista', 'in ufficio'), else null."),
  sourceText: z.string().describe("The exact fragment of the user's words this item comes from."),
  clarification: z
    .object({
      question: z.string().describe("One short, friendly Italian question (max ~10 words)."),
      field: ClarificationField,
    })
    .nullable()
    .describe("Only when something needed for this item is genuinely ambiguous or missing; null otherwise."),
});
export type ItemDraft = z.infer<typeof ItemDraft>;
