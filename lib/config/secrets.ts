/**
 * Server secrets (pass encryption keys, the staff session signing key, the
 * report encryption key).
 *
 * Every one of these used to fall back to a value written in this repository
 * when its environment variable was missing. Anyone who could read the code
 * could then forge an attendance pass or a staff session on the live site.
 * In production a secret must now come from the environment and must not be a
 * published example value; development and tests keep a fallback so the app
 * runs without setup.
 */

/** A required setting is missing or unsafe. The message is safe to show to a person. */
export class ConfigError extends Error {}

/** Values printed in .env.example or once hard-coded in this repository. They are public, so never valid in production. */
const PUBLISHED_VALUES = new Set([
  "0123456789abcdef0123456789abcdef0123456789abcdef",
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
  "ba-attendance-dev-session-secret",
  "ba-attendance-dev-csv-secret",
  "masteradmin2526",
  "admin123",
]);

export const isProduction = () => process.env.NODE_ENV === "production";

/** True for a value that is set and, in production, is not one of the published examples. */
export function isUsableSecret(value: string | undefined): value is string {
  const v = value?.trim();
  if (!v) return false;
  return !isProduction() || !PUBLISHED_VALUES.has(v);
}

/**
 * The first usable value among `names`. In production a missing or published
 * value is an error; elsewhere `devFallback` is used.
 */
export function serverSecret(names: string[], devFallback: string, purpose: string): string {
  for (const name of names) {
    const value = process.env[name];
    if (isUsableSecret(value)) return value.trim();
  }
  if (!isProduction()) return devFallback;
  // Spelled out in the server log; the person sees the short message.
  console.error(
    `[config] ${names[0]} is missing or still set to a published example value. Set a private random value in the deployment's environment variables (${purpose}).`
  );
  throw new ConfigError(`${purpose} is unavailable because the server isn't fully set up. Tell the department.`);
}
