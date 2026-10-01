"use client";

import { useMemo, useState } from "react";
import { buildAgenda, type AgendaEntry, type DiloItem, type IsoDate } from "@dilo/core";
import { isDoneOn, type MemoryEntry } from "@dilo/memory";
import type { Dilo } from "./useDilo";
import { Clarify } from "./Clarify";
import { CheckIcon, CloseIcon } from "./icons";
import { CalendarLink } from "./CalendarLink";
import { EditItem } from "./EditItem";
import { clockLabel, itemMeta, longDay, typeLabel } from "./display";

type Tab = "oggi" | "prossimi" | "note";

const addDays = (iso: IsoDate, n: number): IsoDate => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** "Oggi", plus the next days and notes so nothing DILO remembers gets lost. */
export function Agenda({ dilo }: { dilo: Dilo }) {
  const [tab, setTab] = useState<Tab>("oggi");
  const { entries, today } = dilo;
  const byId = useMemo(() => new Map(entries.map((e) => [e.item.id, e])), [entries]);
  const items = useMemo(() => entries.map((e) => e.item), [entries]);
  const isDone = (date: IsoDate) => (item: DiloItem) => {
    const e = byId.get(item.id);
    return e ? isDoneOn(e, date) : false;
  };

  const agenda = useMemo(() => buildAgenda(items, today, { isDone: isDone(today) }), [items, today, byId]);
  const upcoming = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, i + 1)).map((date) => {
      const a = buildAgenda(items, date, { isDone: isDone(date) });
      // Routines would repeat on every day: they get their own group below.
      const once = [...a.schedule, ...a.anytime, ...a.deadlines].filter((e) => !e.item.recurrence);
      return { date, entries: once };
    });
    const shown = new Set<string>();
    for (const list of [agenda.schedule, agenda.anytime, agenda.deadlines, agenda.overdue, ...days.map((d) => d.entries)]) {
      for (const e of list) shown.add(e.item.id);
    }
    const routines = items.filter((i) => i.recurrence && i.status === "ready");
    const later = entries
      .filter((e) => {
        const i = e.item;
        return i.type !== "note" && i.status === "ready" && !i.recurrence && !shown.has(i.id) && !isDoneOn(e, today);
      })
      .map((e) => e.item)
      .sort((a, b) => (a.date ?? a.window?.from ?? "9999").localeCompare(b.date ?? b.window?.from ?? "9999"));
    return { days: days.filter((d) => d.entries.length > 0), later, routines };
  }, [items, today, agenda, entries]);
  const notes = useMemo(
    () => entries.filter((e) => e.item.type === "note" && e.item.status === "ready").sort((a, b) => b.savedAt.localeCompare(a.savedAt)),
    [entries],
  );

  const inCard = new Set(dilo.lastHeard?.items.map((i) => i.id) ?? []);
  const toClarify = agenda.toClarify.filter((i) => !inCard.has(i.id));
  const todayCount = agenda.schedule.length + agenda.anytime.length + agenda.deadlines.length;

  return (
    <section className="agenda" aria-label="La tua giornata">
      <div className="tabs" role="tablist">
        {(
          [
            ["oggi", "Oggi", todayCount + agenda.overdue.length + agenda.toClarify.length],
            ["prossimi", "Prossimi", upcoming.days.reduce((n, d) => n + d.entries.length, 0) + upcoming.later.length + upcoming.routines.length],
            ["note", "Note", notes.length],
          ] as const
        ).map(([id, label, count]) => (
          <button key={id} role="tab" aria-selected={tab === id} className="tab" onClick={() => setTab(id)}>
            {label}
            {count > 0 && <span className="tab-count">{count}</span>}
          </button>
        ))}
      </div>

      {!dilo.ready ? null : tab === "oggi" ? (
        <div className="panel">
          <p className="panel-date">{longDay(today)}</p>

          {toClarify.length > 0 && (
            <Group title="Da chiarire">
              {toClarify.map((item) => (
                <li key={item.id} className="row row-clarify">
                  <div className="row-body">
                    <p className="item-title">{item.title}</p>
                    <p className="item-meta">{typeLabel(item)}</p>
                    <Clarify item={item} dilo={dilo} />
                  </div>
                  <RemoveButton item={item} dilo={dilo} />
                </li>
              ))}
            </Group>
          )}

          {agenda.overdue.length > 0 && (
            <Group title="Rimasto indietro">
              {agenda.overdue.map((e) => (
                <Row key={e.item.id} entry={e} dilo={dilo} date={today} entryOf={byId} when />
              ))}
            </Group>
          )}

          {agenda.schedule.length > 0 && (
            <Group title="In programma">
              {agenda.schedule.map((e) => (
                <Row key={e.item.id} entry={e} dilo={dilo} date={today} entryOf={byId} />
              ))}
            </Group>
          )}

          {agenda.anytime.length > 0 && (
            <Group title="In giornata">
              {agenda.anytime.map((e) => (
                <Row key={e.item.id} entry={e} dilo={dilo} date={today} entryOf={byId} />
              ))}
            </Group>
          )}

          {agenda.deadlines.length > 0 && (
            <Group title="Scadono oggi">
              {agenda.deadlines.map((e) => (
                <Row key={e.item.id} entry={e} dilo={dilo} date={today} entryOf={byId} />
              ))}
            </Group>
          )}

          {todayCount + agenda.overdue.length + agenda.toClarify.length === 0 && (
            <p className="empty">Oggi è libero. Quando ti viene in mente qualcosa, dillo a DILO.</p>
          )}
        </div>
      ) : tab === "prossimi" ? (
        <div className="panel">
          {upcoming.days.map((d) => (
            <Group key={d.date} title={d.date === addDays(today, 1) ? `Domani, ${longDay(d.date)}` : longDay(d.date)}>
              {d.entries.map((e) => (
                <Row key={e.item.id} entry={e} dilo={dilo} date={d.date} entryOf={byId} />
              ))}
            </Group>
          ))}
          {upcoming.later.length > 0 && (
            <Group title="Più avanti o senza data">
              {upcoming.later.map((item) => (
                <Row
                  key={item.id}
                  entry={{ item, reason: "scheduled", time: null, partOfDay: null }}
                  dilo={dilo}
                  date={today}
                  entryOf={byId}
                  when
                />
              ))}
            </Group>
          )}
          {upcoming.routines.length > 0 && (
            <Group title="Routine">
              {upcoming.routines.map((item) => (
                <Row
                  key={item.id}
                  entry={{ item, reason: "recurring", time: item.time, partOfDay: item.partOfDay }}
                  dilo={dilo}
                  date={today}
                  entryOf={byId}
                  when
                />
              ))}
            </Group>
          )}
          {upcoming.days.length + upcoming.later.length + upcoming.routines.length === 0 && (
            <p className="empty">Nient'altro in vista.</p>
          )}
        </div>
      ) : (
        <div className="panel">
          {notes.length > 0 ? (
            <Group title="Le tue note">
              {notes.map((e) => (
                <NoteRow key={e.item.id} item={e.item} dilo={dilo} />
              ))}
            </Group>
          ) : (
            <p className="empty">Nessuna nota. Prova: “Il codice del cancello è 4512”.</p>
          )}
        </div>
      )}
    </section>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="group">
      <h3 className="group-title">{title}</h3>
      <ul className="rows">{children}</ul>
    </div>
  );
}

function Row({
  entry,
  dilo,
  date,
  entryOf,
  when = false,
}: {
  entry: AgendaEntry;
  dilo: Dilo;
  date: IsoDate;
  entryOf: Map<string, MemoryEntry>;
  when?: boolean;
}) {
  const { item } = entry;
  const [editing, setEditing] = useState(false);
  const stored = entryOf.get(item.id);
  const done = stored ? isDoneOn(stored, date) : false;
  const clock = when ? "" : clockLabel(entry.time, entry.partOfDay);
  const meta = [typeLabel(item), itemMeta(item, dilo.now, { withWhen: when })].filter(Boolean).join(" · ");
  const checkable = item.type !== "event";

  return (
    <li className={`row type-${item.type}${done ? " is-done" : ""}`}>
      {checkable ? (
        <button
          className="check"
          role="checkbox"
          aria-checked={done}
          aria-label={done ? `Segna come da fare: ${item.title}` : `Fatto: ${item.title}`}
          onClick={() => void dilo.setDone(item.id, !done, date)}
        >
          {done && <CheckIcon />}
        </button>
      ) : (
        <span className="dot" aria-hidden="true" />
      )}
      <Editable title={item.title} editing={editing} onToggle={() => setEditing(!editing)}>
        <p className="item-title">{item.title}</p>
        <p className="item-meta">
          {entry.reason === "deadline" && "Scadenza · "}
          {meta}
        </p>
      </Editable>
      {clock && <span className="row-time">{clock}</span>}
      <CalendarLink item={item} synced={!!stored?.calendar} compact />
      <RemoveButton item={item} dilo={dilo} />
      {editing && <EditItem item={item} dilo={dilo} onClose={() => setEditing(false)} />}
    </li>
  );
}

function NoteRow({ item, dilo }: { item: DiloItem; dilo: Dilo }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="row">
      <Editable title={item.title} editing={editing} onToggle={() => setEditing(!editing)}>
        <p className="item-title">{item.title}</p>
        {item.details && <p className="item-meta">{item.details}</p>}
      </Editable>
      <RemoveButton item={item} dilo={dilo} />
      {editing && <EditItem item={item} dilo={dilo} onClose={() => setEditing(false)} />}
    </li>
  );
}

/** The text of a row: tapping it opens the editor. */
function Editable({
  title,
  editing,
  onToggle,
  children,
}: {
  title: string;
  editing: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="row-body editable"
      role="button"
      tabIndex={0}
      aria-expanded={editing}
      aria-label={`Modifica: ${title}`}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      {children}
    </div>
  );
}

function RemoveButton({ item, dilo }: { item: DiloItem; dilo: Dilo }) {
  return (
    <button className="icon-btn remove" onClick={() => void dilo.remove(item.id)} aria-label={`Elimina: ${item.title}`}>
      <CloseIcon />
    </button>
  );
}
