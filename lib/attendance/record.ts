import type { ScanVerificationResult } from "@/types/qr";
import type { AttendanceScan, ScanAction } from "@/types/attendance";
import { evaluateAttendance } from "@/lib/rules/attendance-rules";
import type { SessionMatch } from "@/lib/events/store";
import { addScan, consumeToken, findStudentScans, ScanConflictError } from "@/lib/attendance/store";

/** How early before the time-in window a student may time in. */
export const CHECK_IN_OPENS_EARLY_MINS = 60;

const TIME_ZONE = process.env.APP_TIMEZONE || "Asia/Manila";

/** Server-side clock text for messages, in the department's time zone (not the server's). */
export function clockTime(iso: string | Date): string {
  return new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: TIME_ZONE }).format(
    new Date(iso)
  );
}

function clockDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  }).format(new Date(iso));
}

export interface ScanStudent {
  name: string;
  idNumber: string;
  majorCode: string;
  section: string;
}

export interface RecordAttendanceInput {
  student: ScanStudent;
  eventId: string;
  sessionId: string;
  /** The event and session, looked up by the caller (`findSession`); null when they no longer exist. */
  found: SessionMatch | null;
  /** What the scanner is set to record. Staff choose it; the pass doesn't decide. */
  purpose: ScanAction;
  officer: string;
  method: "qr" | "manual";
  /** Present for QR scans: enforces single use. */
  token?: { id: string; expiresAt: number };
  now?: Date;
}

export type RecordAttendanceResult = ScanVerificationResult & { scan?: AttendanceScan };

function fail(status: ScanVerificationResult["status"], message: string, student?: ScanStudent): RecordAttendanceResult {
  return {
    success: false,
    status,
    message,
    timestamp: new Date().toISOString(),
    details: student ? { studentName: student.name, studentIdNumber: student.idNumber } : undefined,
  };
}

/**
 * The single attendance pipeline for QR scans and manual entries: checks the
 * session is open, rejects reused tokens and duplicate scans, classifies the
 * scan (on time / late, timed out / left early) from the session's schedule
 * and grace period, and records it.
 *
 * The checks below read the student's existing scans first so the message can
 * say what happened. They are not what keeps duplicates out: two scans of the
 * same pass can pass the checks together, so the store's unique constraint
 * decides, and the loser is answered as a duplicate (see `save`).
 */
export async function recordAttendance(input: RecordAttendanceInput): Promise<RecordAttendanceResult> {
  const { student, officer, method } = input;
  const now = input.now ?? new Date();
  const { timeIn, timeOut } = await findStudentScans(student.idNumber, input.sessionId);

  const { purpose } = input;

  const { found } = input;
  if (!found || found.event.id !== input.eventId || found.session.id !== input.sessionId) return fail("SESSION_NOT_FOUND", "This event session no longer exists.", student);
  const { event, session } = found;

  if (event.status !== "published") {
    return fail("WINDOW_CLOSED", "This event is not published, so attendance is closed.", student);
  }

  const opensAt = new Date(new Date(session.time_in_start).getTime() - CHECK_IN_OPENS_EARLY_MINS * 60000);
  const endsAt = new Date(session.time_out_end);

  if (purpose === "time_in") {
    if (now < opensAt) {
      return fail("WINDOW_CLOSED", `Time-in opens at ${clockDateTime(opensAt.toISOString())}.`, student);
    }
    if (now > endsAt) {
      return fail("WINDOW_CLOSED", `This session ended at ${clockTime(endsAt)}. Time-in is closed.`, student);
    }
  }

  if (purpose === "time_in" && timeIn) {
    return fail(
      "DUPLICATE_SCAN",
      `${student.name} already timed in at ${clockTime(timeIn.timestamp)}.${timeOut ? "" : " If they are leaving, switch the scanner to Time-out."}`,
      student
    );
  }
  if (purpose === "time_out") {
    if (!timeIn) {
      return fail("STUDENT_INELIGIBLE", "No time-in on record for this session, so there is nothing to time out. Switch the scanner to Time-in to check them in first.", student);
    }
    if (timeOut) {
      return fail("DUPLICATE_SCAN", `${student.name} already timed out at ${clockTime(timeOut.timestamp)}.`, student);
    }
  }

  if (input.token && !consumeToken(input.token.id, input.token.expiresAt)) {
    return fail("DUPLICATE_TOKEN_USE", "This code was already used. Ask the student to show the new code on their screen.", student);
  }

  const schedule = {
    timeInStart: new Date(session.time_in_start),
    timeInEnd: new Date(session.time_in_end),
    timeOutStart: new Date(session.time_out_start),
    timeOutEnd: new Date(session.time_out_end),
    gracePeriodMins: session.grace_period_mins,
  };

  const common = {
    studentName: student.name,
    studentIdNumber: student.idNumber,
    majorCode: student.majorCode,
    section: student.section,
    eventId: event.id,
    eventTitle: event.title,
    sessionId: session.id,
    sessionTitle: session.title,
    method,
    officer,
    timestamp: now.toISOString(),
  };

  /** Saves the scan; a student who already has it (a simultaneous scan got in first) gets the duplicate answer. */
  const save = async (scan: Omit<AttendanceScan, "id">, action: string): Promise<AttendanceScan | RecordAttendanceResult> => {
    try {
      return await addScan(scan);
    } catch (error) {
      if (!(error instanceof ScanConflictError)) throw error;
      return fail("DUPLICATE_SCAN", `${student.name} was just ${action} by another scan. Refresh the records to see it.`, student);
    }
  };

  if (purpose === "time_in") {
    const result = evaluateAttendance(now, null, schedule);
    const saved = await save({ ...common, action: "time_in", status: result.isLate ? "late" : "on_time" }, "timed in");
    if (!("id" in saved)) return saved;
    const scan = saved;
    return {
      success: true,
      status: result.isLate ? "SUCCESS_LATE" : "SUCCESS_ON_TIME",
      message: result.isLate
        ? `Timed in late. The grace period ended at ${clockTime(new Date(schedule.timeInStart.getTime() + session.grace_period_mins * 60000))}.`
        : "Timed in on time.",
      timestamp: scan.timestamp,
      details: {
        studentName: student.name,
        studentIdNumber: student.idNumber,
        eventTitle: event.title,
        sessionTitle: session.title,
        action: "time_in",
        timeIn: scan.timestamp,
        isLate: result.isLate,
      },
      scan,
    };
  }

  const result = evaluateAttendance(new Date(timeIn!.timestamp), now, schedule);
  const saved = await save(
    {
      ...common,
      // Keep the identity from the time-in scan so a manual time-out can't rename the student.
      studentName: timeIn!.studentName,
      majorCode: timeIn!.majorCode,
      section: timeIn!.section,
      action: "time_out",
      status: result.isEarlyDeparture ? "left_early" : "checked_out",
      durationMinutes: result.durationMinutes,
    },
    "timed out"
  );
  if (!("id" in saved)) return saved;
  const scan = saved;
  return {
    success: true,
    status: result.isEarlyDeparture ? "SUCCESS_CHECKOUT_EARLY" : "SUCCESS_CHECKOUT",
    message: result.isEarlyDeparture
      ? `Timed out before ${clockTime(schedule.timeOutStart)}: recorded as left early.`
      : "Timed out.",
    timestamp: scan.timestamp,
    details: {
      studentName: timeIn!.studentName,
      studentIdNumber: student.idNumber,
      eventTitle: event.title,
      sessionTitle: session.title,
      action: "time_out",
      timeIn: timeIn!.timestamp,
      timeOut: scan.timestamp,
      durationMinutes: result.durationMinutes,
      isEarlyDeparture: result.isEarlyDeparture,
    },
    scan,
  };
}
