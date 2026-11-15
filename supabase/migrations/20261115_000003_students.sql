-- Students register without an account or password, so they cannot live in
-- public.profiles (which extends auth.users). Their registration is kept here,
-- written only by the app's API route with the service role.
--
-- * One row per student ID number; registering again updates the row.
-- * RLS is on with no policies: the anon and authenticated keys can neither
--   read nor write student data (names and emails are personal data).
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS public.students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id_number TEXT NOT NULL UNIQUE
        CHECK (student_id_number ~ '^(\d{10}|\d{4}-\d{5}-BA)$'),
    first_name TEXT NOT NULL CHECK (char_length(first_name) BETWEEN 1 AND 40),
    last_name TEXT NOT NULL CHECK (char_length(last_name) BETWEEN 1 AND 40),
    email TEXT NOT NULL UNIQUE
        CHECK (email = lower(email) AND email ~ '^[^\s@]+@ua\.edu\.ph$'),
    major_code TEXT NOT NULL CHECK (major_code IN ('BSBA-MM', 'BSBA-FM', 'BSBA-HRM', 'BSBA-OM')),
    year_level TEXT NOT NULL CHECK (year_level IN ('1st Year', '2nd Year', '3rd Year', '4th Year')),
    section TEXT NOT NULL CHECK (section ~ '^(MM|FM|HRM|OM)-[1-4][A-Z0-9]$'),
    event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS students_event_id_idx ON public.students (event_id);
CREATE INDEX IF NOT EXISTS students_section_idx ON public.students (section);

CREATE OR REPLACE FUNCTION public.set_students_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := timezone('utc'::text, now());
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS students_set_updated_at ON public.students;
CREATE TRIGGER students_set_updated_at
    BEFORE UPDATE ON public.students
    FOR EACH ROW EXECUTE FUNCTION public.set_students_updated_at();

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.students FROM anon, authenticated;
