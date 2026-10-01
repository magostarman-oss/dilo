import type { DiloItem, IsoDate } from "@dilo/core";

/**
 * DILO RICORDA. What DILO keeps about each item beyond what was understood:
 * when it was saved and whether the user has done it.
 */
export interface MemoryEntry {
  item: DiloItem;
  savedAt: string;
  /** When a one-off item was marked done. */
  completedAt: string | null;
  /** Days a recurring item (routine) was marked done. */
  completedDates: IsoDate[];
  /** The copy of this item in the user's external calendar, once written there. */
  calendar?: CalendarLink | null;
}

export interface CalendarLink {
  provider: "google";
  eventId: string;
  syncedAt: string;
}

/**
 * Where items live. The app only talks to this interface: today it is local
 * storage on the device, later a server database with a local cache.
 */
export interface ItemStore {
  all(): Promise<MemoryEntry[]>;
  /** Adds new items or replaces existing ones with the same id. */
  save(items: DiloItem[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
  /** Marks an item done or not; `date` is the day for recurring items. */
  setDone(id: string, done: boolean, date: IsoDate): Promise<void>;
  /** Records (or clears) where the item lives in the user's calendar. */
  setCalendar(id: string, link: CalendarLink | null): Promise<void>;
  /** Called after every change. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/** Whether an entry counts as done on a given day. */
export function isDoneOn(entry: MemoryEntry, date: IsoDate): boolean {
  return entry.item.recurrence ? entry.completedDates.includes(date) : entry.completedAt !== null;
}

/** Minimal key-value storage: `localStorage` on the web, AsyncStorage on React Native. */
export interface KeyValueStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
}

interface Snapshot {
  version: 1;
  entries: MemoryEntry[];
}

export const STORAGE_KEY = "dilo.memory.v1";

/** An `ItemStore` that keeps everything as one JSON document in a key-value storage. */
export class KeyValueItemStore implements ItemStore {
  private cache: MemoryEntry[] | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly storage: KeyValueStorage,
    private readonly key = STORAGE_KEY,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async all(): Promise<MemoryEntry[]> {
    return [...(await this.load())];
  }

  async save(items: DiloItem[]): Promise<void> {
    const entries = await this.load();
    const savedAt = this.now().toISOString();
    for (const item of items) {
      const i = entries.findIndex((e) => e.item.id === item.id);
      if (i >= 0) entries[i] = { ...entries[i]!, item };
      else entries.push({ item, savedAt, completedAt: null, completedDates: [] });
    }
    await this.write(entries);
  }

  async remove(ids: string[]): Promise<void> {
    const drop = new Set(ids);
    await this.write((await this.load()).filter((e) => !drop.has(e.item.id)));
  }

  async setDone(id: string, done: boolean, date: IsoDate): Promise<void> {
    const entries = await this.load();
    const entry = entries.find((e) => e.item.id === id);
    if (!entry) return;
    if (entry.item.recurrence) {
      const dates = new Set(entry.completedDates);
      if (done) dates.add(date);
      else dates.delete(date);
      entry.completedDates = [...dates].sort();
    } else {
      entry.completedAt = done ? this.now().toISOString() : null;
    }
    await this.write(entries);
  }

  async setCalendar(id: string, link: CalendarLink | null): Promise<void> {
    const entries = await this.load();
    const entry = entries.find((e) => e.item.id === id);
    if (!entry) return;
    entry.calendar = link;
    await this.write(entries);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async load(): Promise<MemoryEntry[]> {
    if (this.cache) return this.cache;
    let entries: MemoryEntry[] = [];
    try {
      const raw = await this.storage.getItem(this.key);
      const parsed = raw ? (JSON.parse(raw) as Partial<Snapshot>) : null;
      if (parsed?.version === 1 && Array.isArray(parsed.entries)) entries = parsed.entries;
    } catch {
      // Corrupt or unavailable storage: start empty rather than crash the app.
    }
    this.cache = entries;
    return entries;
  }

  private async write(entries: MemoryEntry[]): Promise<void> {
    this.cache = entries;
    const snapshot: Snapshot = { version: 1, entries };
    await this.storage.setItem(this.key, JSON.stringify(snapshot));
    for (const l of this.listeners) l();
  }
}

/** In-memory storage, for tests and for platforms where nothing persists. */
export class MemoryStorage implements KeyValueStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}
