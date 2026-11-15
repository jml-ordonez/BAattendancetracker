import { createAdminClient } from "@/lib/supabase/admin";
import type { AttendanceScan, ScanAction, ScanCorrection } from "@/types/attendance";

/**
 * Live attendance store shared by the scanner, manual entry, the dashboard and
 * reports.
 *
 * Stored in Supabase (`door_scans`) when it is configured. The old store kept
 * scans in server memory and a local JSON file: on a serverless host every
 * instance had its own copy and the file couldn't be written, so cleared
 * records (and the sample students) came back and scans saved on one instance
 * never showed on another. Without Supabase (tests, local demos) a plain
 * in-memory list is used; it starts empty, with no sample data.
 */

export class ScanStoreError extends Error {
  constructor(
    message: string,
    public status = 500
  ) {
    super(message);
  }
}

/** The student already has this scan (time-in or time-out) for the session. */
export class ScanConflictError extends Error {}

/** A student's time-in and time-out for one session. */
export interface SessionScans {
  timeIn?: AttendanceScan;
  timeOut?: AttendanceScan;
}

interface ScanRow {
  id: string;
  student_id_number: string;
  student_name: string;
  major_code: string;
  section: string;
  event_id: string;
  event_title: string;
  session_id: string;
  session_title: string;
  action: ScanAction;
  status: AttendanceScan["status"];
  method: AttendanceScan["method"];
  officer: string;
  scanned_at: string;
  duration_minutes: number | null;
  correction: ScanCorrection | null;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** PostgREST returns at most 1000 rows per request, so reads page through the table. */
const PAGE_SIZE = 1000;
/** A safety stop for a runaway table; far above a department's attendance. */
const MAX_ROWS = 20000;

const g = globalThis as unknown as {
  __ba_scans?: AttendanceScan[];
  /** Consumed QR token ids → expiry (unix seconds), for single-use enforcement. */
  __ba_tokens?: Map<string, number>;
};

function supabaseConfigured(): boolean {
  return (
    !!(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL) &&
    !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)
  );
}

/**
 * True when scans go to Supabase. Memory is for tests and offline demos only: in
 * production it would report success for scans that vanish on the next restart,
 * so a missing configuration is an error there.
 */
function usesSupabase(): boolean {
  if (supabaseConfigured()) return true;
  if (process.env.NODE_ENV === "production") {
    console.error(
      "[attendance] Supabase isn't configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the deployment's environment variables."
    );
    throw new ScanStoreError("Attendance can't be saved right now because the database isn't connected. Tell the department.", 503);
  }
  return false;
}

function memory(): AttendanceScan[] {
  return (g.__ba_scans ??= []);
}

function fromRow(row: ScanRow): AttendanceScan {
  return {
    id: row.id,
    studentName: row.student_name,
    studentIdNumber: row.student_id_number,
    majorCode: row.major_code,
    section: row.section,
    eventId: row.event_id,
    eventTitle: row.event_title,
    sessionId: row.session_id,
    sessionTitle: row.session_title,
    action: row.action,
    status: row.status,
    method: row.method,
    officer: row.officer,
    timestamp: new Date(row.scanned_at).toISOString(),
    ...(row.duration_minutes !== null ? { durationMinutes: row.duration_minutes } : {}),
    ...(row.correction ? { correction: row.correction } : {}),
  };
}

/** Turns a Supabase error into one a person can act on; the details go to the server log. */
function dbError(action: string, error: { code?: string; message: string }): ScanStoreError {
  // Spelled out: Supabase error objects print as {} in the Next.js log.
  console.error(`[attendance] couldn't ${action}: ${error.code ?? "?"} ${error.message}`);
  // 42P01 / PGRST205: the door_scans table hasn't been created yet.
  if (error.code === "42P01" || error.code === "PGRST205") {
    return new ScanStoreError(
      "The database needs the attendance update. Run supabase/migrations/20261115_000004_door_scans.sql in the Supabase SQL editor, then try again.",
      503
    );
  }
  return new ScanStoreError(`Couldn't ${action}. Try again in a moment.`, 503);
}

/* ----------------------------------------------------------------- reads */

/** Every scan, newest first. */
export async function listScans(): Promise<AttendanceScan[]> {
  if (!usesSupabase()) return [...memory()];
  const sb = createAdminClient();
  const scans: AttendanceScan[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await sb
      .from("door_scans")
      .select("*")
      .order("scanned_at", { ascending: false })
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw dbError("load the attendance records", error);
    scans.push(...(data as ScanRow[]).map(fromRow));
    if (data.length < PAGE_SIZE) break;
  }
  return scans;
}

/** One student's time-in and time-out for a session, read together. */
export async function findStudentScans(studentIdNumber: string, sessionId: string): Promise<SessionScans> {
  let rows: AttendanceScan[];
  if (!usesSupabase()) {
    rows = memory().filter((s) => s.studentIdNumber === studentIdNumber && s.sessionId === sessionId);
  } else {
    if (!GUID.test(sessionId)) return {};
    const { data, error } = await createAdminClient()
      .from("door_scans")
      .select("*")
      .eq("student_id_number", studentIdNumber)
      .eq("session_id", sessionId);
    if (error) throw dbError("check the student's attendance", error);
    rows = (data as ScanRow[]).map(fromRow);
  }
  return { timeIn: rows.find((s) => s.action === "time_in"), timeOut: rows.find((s) => s.action === "time_out") };
}

export async function getScan(id: string): Promise<AttendanceScan | undefined> {
  if (!usesSupabase()) return memory().find((s) => s.id === id);
  if (!GUID.test(id)) return undefined;
  const { data, error } = await createAdminClient().from("door_scans").select("*").eq("id", id).maybeSingle();
  if (error) throw dbError("load the attendance record", error);
  return data ? fromRow(data as ScanRow) : undefined;
}

/* ---------------------------------------------------------------- writes */

/**
 * Records a scan. Throws `ScanConflictError` when the student already has this
 * scan for the session: the database enforces it, so two scans arriving at the
 * same moment can't both get through.
 */
export async function addScan(scan: Omit<AttendanceScan, "id">): Promise<AttendanceScan> {
  if (!usesSupabase()) {
    const list = memory();
    if (list.some((s) => s.studentIdNumber === scan.studentIdNumber && s.sessionId === scan.sessionId && s.action === scan.action)) {
      throw new ScanConflictError();
    }
    const record: AttendanceScan = { ...scan, id: `scan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
    list.unshift(record);
    return record;
  }
  const { data, error } = await createAdminClient()
    .from("door_scans")
    .insert({
      student_id_number: scan.studentIdNumber,
      student_name: scan.studentName,
      major_code: scan.majorCode,
      section: scan.section,
      event_id: scan.eventId,
      event_title: scan.eventTitle,
      session_id: scan.sessionId,
      session_title: scan.sessionTitle,
      action: scan.action,
      status: scan.status,
      method: scan.method,
      officer: scan.officer,
      scanned_at: scan.timestamp,
      duration_minutes: scan.durationMinutes ?? null,
      correction: scan.correction ?? null,
    })
    .select()
    .single();
  if (error?.code === "23505") throw new ScanConflictError();
  if (error) throw dbError("save the scan", error);
  return fromRow(data as ScanRow);
}

/** Sets the coordinator's correction on a scan. Undefined when the scan no longer exists. */
export async function correctScan(id: string, correction: ScanCorrection): Promise<AttendanceScan | undefined> {
  if (!usesSupabase()) {
    const scan = memory().find((s) => s.id === id);
    if (scan) scan.correction = correction;
    return scan;
  }
  if (!GUID.test(id)) return undefined;
  const { data, error } = await createAdminClient().from("door_scans").update({ correction }).eq("id", id).select().maybeSingle();
  if (error) throw dbError("save the correction", error);
  return data ? fromRow(data as ScanRow) : undefined;
}

/** Deletes every scan and returns how many there were. */
export async function clearScans(): Promise<number> {
  if (!usesSupabase()) {
    const count = memory().length;
    g.__ba_scans = [];
    g.__ba_tokens = new Map();
    return count;
  }
  // PostgREST refuses a delete with no filter; every row has an id.
  const { count, error } = await createAdminClient().from("door_scans").delete({ count: "exact" }).not("id", "is", null);
  if (error) throw dbError("clear the attendance records", error);
  return count ?? 0;
}

/**
 * Marks a QR token as used. Returns false when it was already used.
 * In memory only: passes are not single-use (the unique constraint on
 * `door_scans` stops a second time-in or time-out), so no route calls this.
 */
export function consumeToken(tokenId: string, expiresAt: number): boolean {
  const tokens = (g.__ba_tokens ??= new Map());
  if (tokens.has(tokenId)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (tokens.size > 500) {
    for (const [id, exp] of tokens) if (exp < now) tokens.delete(id);
  }
  tokens.set(tokenId, expiresAt);
  return true;
}
