# BA Attendance

QR attendance for College of Business Administration events. Students register once and get an encrypted QR pass; staff scan it at the door to time students in and out, then review, correct and export the records.

Built with Next.js (App Router), React, TypeScript, Tailwind CSS and Supabase (Postgres).

> This project uses a newer Next.js than most guides describe. Before changing framework code, read the matching guide in `node_modules/next/dist/docs/` (see `AGENTS.md`).

## How it works

| Who | What they do | Where |
| --- | --- | --- |
| Student | Registers (no account or password) and shows a QR pass | `/`, `/student/qr` |
| Staff | Signs in, creates events, scans passes, corrects and exports records | `/admin/*` |

- Students have no logins. A student ID is protected by a private edit key kept on the phone that registered it.
- Staff sessions are a signed, httpOnly cookie, checked in `proxy.ts` and in every staff API route.
- All database access happens on the server with the Supabase service role. Row Level Security is on for every table, so the public (anon) key can read nothing.

## Setup

### 1. Install

```bash
npm install
```

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill it in. Set the same names in your host for the live site (Vercel: Project > Settings > Environment Variables), then redeploy.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key (staff sign-in with Supabase accounts) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only database access |
| `QR_3DES_SECRET_KEY` | Yes | Encrypts passes: 48 hex characters |
| `QR_HMAC_SECRET_KEY` | Yes | Signs passes: 64 hex characters |
| `ADMIN_SESSION_SECRET` | Recommended | Signs staff sessions and encrypts exports (falls back to `QR_HMAC_SECRET_KEY`) |
| `ADMIN_PASSWORD` | See below | Password of the built-in administrator |
| `ADMIN_USERNAME`, `ADMIN_EMAIL` | No | Built-in administrator's username and email (default `admin`, `admin@ua.edu.ph`) |
| `NEXT_PUBLIC_APP_URL` | No | Site address, used in password-reset links |
| `APP_TIMEZONE` | No | Time zone for messages and reports (default `Asia/Manila`) |
| `QR_KEY_VERSION` | No | Key label stored in each pass (default `k1`) |

Generate the secrets yourself; never reuse example values:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"   # QR_3DES_SECRET_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # QR_HMAC_SECRET_KEY
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # ADMIN_SESSION_SECRET
```

In production the app **refuses to run on missing or example secrets**: passes, staff sign-in and encrypted exports answer "the server isn't fully set up" until real values are set. Without Supabase variables, registration and scanning report that the database isn't connected rather than pretending to save.

Changing the keys later invalidates passes students have already downloaded (they reopen their pass page to get a new one) and encrypted exports made with the old key.

### 3. Database

In the Supabase SQL editor, run every file in `supabase/migrations/` **in filename order**. Each is safe to run more than once.

| File | Adds |
| --- | --- |
| `20261023_000001_initial_schema.sql` | Base schema (`events`, `event_sessions`, `profiles`, ...) |
| `20261029_000002_app_managed_events.sql` | Events managed by the app |
| `20261115_000003_students.sql` | `students` (registrations) |
| `20261115_000004_door_scans.sql` | `door_scans` (attendance records) |
| `20261115_000005_student_edit_token.sql` | Student ID protection |
| `20261116_000006_registration_opens.sql` | Registration opening time |
| `20261116_000007_harden_unused_schema.sql` | Locks down unused legacy tables |

`supabase/seed.sql` is optional reference data; the app doesn't need it.

### 4. Staff accounts

Either set `ADMIN_PASSWORD` for the built-in administrator, or create Supabase staff accounts:

```bash
npm run add-admin -- someone@ua.edu.ph "a-long-password" First Last administrator
```

There is no default password.

### 5. Run

```bash
npm run dev      # http://localhost:3000
npm test         # unit and route tests (no database needed)
npm run lint
npm run build
```

## Project structure

```
app/                  Pages and API routes
  admin/              Staff console (dashboard, events, scanner, records, audit log)
  student/qr/         The student's pass
  api/                Route handlers: auth, events, students, qr, attendance, reports, audit
components/           UI by area: admin, auth, scanner, student, landing, ui
lib/                  Logic shared by routes and screens
  attendance/         Scan pipeline, schedule rules, roll building, scan store
  auth/               Staff session cookie, built-in administrator, student device registration
  config/             Server secret handling
  crypto/, tokens/    Pass encryption and validation
  events/, students/  Supabase stores
  export/             CSV generation and encryption
supabase/migrations/  Database schema, in order
scripts/              add-admin
tests/                Vitest suites
types/                Shared TypeScript types
proxy.ts              Guards /admin pages
```

## Known limits

- The audit log, the sign-in lockout and the registration rate limit are kept in server memory, so on a serverless host they are per instance and reset on restart.
- Pass creation (`/api/qr/generate`) doesn't yet check that the student is registered, so a pass shows what its holder typed. Staff should still check the name against the student's ID at the door.
