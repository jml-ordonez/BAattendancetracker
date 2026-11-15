# CSV Decryption & Admin Attendance Records Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix attendance records and coordinator view disappearing/flashing on admin sign-in, and add secure CSV encryption and in-dashboard decryption tools with table preview and download capabilities.

**Architecture:** 
1. Durable persistence in `lib/attendance/store.ts` with local file cache + Supabase sync and seeded scan records, eliminating in-memory data wipeout on server reload/login.
2. Smart session resolution in `CoordinatorScreen` and `SessionSelect` prioritizing sessions with active scans and retaining user selection via `sessionStorage`.
3. High-performance authenticated cryptographic module (`lib/export/csv-crypto.ts`) supporting AES-256-GCM and 3DES+HMAC for CSV encryption and decryption.
4. An interactive `DecryptModal` and enhanced export controls in `RecordsScreen` and `OverviewScreen` with drag-and-drop file upload, live table preview, and plain CSV export.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, Node Crypto, Lucide Icons.

**Spec:** Direct user requirements to resolve records disappearing upon admin login and provide an encrypted CSV decryption tool in the admin dashboard.

## Global Constraints
- Must comply with Next.js 16 App Router conventions and preserve `AGENTS.md`.
- Encrypted CSV envelopes must use authenticated encryption (AEAD: AES-256-GCM or HMAC-SHA256 authenticated 3DES) to prevent tampering.
- Do not expose server cryptographic keys to client bundles; decryption can be performed via server API or client with provided user keys.
- Preserve backward compatibility with existing attendance scan models and CSV schemas.

## Review Focus
1. Admin login with full page navigation (`window.location.replace`) retains attendance records without disappearing.
2. Coordinator view automatically defaults to the session that has scans if no session is explicitly picked.
3. Tampered or corrupted encrypted CSV files display clear, graceful error messages instead of crashing.
4. Excel-compatible UTF-8 BOM encoding is maintained on exported and decrypted CSV files.
5. Large CSV uploads (up to 5MB) decrypt quickly with responsive table pagination.

---

### Task 1: Fix Attendance Record Volatility & Coordinator View Disappearing Bug

**Files:**
- Modify: `lib/attendance/store.ts`
- Modify: `components/admin/screens/Coordinator.tsx`
- Modify: `components/admin/SessionSelect.tsx`
- Modify: `components/admin/AdminData.tsx`
- Test: `tests/attendance.test.ts`

**Interfaces:**
- Consumes: `AttendanceScan`, `BAEvent`, `buildRoll()`
- Produces: Persistent scan storage that survives reloads, smart fallback session picker, and scan count badges in session selector.

- [ ] **Step 1: Write test verifying attendance store persistence and seed data**

```typescript
// in tests/attendance.test.ts
it("initializes with seeded sample scans if store is empty", () => {
  const scans = listScans();
  expect(scans.length).toBeGreaterThan(0);
  expect(scans.some((s) => s.studentName === "Maria Santos")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/attendance.test.ts`
Expected: FAIL (seed scans not yet in `store.ts`).

- [ ] **Step 3: Implement durable storage and seed scans in `lib/attendance/store.ts`**

Add persistent file cache in `.data/attendance-scans.json` (auto-created if missing) and default seed scans for the default seeded event sessions ("Morning keynote: AI in global enterprise").

- [ ] **Step 4: Update `CoordinatorScreen.tsx` and `SessionSelect.tsx`**

- In `CoordinatorScreen.tsx`: Smart-pick the session with the most scans when `chosenId` is unset, and store `chosenId` in `sessionStorage` so navigation/login never resets to an empty session.
- In `SessionSelect.tsx`: Show scan count badge for each session option (e.g. `(14 scans)`).
- In `AdminData.tsx`: Decouple `loaded` state so `scans` and `events` render immediately as they resolve without false empty-state flips.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/attendance.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/attendance/store.ts components/admin/screens/Coordinator.tsx components/admin/SessionSelect.tsx components/admin/AdminData.tsx tests/attendance.test.ts
git commit -m "fix: persist attendance scans across reloads and fix coordinator session selection"
```

---

### Task 2: Implement Cryptographic CSV Encryption & Decryption Engine

**Files:**
- Create: `lib/export/csv-crypto.ts`
- Test: `tests/csv-crypto.test.ts`

**Interfaces:**
- Produces:
  - `encryptCSV(plainCSV: string, keyOrPassphrase?: string): string`
  - `decryptCSV(encryptedData: string, keyOrPassphrase?: string): DecryptCSVResult`
  - `parseDecryptedRows(csvText: string): CSVAttendanceRow[]`

- [ ] **Step 1: Write tests for CSV encryption and decryption**

Test round-trip encryption/decryption, tampered ciphertext rejection, incorrect passphrase rejection, and CSV parsing into typed records.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/csv-crypto.test.ts`
Expected: FAIL with "module not found".

- [ ] **Step 3: Implement `lib/export/csv-crypto.ts`**

- Use AES-256-GCM with salt, IV, auth tag, and PBKDF2 key derivation for passphrase/system key.
- Provide armored envelope format `ENC-CSV:v1:<base64url>` so files can be identified safely.
- Include parsing utility to turn decrypted CSV back into structured `CSVAttendanceRow[]`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/csv-crypto.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/export/csv-crypto.ts tests/csv-crypto.test.ts
git commit -m "feat: implement AES-256-GCM authenticated CSV encryption and decryption module"
```

---

### Task 3: Encrypted CSV Export & Decrypt Route Handlers

**Files:**
- Modify: `app/api/reports/export/route.ts`
- Create: `app/api/reports/decrypt/route.ts`
- Test: `tests/export-decrypt-api.test.ts`

**Interfaces:**
- Consumes: `encryptCSV`, `decryptCSV`, `requireAdmin`
- Produces:
  - `GET /api/reports/export?encrypted=true` returning encrypted payload file
  - `POST /api/reports/decrypt` accepting `{ payload, passphrase? }` or multipart form data

- [ ] **Step 1: Write integration tests for export and decrypt endpoints**

Test that GET export with `encrypted=true` returns armored ciphertext and POST decrypt successfully reverses it with audit logging.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/export-decrypt-api.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update `app/api/reports/export/route.ts` and create `app/api/reports/decrypt/route.ts`**

- Add `encrypted=true` query param support to export route.
- Implement `/api/reports/decrypt` with audit logging (`report.decrypted`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/export-decrypt-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/reports/export/route.ts app/api/reports/decrypt/route.ts tests/export-decrypt-api.test.ts
git commit -m "feat: add encrypted CSV export option and decrypt API endpoint"
```

---

### Task 4: Decrypt CSV UI Component & Admin Dashboard Integration

**Files:**
- Create: `components/admin/DecryptCSVModal.tsx`
- Modify: `components/admin/screens/Records.tsx`
- Modify: `components/admin/screens/Overview.tsx`

**Interfaces:**
- Consumes: `/api/reports/decrypt`, `Modal`, `btn`, `card`
- Produces: User-friendly modal dialog for uploading or pasting encrypted CSV, decrypting with system key or custom passphrase, previewing rows in an accessible table, and downloading plain CSV.

- [ ] **Step 1: Create `components/admin/DecryptCSVModal.tsx`**

- Drag-and-drop file upload zone for `.csv`, `.enc`, `.txt` files.
- Option toggle: "Use System Secret Key" vs "Enter Custom Password / Key".
- Live decrypted table preview with student ID, name, section, event, time-in/out, and status badge.
- One-click "Download Decrypted CSV" action button.
- Comprehensive error boundary and validation alerts for bad passwords or corrupted files.

- [ ] **Step 2: Integrate into `components/admin/screens/Records.tsx`**

- Add "Decrypt CSV" button in PageHeader actions alongside Export.
- Update "Export CSV" to provide a quick choice between "Standard CSV" and "Encrypted CSV (Confidential)".

- [ ] **Step 3: Integrate shortcut into `components/admin/screens/Overview.tsx`**

- Add "Decrypt CSV" quick access in overview header/actions.

- [ ] **Step 4: Verify manual interactive flow and styling**

Run Next build and verify UI integration with no hydration or layout errors.

- [ ] **Step 5: Commit**

```bash
git add components/admin/DecryptCSVModal.tsx components/admin/screens/Records.tsx components/admin/screens/Overview.tsx
git commit -m "feat: add Decrypt CSV modal with preview and enhanced export to admin console"
```

---

### Task 5: End-to-End Verification and Polish

**Files:**
- All modified and created files
- Tests

- [ ] **Step 1: Run full Vitest suite**

Run: `npm run test`
Expected: All tests pass.

- [ ] **Step 2: Run Next.js production build**

Run: `npm run build`
Expected: Build succeeds with zero TypeScript or route compilation errors.

- [ ] **Step 3: Verification with superpowers:verification-before-completion**

Verify evidence of all fixes and new features before final completion.

