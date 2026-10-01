import "server-only";
import { createDilo, type DiloEngine, type Effort } from "@dilo/nlu";

let engine: DiloEngine | null = null;

/** The engine, created on first use. Null when the server has no API key. */
export function getEngine(): DiloEngine | null {
  if (engine) return engine;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  engine = createDilo({
    timezone: process.env.DILO_TIMEZONE || undefined,
    claude: {
      model: process.env.DILO_MODEL || undefined,
      effort: (process.env.DILO_EFFORT as Effort) || undefined,
    },
  });
  return engine;
}
