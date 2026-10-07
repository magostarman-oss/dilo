/**
 * Voice notes to text. Claude reads text, so a speech-to-text service turns the
 * audio into words first. Any OpenAI-compatible transcription endpoint works
 * (OpenAI by default; Groq and others expose the same API).
 */
export type Transcriber = (audio: ArrayBuffer, mimeType: string) => Promise<string>;

export function transcriberFromEnv(env: NodeJS.ProcessEnv = process.env): Transcriber | null {
  const apiKey = env.DILO_TRANSCRIBE_API_KEY || env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseUrl = (env.DILO_TRANSCRIBE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = env.DILO_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";

  return async (audio, mimeType) => {
    const form = new FormData();
    // WhatsApp voice notes are Ogg/Opus; the file name tells the service the format.
    form.append("file", new Blob([audio], { type: mimeType }), `vocale.${extensionFor(mimeType)}`);
    form.append("model", model);
    form.append("language", "it");
    form.append("response_format", "json");
    const res = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) throw new Error(`Transcription failed: ${res.status} ${await res.text().catch(() => "")}`);
    const { text } = (await res.json()) as { text?: string };
    return (text ?? "").trim();
  };
}

function extensionFor(mimeType: string): string {
  const type = mimeType.split(";")[0]!.trim();
  const known: Record<string, string> = {
    "audio/ogg": "ogg",
    "audio/opus": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "m4a",
    "audio/amr": "amr",
    "audio/wav": "wav",
    "audio/webm": "webm",
  };
  return known[type] ?? "ogg";
}
