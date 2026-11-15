import { beforeEach, describe, expect, it } from "vitest";
import { recordAttendance } from "../lib/attendance/record";
import { clearScans, listScans } from "../lib/attendance/store";
import { buildRoll } from "../lib/attendance/roll";
import { createSessionToken, verifySessionToken } from "../lib/auth/admin-session";
import {
  SECTION_PATTERN,
  STUDENT_ID_PATTERN,
  UA_EMAIL_PATTERN,
  deriveMajorFromSection,
  eventInputSchema,
  eventUpdateSchema,
  sectionMatchesMajor,
  sectionMatchesYear,
  sectionSchema,
  sectionsForYear,
  studentIdSchema,
  studentRegistrationSchema,
  yearLevelForSection,
} from "../lib/validation";
import { addEvent, deleteEvent, findSession, getEvent, listEvents, updateEvent, type SessionMatch } from "../lib/events/store";
import { duplicateTitle, singleSession } from "../lib/events/windows";
import { liveSessionsOf, registrableEvents, registrationIsOpen, upcomingRegistrations } from "../lib/attendance/schedule";

// Seeded "Morning keynote": check-in 08:00–09:00 (UTC+8), 15 min grace, check-out 12:00–13:00.
const EVENT = "a2b4c6d8-1111-2222-3333-444455556666";
const SESSION = "b3c5d7e9-2222-3333-4444-555566667777";
const at = (hhmm: string) => new Date(`2026-10-24T${hhmm.length === 5 ? `${hhmm}:00` : hhmm}+08:00`);
const student = { name: "Maria Santos", idNumber: "2024-01492-BA", majorCode: "BSBA-FM", section: "BA-FM 2-1" };
/** The seeded session, looked up the way the API routes do before recording. */
let found: SessionMatch | null = null;
beforeEach(async () => {
  found = await findSession(EVENT, SESSION);
});
const scan = (purpose: "time_in" | "time_out", time: string, extra: Partial<Parameters<typeof recordAttendance>[0]> = {}) =>
  recordAttendance({ student, eventId: EVENT, sessionId: SESSION, found, purpose, officer: "Test", method: "qr", now: at(time), ...extra });

describe("Attendance pipeline", () => {
  beforeEach(() => clearScans());

  it("checks in on time within the grace period", async () => {
    const r = await scan("time_in", "08:10");
    expect(r.success).toBe(true);
    expect(r.status).toBe("SUCCESS_ON_TIME");
    expect((await listScans())[0].majorCode).toBe("BSBA-FM");
  });

  it("marks a check-in after the grace period as late", async () => {
    expect((await scan("time_in", "08:20")).status).toBe("SUCCESS_LATE");
  });

  it("refuses check-in before the window opens and after the session ends", async () => {
    expect((await scan("time_in", "06:30")).status).toBe("WINDOW_CLOSED");
    expect((await scan("time_in", "13:30")).status).toBe("WINDOW_CLOSED");
  });

  it("refuses a second check-in for the same session", async () => {
    await scan("time_in", "08:05");
    const r = await scan("time_in", "08:07");
    expect(r.success).toBe(false);
    expect(r.status).toBe("DUPLICATE_SCAN");
  });

  it("refuses a check-out without a check-in", async () => {
    expect((await scan("time_out", "12:10")).status).toBe("STUDENT_INELIGIBLE");
  });

  it("records the stay and flags an early departure", async () => {
    await scan("time_in", "08:00");
    const r = await scan("time_out", "11:00");
    expect(r.status).toBe("SUCCESS_CHECKOUT_EARLY");
    expect(r.details?.durationMinutes).toBe(180);
  });

  it("accepts a QR token only once", async () => {
    const token = { id: "tok-1", expiresAt: Math.floor(Date.now() / 1000) + 60 };
    expect((await scan("time_in", "08:05", { token })).success).toBe(true);
    expect((await scan("time_out", "12:30", { token })).status).toBe("DUPLICATE_TOKEN_USE");
    expect((await scan("time_out", "12:31", { token: { ...token, id: "tok-2" } })).success).toBe(true);
  });

  it("uses one pass for time-in at the entrance and time-out at the exit", async () => {
    const first = await scan("time_in", "08:05");
    expect(first.status).toBe("SUCCESS_ON_TIME");
    expect(first.details?.action).toBe("time_in");

    const second = await scan("time_out", "12:30");
    expect(second.status).toBe("SUCCESS_CHECKOUT");
    expect(second.details?.action).toBe("time_out");
    expect(await listScans()).toHaveLength(2);
  });

  it("tells staff to switch to Time-out when a student who already timed in is scanned at the entrance", async () => {
    await scan("time_in", "08:05");
    const again = await scan("time_in", "08:05:30");
    expect(again.success).toBe(false);
    expect(again.status).toBe("DUPLICATE_SCAN");
    expect(again.message).toMatch(/already timed in/);
    expect(again.message).toMatch(/switch the scanner to Time-out/);
    expect(await listScans()).toHaveLength(1);
  });

  it("tells staff to switch to Time-in when someone with no time-in is scanned at the exit", async () => {
    const out = await scan("time_out", "12:10");
    expect(out.status).toBe("STUDENT_INELIGIBLE");
    expect(out.message).toMatch(/switch the scanner to Time-in/i);
  });

  it("refuses a second time-out, and doesn't suggest switching once they have left", async () => {
    await scan("time_in", "08:05");
    await scan("time_out", "12:30");
    const again = await scan("time_out", "12:40");
    expect(again.status).toBe("DUPLICATE_SCAN");
    expect(again.message).toMatch(/already timed out/);
    const lateIn = await scan("time_in", "12:45");
    expect(lateIn.status).toBe("DUPLICATE_SCAN");
    expect(lateIn.message).not.toMatch(/switch the scanner/);
  });

  it("records a short stay as an early departure", async () => {
    await scan("time_in", "08:05");
    const out = await scan("time_out", "08:08");
    expect(out.success).toBe(true);
    expect(out.details?.isEarlyDeparture).toBe(true);
  });

  it("pairs check-in and check-out into one roll entry", async () => {
    await scan("time_in", "08:20");
    await scan("time_out", "12:30");
    const roll = buildRoll(await listScans());
    expect(roll).toHaveLength(1);
    expect(roll[0].finalStatus).toBe("late");
    expect(roll[0].durationMinutes).toBe(250);
  });
});

describe("Staff session cookie", () => {
  const admin = { email: "a@b.edu", name: "Test", title: "Chair", role: "administrator" as const };

  it("round-trips a signed session", () => {
    expect(verifySessionToken(createSessionToken(admin))).toEqual(admin);
  });

  it("rejects a tampered or expired session", () => {
    const token = createSessionToken(admin);
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...admin, role: "administrator", name: "Mallory", exp: 9999999999 })).toString("base64url");
    expect(verifySessionToken(`${forged}.${sig}`)).toBeNull();
    // Change the first character to one it certainly isn't (replacing it with a fixed letter is a no-op 1 time in 64).
    expect(verifySessionToken(`${body}.${sig[0] === "x" ? "y" : "x"}${sig.slice(1)}`)).toBeNull();
    expect(verifySessionToken(createSessionToken(admin, Date.now() - 9 * 3600 * 1000))).toBeNull();
  });
});

describe("Section validation", () => {
  it("matches the section to the major and year", () => {
    expect(sectionMatchesMajor("BA-FM 2-1", "BSBA-FM")).toBe(true);
    expect(sectionMatchesMajor("BA-MM 2-1", "BSBA-FM")).toBe(false);
    expect(sectionMatchesYear("BA-FM 2-1", "2nd Year")).toBe(true);
    expect(sectionMatchesYear("BA-FM 3-1", "2nd Year")).toBe(false);

    // MM-1A format
    expect(sectionMatchesMajor("MM-1A", "BSBA-MM")).toBe(true);
    expect(sectionMatchesMajor("MM-1A", "BSBA-FM")).toBe(false);
    expect(sectionMatchesYear("MM-1A", "1st Year")).toBe(true);
    expect(sectionMatchesYear("MM-1A", "2nd Year")).toBe(false);
    expect(sectionMatchesMajor("FM-2B", "BSBA-FM")).toBe(true);
    expect(sectionMatchesYear("FM-2B", "2nd Year")).toBe(true);
  });

  it("derives the major from the section", () => {
    expect(deriveMajorFromSection("MM-1A")).toBe("BSBA-MM");
    expect(deriveMajorFromSection("FM-2B")).toBe("BSBA-FM");
    expect(deriveMajorFromSection("HRM-3A")).toBe("BSBA-HRM");
    expect(deriveMajorFromSection("OM-4A")).toBe("BSBA-OM");
  });
});

describe("Student registration validation", () => {
  it("validates 10-digit student ID format including 2021003213 and 2022001234", () => {
    expect(STUDENT_ID_PATTERN.test("2021003213")).toBe(true);
    expect(STUDENT_ID_PATTERN.test("2022001234")).toBe(true);
    expect(STUDENT_ID_PATTERN.test("2024-01492-BA")).toBe(true);
    expect(STUDENT_ID_PATTERN.test("invalid")).toBe(false);
    expect(STUDENT_ID_PATTERN.test("12345")).toBe(false);

    expect(studentIdSchema.safeParse("2021003213").success).toBe(true);
    expect(studentIdSchema.safeParse("2024-01492-BA").success).toBe(true);
  });

  it("accepts only the listed sections", () => {
    expect(SECTION_PATTERN.test("MM-1A")).toBe(true);
    for (const s of ["MM-1A", "MM-1B", "MM-2A", "MM-2B", "MM-3A", "MM-3B", "MM-4A", "MM-4B"]) {
      expect(sectionSchema.safeParse(s).success).toBe(true);
    }
    expect(sectionSchema.safeParse(" mm-2b ").data).toBe("MM-2B");
    for (const s of ["MM-1C", "MM-5A", "FM-2B", "BA-MM 3-1", ""]) {
      expect(sectionSchema.safeParse(s).success).toBe(false);
    }
  });

  it("lists each year's sections", () => {
    expect(sectionsForYear("1st Year")).toEqual(["MM-1A", "MM-1B"]);
    expect(sectionsForYear("4th Year")).toEqual(["MM-4A", "MM-4B"]);
    expect(sectionsForYear("5th Year")).toEqual([]);
    expect(deriveMajorFromSection("MM-3B")).toBe("BSBA-MM");
  });

  it("derives the year level from every section", () => {
    expect(yearLevelForSection("MM-1A")).toBe("1st Year");
    expect(yearLevelForSection("MM-2B")).toBe("2nd Year");
    expect(yearLevelForSection("MM-3A")).toBe("3rd Year");
    expect(yearLevelForSection("MM-4B")).toBe("4th Year");
  });

  it("checks the whole registration form", () => {
    const ok = { firstName: "Juan", lastName: "Dela Cruz", studentIdNumber: "2021003213", email: "juan@ua.edu.ph", section: "MM-3B", eventId: "evt-1" };
    expect(studentRegistrationSchema.safeParse(ok).success).toBe(true);
    const bad = studentRegistrationSchema.safeParse({ ...ok, firstName: "J4n", email: "juan@gmail.com", section: "", eventId: " " });
    expect(bad.success).toBe(false);
    const paths = bad.error!.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["firstName", "email", "section", "eventId"]));
  });

  it("validates university email ending with @ua.edu.ph", () => {
    expect(UA_EMAIL_PATTERN.test("student@ua.edu.ph")).toBe(true);
    expect(UA_EMAIL_PATTERN.test("2021003213@ua.edu.ph")).toBe(true);
    expect(UA_EMAIL_PATTERN.test("student@university.edu")).toBe(false);
    expect(UA_EMAIL_PATTERN.test("student@gmail.com")).toBe(false);
  });
});

describe("Deleting an event", () => {
  beforeEach(() => clearScans());

  it("removes the event but keeps its attendance records", async () => {
    await scan("time_in", "08:05");
    const event = (await getEvent(EVENT))!;
    expect((await deleteEvent(EVENT))?.id).toBe(EVENT);
    expect(await getEvent(EVENT)).toBeUndefined();
    expect(await listEvents()).not.toContainEqual(expect.objectContaining({ id: EVENT }));
    expect(await listScans()).toHaveLength(1);
    expect((await listScans())[0].eventTitle).toBe(event.title);
    // Scanning a pass for a deleted event is refused, not recorded.
    expect((await scan("time_out", "12:30", { found: await findSession(EVENT, SESSION) })).status).toBe("SESSION_NOT_FOUND");
    expect(await deleteEvent(EVENT)).toBeNull();
    await addEvent(event); // restore the seed for later tests
  });
});

describe("New event validation", () => {
  const inHours = (h: number) => new Date(Date.now() + h * 3600000).toISOString();
  const base = { title: "Marketing Week Opening", description: "Opening program for all year levels.", venue: "AVR 2", start: inHours(1), end: inHours(4), gracePeriodMins: 15, publish: true };

  it("accepts a valid event and tidies whitespace", () => {
    const r = eventInputSchema.safeParse({ ...base, title: "  Marketing   Week Opening " });
    expect(r.success).toBe(true);
    expect(r.data!.title).toBe("Marketing Week Opening");
  });

  it("rejects bad fields with the right path", () => {
    const issue = (v: object) => eventInputSchema.safeParse({ ...base, ...v }).error?.issues[0]?.path[0];
    expect(issue({ title: "-----" })).toBe("title");
    expect(issue({ venue: " " })).toBe("venue");
    expect(issue({ end: inHours(0.5) })).toBe("end");
    expect(issue({ end: inHours(30) })).toBe("end");
    expect(issue({ start: inHours(-5), end: inHours(-2) })).toBe("end");
    expect(issue({ gracePeriodMins: Number.NaN })).toBe("gracePeriodMins");
    expect(issue({ gracePeriodMins: 200 })).toBe("gracePeriodMins");
    expect(issue({ gracePeriodMins: 7.5 })).toBe("gracePeriodMins");
    expect(issue({ end: new Date(new Date(base.start).getTime() + 10 * 60000).toISOString() })).toBe("end");
  });

  it("lets an edit keep a past schedule but still checks it", () => {
    const past = { ...base, start: inHours(-5), end: inHours(-2) };
    expect(eventUpdateSchema.safeParse(past).success).toBe(true);
    expect(eventUpdateSchema.safeParse({ ...past, end: inHours(-6) }).success).toBe(false);
  });
});

describe("Events a student can register for", () => {
  it("lists only published events with a session still to come", async () => {
    const all = await listEvents();
    // Seed: Summit (Oct 24, published), Convention (Nov 5, published), Workshop (Nov 12, draft).
    const ids = (at: string) => registrableEvents(all, new Date(at)).map((e) => e.title);
    expect(ids("2026-10-20T00:00:00+08:00")).toEqual(["Annual BA Leadership Summit 2026", "Financial Analytics & FinTech Convention"]);
    expect(ids("2026-10-25T00:00:00+08:00")).toEqual(["Financial Analytics & FinTech Convention"]);
    expect(ids("2026-12-01T00:00:00+08:00")).toEqual([]);
  });

  it("returns the remaining sessions of the chosen event", async () => {
    const all = await listEvents();
    expect(liveSessionsOf(all, EVENT, new Date("2026-10-24T07:30:00+08:00"))).toHaveLength(2);
    expect(liveSessionsOf(all, EVENT, new Date("2026-10-24T14:00:00+08:00"))).toHaveLength(1);
  });
});

describe("When registration opens", () => {
  const base = async () => structuredClone((await getEvent(EVENT))!);
  const noon = new Date("2026-10-20T12:00:00+08:00");

  it("opens as soon as the event is published when no time is set", async () => {
    const e = await base();
    expect(registrationIsOpen(e, noon)).toBe(true);
    expect(registrableEvents([e], noon)).toHaveLength(1);
    expect(upcomingRegistrations([e], noon)).toHaveLength(0);
  });

  it("keeps the event out of the list until the opening time, then lets students in", async () => {
    const e = { ...(await base()), registration_opens_at: "2026-10-23T08:00:00+08:00" };
    expect(registrationIsOpen(e, new Date("2026-10-23T07:59:00+08:00"))).toBe(false);
    expect(registrableEvents([e], new Date("2026-10-23T07:59:00+08:00"))).toHaveLength(0);
    expect(upcomingRegistrations([e], new Date("2026-10-23T07:59:00+08:00")).map((x) => x.id)).toEqual([EVENT]);

    expect(registrationIsOpen(e, new Date("2026-10-23T08:00:00+08:00"))).toBe(true);
    expect(registrableEvents([e], new Date("2026-10-23T08:00:00+08:00"))).toHaveLength(1);
    expect(upcomingRegistrations([e], new Date("2026-10-23T08:00:00+08:00"))).toHaveLength(0);
  });

  it("never lists an unpublished event, open or not", async () => {
    const e = { ...(await base()), status: "draft" as const, registration_opens_at: "2026-10-23T08:00:00+08:00" };
    expect(registrableEvents([e], noon)).toHaveLength(0);
    expect(upcomingRegistrations([e], noon)).toHaveLength(0);
  });
});

describe("Registration opening time in the event form", () => {
  const inHours = (h: number) => new Date(Date.now() + h * 3600000).toISOString();
  const base = { title: "Marketing Week Opening", description: "Opening program for all year levels.", venue: "AVR 2", start: inHours(48), end: inHours(51), gracePeriodMins: 15, publish: true };
  const issue = (v: object) => eventInputSchema.safeParse({ ...base, ...v }).error?.issues.find((i) => i.path[0] === "registrationOpens")?.message;

  it("is optional", () => {
    expect(eventInputSchema.safeParse(base).success).toBe(true);
    expect(eventInputSchema.safeParse({ ...base, registrationOpens: null }).success).toBe(true);
  });

  it("accepts a time before the event starts", () => {
    expect(issue({ registrationOpens: inHours(24) })).toBeUndefined();
    expect(issue({ registrationOpens: inHours(-3) })).toBeUndefined();
  });

  it("refuses a time at or after the start", () => {
    expect(issue({ registrationOpens: base.start })).toBe("Registration must open before the event starts.");
    expect(issue({ registrationOpens: inHours(49) })).toBe("Registration must open before the event starts.");
  });

  it("refuses a time more than 90 days ahead, which is usually a typo", () => {
    expect(issue({ registrationOpens: inHours(48 - 24 * 91) })).toMatch(/up to 90 days/);
    expect(issue({ registrationOpens: inHours(48 - 24 * 89) })).toBeUndefined();
  });

  it("is checked on edits too", () => {
    const r = eventUpdateSchema.safeParse({ ...base, registrationOpens: inHours(50) });
    expect(r.error?.issues[0]?.path[0]).toBe("registrationOpens");
  });
});

describe("Editing an event", () => {
  it("rebuilds the session windows but keeps the session id, so issued passes stay valid", () => {
    const start = new Date("2026-11-20T09:00:00+08:00");
    const end = new Date("2026-11-20T10:00:00+08:00");
    const s = singleSession("evt", start, end, 10, { id: "keep-me", title: "Main session" });
    expect(s.id).toBe("keep-me");
    expect(s.session_date).toBe("2026-11-20");
    // A one-hour event gets 30-minute windows that don't overlap.
    expect(s.time_in_end).toBe(new Date("2026-11-20T09:30:00+08:00").toISOString());
    expect(s.time_out_start).toBe(new Date("2026-11-20T09:30:00+08:00").toISOString());
    expect(s.grace_period_mins).toBe(10);
  });

  it("finds duplicate titles on the same day, ignoring the event being edited", async () => {
    const all = await listEvents();
    const day = new Date("2026-10-24T15:00:00+08:00");
    expect(duplicateTitle(all, "annual ba leadership summit 2026", day)).toBe(true);
    expect(duplicateTitle(all, "Annual BA Leadership Summit 2026", day, EVENT)).toBe(false);
    expect(duplicateTitle(all, "Annual BA Leadership Summit 2026", new Date("2026-10-25T09:00:00+08:00"))).toBe(false);
  });

  it("saves changes and bumps updated_at", async () => {
    const before = (await getEvent(EVENT))!;
    const original = { title: before.title, updated_at: before.updated_at };
    const after = (await updateEvent(EVENT, { title: "Leadership Summit (moved to Hall B)" }))!;
    expect(after.title).toBe("Leadership Summit (moved to Hall B)");
    expect(after.updated_at).not.toBe(original.updated_at);
    expect(await updateEvent("00000000-0000-0000-0000-000000000000", { title: "Nope" })).toBeNull();
    await updateEvent(EVENT, { title: original.title });
  });
});
