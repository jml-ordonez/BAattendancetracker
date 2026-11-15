import { describe, expect, it } from "vitest";
import { encryptCSV, decryptCSV, parseDecryptedRows } from "../lib/export/csv-crypto";
import { generateAttendanceCSV, type CSVAttendanceRow } from "../lib/export/csv-generator";

describe("CSV Encryption & Decryption Engine", () => {
  const sampleRows: CSVAttendanceRow[] = [
    {
      studentIdNumber: "2024-01492-BA",
      studentName: "Maria Santos",
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
    {
      studentIdNumber: "2021003213",
      studentName: "Juan Dela Cruz",
      yearLevel: "3",
      section: "MM-3B",
      eventTitle: "Annual BA Leadership Summit 2026",
      sessionTitle: "Morning keynote: AI in global enterprise",
      timeIn: "Oct 24, 2026, 8:25 AM",
      timeOut: "Oct 24, 2026, 12:18 PM",
      durationMinutes: 233,
      timeInStatus: "late",
      timeOutStatus: "normal",
      finalStatus: "late",
    },
  ];

  const plainCSV = generateAttendanceCSV(sampleRows);

  it("encrypts and decrypts with system default key", () => {
    const encrypted = encryptCSV(plainCSV);
    expect(typeof encrypted).toBe("string");
    expect(encrypted.length).toBeGreaterThan(100);
    expect(encrypted).not.toContain("Maria Santos"); // Plaintext must not appear

    const result = decryptCSV(encrypted);
    expect(result.success).toBe(true);
    expect(result.csv).toContain("Maria Santos");
    expect(result.csv).toContain("Juan Dela Cruz");
    expect(result.rows).toHaveLength(2);
    expect(result.rows?.[0].studentName).toBe("Maria Santos");
  });

  it("encrypts and decrypts with a custom password / key", () => {
    const passphrase = "SecretAdminPassword2026!";
    const encrypted = encryptCSV(plainCSV, passphrase);

    // Decrypting with wrong passphrase fails
    const failResult = decryptCSV(encrypted, "WrongPassword");
    expect(failResult.success).toBe(false);
    expect(failResult.error).toMatch(/wrong password|authentication failed|corrupted/i);

    // Decrypting with correct passphrase succeeds
    const okResult = decryptCSV(encrypted, passphrase);
    expect(okResult.success).toBe(true);
    expect(okResult.rows).toHaveLength(2);
  });

  it("rejects tampered ciphertext with an integrity error", () => {
    const encrypted = encryptCSV(plainCSV);
    const parsed = JSON.parse(encrypted);
    // Corrupt the ciphertext
    parsed.ct = parsed.ct.slice(0, -4) + "AAAA";
    const tampered = JSON.stringify(parsed);

    const result = decryptCSV(tampered);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/integrity|authentication failed|tampered/i);
  });

  it("leaves the program column out of the export", () => {
    const [header] = plainCSV.split("\r\n");
    expect(header).not.toMatch(/major|program/i);
    expect(plainCSV).not.toContain("BSBA");
    expect(header.split(",")).toHaveLength(12);
  });

  it("still reads files exported before the program column was removed", () => {
    const legacy = [
      '"Student ID Number","Student Full Name","Major Program","Year Level","Section","Event Title","Session Title","Time In","Time Out","Duration (Mins)","Time In Classification","Time Out Classification","Final Attendance Status"',
      '"2021003213","Juan Dela Cruz","BSBA in Marketing Management","3","MM-3B","Summit","Keynote","Oct 24, 8:25 AM","Oct 24, 12:18 PM",233,"late","normal","late"',
    ].join("\r\n");
    const [row] = parseDecryptedRows(legacy);
    expect(row).toMatchObject({ studentName: "Juan Dela Cruz", section: "MM-3B", eventTitle: "Summit", durationMinutes: 233, finalStatus: "late" });
    expect(row).not.toHaveProperty("major");
  });

  it("parses decrypted CSV rows correctly into typed attendance records", () => {
    const rows = parseDecryptedRows(plainCSV);
    expect(rows).toHaveLength(2);
    expect(rows[0].studentIdNumber).toBe("2024-01492-BA");
    expect(rows[0].studentName).toBe("Maria Santos");
    expect(rows[0].durationMinutes).toBe(248);
  });
});

