import { NextResponse, type NextRequest } from "next/server";

/**
 * Optional password for a public deployment, so only the owner spends the API key.
 * Set DILO_PASSWORD on the server; the browser asks for it once (any username).
 */
export function proxy(request: NextRequest) {
  const password = process.env.DILO_PASSWORD;
  if (!password) return NextResponse.next();

  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const given = decoded.slice(decoded.indexOf(":") + 1);
      if (safeEqual(given, password)) return NextResponse.next();
    } catch {
      // malformed header: ask again
    }
  }
  return new NextResponse("Serve la password di DILO.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="DILO", charset="UTF-8"' },
  });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const config = {
  // The app's icons and manifest stay public: phones fetch them without the password when installing DILO.
  // The WhatsApp webhook is called by Meta, which proves itself with a signature instead (see api/whatsapp);
  // the Google Calendar connect links are signed per phone number (see server/whatsapp/google.ts).
  matcher: ["/((?!_next/static|_next/image|manifest.webmanifest|icons/|icon.svg|apple-icon|api/whatsapp|api/google).*)"],
};
