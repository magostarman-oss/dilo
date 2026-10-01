"use client";

/**
 * The user's permission to write to their Google Calendar, obtained in the browser with
 * Google Identity Services (scope calendar.events). Tokens last about an hour; after that
 * the user taps "Ricollega". Keeping it fully in the background needs a server (later).
 */

export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const KEY = "dilo.google.v1";

interface Saved {
  wanted: boolean;
  token: string | null;
  expiresAt: number;
}

function read(): Saved {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return { wanted: false, token: null, expiresAt: 0, ...(JSON.parse(raw) as Partial<Saved>) };
  } catch {
    // storage unavailable
  }
  return { wanted: false, token: null, expiresAt: 0 };
}

function write(s: Saved) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable: the token lives for this page only
  }
  memory = s;
}

let memory: Saved | null = null;
const state = () => (memory ??= read());

export const googleAuth = {
  /** Whether the user chose to keep DILO in sync with their calendar. */
  get wanted() {
    return state().wanted;
  },
  /** A valid access token, or null when it is missing or about to expire. */
  token(): string | null {
    const s = state();
    return s.token && s.expiresAt - 60_000 > Date.now() ? s.token : null;
  },
  /** Google rejected the token: forget it, keep the wish to be connected. */
  expire() {
    write({ ...state(), token: null, expiresAt: 0 });
  },
  /** Asks Google for permission. Must run inside a tap (it may open a Google window). */
  async connect(): Promise<void> {
    await loadScript();
    const reconnect = state().wanted;
    const token = await new Promise<{ access_token: string; expires_in: number }>((resolve, reject) => {
      const client = gis().accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPE,
        callback: (r: { access_token?: string; expires_in?: number; error?: string }) =>
          r.access_token ? resolve({ access_token: r.access_token, expires_in: r.expires_in ?? 3600 }) : reject(new Error(r.error ?? "denied")),
        error_callback: (e: { type?: string }) => reject(new Error(e.type ?? "popup_closed")),
      });
      client.requestAccessToken({ prompt: reconnect ? "" : "consent" });
    });
    write({ wanted: true, token: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 });
  },
  disconnect() {
    const t = state().token;
    if (t) {
      try {
        gis().accounts.oauth2.revoke(t, () => {});
      } catch {
        // script not loaded: the token simply expires
      }
    }
    write({ wanted: false, token: null, expiresAt: 0 });
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gis = () => (window as any).google as any;

let loading: Promise<void> | null = null;
/** Loads Google's sign-in script once. */
export function loadScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (gis()?.accounts?.oauth2) return Promise.resolve();
  return (loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error("Impossibile caricare Google"));
    };
    document.head.appendChild(s);
  }));
}
