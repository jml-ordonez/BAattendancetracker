import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { addEvent } from "../lib/events/store";
import { POST } from "../app/api/students/register/route";
import type { BAEvent } from "../types/events";

const HOUR = 60 * 60 * 1000;
const OPEN_EVENT_ID = "11111111-aaaa-4aaa-8aaa-111111111111";
const ENDED_EVENT_ID = "22222222-bbbb-4bbb-8bbb-222222222222";

function event(id: string, startOffsetH: number, status: BAEvent["status"] = "published"): BAEvent {
  const start = new Date(Date.now() + startOffsetH * HOUR);
  const iso = (offsetH: number) => new Date(start.getTime() + offsetH * HOUR).toISOString();
  return {
    id,
    title: "Registration test event",
    description: "Used by the registration tests.",
    venue: "Room 101",
    start_time: iso(0),
    end_time: iso(4),
    organizer_id: "tests@ua.edu.ph",
    status,
    certificate_enabled: false,
    min_attendance_duration_mins: 0,
    created_at: iso(-48),
    updated_at: iso(-48),
    sessions: [
      {
        id: `${id.slice(0, 8)}-5555-4555-8555-555555555555`,
        event_id: id,
        title: "Main session",
        session_date: iso(0).slice(0, 10),
        time_in_start: iso(0),
        time_in_end: iso(1),
        time_out_start: iso(3),
        time_out_end: iso(4),
        grace_period_mins: 15,
        order_index: 1,
      },
    ],
  };
}

const valid = {
  firstName: "Juan",
  lastName: "Dela Cruz",
  studentIdNumber: "2022001234",
  email: "juan.delacruz@ua.edu.ph",
  section: "MM-2A",
  eventId: OPEN_EVENT_ID,
};

let ipCounter = 0;
function register(body: unknown) {
  // A fresh address per request keeps the per-IP limiter out of the way.
  return POST(
    new NextRequest("http://localhost/api/students/register", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${++ipCounter}` },
      body: JSON.stringify(body),
    })
  );
}

describe("POST /api/students/register", () => {
  beforeAll(async () => {
    // No Supabase in tests: the stores fall back to memory.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    await addEvent(event(OPEN_EVENT_ID, 1));
    await addEvent(event(ENDED_EVENT_ID, -24));
  });

  beforeEach(() => {
    (globalThis as { __ba_students?: unknown }).__ba_students = undefined;
  });

  it("saves a registration and returns its id", async () => {
    const res = await register(valid);
    expect(res.status).toBe(200);
    expect(typeof (await res.json()).id).toBe("string");
  });

  it("registering the same student ID again updates the row instead of duplicating it", async () => {
    const first = await (await register(valid)).json();
    const res = await register({ ...valid, section: "MM-3B" });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(first.id);
  });

  it("rejects an email that belongs to a different student ID", async () => {
    await register(valid);
    const res = await register({ ...valid, studentIdNumber: "2022009999" });
    expect(res.status).toBe(409);
    expect((await res.json()).fieldErrors.email).toMatch(/already registered/i);
  });

  it("rejects non-university emails with a field error", async () => {
    const res = await register({ ...valid, email: "juan@gmail.com" });
    expect(res.status).toBe(400);
    expect((await res.json()).fieldErrors.email).toMatch(/ua\.edu\.ph/);
  });

  it("rejects a section that isn't on the list", async () => {
    const res = await register({ ...valid, section: "XX-9Z" });
    expect(res.status).toBe(400);
    expect((await res.json()).fieldErrors.section).toBeTruthy();
  });

  it("rejects an event that has ended or doesn't exist", async () => {
    for (const eventId of [ENDED_EVENT_ID, "33333333-cccc-4ccc-8ccc-333333333333"]) {
      const res = await register({ ...valid, eventId });
      expect(res.status).toBe(404);
      expect((await res.json()).fieldErrors.eventId).toBeTruthy();
    }
  });

  it("rejects a body that isn't JSON", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/students/register", {
        method: "POST",
        headers: { "x-forwarded-for": "10.9.9.9" },
        body: "not json",
      })
    );
    expect(res.status).toBe(400);
  });

  it("throttles a single address that floods the endpoint", async () => {
    const send = () =>
      POST(
        new NextRequest("http://localhost/api/students/register", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "10.7.7.7" },
          body: JSON.stringify({}),
        })
      );
    let last = 0;
    for (let i = 0; i < 125; i++) last = (await send()).status;
    expect(last).toBe(429);
  });
});
