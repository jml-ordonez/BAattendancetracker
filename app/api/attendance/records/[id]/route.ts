import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { correctScan, getScan, ScanStoreError } from "@/lib/attendance/store";
import { logAudit } from "@/lib/audit/store";
import { clientIp, jsonError, parseBody, requireAdmin } from "@/lib/http";
import { reasonSchema } from "@/lib/validation";

const schema = z.object({
  status: z.enum(["present", "late", "checked_out", "left_early", "excused"], { message: "Choose the corrected status." }),
  reason: reasonSchema,
});

/** Coordinator correction of a student's attendance for one session. Target: the time-in scan. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = requireAdmin(request);
  if (admin instanceof NextResponse) return admin;

  const { id } = await params;
  const parsed = await parseBody(request, schema);
  if ("response" in parsed) return parsed.response;

  let scan, updated;
  try {
    scan = await getScan(id);
    if (!scan || scan.action !== "time_in") return jsonError("Attendance record not found. It may have been cleared; refresh the records.", 404);
    updated = await correctScan(id, { ...parsed.data, by: admin.name, at: new Date().toISOString() });
  } catch (error) {
    if (error instanceof ScanStoreError) return jsonError(error.message, error.status);
    throw error;
  }
  if (!updated) return jsonError("Attendance record not found. It may have been cleared; refresh the records.", 404);
  const previous = scan.correction?.status ?? scan.status;

  logAudit({
    actor: admin.name,
    actorEmail: admin.email,
    category: "records",
    action: "attendance.corrected",
    summary: `Corrected ${scan.studentName} (${scan.studentIdNumber}) from ${previous.replace("_", " ")} to ${parsed.data.status.replace("_", " ")}`,
    target: `${scan.eventTitle} · ${scan.sessionTitle}`,
    outcome: "success",
    ip: clientIp(request),
    details: { reason: parsed.data.reason, from: previous, to: parsed.data.status },
  });

  return NextResponse.json({ record: updated });
}
