"use client";

import { useRef, useState, type FormEvent } from "react";
import type { Dilo } from "./useDilo";
import { useSpeech } from "./useSpeech";
import type { ReactNode } from "react";
import { ArrowUpIcon } from "./icons";

/** The heart of the home: "Parla con DILO" and "Oppure scrivi qui...". */
export function Composer({ dilo, headline }: { dilo: Dilo; headline: ReactNode }) {
  const [text, setText] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const speech = useSpeech((heard) => {
    void dilo.say(heard).then((ok) => {
      if (!ok) setText(heard); // keep the words so the user can retry
    });
  });
  const thinking = dilo.phase === "thinking";

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim() || thinking) return;
    if (await dilo.say(text)) setText("");
  };

  const talk = () => {
    speech.clearError();
    if (speech.listening) return speech.stop();
    if (!speech.supported || !speech.start()) {
      setHint("Su questo browser la voce non è disponibile: scrivi pure qui sotto.");
      input.current?.focus();
    }
  };

  const status = thinking
    ? "DILO sta pensando…"
    : speech.listening
      ? speech.interim || "Ti ascolto…"
      : (speech.error ?? hint);

  return (
    <section className="composer" aria-label="Parla o scrivi a DILO">
      <button
        type="button"
        className={`talk${speech.listening ? " is-listening" : ""}${thinking ? " is-thinking" : ""}`}
        onClick={talk}
        disabled={thinking}
        aria-pressed={speech.listening}
      >
        <span className="talk-orb" aria-hidden="true">
          <span className="wave">
            <span />
            <span />
            <span />
            <span />
            <span />
          </span>
        </span>
        <span className="talk-label">{speech.listening ? "Ho finito" : "Parla con DILO"}</span>
      </button>

      {headline}

      <p className={`composer-status${status ? " is-visible" : ""}`} role="status" aria-live="polite">
        {status ?? " "}
      </p>

      <form className="write" onSubmit={submit}>
        <textarea
          ref={input}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setHint(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Oppure scrivi qui..."
          aria-label="Oppure scrivi qui"
          rows={1}
          maxLength={2000}
          enterKeyHint="send"
          disabled={thinking}
        />
        <button type="submit" className="send" disabled={!text.trim() || thinking} aria-label="Invia a DILO">
          <ArrowUpIcon />
        </button>
      </form>
    </section>
  );
}
