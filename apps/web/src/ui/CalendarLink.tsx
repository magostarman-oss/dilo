import { googleCalendarUrl, type DiloItem } from "@dilo/core";
import { CalendarIcon } from "./icons";

/** Opens Google Calendar with the item filled in; the user confirms with Save. */
export function CalendarLink({ item, compact = false }: { item: DiloItem; compact?: boolean }) {
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
