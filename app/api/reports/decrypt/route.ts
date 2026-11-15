import { NextResponse, type NextRequest } from "next/server";
import { decryptCSV } from "@/lib/export/csv-crypto";
import { logAudit } from "@/lib/audit/store";
import { clientIp, jsonError, requireAdmin } from "@/lib/http";

export async function POST(request: NextRequest) {
  const admin = requireAdmin(request);
  if (admin instanceof NextResponse) return admin;

  let payload = "";
  let passphrase: string | undefined;

  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    try {
      const formData = await request.formData();
      const file = formData.get("file");
      if (file && typeof file === "object" && "text" in file) {
        payload = await (file as Blob).text();
      } else if (typeof file === "string") {
        payload = file;
      }
      const pass = formData.get("passphrase");
      if (typeof pass === "string") passphrase = pass;
    } catch {
      return jsonError("Failed to parse uploaded form file.", 400);
    }
  } else {
    try {
      const body = await request.json();
      payload = body.payload || body.ciphertext || "";
      passphrase = body.passphrase;
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }
  }

  if (!payload || !payload.trim()) {
    return jsonError("Please upload an encrypted CSV file or provide ciphertext.", 400);
  }

  const result = decryptCSV(payload, passphrase);

  logAudit({
    actor: admin.name,
    actorEmail: admin.email,
    category: "reports",
    action: result.success ? "report.decrypted" : "report.decryption_failed",
    summary: result.success
      ? `Successfully decrypted attendance report (${result.rows?.length ?? 0} rows)`
      : `Failed to decrypt attendance report: ${result.error}`,
    outcome: result.success ? "success" : "failure",
    ip: clientIp(request),
    details: {
      rowCount: result.rows?.length ?? 0,
      keyType: result.metadata?.keyType ?? null,
      error: result.error ?? null,
    },
  });

  if (!result.success) {
    return jsonError(result.error || "Decryption failed.", 400);
  }

  return NextResponse.json({
    success: true,
    csv: result.csv,
    rows: result.rows,
    count: result.rows?.length ?? 0,
    metadata: result.metadata,
  });
}
