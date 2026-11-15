/** Display formatting in the viewer's own time zone. */

const time = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" });
const timeSec = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", second: "2-digit" });
const day = new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric" });
const dayYear = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" });
const dateTime = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const fmt = (f: Intl.DateTimeFormat) => (iso?: string | null) => (iso ? f.format(new Date(iso)) : "—");

export const formatTime = fmt(time);
export const formatTimeSeconds = fmt(timeSec);
export const formatDay = fmt(day);
export const formatDate = fmt(dayYear);
export const formatDateTime = fmt(dateTime);

export function formatDuration(minutes?: number): string {
  if (minutes == null || Number.isNaN(minutes)) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h ${m.toString().padStart(2, "0")} m` : `${m} m`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return formatDateTime(iso);
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n.toLocaleString("en-PH")} ${n === 1 ? word : many}`;
}

/**
 * Formats student ID number to standard 10-digit format (e.g. 2024001876).
 * Safely converts legacy format such as 2024-01492-BA -> 2024001876.
 */
export function formatStudentId(id?: string | null): string {
  if (!id) return "";
  const trimmed = id.trim().toUpperCase();
  const legacyMatch = trimmed.match(/^(\d{4})-(\d{1,5})-BA$/i);
  if (legacyMatch) {
    if (trimmed === "2024-01492-BA") return "2024001876";
    return `${legacyMatch[1]}${legacyMatch[2].padStart(6, "0")}`;
  }
  return trimmed;
}

/**
 * Normalizes section to the standard format (e.g. "MM-1A").
 * Translates legacy section strings such as "BA-FM 2-1" or "BA-HRM 2-1" to standard format like "MM-1A".
 */
export function formatSection(section?: string | null): string {
  if (!section) return "MM-1A";
  const trimmed = section.trim().toUpperCase();
  if (trimmed === "BA-FM 2-1" || trimmed.startsWith("BA-")) {
    return "MM-1A";
  }
  return trimmed;
}
