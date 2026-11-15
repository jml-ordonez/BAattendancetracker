import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { addEvent } from "../lib/events/store";
import { ADMIN_COOKIE, createSessionToken } from "../lib/auth/admin-session";
import { generateStudentQRToken } from "../lib/tokens/qr-token";
import { DELETE as clearRecords, GET as listRecords } from "../app/api/attendance/records/route";
import { POST as verifyScan } from "../app/api/qr/verify/route";
import type { BAEvent } from "../types/events";

const HOUR = 60 * 60 * 1000;
const EVENT_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const SESSION_A = "aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa";
const EVENT_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const SESSION_B = "bbbbbbbb-5555-4555-8555-bbbbbbbbbbbb";

/** An event whose time-in window is open right now. */
function openEvent(id: string, sessionId: string, title: string): BAEvent {
  const iso = (offsetH: number) => new Date(Date.now() + offsetH * HOUR).toISOString();
  return {
    id,
    title,
    description: "Used by the attendance route tests.",
    venue: "Room 101",
    start_time: iso(-0.25),
    end_time: iso(4),
    organizer_id: "tests@ua.edu.ph",
    status: "published",
    certificate_enabled: false,
    min_attendance_duration_mins: 0,
    created_at: iso(-48),
    updated_at: iso(-48),
    sessions: [
      {
        id: sessionId,
        event_id: id,
        title: `${title} session`,
        session_date: iso(0).slice(0, 10),
        time_in_start: iso(-0.25),
        time_in_end: iso(1),
        time_out_start: iso(3),
        time_out_end: iso(4),
        grace_period_mins: 15,
        order_index: 1,
      },
    ],
  };
}

const admin = { email: "staff@ua.edu.ph", name: "Test Staff", title: "Administrator", role: "administrator" as const };
const cookie = `${ADMIN_COOKIE}=${createSessionToken(admin)}`;
const request = (url: string, init: { method: string; body?: unknown }) =>
  new NextRequest(`http://localhost${url}`, {
    method: init.method,
    headers: { "content-type": "application/json", cookie },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

const pass = (eventId: string, sessionId: string) =>
  generateStudentQRToken({
    studentId: "2022001234",
    studentName: "Ana Reyes",
    studentIdNumber: "2022001234",
    majorCode: "BSBA-MM",
    section: "MM-2A",
    eventId,
    sessionId,
    purpose: "attendance",
    expirySeconds: 3600,
  }).token;

/** `purpose` is what the scanner is set to; pass null to leave it out of the request. */
const scan = (token: string, eventId = EVENT_A, sessionId = SESSION_A, purpose: string | null = "time_in") =>
  verifyScan(request("/api/qr/verify", { method: "POST", body: { token, eventId, sessionId, ...(purpose ? { expectedPurpose: purpose } : {}) } }));
const records = async () => (await (await listRecords(request("/api/attendance/records", { method: "GET" }))).json()).records;

describe("Scanning and the records list", () => {
  beforeAll(async () => {
    // No Supabase in tests: the stores fall back to memory.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    await addEvent(openEvent(EVENT_A, SESSION_A, "Marketing Week Opening"));
    await addEvent(openEvent(EVENT_B, SESSION_B, "Finance Forum"));
  });

  beforeEach(async () => {
    await clearRecords(request("/api/attendance/records", { method: "DELETE" }));
  });

  it("saves a scan and shows it in the records", async () => {
    const res = await scan(pass(EVENT_A, SESSION_A));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.details.action).toBe("time_in");

    const list = await records();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ studentName: "Ana Reyes", studentIdNumber: "2022001234", action: "time_in", eventTitle: "Marketing Week Opening" });
  });

  it("answers a repeat scan as a duplicate and records nothing more", async () => {
    const token = pass(EVENT_A, SESSION_A);
    await scan(token);
    const again = await (await scan(token)).json();
    expect(again.success).toBe(false);
    expect(again.status).toBe("DUPLICATE_SCAN");
    expect(await records()).toHaveLength(1);
  });

  it("records a departure when the scanner is set to Time-out", async () => {
    const token = pass(EVENT_A, SESSION_A);
    await scan(token, EVENT_A, SESSION_A, "time_in");
    const out = await (await scan(token, EVENT_A, SESSION_A, "time_out")).json();
    expect(out.success).toBe(true);
    expect(out.details.action).toBe("time_out");
    expect((await records()).map((r: { action: string }) => r.action).sort()).toEqual(["time_in", "time_out"]);
  });

  it("tells staff to switch the scanner when a student is scanned in the wrong mode", async () => {
    const token = pass(EVENT_A, SESSION_A);
    await scan(token);
    const again = await (await scan(token)).json();
    expect(again.message).toMatch(/switch the scanner to Time-out/);
    const noIn = await (await scan(pass(EVENT_A, SESSION_A), EVENT_A, SESSION_A, "time_out")).json();
    expect(noIn.success).toBe(true); // this student did time in above, so a time-out is valid
    await clearRecords(request("/api/attendance/records", { method: "DELETE" }));
    const stranger = await (await scan(pass(EVENT_A, SESSION_A), EVENT_A, SESSION_A, "time_out")).json();
    expect(stranger.success).toBe(false);
    expect(stranger.message).toMatch(/switch the scanner to Time-in/i);
  });

  it("needs the scanner to say Time-in or Time-out; there is no auto mode", async () => {
    for (const purpose of [null, "attendance", "auto"]) {
      const res = await scan(pass(EVENT_A, SESSION_A), EVENT_A, SESSION_A, purpose);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/time-in or time-out/i);
    }
    expect(await records()).toEqual([]);
  });

  it("clears every record and they stay cleared", async () => {
    await scan(pass(EVENT_A, SESSION_A));
    const res = await clearRecords(request("/api/attendance/records", { method: "DELETE" }));
    expect((await res.json()).cleared).toBe(1);
    expect(await records()).toEqual([]);
    expect(await records()).toEqual([]);
  });

  it("names both events when a pass is scanned at the wrong session", async () => {
    const body = await (await scan(pass(EVENT_B, SESSION_B), EVENT_A, SESSION_A)).json();
    expect(body.success).toBe(false);
    expect(body.message).toContain("Finance Forum");
    expect(body.message).toContain("Marketing Week Opening");
    expect(body.message).toMatch(/Change the session/);
    expect(await records()).toEqual([]);
  });

  it("refuses staff-only routes without a session", async () => {
    const res = await listRecords(new NextRequest("http://localhost/api/attendance/records"));
    expect(res.status).toBe(401);
  });

  it("answers with a readable error, not a crash, when the database isn't connected in production", async () => {
    // A production server with its private keys set, but no database.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("QR_3DES_SECRET_KEY", "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718");
    vi.stubEnv("QR_HMAC_SECRET_KEY", "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0");
    try {
      const res = await verifyScan(
        new NextRequest("http://localhost/api/qr/verify", {
          method: "POST",
          headers: { "content-type": "application/json", cookie: `${ADMIN_COOKIE}=${createSessionToken(admin)}` },
          body: JSON.stringify({ token: pass(EVENT_A, SESSION_A), eventId: EVENT_A, sessionId: SESSION_A, expectedPurpose: "time_in" }),
        })
      );
      const body = await res.json();
      expect(res.status).toBe(503);
      expect(body.status).toBe("SERVER_ERROR");
      expect(body.message).toMatch(/database isn't connected/i);
    } finally {
      vi.unstubAllEnvs();
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
      vi.stubEnv("SUPABASE_URL", "");
      vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
      vi.stubEnv("SUPABASE_SECRET_KEY", "");
    }
  });

  it("says the server isn't set up, not 'invalid pass', when the pass keys are missing in production", async () => {
    const token = pass(EVENT_A, SESSION_A);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_SESSION_SECRET", "a-private-session-signing-secret-for-tests");
    try {
      const res = await verifyScan(
        new NextRequest("http://localhost/api/qr/verify", {
          method: "POST",
          headers: { "content-type": "application/json", cookie: `${ADMIN_COOKIE}=${createSessionToken(admin)}` },
          body: JSON.stringify({ token, eventId: EVENT_A, sessionId: SESSION_A, expectedPurpose: "time_in" }),
        })
      );
      const body = await res.json();
      expect(res.status).toBe(503);
      expect(body.status).toBe("SERVER_ERROR");
      expect(body.message).toMatch(/isn't fully set up/);
    } finally {
      vi.unstubAllEnvs();
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
      vi.stubEnv("SUPABASE_URL", "");
      vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
      vi.stubEnv("SUPABASE_SECRET_KEY", "");
    }
  });
});
