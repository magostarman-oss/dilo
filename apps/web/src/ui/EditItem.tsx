"use client";

import { useState, type FormEvent } from "react";
import type { DiloItem } from "@dilo/core";
import type { Dilo } from "./useDilo";

/** Change an item by hand: title, day, time, place. The calendar follows. */
export function EditItem({ item, dilo, onClose }: { item: DiloItem; dilo: Dilo; onClose: () => void }) {
  const [title, setTitle] = useState(item.title);
  const [date, setDate] = useState(item.date ?? "");
  const [time, setTime] = useState(item.time ?? "");
  const [location, setLocation] = useState(item.location ?? "");
  const [saving, setSaving] = useState(false);
  const datable = item.type !== "note";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    await dilo.edit(item, {
      title,
      location: location || null,
      ...(datable ? { date: date || (item.recurrence ? item.date : null), time: time || null } : {}),
    });
    setSaving(false);
    onClose();
  };

  return (
    <form className="edit" onSubmit={submit} aria-label={`Modifica: ${item.title}`}>
      <label className="edit-field edit-wide">
        <span>Cosa</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required autoFocus />
      </label>
      {datable && (
        <>
          <label className="edit-field">
            <span>{item.recurrence ? "Dal giorno" : "Giorno"}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="edit-field">
            <span>Ora</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </>
      )}
      <label className="edit-field edit-wide">
        <span>Dove</span>
        <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} placeholder="Facoltativo" />
      </label>
      <div className="edit-actions edit-wide">
        <button type="button" className="text-btn" onClick={onClose}>
          Annulla
        </button>
        <button type="submit" className="pill-btn" disabled={!title.trim() || saving}>
          {saving ? "Salvo…" : "Salva"}
        </button>
      </div>
    </form>
  );
}
