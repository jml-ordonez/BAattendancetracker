import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { registrableEvents, registrationIsOpen, registrationOpensAt } from "@/lib/attendance/schedule";
import { EventStoreError, getEvent } from "@/lib/events/store";
import { formatLocalDateTime } from "@/lib/events/windows";
import { clientIp, jsonError, parseBody } from "@/lib/http";
import { saveStudent, StudentStoreError } from "@/lib/students/store";
import { deriveMajorFromSection, studentRegistrationSchema, yearLevelForSection } from "@/lib/validation";

/**
 * The registration form, plus what the device is doing (a new registration unless it says
 * otherwise) and the edit key it was given when it registered.
 */
const bodySchema = studentRegistrationSchema.extend({
  mode: z.enum(["register", "update", "restore"]).default("register"),
  editToken: z.string().trim().max(100).optional(),
});

/**
 * Generous on purpose: a whole class registers from one campus Wi-Fi address.
 * This only stops a script from flooding the table.
 */
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 120;

const g = globalThis as unknown as { __ba_register_hits?: Map<string, { count: number; resetAt: number }> };
const hits = (g.__ba_register_hits ??= new Map());

function rateLimited(ip: string): boolean {
  const now = Date.now();
  if (hits.size > 1000) for (const [key, hit] of hits) if (hit.resetAt <= now) hits.delete(key);
  const hit = hits.get(ip);
  if (!hit || hit.resetAt <= now) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  hit.count += 1;
  return hit.count > MAX_PER_WINDOW;
}

/**
 * Saves a student's registration. Public: students have no accounts, so the
 * body is checked again here and the program and year come from the section.
 */
export async function POST(request: NextRequest) {
  if (rateLimited(clientIp(request))) {
    return jsonError("Too many registrations from this connection. Wait a minute and try again.", 429);
  }

  const parsed = await parseBody(request, bodySchema);
  if ("response" in parsed) return parsed.response;
  const { firstName, lastName, studentIdNumber, email, section, eventId, editToken, mode } = parsed.data;

  try {
    const event = await getEvent(eventId);
    if (event?.status === "published" && !registrationIsOpen(event)) {
      const message = `Registration for this event opens on ${formatLocalDateTime(registrationOpensAt(event)!)}. Come back then to get your pass.`;
      return jsonError(message, 403, { fieldErrors: { eventId: message } });
    }
    if (!event || registrableEvents([event]).length === 0) {
      return jsonError("This event is no longer open for attendance. Choose another.", 404, {
        fieldErrors: { eventId: "This event is no longer open for attendance. Choose another." },
      });
    }

    const { student, editToken: issued } = await saveStudent(
      {
        studentIdNumber,
        firstName: firstName.replace(/\s+/g, " "),
        lastName: lastName.replace(/\s+/g, " "),
        email,
        majorCode: deriveMajorFromSection(section),
        yearLevel: yearLevelForSection(section)!,
        section,
        eventId,
      },
      editToken,
      mode
    );
    // The edit key is only returned when it is new; the device keeps the one it has otherwise.
    return NextResponse.json({ id: student.id, ...(issued ? { editToken: issued } : {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof StudentStoreError) {
      return jsonError(error.message, error.status, {
        ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
        ...(error.canRestore ? { canRestore: true } : {}),
      });
    }
    if (error instanceof EventStoreError) return jsonError(error.message, 500);
    throw error;
  }
}
