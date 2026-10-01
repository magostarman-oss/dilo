import type { DiloItem } from "@dilo/core";
import type { ItemStore } from "@dilo/memory";
import type { DiloApi } from "./contract";

export interface Heard {
  /** Everything DILO understood from this message, saved in memory. */
  items: DiloItem[];
  /** DILO's words when it found nothing to remember. */
  reply: string | null;
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
  ) {}

  /** The user said or wrote something. Every understood item is remembered, questions included. */
  async say(text: string): Promise<Heard> {
    const res = await this.api.understand({ text, timezone: this.timezone });
    await this.store.save(res.items);
    return { items: res.items, reply: res.reply };
  }

  /** The user answered DILO's question about an item; the item is replaced by what DILO now understands. */
  async answer(item: DiloItem, answer: string): Promise<Heard> {
    const res = await this.api.answer({ pending: [item], answer, timezone: this.timezone });
    if (res.items.length > 0) {
      await this.store.remove([item.id]);
      await this.store.save(res.items);
    }
    return { items: res.items, reply: res.reply };
  }

  /** Takes back what a message added. */
  forget(items: DiloItem[]): Promise<void> {
    return this.store.remove(items.map((i) => i.id));
  }
}
