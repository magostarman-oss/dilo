"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** The subset of the Web Speech API DILO uses (not in TypeScript's DOM types). */
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Per parlare con DILO consenti l'uso del microfono.",
  "service-not-allowed": "Per parlare con DILO consenti l'uso del microfono.",
  "audio-capture": "Non trovo un microfono. Puoi scrivere qui sotto.",
  network: "Il riconoscimento vocale non è raggiungibile. Puoi scrivere qui sotto.",
};

/**
 * Voice input through the browser's speech recognition, in Italian.
 * Real streaming voice on the server is a later step; this keeps the same shape.
 */
export function useSpeech(onFinal: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const finalText = useRef("");
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  useEffect(() => {
    setSupported(recognitionCtor() !== null);
    return () => rec.current?.abort();
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return false;
    rec.current?.abort();
    const r = new Ctor();
    r.lang = "it-IT";
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    finalText.current = "";
    setInterim("");
    setError(null);

    r.onresult = (e) => {
      let text = "";
      let final = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) final += res[0].transcript;
        else text += res[0].transcript;
      }
      finalText.current = final;
      setInterim((final + text).trim());
    };
    r.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") setError(ERRORS[e.error] ?? "Non ti ho sentito bene. Riprova.");
    };
    r.onend = () => {
      setListening(false);
      setInterim("");
      const text = finalText.current.trim();
      if (text) onFinalRef.current(text);
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
      return true;
    } catch {
      return false;
    }
  }, []);

  const stop = useCallback(() => rec.current?.stop(), []);

  return { supported, listening, interim, error, start, stop, clearError: () => setError(null) };
}
