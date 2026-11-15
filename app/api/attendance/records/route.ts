import { NextResponse, type NextRequest } from "next/server";
import { clearScans, listScans, ScanStoreError } from "@/lib/attendance/store";
import { logAudit } from "@/lib/audit/store";
import { clientIp, jsonError, requireAdmin } from "@/lib/http";

export async function GET(request: NextRequest) {
  const admin = requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  try {
    const records = await listScans();
    return NextResponse.json({ records, count: records.length, serverTime: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ScanStoreError) return jsonError(error.message, error.status);
    throw error;
  }
}

/** Clears every scan. Was public and linked from the landing page; now staff-only and audited. */
export async function DELETE(request: NextRequest) {
  const admin = requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  try {
    const count = await clearScans();
    logAudit({
      actor: admin.name,
      actorEmail: admin.email,
      category: "records",
      action: "records.cleared",
      summary: `Cleared all attendance records (${count} scan${count === 1 ? "" : "s"})`,
      outcome: "success",
      ip: clientIp(request),
      details: { count },
    });
    return NextResponse.json({ records: [], count: 0, cleared: count }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ScanStoreError) return jsonError(error.message, error.status);
    throw error;
  }
}
