import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ConfigError, isUsableSecret, serverSecret } from "../lib/config/secrets";
import { builtInAdminConfigured, checkBuiltInAdmin } from "../lib/auth/staff-accounts";
import { createSessionToken, verifySessionToken } from "../lib/auth/admin-session";
import { getCryptoKeys } from "../lib/crypto/3des";
import { generateStudentQRToken, validateTokenIntegrity } from "../lib/tokens/qr-token";
import { encryptCSV } from "../lib/export/csv-crypto";
import { POST as login } from "../app/api/auth/login/route";
import { GET as listEvents } from "../app/api/events/route";

const PRIVATE_3DES = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718";
const PRIVATE_HMAC = "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0";
const PUBLISHED_3DES = "0123456789abcdef0123456789abcdef0123456789abcdef";
const admin = { email: "a@ua.edu.ph", name: "Test", title: "Administrator", role: "administrator" as const };

const production = () => vi.stubEnv("NODE_ENV", "production");
const clearSecrets = () => {
  for (const name of ["QR_3DES_SECRET_KEY", "QR_HMAC_SECRET_KEY", "ADMIN_SESSION_SECRET", "ADMIN_PASSWORD", "ADMIN_USERNAME", "ADMIN_EMAIL"]) vi.stubEnv(name, "");
};

let ip = 0;
const signIn = (username: string, password: string) =>
  login(
    new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.1.0.${++ip}` },
      body: JSON.stringify({ username, password }),
    })
  );

afterEach(() => vi.unstubAllEnvs());

describe("Server secrets", () => {
  it("uses a development fallback outside production", () => {
    clearSecrets();
    expect(serverSecret(["QR_HMAC_SECRET_KEY"], "dev-fallback", "Attendance passes")).toBe("dev-fallback");
    expect(() => getCryptoKeys()).not.toThrow();
  });

  it("refuses to run in production without private keys", () => {
    clearSecrets();
    production();
    expect(() => getCryptoKeys()).toThrow(ConfigError);
    expect(() => createSessionToken(admin)).toThrow(ConfigError);
    expect(() => encryptCSV("a,b")).toThrow(ConfigError);
    expect(() => generateStudentQRToken({ studentId: "s", eventId: "e", sessionId: "x", purpose: "attendance" })).toThrow(ConfigError);
  });

  it("refuses the example keys printed in .env.example in production", () => {
    clearSecrets();
    production();
    vi.stubEnv("QR_3DES_SECRET_KEY", PUBLISHED_3DES);
    vi.stubEnv("QR_HMAC_SECRET_KEY", "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210");
    expect(isUsableSecret(PUBLISHED_3DES)).toBe(false);
    expect(() => getCryptoKeys()).toThrow(ConfigError);
  });

  it("works in production with private keys", () => {
    clearSecrets();
    production();
    vi.stubEnv("QR_3DES_SECRET_KEY", PRIVATE_3DES);
    vi.stubEnv("QR_HMAC_SECRET_KEY", PRIVATE_HMAC);
    const { token } = generateStudentQRToken({ studentId: "s", eventId: "e", sessionId: "x", purpose: "attendance", expirySeconds: 60 });
    expect(validateTokenIntegrity(token).valid).toBe(true);
    expect(verifySessionToken(createSessionToken(admin))).toEqual(admin);
  });

  it("doesn't accept a pass or a staff session made with the old public keys", () => {
    clearSecrets();
    // Made the way an attacker would: with the keys that used to be in the repository.
    const forgedPass = generateStudentQRToken({ studentId: "s", eventId: "e", sessionId: "x", purpose: "attendance", expirySeconds: 60 }).token;
    const forgedSession = createSessionToken(admin);

    production();
    vi.stubEnv("QR_3DES_SECRET_KEY", PRIVATE_3DES);
    vi.stubEnv("QR_HMAC_SECRET_KEY", PRIVATE_HMAC);
    expect(validateTokenIntegrity(forgedPass).valid).toBe(false);
    expect(verifySessionToken(forgedSession)).toBeNull();
  });

  it("treats everyone as signed out, rather than crashing, when there is no signing key", () => {
    clearSecrets();
    const token = createSessionToken(admin);
    production();
    expect(verifySessionToken(token)).toBeNull();
  });
});

describe("Built-in administrator", () => {
  it("doesn't exist without ADMIN_PASSWORD: there is no default password", () => {
    clearSecrets();
    expect(builtInAdminConfigured()).toBe(false);
    for (const guess of ["masteradmin2526", "admin123", "admin", ""]) {
      expect(checkBuiltInAdmin("admin", guess)).toBeNull();
      expect(checkBuiltInAdmin("eleanor", guess)).toBeNull();
    }
  });

  it("signs in with the configured username or email and password", () => {
    clearSecrets();
    vi.stubEnv("ADMIN_PASSWORD", "a-long-private-password");
    expect(checkBuiltInAdmin("admin", "a-long-private-password")?.role).toBe("administrator");
    expect(checkBuiltInAdmin("ADMIN@ua.edu.ph", "a-long-private-password")?.email).toBe("admin@ua.edu.ph");
    expect(checkBuiltInAdmin("admin", "a-long-private-passwor")).toBeNull();
    expect(checkBuiltInAdmin("someone", "a-long-private-password")).toBeNull();

    vi.stubEnv("ADMIN_USERNAME", "dean");
    expect(checkBuiltInAdmin("dean", "a-long-private-password")).not.toBeNull();
    expect(checkBuiltInAdmin("admin", "a-long-private-password")).toBeNull();
  });

  it("ignores the passwords that were once published, in production", () => {
    clearSecrets();
    production();
    vi.stubEnv("ADMIN_PASSWORD", "masteradmin2526");
    expect(builtInAdminConfigured()).toBe(false);
    expect(checkBuiltInAdmin("admin", "masteradmin2526")).toBeNull();
  });
});

describe("POST /api/auth/login", () => {
  const noSupabase = () => {
    for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"]) vi.stubEnv(name, "");
  };

  it("says sign-in isn't set up when no staff account exists, instead of 'wrong password'", async () => {
    clearSecrets();
    noSupabase();
    const res = await signIn("admin", "masteradmin2526");
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/isn't set up/);
  });

  it("signs in the configured administrator and sets an httpOnly session cookie", async () => {
    clearSecrets();
    noSupabase();
    vi.stubEnv("ADMIN_PASSWORD", "a-long-private-password");
    const res = await signIn("admin", "a-long-private-password");
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/ba_admin_session=.+HttpOnly/i);

    const wrong = await signIn("admin", "masteradmin2526");
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("set-cookie")).toBeNull();
  });

  it("doesn't sign anyone in when the session can't be signed with a private key", async () => {
    clearSecrets();
    noSupabase();
    production();
    vi.stubEnv("ADMIN_PASSWORD", "a-long-private-password");
    const res = await signIn("admin", "a-long-private-password");
    expect(res.status).toBe(503);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("GET /api/events for students", () => {
  it("doesn't include the organizer's email address", async () => {
    for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"]) vi.stubEnv(name, "");
    const body = await (await listEvents(new NextRequest("http://localhost/api/events"))).json();
    expect(body.events.length).toBeGreaterThan(0);
    for (const event of body.events) {
      expect(event.status).toBe("published");
      expect(event.organizer_id).toBe("");
    }
  });
});
