import { toGoogleEvent, type DiloItem, type GoogleEventBody, type IsoDate } from "@dilo/core";
import { isDoneOn, type CalendarLink, type ItemStore, type MemoryEntry } from "@dilo/memory";
import { CalendarAuthError, type GoogleCalendarApi } from "./google-calendar";

export interface SyncResult {
  /** Events created, updated or removed. */
  written: number;
  /** Items waiting for the user to (re)connect the calendar. */
  waiting: number;
}

const fingerprint = (event: GoogleEventBody) => JSON.stringify(event);

/** What the calendar needs for an entry: a new event, a changed event, its removal, or nothing. */
export function calendarChange(entry: MemoryEntry, today: IsoDate): "insert" | "update" | "remove" | null {
  if (!entry.calendar) return wantsCalendar(entry, today) ? "insert" : null;
  const event = toGoogleEvent(entry.item);
  if (!event) return "remove"; // Became a note or a question: it no longer belongs in the calendar.
  // Links written before fingerprints existed get rewritten once, which is harmless.
  if (entry.calendar.fingerprint !== fingerprint(event)) return "update";
  return null;
}

/** Whether an item belongs in the calendar now: it has a day, it is not past and not done. */
export function wantsCalendar(entry: MemoryEntry, today: IsoDate): boolean {
  const { item } = entry;
  if (entry.calendar || !toGoogleEvent(item) || isDoneOn(entry, today)) return false;
  if (item.recurrence) return !item.recurrence.until || item.recurrence.until >= today;
  const day = item.endDate ?? item.date ?? item.deadline?.date;
  return !!day && day >= today;
}

/**
 * An ItemStore that also keeps the user's Google Calendar in step: what DILO
 * remembers is written to the calendar, what changes is updated there, and what
 * is undone or deleted leaves it.
 * When the calendar is not connected, items simply wait and are written later.
 */
export class CalendarSyncedStore implements ItemStore {
  private running: Promise<SyncResult> | null = null;
  private again = false;

  constructor(
    private readonly inner: ItemStore,
    private readonly api: GoogleCalendarApi,
    private readonly today: () => IsoDate,
    private readonly onResult: (r: SyncResult) => void = () => {},
    private readonly now: () => Date = () => new Date(),
  ) {}

  all() {
    return this.inner.all();
  }
  setDone(id: string, done: boolean, date: IsoDate) {
    return this.inner.setDone(id, done, date);
  }
  setCalendar(id: string, link: CalendarLink | null) {
    return this.inner.setCalendar(id, link);
  }
  subscribe(listener: () => void) {
    return this.inner.subscribe(listener);
  }

  async save(items: DiloItem[]): Promise<void> {
    await this.inner.save(items);
    void this.sync();
  }

  async remove(ids: string[]): Promise<void> {
    const drop = new Set(ids);
    const linked = (await this.inner.all()).filter((e) => drop.has(e.item.id) && e.calendar);
    await this.inner.remove(ids);
    for (const e of linked) {
      try {
        await this.api.remove(e.calendar!.eventId);
      } catch {
        // Not connected right now: the event stays in the calendar, the user can delete it there.
      }
    }
  }

  /** Brings the calendar in line with memory: new, changed and dropped events. Safe to call often. */
  sync(): Promise<SyncResult> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.run().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        void this.sync();
      }
    });
    return this.running;
  }

  private async run(): Promise<SyncResult> {
    const today = this.today();
    const todo = (await this.inner.all())
      .map((entry) => ({ entry, change: calendarChange(entry, today) }))
      .filter((t) => t.change !== null);
    let written = 0;
    let waiting = todo.length;
    if (this.api.connected) {
      for (const { entry, change } of todo) {
        try {
          await this.apply(entry, change!);
          written++;
          waiting--;
        } catch (err) {
          if (err instanceof CalendarAuthError) break;
          console.error("[dilo] calendar write failed", err);
        }
      }
    }
    const result = { written, waiting };
    this.onResult(result);
    return result;
  }

  private async apply(entry: MemoryEntry, change: "insert" | "update" | "remove"): Promise<void> {
    const id = entry.item.id;
    if (change === "remove") {
      await this.api.remove(entry.calendar!.eventId);
      await this.inner.setCalendar(id, null);
      return;
    }
    const event = toGoogleEvent(entry.item)!;
    let eventId = entry.calendar?.eventId ?? null;
    // Deleted by the user in Google meanwhile: write it again, it changed in DILO after all.
    if (change === "update" && !(await this.api.update(eventId!, event))) eventId = null;
    eventId ??= await this.api.insert(event);
    await this.inner.setCalendar(id, { provider: "google", eventId, syncedAt: this.now().toISOString(), fingerprint: fingerprint(event) });
  }
}
