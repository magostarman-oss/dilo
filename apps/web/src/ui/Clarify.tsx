"use client";

import { useState, type FormEvent } from "react";
import type { DiloItem } from "@dilo/core";
import type { Dilo } from "./useDilo";
import { ArrowUpIcon } from "./icons";

/** DILO's short question about an item, with a place to answer. */
export function Clarify({ item, dilo }: { item: DiloItem; dilo: Dilo }) {
  const [text, setText] = useState("");
  const busy = dilo.answering === item.id;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    if (await dilo.answer(item, text)) setText("");
  };

  return (
    <form className="clarify" onSubmit={submit}>
      <p className="clarify-q">{item.clarification?.question}</p>
      <div className="clarify-row">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={busy ? "Un attimo…" : "Rispondi a DILO"}
          aria-label={`Rispondi: ${item.clarification?.question ?? ""}`}
          enterKeyHint="send"
          maxLength={2000}
          disabled={busy}
        />
        <button type="submit" className="send small" disabled={!text.trim() || busy} aria-label="Invia risposta">
          <ArrowUpIcon />
        </button>
      </div>
    </form>
  );
}
