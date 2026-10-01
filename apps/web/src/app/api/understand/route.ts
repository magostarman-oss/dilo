import { handleUnderstand } from "@/server/handlers";
import { postRoute } from "@/server/route";

export const runtime = "nodejs";
export const maxDuration = 60;
export const POST = postRoute(handleUnderstand);
