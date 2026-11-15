"use client";

import React, { useDeferredValue, useMemo, useState } from "react";
import { Download, Loader2, Search, ShieldCheck, Trash2 } from "lucide-react";
import { useAdminData } from "@/components/admin/AdminData";
import { PageHeader } from "@/components/admin/PageHeader";
import { DecryptCSVModal } from "@/components/admin/DecryptCSVModal";
import { Modal } from "@/components/ui/Modal";
import { SelectField } from "@/components/ui/Field";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { btn, card, input } from "@/components/ui/styles";
import { api } from "@/lib/client/api";
import { formatDateTime, formatSection, formatStudentId, plural } from "@/lib/format";
import { cn } from "@/lib/utils";

const PAGE = 50;

export function RecordsScreen() {
  const { scans, events, loaded, refreshScans } = useAdminData();
  const [q, setQ] = useState("");
  const [eventId, setEventId] = useState("all");
  const [status, setStatus] = useState("all");
  const [action, setAction] = useState("all");
  const [shown, setShown] = useState(PAGE);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [decryptOpen, setDecryptOpen] = useState(false);
  const query = useDeferredValue(q.trim().toLowerCase());

  const filtered = useMemo(
    () =>
      scans.filter(
        (r) =>
          (eventId === "all" || r.eventId === eventId) &&
          (status === "all" || r.status === status) &&
          (action === "all" || r.action === action) &&
          (!query || r.studentName.toLowerCase().includes(query) || r.studentIdNumber.toLowerCase().includes(query) || r.section.toLowerCase().includes(query))
      ),
    [scans, eventId, status, action, query]
  );

  // Deleted events keep their records, so they stay filterable under their saved title.
  const eventOptions = useMemo(() => {
    const options = events.map((e) => ({ id: e.id, title: e.title }));
    const known = new Set(options.map((o) => o.id));
    for (const s of scans) {
      if (known.has(s.eventId)) continue;
      known.add(s.eventId);
      options.push({ id: s.eventId, title: `${s.eventTitle} (deleted)` });
    }
    return options;
  }, [events, scans]);

  const hasFilters = q || eventId !== "all" || status !== "all" || action !== "all";
  const reset = () => {
    setQ("");
    setEventId("all");
    setStatus("all");
    setAction("all");
  };

  const uniqueStudentsCount = useMemo(() => new Set(scans.map((s) => s.studentIdNumber)).size, [scans]);
  const filteredStudentsCount = useMemo(() => new Set(filtered.map((s) => s.studentIdNumber)).size, [filtered]);

  const exportParams = new URLSearchParams({
    ...(eventId !== "all" && { eventId }),
    ...(q.trim() && { q: q.trim() }),
    encrypted: "true",
  });
  const exportEncryptedHref = `/api/reports/export?${exportParams.toString()}`;

  const clearAll = async () => {
    setClearing(true);
    try {
      await api("/api/attendance/records", { method: "DELETE" });
      await refreshScans();
      setConfirmClear(false);
    } finally {
      setClearing(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Attendance records"
        description={
          loaded
            ? `${plural(scans.length, "door scan")} (${plural(uniqueStudentsCount, "student")}) recorded across ${plural(new Set(scans.map((s) => s.eventId)).size, "event")}.`
            : "Loading records…"
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {scans.length > 0 && (
              <button type="button" onClick={() => setConfirmClear(true)} className={btn.danger}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Clear all
              </button>
            )}

            <button
              type="button"
              onClick={() => setDecryptOpen(true)}
              className={btn.secondary}
              title="Upload and decrypt an encrypted attendance CSV file"
            >
              <ShieldCheck className="h-4 w-4 text-brand-ink" aria-hidden="true" />
              Decrypt CSV
            </button>

            <a
              href={exportEncryptedHref}
              download
              className={btn.primary}
              title="Download encrypted attendance roll (consolidates time-in & time-out per student)"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Export CSV
            </a>
          </div>
        }
      />

      <section className={cn(card, "animate-rise")} style={{ "--i": 1 } as React.CSSProperties} aria-label="Attendance records">
        <div className="grid gap-3 border-b border-line p-5 sm:grid-cols-2 sm:p-6 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))] lg:items-end">
          <div className="sm:col-span-2 lg:col-span-1">
            <label htmlFor="rec-q" className="mb-1.5 block text-sm font-medium">
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input id="rec-q" type="search" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} placeholder="Name, ID number or section" className={cn(input, "pl-9")} />
            </div>
          </div>
          <SelectField label="Event" value={eventId} onChange={(e) => { setEventId(e.target.value); setShown(PAGE); }}>
            <option value="all">All events</option>
            {eventOptions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </SelectField>
          <SelectField label="Scan" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="all">Time-ins and outs</option>
            <option value="time_in">Time-ins</option>
            <option value="time_out">Time-outs</option>
          </SelectField>
          <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Any status</option>
            <option value="on_time">On time</option>
            <option value="late">Late</option>
            <option value="checked_out">Timed out</option>
            <option value="left_early">Left early</option>
          </SelectField>
        </div>

        <div className="flex items-center justify-between px-5 py-3 text-sm text-ink-soft sm:px-6" aria-live="polite">
          <span className="figures">
            Showing {Math.min(shown, filtered.length)} of {plural(filtered.length, "door scan")} ({plural(filteredStudentsCount, "student")})
          </span>
          {hasFilters && (
            <button type="button" onClick={reset} className="font-semibold text-brand-ink hover:underline">
              Clear filters
            </button>
          )}
        </div>

        {!loaded ? (
          <div className="mx-6 mb-6 h-48 animate-pulse rounded-lg bg-paper" />
        ) : filtered.length === 0 ? (
          <p className="border-t border-line px-6 py-12 text-center text-sm text-ink-soft">
            {scans.length === 0 ? "No scans recorded yet. Records appear here as soon as students are scanned at the door." : "No records match these filters."}
          </p>
        ) : (
          <>
            {/* Phone: one row per scan */}
            <ul className="border-t border-line md:hidden">
              {filtered.slice(0, shown).map((r) => (
                <li key={r.id} className="border-b border-line px-5 py-4 last:border-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{r.studentName}</p>
                      <p className="figures text-xs text-muted">
                        {formatStudentId(r.studentIdNumber)} · {formatSection(r.section)}
                      </p>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="figures mt-1.5 text-sm text-ink-soft">
                    {r.action === "time_in" ? "Time-in" : "Time-out"} · {formatDateTime(r.timestamp)}
                  </p>
                  <p className="truncate text-xs text-muted">{r.eventTitle}</p>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-x-auto border-t border-line md:block">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Attendance scans</caption>
                <thead className="bg-paper/70 text-xs uppercase tracking-wide text-muted">
                  <tr className="border-b border-line">
                    <th scope="col" className="px-6 py-3 font-medium">Student</th>
                    <th scope="col" className="px-3 py-3 font-medium">Section</th>
                    <th scope="col" className="px-3 py-3 font-medium">Event · session</th>
                    <th scope="col" className="px-3 py-3 font-medium">Scan</th>
                    <th scope="col" className="px-3 py-3 font-medium">Status</th>
                    <th scope="col" className="px-3 py-3 text-right font-medium">Time</th>
                    <th scope="col" className="px-6 py-3 font-medium">Recorded by</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, shown).map((r) => (
                    <tr key={r.id} className="border-b border-line last:border-0 hover:bg-brand-tint/60">
                      <td className="px-6 py-3">
                        <div className="font-semibold">{r.studentName}</div>
                        <div className="figures text-xs text-muted">{formatStudentId(r.studentIdNumber)}</div>
                      </td>
                      <td className="px-3 py-3 text-ink-soft">
                        <div>{formatSection(r.section)}</div>
                      </td>
                      <td className="max-w-[18rem] px-3 py-3">
                        <div className="truncate">{r.eventTitle}</div>
                        <div className="truncate text-xs text-muted">{r.sessionTitle}</div>
                      </td>
                      <td className="px-3 py-3">{r.action === "time_in" ? "Time-in" : "Time-out"}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge status={r.status} />
                          {r.correction && <span className="text-xs text-brand-ink">Corrected: {r.correction.status.replace("_", " ")}</span>}
                        </div>
                      </td>
                      <td className="figures whitespace-nowrap px-3 py-3 text-right text-ink-soft">{formatDateTime(r.timestamp)}</td>
                      <td className="px-6 py-3 text-ink-soft">
                        <div>{r.officer}</div>
                        <div className="text-xs text-muted">{r.method === "manual" ? "Manual entry" : "QR scan"}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {shown < filtered.length && (
              <div className="border-t border-line p-4 text-center">
                <button type="button" onClick={() => setShown((n) => n + PAGE)} className={btn.small}>
                  Show {Math.min(PAGE, filtered.length - shown)} more
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        size="sm"
        title="Clear all attendance records?"
        description={`This permanently deletes ${plural(scans.length, "scan")} for every event. Export a CSV first if you need a copy. The action is recorded in the audit log.`}
      >
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => setConfirmClear(false)} className={btn.secondary}>
            Keep records
          </button>
          <button type="button" onClick={clearAll} disabled={clearing} className={btn.dangerSolid}>
            {clearing && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Delete {plural(scans.length, "scan")}
          </button>
        </div>
      </Modal>

      <DecryptCSVModal open={decryptOpen} onClose={() => setDecryptOpen(false)} />
    </>
  );
}
