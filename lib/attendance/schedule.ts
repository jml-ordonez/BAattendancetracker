import type { BAEvent, EventSession } from "@/types/events";
import type { AttendanceScan } from "@/types/attendance";

/** Must match CHECK_IN_OPENS_EARLY_MINS in record.ts (that file is server-only). */
export const OPENS_EARLY_MINS = 60;

export type SessionState = "open" | "upcoming" | "ended";

export interface SessionPick {
  event: BAEvent;
  session: EventSession;
  state: SessionState;
}

export function sessionState(session: EventSession, now = new Date()): SessionState {
  const opens = new Date(session.time_in_start).getTime() - OPENS_EARLY_MINS * 60000;
  const closes = new Date(session.time_out_end).getTime();
  const t = now.getTime();
  return t < opens ? "upcoming" : t > closes ? "ended" : "open";
}

/** Every session of the published events, in time order. */
export function publishedSessions(events: BAEvent[], now = new Date()): SessionPick[] {
  return events
    .filter((e) => e.status === "published")
    .flatMap((event) => (event.sessions ?? []).map((session) => ({ event, session, state: sessionState(session, now) })))
    // Compare instants, not strings: stored times mix UTC ("Z") and "+08:00" offsets.
    .sort((a, b) => new Date(a.session.time_in_start).getTime() - new Date(b.session.time_in_start).getTime());
}

/** The session open now; otherwise the next one; otherwise the most recent one. */
export function pickSession(events: BAEvent[], now = new Date()): SessionPick | null {
  const all = publishedSessions(events, now);
  return all.find((s) => s.state === "open") ?? all.find((s) => s.state === "upcoming") ?? all.at(-1) ?? null;
}

/**
 * Picks the most relevant session for the coordinator/dashboard:
 * 1. An open session right now.
 * 2. A session that already has recorded attendance scans.
 * 3. The next upcoming session.
 * 4. The latest session.
 */
export function pickBestSession(events: BAEvent[], scans?: AttendanceScan[], now = new Date()): SessionPick | null {
  const all = publishedSessions(events, now);
  const open = all.find((s) => s.state === "open");
  if (open) return open;

  if (scans && scans.length > 0) {
    const scanSessionIds = new Set(scans.map((s) => s.sessionId));
    const withScans = all.find((s) => scanSessionIds.has(s.session.id));
    if (withScans) return withScans;
  }

  return all.find((s) => s.state === "upcoming") ?? all.at(-1) ?? null;
}

export function graceEnds(session: EventSession): Date {
  return new Date(new Date(session.time_in_start).getTime() + session.grace_period_mins * 60000);
}

/** Published events a student can still register for: at least one session hasn't ended. Soonest first. */
export function registrableEvents(events: BAEvent[], now = new Date()): BAEvent[] {
  return events
    .filter((e) => e.status === "published" && (e.sessions ?? []).some((s) => sessionState(s, now) !== "ended"))
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
}

/** The sessions of one event that haven't ended, in time order. */
export function liveSessionsOf(events: BAEvent[], eventId: string, now = new Date()): SessionPick[] {
  return publishedSessions(events, now).filter((s) => s.event.id === eventId && s.state !== "ended");
}
