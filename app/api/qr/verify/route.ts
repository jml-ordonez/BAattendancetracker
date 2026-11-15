import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { validateTokenIntegrity } from "@/lib/tokens/qr-token";
import { recordAttendance } from "@/lib/attendance/record";
import { ScanStoreError } from "@/lib/attendance/store";
import { EventStoreError, findSession } from "@/lib/events/store";
import { logAudit } from "@/lib/audit/store";
import { clientIp, jsonError, parseBody, requireAdmin } from "@/lib/http";
import { purposeSchema } from "@/lib/validation";
import type { ScanVerificationResult } from "@/types/qr";

const schema = z.object({
  token: z.string().min(1).max(4000),
  eventId: z.string().min(1),
  sessionId: z.string().min(1),
  /** What the scanner is set to record. Staff choose Time-in or Time-out; the pass doesn't decide. */
  expectedPurpose: purposeSchema,
});

const REJECTIONS = {
  INVALID_TOKEN: ["TOKEN_TAMPERED", "This is not a valid attendance pass."],
  TOKEN_EXPIRED: ["TOKEN_EXPIRED", "This pass has expired. Ask the student to reopen their pass to get a new code."],
  PURPOSE_MISMATCH: ["TOKEN_INVALID", "Wrong pass type for this scanner. Ask the student to switch their pass to match."],
  EVENT_MISMATCH: ["TOKEN_INVALID", "This pass is for a different event."],
  SESSION_MISMATCH: ["TOKEN_INVALID", "This pass is for a different session of this event."],
} as const;

/** Says which event or session the pass is for and where staff change the scanner's, instead of a bare "different event". */
async function mismatchMessage(
  code: "EVENT_MISMATCH" | "SESSION_MISMATCH",
  pass: { eid: string; ssid: string },
  eventId: string,
  sessionId: string
): Promise<string> {
  const [passFound, scannerFound] = await Promise.all([findSession(pass.eid, pass.ssid), findSession(eventId, sessionId)]);
  const where = scannerFound ? `“${scannerFound.event.title}”${code === "SESSION_MISMATCH" ? ` (${scannerFound.session.title})` : ""}` : "another session";
  if (!passFound) {
    return `This pass is for an event or session that no longer exists. Ask the student to open their pass and choose ${where}.`;
  }
  const passFor = code === "EVENT_MISMATCH" ? `“${passFound.event.title}”` : `“${passFound.event.title}” (${passFound.session.title})`;
  return `This pass is for ${passFor}, but the scanner is set to ${where}. Change the session at the top of this page, or ask the student to choose the right event.`;
}

export async function POST(request: NextRequest) {
  const admin = requireAdmin(request);
  if (admin instanceof NextResponse) return admin;

  const parsed = await parseBody(request, schema);
  if ("response" in parsed) return parsed.response;
  const { token, eventId, sessionId, expectedPurpose } = parsed.data;
  const ip = clientIp(request);

  // Decrypt, check the HMAC, expiry, event and session in one place.
  const check = validateTokenIntegrity(token, undefined, eventId, sessionId);
  const p = check.payload;

  let result: ScanVerificationResult;
  try {
    if (!check.valid || !p) {
      const code = check.errorCode ?? "INVALID_TOKEN";
      const [status, fallback] = REJECTIONS[code];
      result = {
        success: false,
        status,
        message: p && (code === "EVENT_MISMATCH" || code === "SESSION_MISMATCH") ? await mismatchMessage(code, p, eventId, sessionId) : fallback,
        timestamp: new Date().toISOString(),
        details: p?.sname ? { studentName: p.sname, studentIdNumber: p.snum } : undefined,
      };
    } else if (!p.sname || !p.snum || !p.smaj || !p.ssec) {
      result = {
        success: false,
        status: "TOKEN_INVALID",
        message: "This pass was made by an older version of the app. Ask the student to reopen their pass.",
        timestamp: new Date().toISOString(),
      };
    } else {
      const found = await findSession(eventId, sessionId);
      result = await recordAttendance({
        student: { name: p.sname, idNumber: p.snum, majorCode: p.smaj, section: p.ssec },
        eventId,
        sessionId,
        found,
        // One pass serves time-in and time-out, so it is not single-use; the
        // store's unique constraint stops a second time-in or time-out.
        purpose: expectedPurpose,
        officer: admin.name,
        method: "qr",
      });
    }
  } catch (error) {
    if (!(error instanceof ScanStoreError || error instanceof EventStoreError)) throw error;
    // Nothing was recorded. Answer in the scanner's own shape so staff see why and can scan again.
    const timestamp = new Date().toISOString();
    return jsonError(error.message, error instanceof ScanStoreError ? error.status : 503, {
      success: false,
      status: "SERVER_ERROR",
      message: error.message,
      timestamp,
    });
  }

  const who = result.details?.studentName ? `${result.details.studentName} (${result.details.studentIdNumber})` : "unknown pass";
  logAudit({
    actor: admin.name,
    actorEmail: admin.email,
    category: "attendance",
    action: result.success ? "scan.verified" : "scan.rejected",
    summary: result.success
      ? `${result.details?.action === "time_out" ? "Timed out" : "Timed in"} ${who}`
      : `Rejected scan of ${who}: ${result.message}`,
    target: result.details?.eventTitle,
    outcome: result.success ? "success" : "failure",
    ip,
    details: { status: result.status },
  });

  // Strip the internal scan record from the response.
  const { success, status, message, timestamp, details } = result;
  return NextResponse.json({ success, status, message, timestamp, details } satisfies ScanVerificationResult);
}
