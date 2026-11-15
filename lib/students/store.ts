import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Registered students.
 *
 * Stored in Supabase (`students`) when it is configured; the registration form
 * used to keep everything in the browser, so nothing ever reached the database.
 * Without Supabase (tests, offline demos) an in-memory map is used.
 */

export class StudentStoreError extends Error {
  constructor(
    message: string,
    public status = 500
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
}

const g = globalThis as unknown as { __ba_students?: Map<string, StudentRecord> };

function memory(): Map<string, StudentRecord> {
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

/** Turns a Supabase error into one a person can act on; the details go to the server log. */
function dbError(error: { code?: string; message: string }): StudentStoreError {
  // Spelled out: Supabase error objects print as {} in the Next.js log.
  console.error(`[students] couldn't save the registration: ${error.code ?? "?"} ${error.message}`);
  // 23505: the email already belongs to another student ID (the ID itself is upserted).
  if (error.code === "23505") {
    return new StudentStoreError("That email is already registered under a different student ID.", 409);
  }
  // 23503: the event was deleted between the check and the write.
  if (error.code === "23503") {
    return new StudentStoreError("This event is no longer open for attendance. Choose another.", 404);
  }
  // 42P01 / PGRST205: the students table hasn't been created yet.
  if (error.code === "42P01" || error.code === "PGRST205") {
    return new StudentStoreError(
      "The database needs the students update. Run supabase/migrations/20261115_000003_students.sql in the Supabase SQL editor, then try again."
    );
  }
  return new StudentStoreError("Couldn't save your registration. Try again in a moment.");
}

/** Creates the student, or updates their details when the ID number is already registered. */
export async function saveStudent(input: StudentInput): Promise<StudentRecord> {
  if (!supabaseConfigured()) {
    // Memory is for tests and offline demos only. In production it would report success
    // for a registration that disappears on the next restart, so fail instead.
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[students] Supabase isn't configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the deployment's environment variables."
      );
      throw new StudentStoreError("Registration is unavailable right now because the database isn't connected. Tell the department.", 503);
    }
    const map = memory();
    const now = new Date().toISOString();
    const existing = map.get(input.studentIdNumber);
    const emailTaken = [...map.values()].some((s) => s.email === input.email && s.studentIdNumber !== input.studentIdNumber);
    if (emailTaken) throw new StudentStoreError("That email is already registered under a different student ID.", 409);
    const record: StudentRecord = {
      ...input,
      id: existing?.id ?? crypto.randomUUID(),
      registeredAt: existing?.registeredAt ?? now,
      updatedAt: now,
    };
    map.set(input.studentIdNumber, record);
    return record;
  }

  const { data, error } = await createAdminClient()
    .from("students")
    .upsert(
      {
        student_id_number: input.studentIdNumber,
        first_name: input.firstName,
        last_name: input.lastName,
        email: input.email,
        major_code: input.majorCode,
        year_level: input.yearLevel,
        section: input.section,
        event_id: input.eventId,
      },
      { onConflict: "student_id_number" }
    )
    .select()
    .single();
  if (error) throw dbError(error);
  return fromRow(data as StudentRow);
}
