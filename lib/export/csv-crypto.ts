import crypto from "crypto";
import { serverSecret } from "@/lib/config/secrets";
import type { CSVAttendanceRow } from "./csv-generator";

/**
 * Authenticated CSV Encryption & Decryption Module
 * 
 * Cryptographic Standard:
 * - Cipher: AES-256-GCM (Authenticated Encryption with Associated Data - AEAD)
 * - Key Derivation: PBKDF2-HMAC-SHA256 (100,000 iterations, 16-byte cryptographically secure salt)
 * - Nonce/IV: 12 bytes random per encryption
 * - Auth Tag: 16 bytes (128 bits) verification tag
 * - AAD: "ba-attendance-enc-csv:v1" to prevent cross-context replay
 */

const CIPHER_ALGO = "aes-256-gcm";
const KEY_BYTES = 32; // 256 bits
const IV_BYTES = 12; // 96 bits for GCM
const SALT_BYTES = 16;
const PBKDF2_ITERATIONS = 100000;
const AAD_STRING = "ba-attendance-enc-csv:v1";

export interface EncryptedCSVEnvelope {
  format: "ba-enc-csv";
  v: number;
  algo: string;
  keyType: "system" | "custom";
  salt: string; // hex
  iv: string;   // hex
  tag: string;  // hex
  ct: string;   // base64url
  exportedAt: string;
}

export interface DecryptCSVResult {
  success: boolean;
  csv?: string;
  rows?: CSVAttendanceRow[];
  error?: string;
  metadata?: {
    exportedAt?: string;
    keyType?: "system" | "custom";
    rowCount?: number;
  };
}

function getSystemSecret(): string {
  return serverSecret(["ADMIN_SESSION_SECRET", "QR_HMAC_SECRET_KEY", "QR_3DES_SECRET_KEY"], "ba-attendance-dev-csv-secret", "Encrypted reports");
}

function deriveKey(secretOrPass: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(secretOrPass, salt, PBKDF2_ITERATIONS, KEY_BYTES, "sha256");
}

/**
 * Encrypts a plain CSV string into an authenticated, tamper-proof envelope JSON string.
 */
export function encryptCSV(plainCSV: string, customKeyOrPass?: string): string {
  const isCustom = Boolean(customKeyOrPass && customKeyOrPass.trim());
  const secret = isCustom ? customKeyOrPass!.trim() : getSystemSecret();

  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const key = deriveKey(secret, salt);

  const cipher = crypto.createCipheriv(CIPHER_ALGO, key, iv);
  cipher.setAAD(Buffer.from(AAD_STRING, "utf8"));

  const ciphertext = Buffer.concat([cipher.update(plainCSV, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const envelope: EncryptedCSVEnvelope = {
    format: "ba-enc-csv",
    v: 1,
    algo: "aes-256-gcm",
    keyType: isCustom ? "custom" : "system",
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ct: ciphertext.toString("base64url"),
    exportedAt: new Date().toISOString(),
  };

  return JSON.stringify(envelope, null, 2);
}

/**
 * Verifies authenticity and decrypts an encrypted CSV envelope.
 */
export function decryptCSV(encryptedInput: string, keyOrPassphrase?: string): DecryptCSVResult {
  try {
    if (!encryptedInput || typeof encryptedInput !== "string") {
      return { success: false, error: "The uploaded file is empty or invalid." };
    }

    let cleanInput = encryptedInput.trim();
    // Strip UTF-8 BOM if present
    if (cleanInput.charCodeAt(0) === 0xfeff) {
      cleanInput = cleanInput.slice(1);
    }

    // Support armored prefix ENC-CSV:v1:<base64>
    if (cleanInput.startsWith("ENC-CSV:v1:")) {
      try {
        cleanInput = Buffer.from(cleanInput.slice("ENC-CSV:v1:".length), "base64url").toString("utf8");
      } catch {}
    }

    let envelope: EncryptedCSVEnvelope;
    try {
      envelope = JSON.parse(cleanInput) as EncryptedCSVEnvelope;
    } catch {
      return {
        success: false,
        error: "Invalid file format: not a recognised encrypted attendance file.",
      };
    }

    if (!envelope || envelope.format !== "ba-enc-csv" || !envelope.iv || !envelope.tag || !envelope.ct || !envelope.salt) {
      return {
        success: false,
        error: "Malformed envelope: missing required cryptographic headers.",
      };
    }

    // Determine secret to use:
    // 1. If keyOrPassphrase supplied, use it.
    // 2. If envelope says keyType === "system" and no key supplied, use system secret.
    // 3. If envelope says keyType === "custom" and no key supplied, ask for password.
    if (!keyOrPassphrase && envelope.keyType === "custom") {
      return {
        success: false,
        error: "This file was encrypted with a custom password. Please enter the password to decrypt.",
      };
    }

    const secret = keyOrPassphrase?.trim() || getSystemSecret();
    const salt = Buffer.from(envelope.salt, "hex");
    const iv = Buffer.from(envelope.iv, "hex");
    const tag = Buffer.from(envelope.tag, "hex");
    const ciphertext = Buffer.from(envelope.ct, "base64url");

    if (iv.length !== IV_BYTES || tag.length !== 16) {
      return { success: false, error: "Invalid IV or authentication tag length." };
    }

    const key = deriveKey(secret, salt);
    const decipher = crypto.createDecipheriv(CIPHER_ALGO, key, iv);
    decipher.setAAD(Buffer.from(AAD_STRING, "utf8"));
    decipher.setAuthTag(tag);

    let decryptedText: string;
    try {
      decryptedText = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
      return {
        success: false,
        error: "Authentication failed: wrong password or tampered ciphertext (integrity check failed).",
      };
    }

    const rows = parseDecryptedRows(decryptedText);

    return {
      success: true,
      csv: decryptedText,
      rows,
      metadata: {
        exportedAt: envelope.exportedAt,
        keyType: envelope.keyType,
        rowCount: rows.length,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Decryption failed unexpectedly.",
    };
  }
}

/**
 * Parses raw attendance CSV text into typed CSVAttendanceRow structures.
 */
export function parseDecryptedRows(csvText: string): CSVAttendanceRow[] {
  let clean = csvText.trim();
  if (clean.charCodeAt(0) === 0xfeff) clean = clean.slice(1);

  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const parseLine = (line: string): string[] => {
    const fields: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === "," && !inQuotes) {
        fields.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
    fields.push(cur);
    return fields.map((f) => {
      let trimmed = f.trim();
      // Remove surrounding quotes
      if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        trimmed = trimmed.slice(1, -1).replace(/""/g, '"');
      }
      // Remove formula escape prefix
      if (trimmed.startsWith("'")) {
        trimmed = trimmed.slice(1);
      }
      return trimmed;
    });
  };

  const headers = parseLine(lines[0]);
  const rows: CSVAttendanceRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = parseLine(lines[i]);
    if (vals.length < 5) continue;

    // Map by header name, so files exported before the program column was removed still read correctly.
    // The positions below are only a fallback for a file with no recognisable header row.
    const getVal = (name: string, fallbackIdx: number): string => {
      const idx = headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
      return idx >= 0 ? vals[idx] ?? "" : vals[fallbackIdx] ?? "";
    };

    rows.push({
      studentIdNumber: getVal("Student ID Number", 0),
      studentName: getVal("Student Full Name", 1),
      yearLevel: getVal("Year Level", 2),
      section: getVal("Section", 3),
      eventTitle: getVal("Event Title", 4),
      sessionTitle: getVal("Session Title", 5),
      timeIn: getVal("Time In", 6),
      timeOut: getVal("Time Out", 7),
      durationMinutes: Number(getVal("Duration (Mins)", 8)) || 0,
      timeInStatus: getVal("Time In Classification", 9),
      timeOutStatus: getVal("Time Out Classification", 10),
      finalStatus: getVal("Final Attendance Status", 11),
    });
  }

  return rows;
}

