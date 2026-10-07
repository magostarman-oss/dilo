import { authorizeUrl, googleOAuthFromEnv } from "@/server/whatsapp/google";
import { page } from "../html";

export const runtime = "nodejs";

/** The link DILO sends on WhatsApp lands here and moves on to Google's permission screen. */
export async function GET(request: Request): Promise<Response> {
  const google = googleOAuthFromEnv();
  if (!google) return page("Google Calendar non è ancora configurato su DILO.", 503);
  const url = await authorizeUrl(google, new URL(request.url).searchParams.get("s") ?? "");
  if (!url) return page("Questo link è scaduto. Scrivi «calendario» a DILO su WhatsApp per averne uno nuovo.", 400);
  return Response.redirect(url, 302);
}
