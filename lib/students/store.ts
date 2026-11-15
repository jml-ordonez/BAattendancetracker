import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Registered students.
 *
 * Stored in Supabase (`students`) when it is configured; the registration form
 * used to keep everything in the browser, so nothing ever reached the database.
 * Without Supabase (tests, offline demos) an in-memory map is used.
 *
 * Students have no accounts, so a student ID is protected by an edit key instead:
 * the first registration hands the device a random key (only its SHA-256 hash is
 * stored). Every save states what it is doing (see `SaveMode`), so a second
 * registration of an ID is refused instead of quietly replacing or re-issuing it.
 */

/**
 * What the caller is doing.
 * - "register": a new registration. Refused when the student ID already exists, whoever asks.
 * - "update": the device that registered is editing its details; needs its edit key.
 * - "restore": the same student on a new phone or after clearing the browser; needs the
 *   name and email on file, and replaces the edit key. Offered only after "register" was refused.
 */
export type SaveMode = "register" | "update" | "restore";

export class StudentStoreError extends Error {
  constructor(
    message: string,
    public status = 500,
    /** Messages to show beside the form fields that caused the error. */
    public fieldErrors?: Record<string, string>,
    /** Set when the student ID is taken but the name and email match, so the person may restore their own registration. */
    public canRestore = false
  ) {
    super(message);
  }
}

export interface StudentInput {
  studentIdNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  majorCode: string;
  yearLevel: string;
  section: string;
  eventId: string;
}

export interface StudentRecord extends StudentInput {
  id: string;
  registeredAt: string;
  updatedAt: string;
}

export interface SaveStudentResult {
  student: StudentRecord;
  /** A new edit key for the registering device. Absent when the device's own key was accepted. */
  editToken?: string;
}

interface StudentRow {
  id: string;
  student_id_number: string;
  first_name: string;
  last_name: string;
  email: string;
  major_code: string;
  year_level: string;
  section: string;
  event_id: string | null;
  registered_at: string;
  updated_at: string;
  edit_token_hash: string | null;
}

type StoredStudent = StudentRecord & { editTokenHash?: string | null };

const ID_TAKEN = "This student ID is already registered to another student. Check the number on your university ID. If it is yours, ask the department to help.";
const EMAIL_TAKEN = "That email is already registered under a different student ID. Use your own university email.";

const ID_REGISTERED = "This student ID is already registered.";

const idTakenError = (canRestore = false) =>
  canRestore
    ? new StudentStoreError(ID_REGISTERED, 409, { studentIdNumber: ID_REGISTERED }, true)
    : new StudentStoreError(ID_TAKEN, 409, { studentIdNumber: ID_TAKEN });
const emailTakenError = () => new StudentStoreError(EMAIL_TAKEN, 409, { email: EMAIL_TAKEN });

const g = globalThis as unknown as { __ba_students?: Map<string, StoredStudent> };

function memory(): Map<string, StoredStudent> {
  return (g.__ba_students ??= new Map());
}

function supabaseConfigured(): boolean {
  return (
    !!(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL) &&
    !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)
  );
}

function fromRow(row: StudentRow): StudentRecord {
  return {
    id: row.id,
    studentIdNumber: row.student_id_number,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    majorCode: row.major_code,
    yearLevel: row.year_level,
    section: row.section,
    eventId: row.event_id ?? "",
    registeredAt: row.registered_at,
    updatedAt: row.updated_at,
  };
}

/* ------------------------------------------------------------ edit keys */

const newToken = () => randomBytes(32).toString("base64url");
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function tokenMatches(presented: string | undefined, hash: string | null | undefined): boolean {
  if (!presented || !hash) return false;
  const a = Buffer.from(hashToken(presented));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Names and emails compared without regard to case or spacing: "  juan  DELA cruz " is "Juan Dela Cruz". */
const same = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

type Decision = { kind: "create" } | { kind: "update"; rotate: boolean } | { kind: "taken"; canRestore: boolean };

/**
 * Who may write to this student ID.
 * - Nobody has it yet: create it.
 * - "update" with this ID's edit key: update it (a typo fix, a new section or event).
 * - "restore" with the same name and email as on file: update it and give this device a fresh
 *   key. Nothing about the person changes, and the old phone's key stops working.
 * - Everything else, including every "register": refuse. `canRestore` tells the form whether
 *   to offer "restore" (only when the name and email already match).
 */
function decide(existing: StoredStudent | null, input: StudentInput, presented: string | undefined, mode: SaveMode): Decision {
  if (!existing) return { kind: "create" };
  if (mode === "update" && tokenMatches(presented, existing.editTokenHash)) return { kind: "update", rotate: false };
  const sameIdentity = same(existing.firstName, input.firstName) && same(existing.lastName, input.lastName) && same(existing.email, input.email);
  if (mode === "restore" && sameIdentity) return { kind: "update", rotate: true };
  return { kind: "taken", canRestore: sameIdentity };
}

/** Turns a Supabase error into one a person can act on; the details go to the server log. */
function dbError(error: { code?: string; message: string }): StudentStoreError {
  // Spelled out: Supabase error objects print as {} in the Next.js log.
  console.error(`[students] couldn't save the registration: ${error.code ?? "?"} ${error.message}`);
  // 23505: a unique column is taken. The message names the constraint that was hit.
  if (error.code === "23505") return error.message.includes("student_id_number") ? idTakenError() : emailTakenError();
  // 23503: the event was deleted between the check and the write.
  if (error.code === "23503") {
    return new StudentStoreError("This event is no longer open for attendance. Choose another.", 404, {
      eventId: "This event is no longer open for attendance. Choose another.",
    });
  }
  // 42P01 / PGRST205: the students table hasn't been created yet. 42703 / PGRST204: a column hasn't (the edit key).
  if (error.code === "42P01" || error.code === "PGRST205" || error.code === "42703" || error.code === "PGRST204") {
    return new StudentStoreError(
      "The database needs the students update. Run the students migrations in supabase/migrations in the Supabase SQL editor, then try again."
    );
  }
  return new StudentStoreError("Couldn't save your registration. Try again in a moment.");
}

/**
 * Creates the student, or updates their details when the caller is allowed to
 * (see `decide`). `presentedToken` is the edit key this device was given earlier.
 */
export async function saveStudent(input: StudentInput, presentedToken?: string, mode: SaveMode = "register"): Promise<SaveStudentResult> {
  if (!supabaseConfigured()) {
    // Memory is for tests and offline demos only. In production it would report success
    // for a registration that disappears on the next restart, so fail instead.
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[students] Supabase isn't configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the deployment's environment variables."
      );
      throw new StudentStoreError("Registration is unavailable right now because the database isn't connected. Tell the department.", 503);
    }
    return saveInMemory(input, presentedToken, mode);
  }
  return saveInSupabase(input, presentedToken, mode, 0);
}

function saveInMemory(input: StudentInput, presentedToken: string | undefined, mode: SaveMode): SaveStudentResult {
  const map = memory();
  const existing = map.get(input.studentIdNumber) ?? null;
  const decision = decide(existing, input, presentedToken, mode);
  if (decision.kind === "taken") throw idTakenError(decision.canRestore);
  if ([...map.values()].some((s) => s.email === input.email && s.studentIdNumber !== input.studentIdNumber)) throw emailTakenError();

  const now = new Date().toISOString();
  const token = decision.kind === "create" || decision.rotate ? newToken() : undefined;
  const student: StudentRecord = {
    ...input,
    id: existing?.id ?? crypto.randomUUID(),
    registeredAt: existing?.registeredAt ?? now,
    updatedAt: now,
  };
  map.set(input.studentIdNumber, { ...student, editTokenHash: token ? hashToken(token) : existing?.editTokenHash });
  return { student, editToken: token };
}

async function saveInSupabase(input: StudentInput, presentedToken: string | undefined, mode: SaveMode, attempt: number): Promise<SaveStudentResult> {
  const sb = createAdminClient();
  const { data, error: readError } = await sb.from("students").select("*").eq("student_id_number", input.studentIdNumber).maybeSingle();
  if (readError) throw dbError(readError);
  const row = data as StudentRow | null;

  const decision = decide(
    row && { ...fromRow(row), editTokenHash: row.edit_token_hash },
    input,
    presentedToken,
    mode
  );
  if (decision.kind === "taken") throw idTakenError(decision.canRestore);

  const token = decision.kind === "create" || decision.rotate ? newToken() : undefined;
  const fields = {
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
    major_code: input.majorCode,
    year_level: input.yearLevel,
    section: input.section,
    event_id: input.eventId,
    ...(token ? { edit_token_hash: hashToken(token) } : {}),
  };

  if (!row) {
    const { data: created, error } = await sb.from("students").insert({ student_id_number: input.studentIdNumber, ...fields }).select().single();
    // Two people registered this ID at the same moment and the other got in first:
    // judge this one against the winner instead of failing blindly.
    if (error?.code === "23505" && error.message.includes("student_id_number") && attempt === 0) {
      return saveInSupabase(input, presentedToken, mode, attempt + 1);
    }
    if (error) throw dbError(error);
    return { student: fromRow(created as StudentRow), editToken: token };
  }

  const { data: updated, error } = await sb.from("students").update(fields).eq("student_id_number", input.studentIdNumber).select().single();
  if (error) throw dbError(error);
  return { student: fromRow(updated as StudentRow), editToken: token };
}
