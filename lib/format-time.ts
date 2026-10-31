type ClockTimeOptions = {
  locale?: string;
  timeZone?: string;
};

/** Formats a timestamp as a consistent 12-hour clock time. */
export function formatClockTime(
  timestamp: number | Date,
  { locale, timeZone }: ClockTimeOptions = {}
): string {
  return new Date(timestamp).toLocaleTimeString(locale, {
    ...(timeZone ? { timeZone } : {}),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
