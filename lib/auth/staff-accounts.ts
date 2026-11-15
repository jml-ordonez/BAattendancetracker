import crypto from "crypto";
import { isUsableSecret } from "@/lib/config/secrets";
import type { AdminIdentity } from "@/lib/auth/admin-session";

/**
 * The built-in administrator, configured only through environment variables
 * (ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD). Server-only.
 *
 * Passwords used to be written in this file, so anyone who could read the
 * repository could sign in as an administrator. There is no default password
 * any more: without ADMIN_PASSWORD the built-in account doesn't exist, and
 * staff sign in with their Supabase accounts (see scripts/add-admin.js).
 */

const DEFAULT_USERNAME = "admin";
const DEFAULT_EMAIL = "admin@ua.edu.ph";

interface BuiltInAdmin extends AdminIdentity {
  username: string;
  password: string;
}

function builtInAdmin(): BuiltInAdmin | null {
  const password = process.env.ADMIN_PASSWORD;
  // In production a password that was ever published in this repository doesn't count.
  if (!isUsableSecret(password)) return null;
  return {
    username: (process.env.ADMIN_USERNAME || DEFAULT_USERNAME).trim(),
    email: (process.env.ADMIN_EMAIL || DEFAULT_EMAIL).trim(),
    password,
    name: "System Administrator",
    title: "Administrator",
    role: "administrator",
  };
}

/** Whether a built-in administrator is configured at all. */
export function builtInAdminConfigured(): boolean {
  return builtInAdmin() !== null;
}

/** Compares without leaking, through timing, how much of the password matched. */
function samePassword(a: string, b: string): boolean {
  const digest = (v: string) => crypto.createHash("sha256").update(v, "utf8").digest();
  return crypto.timingSafeEqual(digest(a), digest(b));
}

/** The built-in administrator when the username (or email) and password match; otherwise null. */
export function checkBuiltInAdmin(identifier: string, password: string): AdminIdentity | null {
  const account = builtInAdmin();
  if (!account) return null;
  const id = identifier.trim().toLowerCase();
  const known = id === account.username.toLowerCase() || id === account.email.toLowerCase();
  // Always compare, so an unknown username takes as long as a wrong password.
  const matches = samePassword(password, account.password);
  if (!known || !matches) return null;
  return { email: account.email, name: account.name, title: account.title, role: account.role };
}
