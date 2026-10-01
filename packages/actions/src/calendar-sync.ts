import { toGoogleEvent, type DiloItem, type IsoDate } from "@dilo/core";
import { isDoneOn, type CalendarLink, type ItemStore, type MemoryEntry } from "@dilo/memory";
import { CalendarAuthError, type GoogleCalendarApi } from "./google-calendar";

export interface SyncResult {
  written: number;
  /** Items waiting for the user to (re)connect the calendar. */
  waiting: number;
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
 * remembers is written to the calendar, and what is undone or deleted leaves it.
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

  /** Writes every item that should be in the calendar and is not yet. Safe to call often. */
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
    const todo = (await this.inner.all()).filter((e) => wantsCalendar(e, today));
    let written = 0;
    let waiting = todo.length;
    if (this.api.connected) {
      for (const entry of todo) {
        try {
          const eventId = await this.api.insert(toGoogleEvent(entry.item)!);
          await this.inner.setCalendar(entry.item.id, { provider: "google", eventId, syncedAt: this.now().toISOString() });
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
}
