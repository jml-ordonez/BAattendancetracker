import { beforeEach, describe, expect, it, vi } from "vitest";
import { addScan, clearScans, correctScan, findStudentScans, getScan, listScans, ScanConflictError, ScanStoreError } from "../lib/attendance/store";
import type { AttendanceScan } from "../types/attendance";

const scan = (overrides: Partial<Omit<AttendanceScan, "id">> = {}): Omit<AttendanceScan, "id"> => ({
  studentName: "Ana Reyes",
  studentIdNumber: "2022001234",
  majorCode: "BSBA-MM",
  section: "MM-2A",
  eventId: "a2b4c6d8-1111-2222-3333-444455556666",
  eventTitle: "Test event",
  sessionId: "b3c5d7e9-2222-3333-4444-555566667777",
  sessionTitle: "Morning",
  action: "time_in",
  status: "on_time",
  method: "qr",
  officer: "Tester",
  timestamp: "2026-10-24T08:10:00+08:00",
  ...overrides,
});

describe("Attendance store", () => {
  beforeEach(async () => {
    await clearScans();
  });

  it("starts empty: there are no sample students to come back", async () => {
    expect(await listScans()).toEqual([]);
    expect((await listScans()).some((s) => s.studentName === "Maria Santos" || s.studentName === "Juan Dela Cruz")).toBe(false);
  });

  it("clearing removes every scan and it stays cleared", async () => {
    await addScan(scan());
    await addScan(scan({ action: "time_out", status: "checked_out" }));
    expect(await clearScans()).toBe(2);
    expect(await listScans()).toEqual([]);
    // A later read (another request) doesn't bring anything back.
    expect(await listScans()).toEqual([]);
    expect(await clearScans()).toBe(0);
  });

  it("lists the newest scan first", async () => {
    await addScan(scan({ studentIdNumber: "2022000001" }));
    await addScan(scan({ studentIdNumber: "2022000002" }));
    expect((await listScans()).map((s) => s.studentIdNumber)).toEqual(["2022000002", "2022000001"]);
  });

  it("refuses a second time-in or time-out for the same student and session", async () => {
    await addScan(scan());
    await expect(addScan(scan({ timestamp: "2026-10-24T08:11:00+08:00" }))).rejects.toBeInstanceOf(ScanConflictError);
    await addScan(scan({ action: "time_out", status: "checked_out" }));
    await expect(addScan(scan({ action: "time_out", status: "checked_out" }))).rejects.toBeInstanceOf(ScanConflictError);
    expect(await listScans()).toHaveLength(2);
  });

  it("lets only one of two simultaneous scans through", async () => {
    const results = await Promise.allSettled([addScan(scan()), addScan(scan())]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await listScans()).toHaveLength(1);
  });

  it("allows the same student in a different session", async () => {
    await addScan(scan());
    await addScan(scan({ sessionId: "c4d6e8fa-3333-4444-5555-666677778888" }));
    expect(await listScans()).toHaveLength(2);
  });

  it("finds a student's time-in and time-out together", async () => {
    await addScan(scan());
    await addScan(scan({ action: "time_out", status: "left_early", durationMinutes: 90 }));
    const { timeIn, timeOut } = await findStudentScans("2022001234", "b3c5d7e9-2222-3333-4444-555566667777");
    expect(timeIn?.action).toBe("time_in");
    expect(timeOut?.durationMinutes).toBe(90);
    expect(await findStudentScans("2022009999", "b3c5d7e9-2222-3333-4444-555566667777")).toEqual({});
  });

  it("saves a correction on a scan and reports a missing one", async () => {
    const saved = await addScan(scan());
    const correction = { status: "excused" as const, reason: "Medical certificate shown", by: "Coordinator", at: "2026-10-25T09:00:00+08:00" };
    expect((await correctScan(saved.id, correction))?.correction).toEqual(correction);
    expect((await getScan(saved.id))?.correction?.reason).toBe("Medical certificate shown");
    await clearScans();
    expect(await correctScan(saved.id, correction)).toBeUndefined();
    expect(await getScan(saved.id)).toBeUndefined();
  });

  it("fails in production instead of quietly using memory when Supabase isn't configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      await expect(listScans()).rejects.toBeInstanceOf(ScanStoreError);
      await expect(addScan(scan())).rejects.toMatchObject({ status: 503 });
    } finally {
      vi.stubEnv("NODE_ENV", "test");
    }
  });
});
