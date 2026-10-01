import { googleCalendarUrl, type DiloItem } from "@dilo/core";
import { CalendarIcon, CheckIcon } from "./icons";

/**
 * Where an item stands with Google Calendar: already there (written automatically),
 * or a link that opens Google Calendar filled in, for a one-tap manual save.
 */
export function CalendarLink({ item, synced = false, compact = false }: { item: DiloItem; synced?: boolean; compact?: boolean }) {
  if (synced) {
    return compact ? (
      <span className="icon-btn cal-btn is-synced" title="In Google Calendar" aria-label="In Google Calendar">
        <CalendarIcon />
      </span>
    ) : (
      <span className="cal-link is-synced">
        <CheckIcon />
        <span>In Google Calendar</span>
      </span>
    );
  }
  const url = googleCalendarUrl(item);
  if (!url) return null;
  return (
    <a
      className={compact ? "icon-btn cal-btn" : "cal-link"}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Aggiungi a Google Calendar: ${item.title}`}
    >
      <CalendarIcon />
      {!compact && <span>Aggiungi a Google Calendar</span>}
    </a>
  );
}
