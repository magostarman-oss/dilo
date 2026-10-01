/**
 * Try DILO from the terminal:
 *   pnpm dilo "Domani alle 15 prenota il dentista e ricordami di chiamare Marco"
 *   pnpm dilo            (interactive: DILO asks, you answer)
 * Needs ANTHROPIC_API_KEY in the environment or in a .env file at the repo root.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { summarizeItem, type DiloItem } from "@dilo/core";
import { createDilo, type Effort } from "./index";

function loadDotEnv() {
  for (const dir of [process.cwd(), resolve(process.cwd(), "../..")]) {
    const file = resolve(dir, ".env");
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]!] && m[2]) process.env[m[1]!] = m[2].replace(/^["']|["']$/g, "");
    }
    return;
  }
}

loadDotEnv();
const args = process.argv.slice(2).filter((a) => a !== "--");
const json = args.includes("--json");
const text = args.filter((a) => !a.startsWith("--")).join(" ");

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Manca ANTHROPIC_API_KEY: copia .env.example in .env e inserisci la chiave.");
  process.exit(1);
}

const dilo = createDilo({
  timezone: process.env.DILO_TIMEZONE || undefined,
  claude: {
    model: process.env.DILO_MODEL || undefined,
    effort: (process.env.DILO_EFFORT as Effort) || undefined,
  },
});

function show(items: DiloItem[]) {
  if (json) return console.log(JSON.stringify(items, null, 2));
  items.forEach((item, i) => console.log(`${i + 1}. ${summarizeItem(item)}`));
}

async function handle(input: string, rl?: Awaited<ReturnType<typeof createInterface>>) {
  const started = Date.now();
  let result = await dilo.understand(input);
  if (result.reply) console.log(`DILO: ${result.reply}`);
  show(result.items);
  console.log(`  (${((Date.now() - started) / 1000).toFixed(1)}s)`);

  let items = result.items;
  while (rl) {
    const pending = items.filter((i) => i.status === "needs_clarification");
    if (pending.length === 0) break;
    const first = pending[0]!;
    const answer = (await rl.question(`DILO: ${first.clarification!.question}\n> `)).trim();
    if (!answer) break;
    result = await dilo.answer([first], answer);
    items = items.flatMap((i) => (i.id === first.id ? result.items : [i]));
    show(items);
  }
}

if (text) {
  await handle(text);
} else {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log("Cosa hai in testa? (invio vuoto per uscire)");
  for (;;) {
    const line = (await rl.question("> ")).trim();
    if (!line) break;
    try {
      await handle(line, rl);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
    }
  }
  rl.close();
}
