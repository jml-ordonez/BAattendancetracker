"use client";

import React, { useMemo } from "react";
import { SelectField } from "@/components/ui/Field";
import { publishedSessions, type SessionPick } from "@/lib/attendance/schedule";
import { formatDay, formatTime } from "@/lib/format";
import type { BAEvent } from "@/types/events";
import type { AttendanceScan } from "@/types/attendance";

const STATE_LABEL = { open: "open now", upcoming: "upcoming", ended: "ended" } as const;

/** Picks a session of a published event; options are grouped by event and say whether each is open. */
export function SessionSelect({
  events,
  scans,
  value,
  onChange,
  label = "Session",
}: {
  events: BAEvent[];
  scans?: AttendanceScan[];
  value?: string;
  onChange: (pick: SessionPick) => void;
  label?: string;
}) {
  const sessions = useMemo(() => publishedSessions(events), [events]);
  const scanCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (!scans) return counts;
    for (const s of scans) {
      counts.set(s.sessionId, (counts.get(s.sessionId) ?? 0) + 1);
    }
    return counts;
  }, [scans]);

  const byEvent = useMemo(() => {
    const groups = new Map<string, SessionPick[]>();
    for (const s of sessions) groups.set(s.event.id, [...(groups.get(s.event.id) ?? []), s]);
    return [...groups.values()];
  }, [sessions]);

  if (sessions.length === 0) {
    return (
      <SelectField label={label} disabled value="">
        <option value="">No published sessions</option>
      </SelectField>
    );
  }

  return (
    <SelectField
      label={label}
      value={value ?? ""}
      onChange={(e) => {
        const pick = sessions.find((s) => s.session.id === e.target.value);
        if (pick) onChange(pick);
      }}
    >
      {byEvent.map((group) => (
        <optgroup key={group[0].event.id} label={group[0].event.title}>
          {group.map(({ session, state }) => {
            const count = scanCounts.get(session.id) ?? 0;
            const countText = count > 0 ? ` · ${count} scan${count === 1 ? "" : "s"}` : "";
            return (
              <option key={session.id} value={session.id}>
                {session.title} · {formatDay(session.time_in_start)}, {formatTime(session.time_in_start)} ({STATE_LABEL[state]}{countText})
              </option>
            );
          })}
        </optgroup>
      ))}
    </SelectField>
  );
}
