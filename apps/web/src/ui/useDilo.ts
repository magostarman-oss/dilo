"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DiloApiError, DiloAssistant, HttpDiloApi, type Heard } from "@dilo/client";
import { todayIso, type DiloItem } from "@dilo/core";
import { KeyValueItemStore, MemoryStorage, type KeyValueStorage, type MemoryEntry } from "@dilo/memory";
import { CalendarSyncedStore, GoogleCalendarApi, type SyncResult } from "@dilo/actions";
import { GOOGLE_CLIENT_ID, googleAuth } from "./googleAuth";

export type Phase = "idle" | "thinking";

export interface LastHeard extends Heard {
  text: string;
}

function browserStorage(): KeyValueStorage {
  try {
    const probe = "dilo.probe";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return new MemoryStorage();
  }
}

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Rome";
  } catch {
    return "Europe/Rome";
  }
}

/** Everything the web UI needs from DILO: memory, understanding, and today's date. */
export function useDilo() {
  const [ready, setReady] = useState(false);
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [answering, setAnswering] = useState<string | null>(null);
  const [lastHeard, setLastHeard] = useState<LastHeard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [calendar, setCalendar] = useState({ wanted: false, connected: false, waiting: 0, busy: false });

  const { store, assistant, timezone } = useMemo(() => {
    if (typeof window === "undefined") return { store: null, assistant: null, timezone: "Europe/Rome" };
    const timezone = browserTimezone();
    const local = new KeyValueItemStore(browserStorage());
    // DILO AGISCE: with the user's permission, what DILO remembers also goes to Google Calendar.
    const api = new GoogleCalendarApi(
      () => googleAuth.token(),
      undefined,
      () => {
        googleAuth.expire();
        setCalendar((c) => ({ ...c, connected: false }));
      },
    );
    const onResult = (r: SyncResult) =>
      setCalendar((c) => ({ ...c, waiting: r.waiting, connected: googleAuth.token() !== null }));
    const store = GOOGLE_CLIENT_ID
      ? new CalendarSyncedStore(local, api, () => todayIso(new Date(), timezone), onResult)
      : local;
    return { store, assistant: new DiloAssistant(new HttpDiloApi(), store, timezone), timezone };
  }, []);

  const syncCalendar = useCallback(() => {
    if (store instanceof CalendarSyncedStore) void store.sync();
  }, [store]);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    setCalendar((c) => ({ ...c, wanted: googleAuth.wanted, connected: googleAuth.token() !== null }));
    syncCalendar();
  }, [syncCalendar, now]);

  const connectCalendar = useCallback(async () => {
    setCalendar((c) => ({ ...c, busy: true }));
    try {
      await googleAuth.connect();
      setCalendar((c) => ({ ...c, wanted: true, connected: true }));
      syncCalendar();
    } catch {
      setError("Non sono riuscito a collegare Google Calendar. Riprova.");
    } finally {
      setCalendar((c) => ({ ...c, busy: false }));
    }
  }, [syncCalendar]);

  const disconnectCalendar = useCallback(() => {
    googleAuth.disconnect();
    setCalendar((c) => ({ ...c, wanted: false, connected: false }));
  }, []);

  useEffect(() => {
    if (!store) return;
    const refresh = () => store.all().then(setEntries);
    refresh().then(() => setReady(true));
    const off = store.subscribe(refresh);
    // Keep "Oggi" right across midnight and when the app comes back to the foreground.
    const tick = () => setNow(new Date());
    const timer = window.setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      off();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [store]);

  const fail = (err: unknown) =>
    setError(err instanceof DiloApiError ? err.message : "Qualcosa è andato storto. Riprova.");

  const say = useCallback(
    async (text: string) => {
      if (!assistant || !text.trim()) return false;
      setPhase("thinking");
      setError(null);
      try {
        const heard = await assistant.say(text.trim());
        setLastHeard({ ...heard, text: text.trim() });
        return true;
      } catch (err) {
        fail(err);
        return false;
      } finally {
        setPhase("idle");
      }
    },
    [assistant],
  );

  const answer = useCallback(
    async (item: DiloItem, text: string) => {
      if (!assistant || !text.trim()) return false;
      setAnswering(item.id);
      setError(null);
      try {
        const heard = await assistant.answer(item, text.trim());
        // Show the clarified items in place of the one that asked.
        setLastHeard((last) =>
          last && last.items.some((i) => i.id === item.id)
            ? { ...last, items: last.items.flatMap((i) => (i.id === item.id ? heard.items : [i])) }
            : last,
        );
        return true;
      } catch (err) {
        fail(err);
        return false;
      } finally {
        setAnswering(null);
      }
    },
    [assistant],
  );

  const undoLast = useCallback(async () => {
    if (!assistant || !lastHeard) return;
    await assistant.forget(lastHeard.items);
    setLastHeard(null);
  }, [assistant, lastHeard]);

  const setDone = useCallback(
    (id: string, done: boolean, date: string) => store?.setDone(id, done, date),
    [store],
  );
  const remove = useCallback(
    async (id: string) => {
      await store?.remove([id]);
      setLastHeard((last) => (last ? { ...last, items: last.items.filter((i) => i.id !== id) } : last));
    },
    [store],
  );

  return {
    ready,
    entries,
    phase,
    answering,
    lastHeard,
    error,
    now,
    timezone,
    today: todayIso(now, timezone),
    calendar: { available: GOOGLE_CLIENT_ID !== "", ...calendar, connect: connectCalendar, disconnect: disconnectCalendar },
    say,
    answer,
    undoLast,
    dismissLast: () => setLastHeard(null),
    dismissError: () => setError(null),
    setDone,
    remove,
  };
}

export type Dilo = ReturnType<typeof useDilo>;
