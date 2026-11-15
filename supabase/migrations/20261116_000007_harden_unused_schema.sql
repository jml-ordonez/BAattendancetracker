-- Hardening for parts of the first migration that the app doesn't use.
--
-- The app reads and writes only events, event_sessions, students, door_scans
-- and profiles, always from the server with the service role. The rest of the
-- original 20-table schema is unused, but two things in it were reachable with
-- the public (anon) key:
--
-- * rate_limit_records never had Row Level Security turned on.
-- * process_attendance_scan is SECURITY DEFINER (it runs with the owner's
--   rights) and Postgres lets everyone execute new functions by default, so it
--   could be called through the public API. It also had no fixed search_path.
-- Safe to run more than once.

ALTER TABLE IF EXISTS public.rate_limit_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limit_records FROM anon, authenticated;

DO $$
BEGIN
    IF to_regprocedure('public.process_attendance_scan(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text)') IS NOT NULL THEN
        REVOKE EXECUTE ON FUNCTION public.process_attendance_scan(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text)
            FROM PUBLIC, anon, authenticated;
        ALTER FUNCTION public.process_attendance_scan(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text)
            SET search_path = public, pg_temp;
    END IF;
END;
$$;
