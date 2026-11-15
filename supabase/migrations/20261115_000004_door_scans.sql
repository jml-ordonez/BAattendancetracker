-- Attendance scans are now stored in Supabase by the app's API routes (service
-- role). They used to live in server memory and a local JSON file, which on a
-- serverless host differs between instances and resets on restart: cleared
-- records (and the sample students) came back, and scans saved on one instance
-- never showed on another.
--
-- * No foreign keys: students have no accounts, staff have no profiles, and a
--   deleted event keeps its records under their saved title.
-- * UNIQUE (student_id_number, session_id, action) lets the database refuse a
--   second time-in or time-out even when two scans arrive at the same moment.
-- * RLS is on with no policies: only the server (service role) can read or write.
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS public.door_scans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id_number TEXT NOT NULL CHECK (char_length(student_id_number) BETWEEN 1 AND 20),
    student_name TEXT NOT NULL CHECK (char_length(student_name) BETWEEN 1 AND 100),
    major_code TEXT NOT NULL CHECK (major_code IN ('BSBA-MM', 'BSBA-FM', 'BSBA-HRM', 'BSBA-OM')),
    section TEXT NOT NULL CHECK (char_length(section) BETWEEN 1 AND 20),
    event_id UUID NOT NULL,
    event_title TEXT NOT NULL,
    session_id UUID NOT NULL,
    session_title TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('time_in', 'time_out')),
    status TEXT NOT NULL CHECK (status IN ('on_time', 'late', 'checked_out', 'left_early')),
    method TEXT NOT NULL CHECK (method IN ('qr', 'manual')),
    officer TEXT NOT NULL,
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    duration_minutes INT CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
    correction JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT door_scans_one_per_student_session_action UNIQUE (student_id_number, session_id, action)
);

CREATE INDEX IF NOT EXISTS door_scans_scanned_at_idx ON public.door_scans (scanned_at DESC);
CREATE INDEX IF NOT EXISTS door_scans_event_id_idx ON public.door_scans (event_id);
CREATE INDEX IF NOT EXISTS door_scans_session_id_idx ON public.door_scans (session_id);

ALTER TABLE public.door_scans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.door_scans FROM anon, authenticated;
