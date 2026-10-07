/**
 * The few calls DILO makes to the WhatsApp Business Cloud API (Meta Graph API):
 * send a text, download a voice note.
 */
export interface WhatsAppApi {
  sendText(to: string, text: string): Promise<void>;
  downloadMedia(mediaId: string): Promise<{ data: ArrayBuffer; mimeType: string }>;
}

const GRAPH = "https://graph.facebook.com";
/** WhatsApp cuts messages longer than this. */
const MAX_TEXT = 4096;

export class CloudApi implements WhatsAppApi {
  constructor(
    private readonly token: string,
    private readonly phoneNumberId: string,
    private readonly version = "v23.0",
  ) {}

  async sendText(to: string, text: string): Promise<void> {
    const res = await fetch(`${GRAPH}/${this.version}/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text.slice(0, MAX_TEXT), preview_url: false },
      }),
    });
    if (!res.ok) throw new Error(`WhatsApp send failed: ${res.status} ${await res.text().catch(() => "")}`);
  }

  async downloadMedia(mediaId: string): Promise<{ data: ArrayBuffer; mimeType: string }> {
    // Two steps: the media id gives a short-lived URL, the URL gives the file (same token).
    const meta = await fetch(`${GRAPH}/${this.version}/${mediaId}`, { headers: this.headers() });
    if (!meta.ok) throw new Error(`WhatsApp media lookup failed: ${meta.status}`);
    const { url, mime_type } = (await meta.json()) as { url: string; mime_type: string };
    const file = await fetch(url, { headers: this.headers() });
    if (!file.ok) throw new Error(`WhatsApp media download failed: ${file.status}`);
    return { data: await file.arrayBuffer(), mimeType: mime_type };
  }

  private headers(extra: Record<string, string> = {}) {
    return { authorization: `Bearer ${this.token}`, ...extra };
  }
}

export function cloudApiFromEnv(env: NodeJS.ProcessEnv = process.env): CloudApi | null {
  const token = env.WHATSAPP_TOKEN;
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
  return token && phoneNumberId ? new CloudApi(token, phoneNumberId, env.WHATSAPP_API_VERSION || undefined) : null;
}

/** Checks Meta's X-Hub-Signature-256 header: an HMAC-SHA256 of the raw body with the app secret. */
export async function validSignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice("sha256=".length);
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
