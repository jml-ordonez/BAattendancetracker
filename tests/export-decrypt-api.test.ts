import { describe, expect, it } from "vitest";
import { encryptCSV, decryptCSV } from "../lib/export/csv-crypto";
import { generateAttendanceCSV, type CSVAttendanceRow } from "../lib/export/csv-generator";

describe("Export and Decrypt Route Endpoints Logic", () => {
  const sampleRows: CSVAttendanceRow[] = [
    {
      studentIdNumber: "2024-01492-BA",
      studentName: "Maria Santos",
      major: "BSBA in Financial Management",
      yearLevel: "2",
      section: "BA-FM 2-1",
      eventTitle: "Annual BA Leadership Summit 2026",
      sessionTitle: "Morning keynote: AI in global enterprise",
      timeIn: "Oct 24, 2026, 8:12 AM",
      timeOut: "Oct 24, 2026, 12:20 PM",
      durationMinutes: 248,
      timeInStatus: "on time",
      timeOutStatus: "normal",
      finalStatus: "checked out",
    },
  ];

  it("handles encrypted export payload and decrypt roundtrip", () => {
    const plainCSV = "﻿" + generateAttendanceCSV(sampleRows);
    const encryptedPayload = encryptCSV(plainCSV);
    const decrypted = decryptCSV(encryptedPayload);

    expect(decrypted.success).toBe(true);
    expect(decrypted.rows).toHaveLength(1);
    expect(decrypted.rows?.[0].studentIdNumber).toBe("2024-01492-BA");
    expect(decrypted.metadata?.keyType).toBe("system");
  });

  it("handles custom passphrase export and decrypt roundtrip", () => {
    const plainCSV = "﻿" + generateAttendanceCSV(sampleRows);
    const passphrase = "DeanSpecialAccess2026";
    const encryptedPayload = encryptCSV(plainCSV, passphrase);
    const decrypted = decryptCSV(encryptedPayload, passphrase);

    expect(decrypted.success).toBe(true);
    expect(decrypted.metadata?.keyType).toBe("custom");
    expect(decrypted.rows?.[0].studentName).toBe("Maria Santos");
  });
});
