import { describe, expect, it } from "vitest";
import { summarizeItem, type DiloItem } from "@dilo/core";
import { createDilo } from "../../src/index";
import { CASES, LIVE_NOW, type ExpectedItem } from "./cases";

/**
 * Calls the real Claude API. Runs only with ANTHROPIC_API_KEY set:
 *   ANTHROPIC_API_KEY=... pnpm test:live
 */
const hasKey = !!process.env.ANTHROPIC_API_KEY;
const dilo = hasKey ? createDilo({ claude: { effort: (process.env.DILO_EFFORT as never) || undefined } }) : null;

function check(actual: DiloItem, exp: ExpectedItem) {
  const types = Array.isArray(exp.type) ? exp.type : [exp.type];
  expect(types).toContain(actual.type);
  if (exp.title) expect(actual.title).toMatch(exp.title);
  if (exp.date !== undefined) expect(actual.date).toBe(exp.date);
  if (exp.time !== undefined) expect(actual.time).toBe(exp.time);
  if (exp.partOfDay !== undefined) expect(actual.partOfDay).toBe(exp.partOfDay);
  if (exp.window !== undefined) expect(actual.window).toEqual(exp.window);
  if (exp.deadline !== undefined) expect(actual.deadline?.date).toBe(exp.deadline);
  if (exp.frequency !== undefined) expect(actual.recurrence?.frequency).toBe(exp.frequency);
  if (exp.weekdays !== undefined) expect(actual.recurrence?.weekdays).toEqual(exp.weekdays);
  if (exp.alertMinutesBefore !== undefined) expect(actual.alertMinutesBefore).toBe(exp.alertMinutesBefore);
  if (exp.asks !== undefined) expect(actual.status === "needs_clarification").toBe(exp.asks);
}

describe.skipIf(!hasKey).concurrent("DILO understands Italian (live)", () => {
  for (const c of CASES) {
    it(c.text, { timeout: 120_000 }, async () => {
      const res = await dilo!.understand(c.text, { now: LIVE_NOW });
      const lines = res.items.map((i) => `  ${summarizeItem(i, LIVE_NOW)}`).join("\n");
      console.log(`${c.text}\n${lines || `  DILO: ${res.reply}`}`);

      if (c.replyOnly) {
        expect(res.items).toHaveLength(0);
        expect(res.reply).toBeTruthy();
        return;
      }
      expect(res.items).toHaveLength(c.items.length);
      c.items.forEach((exp, i) => check(res.items[i]!, exp));
    });
  }
});

describe.skipIf(!hasKey)("clarification round-trip (live)", () => {
  it("asks when, then understands the answer", { timeout: 120_000 }, async () => {
    const first = await dilo!.understand("Ricordami di chiamare Marco", { now: LIVE_NOW });
    expect(first.items[0]!.status).toBe("needs_clarification");
    const second = await dilo!.answer(first.items, "domani alle 18", { now: LIVE_NOW });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]).toMatchObject({ type: "reminder", date: "2026-10-01", time: "18:00", status: "ready" });
  });
});
