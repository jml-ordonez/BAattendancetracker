import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { addEvent } from "../lib/events/store";
import { POST } from "../app/api/students/register/route";
import { POST as generatePass } from "../app/api/qr/generate/route";
import type { BAEvent } from "../types/events";

const HOUR = 60 * 60 * 1000;
const OPEN_EVENT_ID = "11111111-aaaa-4aaa-8aaa-111111111111";
const ENDED_EVENT_ID = "22222222-bbbb-4bbb-8bbb-222222222222";
/** Starts in 3 days; registration opens tomorrow. */
const LATER_EVENT_ID = "44444444-dddd-4ddd-8ddd-444444444444";
/** Starts in 3 days; registration opened an hour ago. */
const EARLY_EVENT_ID = "55555555-eeee-4eee-8eee-555555555555";

function event(id: string, startOffsetH: number, status: BAEvent["status"] = "published", registrationOpensOffsetH?: number): BAEvent {
  const start = new Date(Date.now() + startOffsetH * HOUR);
  const iso = (offsetH: number) => new Date(start.getTime() + offsetH * HOUR).toISOString();
  return {
    id,
    title: "Registration test event",
    description: "Used by the registration tests.",
    venue: "Room 101",
    start_time: iso(0),
    end_time: iso(4),
    ...(registrationOpensOffsetH === undefined ? {} : { registration_opens_at: new Date(Date.now() + registrationOpensOffsetH * HOUR).toISOString() }),
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
    await addEvent(event(LATER_EVENT_ID, 72, "published", 24));
    await addEvent(event(EARLY_EVENT_ID, 72, "published", -1));
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

  it("fails instead of faking success in production when Supabase isn't configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const res = await register(valid);
      expect(res.status).toBe(503);
      expect((await res.json()).error).toMatch(/database isn't connected/i);
    } finally {
      vi.stubEnv("NODE_ENV", "test");
    }
  });

  describe("a student ID belongs to one student", () => {
    const stored = (id = valid.studentIdNumber) =>
      (globalThis as unknown as { __ba_students?: Map<string, { firstName: string; lastName: string }> }).__ba_students?.get(id);
    const other = { ...valid, firstName: "Mario", lastName: "Reyes", email: "mario.reyes@ua.edu.ph" };

    it("gives the registering device an edit key", async () => {
      const body = await (await register(valid)).json();
      expect(typeof body.editToken).toBe("string");
      expect(body.editToken.length).toBeGreaterThan(30);
    });

    it("refuses a different name on a student ID that is taken, and leaves the first student alone", async () => {
      await register(valid);
      const res = await register(other);
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.fieldErrors.studentIdNumber).toMatch(/already registered to another student/i);
      expect(stored()).toMatchObject({ firstName: "Juan", lastName: "Dela Cruz" });
      // The message doesn't tell a stranger who owns the ID.
      expect(JSON.stringify(body)).not.toMatch(/Juan|Dela Cruz/);
    });

    it("lets the same device correct its own details with the edit key", async () => {
      const { editToken } = await (await register(valid)).json();
      const res = await register({ ...valid, firstName: "Juanito", section: "MM-3A", editToken });
      expect(res.status).toBe(200);
      expect((await res.json()).editToken).toBeUndefined();
      expect(stored()?.firstName).toBe("Juanito");
    });

    it("refuses a wrong edit key", async () => {
      await register(valid);
      const res = await register({ ...other, studentIdNumber: valid.studentIdNumber, editToken: "not-the-key" });
      expect(res.status).toBe(409);
      expect(stored()?.firstName).toBe("Juan");
    });

    it("recognises the same student on a new phone by name and email, ignoring case and spacing", async () => {
      const first = await (await register(valid)).json();
      const res = await register({ ...valid, firstName: "  JUAN ", lastName: "dela   cruz", email: "Juan.DelaCruz@ua.edu.ph", section: "MM-2B" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(first.id);
      expect(body.editToken).toBeTruthy();
      expect(body.editToken).not.toBe(first.editToken);
      // The old phone's key was replaced, so it can no longer rename the student.
      const stale = await register({ ...other, studentIdNumber: valid.studentIdNumber, editToken: first.editToken });
      expect(stale.status).toBe(409);
    });

    it("doesn't let one student's edit key change another student ID", async () => {
      const mine = await (await register(valid)).json();
      await register({ ...other, studentIdNumber: "2022001235" });
      const res = await register({ ...valid, studentIdNumber: "2022001235", firstName: "Hijack", editToken: mine.editToken });
      expect(res.status).toBe(409);
      expect(stored("2022001235")?.firstName).toBe("Mario");
    });

    it("lets only one of two simultaneous registrations take the ID", async () => {
      const results = await Promise.all([register(valid), register({ ...other, studentIdNumber: valid.studentIdNumber })]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    });
  });

  describe("registration opening time", () => {
    const generate = (eventId: string) =>
      generatePass(
        new NextRequest("http://localhost/api/qr/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            eventId,
            sessionId: `${eventId.slice(0, 8)}-5555-4555-8555-555555555555`,
            student: { name: "Juan Dela Cruz", idNumber: "2022001234", majorCode: "BSBA-MM", section: "MM-2A" },
          }),
        })
      );

    it("refuses registration before it opens, and says when it does", async () => {
      const res = await register({ ...valid, eventId: LATER_EVENT_ID });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.fieldErrors.eventId).toMatch(/Registration for this event opens on .+\. Come back then/);
      expect(stored()).toBeUndefined();
    });

    it("lets students register ahead of the event once it has opened", async () => {
      const res = await register({ ...valid, eventId: EARLY_EVENT_ID });
      expect(res.status).toBe(200);
    });

    it("doesn't hand out a pass before registration opens, but does once it has", async () => {
      const early = await generate(LATER_EVENT_ID);
      expect(early.status).toBe(403);
      expect((await early.json()).error).toMatch(/opens on/);

      const open = await generate(EARLY_EVENT_ID);
      expect(open.status).toBe(200);
      expect(typeof (await open.json()).token).toBe("string");
    });

    function stored() {
      return (globalThis as unknown as { __ba_students?: Map<string, unknown> }).__ba_students?.get(valid.studentIdNumber);
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
