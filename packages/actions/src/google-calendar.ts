import type { GoogleEventBody } from "@dilo/core";

/** Thrown when Google says the access token is missing or expired: the user must reconnect. */
export class CalendarAuthError extends Error {
  constructor() {
    super("Google Calendar non è collegato o il collegamento è scaduto.");
    this.name = "CalendarAuthError";
  }
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/**
 * The few Google Calendar API calls DILO needs, with a short-lived access token the
 * user granted (scope calendar.events). Works in the browser and on React Native.
 */
export class GoogleCalendarApi {
  constructor(
    private readonly getToken: () => string | null,
    private readonly fetchImpl: Fetch = (url, init) => fetch(url, init),
    /** Told when Google rejects the token, so the app can forget it and ask to reconnect. */
    private readonly onUnauthorized: () => void = () => {},
  ) {}

  get connected(): boolean {
    return this.getToken() !== null;
  }

  async insert(event: GoogleEventBody): Promise<string> {
    const res = (await this.call("POST", BASE, event)) as { id: string };
    return res.id;
  }

  /** Replaces the event; returns false when it no longer exists (deleted by the user in Google). */
  async update(eventId: string, event: GoogleEventBody): Promise<boolean> {
    const res = await this.call("PUT", `${BASE}/${encodeURIComponent(eventId)}`, event);
    return res !== null;
  }

  async remove(eventId: string): Promise<void> {
    await this.call("DELETE", `${BASE}/${encodeURIComponent(eventId)}`);
  }

  private async call(method: string, url: string, body?: unknown): Promise<unknown> {
    const token = this.getToken();
    if (!token) throw new CalendarAuthError();
    const res = await this.fetchImpl(url, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 401 || res.status === 403) {
      this.onUnauthorized();
      throw new CalendarAuthError();
    }
    // Already gone from the calendar: nothing left to delete or update.
    if ((method === "DELETE" || method === "PUT") && (res.status === 404 || res.status === 410)) return null;
    if (!res.ok) throw new Error(`Google Calendar ${method} ${res.status}`);
    return method === "DELETE" ? null : res.json();
  }
}
