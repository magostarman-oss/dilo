import type { ServerKv } from "./kv";

/**
 * Google Calendar for DILO on WhatsApp. The user connects once from a link DILO
 * sends; Google gives the server a refresh token, kept per phone number, from
 * which DILO gets a fresh access token whenever it writes to the calendar.
 */

const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const STATE_TTL_MS = 60 * 60 * 1000;

export interface GoogleOAuth {
  clientId: string;
  clientSecret: string;
  /** Signs the connect links, so nobody can attach their calendar to someone else's number. */
  stateSecret: string;
  /** The deployment's address, e.g. https://dilo.vercel.app */
  baseUrl: string;
}

export function googleOAuthFromEnv(env: NodeJS.ProcessEnv = process.env): GoogleOAuth | null {
  const clientId = env.GOOGLE_CLIENT_ID || env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const stateSecret = env.WHATSAPP_APP_SECRET?.trim();
  const baseUrl = env.DILO_PUBLIC_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  if (!clientId || !clientSecret || !stateSecret || !baseUrl) return null;
  return { clientId, clientSecret, stateSecret, baseUrl: baseUrl.replace(/\/$/, "") };
}

const redirectUri = (g: GoogleOAuth) => `${g.baseUrl}/api/google/callback`;
const googleKey = (phone: string) => `dilo:wa:${phone}:google`;

/** The link DILO sends on WhatsApp: it opens Google's permission screen for this number. */
export async function connectLink(g: GoogleOAuth, phone: string, now = Date.now()): Promise<string> {
  return `${g.baseUrl}/api/google/connect?s=${encodeURIComponent(await signState(g, phone, now))}`;
}

/** Google's permission screen for the phone number inside a valid signed state. */
export async function authorizeUrl(g: GoogleOAuth, state: string, now = Date.now()): Promise<string | null> {
  if (!(await readState(g, state, now))) return null;
  const params = new URLSearchParams({
    client_id: g.clientId,
    redirect_uri: redirectUri(g),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    // Always ask, so Google always returns a refresh token (it does not on a silent re-consent).
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** Google came back with a code: trade it for a refresh token and keep it. Returns the phone number. */
export async function finishConnect(
  g: GoogleOAuth,
  kv: ServerKv,
  code: string,
  state: string,
  now = Date.now(),
): Promise<string | null> {
  const phone = await readState(g, state, now);
  if (!phone) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: g.clientId,
      client_secret: g.clientSecret,
      redirect_uri: redirectUri(g),
      grant_type: "authorization_code",
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { refresh_token?: string; error?: string };
  if (!res.ok || !json.refresh_token) throw new Error(`Google token exchange failed: ${json.error ?? res.status}`);
  await kv.setItem(googleKey(phone), JSON.stringify({ refreshToken: json.refresh_token, connectedAt: new Date(now).toISOString() }));
  return phone;
}

/** A fresh access token for this number's calendar, or null when it is not connected (or no longer). */
export async function accessToken(g: GoogleOAuth, kv: ServerKv, phone: string): Promise<string | null> {
  const raw = await kv.getItem(googleKey(phone));
  const refreshToken = raw ? (JSON.parse(raw) as { refreshToken?: string }).refreshToken : null;
  if (!refreshToken) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: g.clientId,
      client_secret: g.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (json.error === "invalid_grant") {
    // The user removed DILO's access in Google, or the permission expired: ask to connect again.
    await kv.setItem(googleKey(phone), "");
    return null;
  }
  if (!res.ok || !json.access_token) throw new Error(`Google token refresh failed: ${json.error ?? res.status}`);
  return json.access_token;
}

export async function isConnected(kv: ServerKv, phone: string): Promise<boolean> {
  return !!(await kv.getItem(googleKey(phone)));
}

async function signState(g: GoogleOAuth, phone: string, now: number): Promise<string> {
  const payload = `${phone}.${now + STATE_TTL_MS}`;
  return `${payload}.${await hmac(g.stateSecret, payload)}`;
}

async function readState(g: GoogleOAuth, state: string, now: number): Promise<string | null> {
  const [phone, expires, sig] = state.split(".");
  if (!phone || !expires || !sig || Number(expires) < now) return null;
  const expected = await hmac(g.stateSecret, `${phone}.${expires}`);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? phone : null;
}

async function hmac(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}
