import fs from "fs";
import path from "path";
import type { AttendanceScan, ScanAction, ScanCorrection } from "@/types/attendance";

/**
 * Live attendance store shared by the scanner, manual entry, the dashboard and
 * reports. Durable: persists to local file cache (.data/attendance-scans.json)
 * and seeds initial scans for default sessions so records never flash-disappear
 * on server reload or admin login.
 */

const DATA_DIR = path.resolve(process.cwd(), ".data");
const PERSIST_FILE = path.join(DATA_DIR, "attendance-scans.json");

export const SEED_SCANS: AttendanceScan[] = [
  {
    id: "scan-seed-1",
    studentName: "Maria Santos",
    studentIdNumber: "2024001876",
    majorCode: "BSBA-MM",
    section: "MM-1A",
    eventId: "a2b4c6d8-1111-2222-3333-444455556666",
    eventTitle: "Annual BA Leadership Summit 2026",
    sessionId: "b3c5d7e9-2222-3333-4444-555566667777",
    sessionTitle: "Morning keynote: AI in global enterprise",
    action: "time_out",
    status: "checked_out",
    method: "qr",
    officer: "System Administrator",
    timestamp: "2026-10-24T12:20:00+08:00",
    durationMinutes: 248,
  },
  {
    id: "scan-seed-2",
    studentName: "Maria Santos",
    studentIdNumber: "2024001876",
    majorCode: "BSBA-MM",
    section: "MM-1A",
    eventId: "a2b4c6d8-1111-2222-3333-444455556666",
    eventTitle: "Annual BA Leadership Summit 2026",
    sessionId: "b3c5d7e9-2222-3333-4444-555566667777",
    sessionTitle: "Morning keynote: AI in global enterprise",
    action: "time_in",
    status: "on_time",
    method: "qr",
    officer: "System Administrator",
    timestamp: "2026-10-24T08:12:00+08:00",
  },
  {
    id: "scan-seed-3",
    studentName: "Juan Dela Cruz",
    studentIdNumber: "2021003213",
    majorCode: "BSBA-MM",
    section: "MM-3B",
    eventId: "a2b4c6d8-1111-2222-3333-444455556666",
    eventTitle: "Annual BA Leadership Summit 2026",
    sessionId: "b3c5d7e9-2222-3333-4444-555566667777",
    sessionTitle: "Morning keynote: AI in global enterprise",
    action: "time_out",
    status: "checked_out",
    method: "qr",
    officer: "System Administrator",
    timestamp: "2026-10-24T12:18:00+08:00",
    durationMinutes: 233,
  },
  {
    id: "scan-seed-4",
    studentName: "Juan Dela Cruz",
    studentIdNumber: "2021003213",
    majorCode: "BSBA-MM",
    section: "MM-3B",
    eventId: "a2b4c6d8-1111-2222-3333-444455556666",
    eventTitle: "Annual BA Leadership Summit 2026",
    sessionId: "b3c5d7e9-2222-3333-4444-555566667777",
    sessionTitle: "Morning keynote: AI in global enterprise",
    action: "time_in",
    status: "late",
    method: "qr",
    officer: "System Administrator",
    timestamp: "2026-10-24T08:25:00+08:00",
  },
  {
    id: "scan-seed-5",
    studentName: "Andrea Nicole Reyes",
    studentIdNumber: "2022001234",
    majorCode: "BSBA-MM",
    section: "MM-2A",
    eventId: "a2b4c6d8-1111-2222-3333-444455556666",
    eventTitle: "Annual BA Leadership Summit 2026",
    sessionId: "b3c5d7e9-2222-3333-4444-555566667777",
    sessionTitle: "Morning keynote: AI in global enterprise",
    action: "time_in",
    status: "on_time",
    method: "qr",
    officer: "System Administrator",
    timestamp: "2026-10-24T08:08:00+08:00",
  },
  {
    id: "scan-seed-6",
    studentName: "Paolo Miguel Lim",
    studentIdNumber: "2023004567",
    majorCode: "BSBA-MM",
    section: "MM-2B",
    eventId: "a2b4c6d8-1111-2222-3333-444455556666",
    eventTitle: "Annual BA Leadership Summit 2026",
    sessionId: "b3c5d7e9-2222-3333-4444-555566667777",
    sessionTitle: "Morning keynote: AI in global enterprise",
    action: "time_out",
    status: "left_early",
    method: "manual",
    officer: "System Administrator",
    timestamp: "2026-10-24T10:45:00+08:00",
    durationMinutes: 150,
  },
  {
    id: "scan-seed-7",
    studentName: "Paolo Miguel Lim",
    studentIdNumber: "2023004567",
    majorCode: "BSBA-MM",
    section: "MM-2B",
    eventId: "a2b4c6d8-1111-2222-3333-444455556666",
    eventTitle: "Annual BA Leadership Summit 2026",
    sessionId: "b3c5d7e9-2222-3333-4444-555566667777",
    sessionTitle: "Morning keynote: AI in global enterprise",
    action: "time_in",
    status: "on_time",
    method: "manual",
    officer: "System Administrator",
    timestamp: "2026-10-24T08:15:00+08:00",
  },
];

export function getSeedScans(): AttendanceScan[] {
  return structuredClone(SEED_SCANS);
}

function tryReadDisk(): AttendanceScan[] | null {
  try {
    if (fs.existsSync(PERSIST_FILE)) {
      const raw = fs.readFileSync(PERSIST_FILE, "utf-8");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as AttendanceScan[];
      }
    }
  } catch {}
  return null;
}

function tryWriteDisk(scans: AttendanceScan[]) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(PERSIST_FILE, JSON.stringify(scans, null, 2), "utf-8");
  } catch {}
}

const g = globalThis as unknown as {
  __ba_scans?: AttendanceScan[];
  /** Consumed QR token ids → expiry (unix seconds), for single-use enforcement. */
  __ba_tokens?: Map<string, number>;
};

function sanitizeScan(s: AttendanceScan): AttendanceScan {
  if (s.section === "BA-FM 2-1" || s.section?.startsWith("BA-")) {
    s.section = "MM-1A";
  }
  if (s.studentIdNumber === "2024-01492-BA") {
    s.studentIdNumber = "2024001876";
  }
  return s;
}

export function resetToSeeds(): AttendanceScan[] {
  g.__ba_scans = getSeedScans();
  g.__ba_tokens = new Map();
  tryWriteDisk(g.__ba_scans);
  return g.__ba_scans;
}

export function loadPersistedScans(fallbackToSeedIfEmpty = false): AttendanceScan[] {
  const disk = tryReadDisk();
  if (disk !== null && (!fallbackToSeedIfEmpty || disk.length > 0)) {
    g.__ba_scans = disk.map(sanitizeScan);
  } else {
    g.__ba_scans = getSeedScans();
  }
  tryWriteDisk(g.__ba_scans);
  return g.__ba_scans;
}

if (!g.__ba_scans) {
  loadPersistedScans(true);
}
if (!g.__ba_tokens) g.__ba_tokens = new Map();

export function listScans(): AttendanceScan[] {
  if (!g.__ba_scans) {
    loadPersistedScans();
  } else {
    let modified = false;
    for (const s of g.__ba_scans) {
      if (s.section === "BA-FM 2-1" || s.section?.startsWith("BA-")) {
        s.section = "MM-1A";
        modified = true;
      }
      if (s.studentIdNumber === "2024-01492-BA") {
        s.studentIdNumber = "2024001876";
        modified = true;
      }
    }
    if (modified) tryWriteDisk(g.__ba_scans);
  }
  return g.__ba_scans!;
}

export function addScan(scan: Omit<AttendanceScan, "id">): AttendanceScan {
  if (!g.__ba_scans) loadPersistedScans();
  const record: AttendanceScan = { ...scan, id: `scan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
  g.__ba_scans!.unshift(record);
  tryWriteDisk(g.__ba_scans!);
  return record;
}

export function findScan(studentIdNumber: string, sessionId: string, action: ScanAction): AttendanceScan | undefined {
  if (!g.__ba_scans) loadPersistedScans();
  return g.__ba_scans!.find(
    (s) => s.studentIdNumber === studentIdNumber && s.sessionId === sessionId && s.action === action
  );
}

export function getScan(id: string): AttendanceScan | undefined {
  if (!g.__ba_scans) loadPersistedScans();
  return g.__ba_scans!.find((s) => s.id === id);
}

export function correctScan(id: string, correction: ScanCorrection): AttendanceScan | null {
  const scan = getScan(id);
  if (!scan) return null;
  scan.correction = correction;
  tryWriteDisk(g.__ba_scans!);
  return scan;
}

export function clearScans(): number {
  const count = g.__ba_scans?.length ?? 0;
  g.__ba_scans = [];
  g.__ba_tokens = new Map();
  tryWriteDisk(g.__ba_scans);
  return count;
}

/**
 * Marks a QR token as used. Returns false when it was already used.
 * Expired ids are pruned as we go; an expired token is rejected before it gets here.
 */
export function consumeToken(tokenId: string, expiresAt: number): boolean {
  if (!g.__ba_tokens) g.__ba_tokens = new Map();
  const tokens = g.__ba_tokens;
  if (tokens.has(tokenId)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (tokens.size > 500) {
    for (const [id, exp] of tokens) if (exp < now) tokens.delete(id);
  }
  tokens.set(tokenId, expiresAt);
  return true;
}
