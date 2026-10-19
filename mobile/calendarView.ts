export type CalendarEvent = { event_key: string; starts_at: string; ends_at: string };
export type CalendarSync = { synced_at: string; window_start: string; window_end: string; source: "manual" | "imported" };
export type CalendarSnapshot = { sync: CalendarSync | null; events: CalendarEvent[] };
export type DayEvent = CalendarEvent & { start: Date; end: Date; continuesBefore: boolean; continuesAfter: boolean };

export function dayKey(day: Date): string {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

export function dayBounds(day: Date): [Date, Date] {
  return [new Date(day.getFullYear(), day.getMonth(), day.getDate()), new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)];
}

export function monthDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), 1 - offset + index));
}

export function eventsForDay(events: CalendarEvent[], day: Date): DayEvent[] {
  const [from, until] = dayBounds(day);
  return events.flatMap(event => {
    const start = new Date(event.starts_at), end = new Date(event.ends_at);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || start >= until || end <= from) return [];
    return [{ ...event, start, end, continuesBefore: start < from, continuesAfter: end > until }];
  }).sort((first, second) => first.start.getTime() - second.start.getTime() || first.end.getTime() - second.end.getTime());
}

export function dayIsCovered(sync: CalendarSync | null, day: Date): boolean {
  if (!sync) return false;
  const [from, until] = dayBounds(day);
  return new Date(sync.window_start) <= from && new Date(sync.window_end) >= until;
}

export function eventTime(event: DayEvent, day: Date): string {
  const [from, until] = dayBounds(day);
  const time = (value: Date) => `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  if (event.start <= from && event.end >= until) return "終日（00:00〜24:00）";
  return `${event.start <= from ? "00:00" : time(event.start)}〜${event.end >= until ? "24:00" : time(event.end)}`;
}
