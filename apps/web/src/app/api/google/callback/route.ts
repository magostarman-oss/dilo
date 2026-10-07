import { after } from "next/server";
import { syncCalendar } from "@/server/whatsapp/conversation";
import { finishConnect, googleOAuthFromEnv } from "@/server/whatsapp/google";
import { whatsAppFromEnv } from "@/server/whatsapp/setup";
import { page } from "../html";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Google comes back here after the user allowed DILO to write to their calendar. */
export async function GET(request: Request): Promise<Response> {
  const google = googleOAuthFromEnv();
  const deps = whatsAppFromEnv();
  if (!google || !deps) return page("Google Calendar non è ancora configurato su DILO.", 503);

  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  if (!code) return page("Collegamento annullato. Puoi riprovare quando vuoi scrivendo «calendario» a DILO.", 400);

  const phone = await finishConnect(google, deps.kv, code, params.get("state") ?? "").catch((err) => {
    console.error("[dilo] google connect failed:", err);
    return undefined;
  });
  if (phone === undefined) return page("Non sono riuscito a collegare Google Calendar. Riprova scrivendo «calendario» a DILO.", 502);
  if (!phone) return page("Questo link è scaduto. Scrivi «calendario» a DILO su WhatsApp per averne uno nuovo.", 400);

  // What DILO already remembers goes into the calendar now, and DILO says so on WhatsApp.
  after(async () => {
    try {
      await syncCalendar(phone, deps);
      await deps.whatsapp.sendText(phone, "Google Calendar collegato ✅ Da ora tutto quello che ha una data lo trovi anche lì.");
    } catch (err) {
      console.error("[dilo] calendar first sync failed:", err);
    }
  });
  return page("Fatto! Google Calendar è collegato. Puoi tornare su WhatsApp.");
}
