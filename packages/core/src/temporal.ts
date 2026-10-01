import { z } from "zod";

/**
 * Temporal intermediate representation (IR).
 *
 * The language model never computes calendar dates itself: it only describes
 * *what the user said* ("domani", "venerdì prossimo", "il 3 marzo", "tra 20
 * minuti") in this small, closed vocabulary. The deterministic resolver in
 * `resolve.ts` turns it into real dates in the user's timezone. This keeps
 * date arithmetic testable and stops the model from inventing dates.
 *
 * Fields are flat and nullable (instead of discriminated unions) so the schema
 * works well with structured outputs.
 */

export const WEEKDAYS_IT = [
  "lunedì",
  "martedì",
  "mercoledì",
  "giovedì",
  "venerdì",
  "sabato",
  "domenica",
] as const;

export const MONTHS_IT = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
] as const;

export const DateExprKind = z.enum([
  "relative_days",
  "weekday",
  "calendar",
  "relative_weeks",
  "relative_months",
  "week",
  "weekend",
  "month",
  "month_end",
]);
export type DateExprKind = z.infer<typeof DateExprKind>;

export const DateExpr = z
  .object({
    kind: DateExprKind.describe(
      [
        "relative_days: offset days from today (oggi=0, domani=1, dopodomani=2, 'tra 3 giorni'=3, ieri=-1).",
        "weekday: a named day of the week, see weekday + weekOffset.",
        "calendar: an explicit day/month (and optional year), e.g. 'il 3 marzo', '15/10'.",
        "relative_weeks: 'tra N settimane' (offset=N), a specific day N*7 days from today.",
        "relative_months: 'tra N mesi' (offset=N), same day-of-month N months from now.",
        "week: a vague whole week, 'questa settimana' (weekOffset=0), 'la settimana prossima' (weekOffset=1).",
        "weekend: 'nel weekend'/'sabato e domenica' (weekOffset null = upcoming weekend, 1 = the one after).",
        "month: a vague whole month, 'a novembre' (month=11) or 'il mese prossimo' (offset=1, month null).",
        "month_end: 'a fine mese' (offset 0) or 'fine del mese prossimo' (offset 1): the last day of that month.",
      ].join(" "),
    ),
    offset: z
      .number()
      .int()
      .nullable()
      .describe("Signed count for relative_* kinds and for month/month_end offsets; null otherwise."),
    weekday: z
      .number()
      .int()
      .nullable()
      .describe("ISO weekday for kind=weekday: 1=lunedì ... 7=domenica; null otherwise."),
    weekOffset: z
      .number()
      .int()
      .nullable()
      .describe(
        "For weekday/week/weekend. null = the next occurrence after today (plain 'venerdì' or 'venerdì prossimo'); 0 = in the current calendar week ('questo venerdì', 'venerdì di questa settimana'); 1 = in next calendar week ('venerdì della settimana prossima'); 2 = the week after.",
      ),
    day: z.number().int().nullable().describe("Day of month (1-31) for kind=calendar."),
    month: z.number().int().nullable().describe("Month 1-12 for kind=calendar or kind=month."),
    year: z
      .number()
      .int()
      .nullable()
      .describe("Four-digit year ONLY if the user said it; null otherwise (the resolver picks the next occurrence)."),
  })
  .describe("A date as the user expressed it, not a computed calendar date.");
export type DateExpr = z.infer<typeof DateExpr>;

export const PartOfDay = z.enum(["mattina", "mezzogiorno", "pomeriggio", "sera", "notte"]);
export type PartOfDay = z.infer<typeof PartOfDay>;

export const TimeExpr = z
  .object({
    kind: z
      .enum(["clock", "part_of_day", "relative"])
      .describe(
        "clock: an explicit time (use hour/minute, 24h). part_of_day: only a vague part of the day ('stasera', 'in mattinata'). relative: 'tra 20 minuti', 'fra due ore' (use offsetMinutes).",
      ),
    hour: z.number().int().nullable().describe("0-23 for kind=clock, already converted to 24h using the context."),
    minute: z.number().int().nullable().describe("0-59 for kind=clock ('e mezza'=30, 'e un quarto'=15, 'meno un quarto'=45 of the previous hour)."),
    partOfDay: PartOfDay.nullable().describe("For kind=part_of_day; may also be set with clock for context."),
    offsetMinutes: z.number().int().nullable().describe("For kind=relative: minutes from now."),
  })
  .describe("A time of day as the user expressed it.");
export type TimeExpr = z.infer<typeof TimeExpr>;

export const Frequency = z.enum(["daily", "weekly", "monthly", "yearly"]);
export type Frequency = z.infer<typeof Frequency>;

export const RecurrenceExpr = z
  .object({
    frequency: Frequency,
    interval: z.number().int().describe("Every N units: 'ogni giorno'=1, 'ogni due settimane'=2, 'a giorni alterni'=2 daily."),
    weekdays: z
      .array(z.number().int())
      .describe("For weekly: ISO weekdays 1-7 ('ogni lunedì e giovedì'=[1,4], 'nei giorni feriali'=[1,2,3,4,5]). Empty if not specified."),
    dayOfMonth: z
      .number()
      .int()
      .nullable()
      .describe("For monthly/yearly: day of month; -1 means the last day of the month."),
    month: z.number().int().nullable().describe("For yearly: month 1-12."),
    until: DateExpr.nullable().describe("Last possible date ('fino a fine ottobre'), or null."),
    count: z.number().int().nullable().describe("Total number of occurrences ('per 10 volte'), or null."),
  })
  .describe("How an item repeats.");
export type RecurrenceExpr = z.infer<typeof RecurrenceExpr>;

export const WhenExpr = z
  .object({
    date: DateExpr.nullable().describe("The day, or null if the user gave no day."),
    time: TimeExpr.nullable().describe("The start time, or null if the user gave no time."),
    endDate: DateExpr.nullable().describe("End day for multi-day items ('da lunedì a mercoledì'), else null."),
    endTime: TimeExpr.nullable().describe("End time ('dalle 15 alle 17'), else null."),
  })
  .describe("When the item happens.");
export type WhenExpr = z.infer<typeof WhenExpr>;

export const DeadlineExpr = z
  .object({
    date: DateExpr,
    time: TimeExpr.nullable(),
  })
  .describe("A deadline ('entro venerdì', 'da consegnare entro il 15').");
export type DeadlineExpr = z.infer<typeof DeadlineExpr>;
