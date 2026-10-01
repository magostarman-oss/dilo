import { applyEdit, todayIso, type DiloItem, type ItemEdit } from "@dilo/core";
import { isDoneOn, type ItemStore, type MemoryEntry } from "@dilo/memory";
import { MAX_KNOWN, type DiloApi } from "./contract";

export interface Heard {
  /** Everything DILO understood from this message, saved in memory (new or changed). */
  items: DiloItem[];
  /** DILO's words when it found nothing to remember. */
  reply: string | null;
  /** Ids among `items` that changed something already saved. */
  updated: string[];
  /** Saved items this message cancelled. */
  cancelled: DiloItem[];
  /** How changed items were before, to put them back on undo. */
  previous: DiloItem[];
}

/** Saved items a new message could refer to: not done and not in the past, nearest first. */
export function knownItems(entries: MemoryEntry[], now: Date, timezone: string): DiloItem[] {
  const today = todayIso(now, timezone);
  const day = (i: DiloItem) => i.date ?? i.window?.from ?? i.deadline?.date ?? null;
  return entries
    .filter((e) => {
      const i = e.item;
      if (i.recurrence) return !i.recurrence.until || i.recurrence.until >= today;
      if (isDoneOn(e, today)) return false;
      const d = i.endDate ?? i.window?.to ?? i.deadline?.date ?? i.date;
      return !d || d >= today;
    })
    .map((e) => e.item)
    .sort((a, b) => (day(a) ?? "9999").localeCompare(day(b) ?? "9999"))
    .slice(0, MAX_KNOWN);
}

/**
 * PARLI → CAPISCE → RICORDA, from the app's side. UI-free, so the web app
 * and a future React Native app share the same behaviour.
 */
export class DiloAssistant {
  constructor(
    private readonly api: DiloApi,
    private readonly store: ItemStore,
    private readonly timezone: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * The user said or wrote something. Every understood item is remembered, questions included;
   * saved items the user changed are updated in place, and cancelled ones are removed.
   */
  async say(text: string): Promise<Heard> {
    const entries = await this.store.all();
    const known = knownItems(entries, this.now(), this.timezone);
    const res = await this.api.understand({ text, timezone: this.timezone, ...(known.length ? { known } : {}) });
    const byId = new Map(entries.map((e) => [e.item.id, e.item]));
    const updated = (res.updated ?? []).filter((id) => byId.has(id));
    const cancelled = (res.cancelled ?? []).map((id) => byId.get(id)).filter((i): i is DiloItem => !!i);
    await this.store.save(res.items);
    if (cancelled.length) await this.store.remove(cancelled.map((i) => i.id));
    return { items: res.items, reply: res.reply, updated, cancelled, previous: updated.map((id) => byId.get(id)!) };
  }

  /** The user answered DILO's question about an item; the item is replaced by what DILO now understands. */
  async answer(item: DiloItem, answer: string): Promise<Heard> {
    const res = await this.api.answer({ pending: [item], answer, timezone: this.timezone });
    if (res.items.length > 0) {
      await this.store.remove([item.id]);
      await this.store.save(res.items);
    }
    return { items: res.items, reply: res.reply, updated: [], cancelled: [], previous: [] };
  }

  /** The user changed an item by hand. Same id, so memory and the calendar update it in place. */
  async edit(item: DiloItem, change: ItemEdit): Promise<DiloItem> {
    const updated = applyEdit(item, change);
    await this.store.save([updated]);
    return updated;
  }

  /** Takes back what a message did: new items go, changed and cancelled ones come back as they were. */
  async forget(heard: Pick<Heard, "items"> & Partial<Pick<Heard, "previous" | "cancelled">>): Promise<void> {
    const restore = [...(heard.previous ?? []), ...(heard.cancelled ?? [])];
    const keep = new Set(restore.map((i) => i.id));
    await this.store.remove(heard.items.map((i) => i.id).filter((id) => !keep.has(id)));
    if (restore.length) await this.store.save(restore);
  }
}
