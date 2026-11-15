-- A student ID can only be changed by the device that registered it.
--
-- Registration used to overwrite the row for a student ID, so a second person
-- typing the same ID replaced the first student's name. Now the first
-- registration hands the device a private edit key; only a SHA-256 hash of it
-- is stored here. Rows registered before this change have no hash and can be
-- claimed once by re-registering with the same name and email.
-- Safe to run more than once.

ALTER TABLE public.students ADD COLUMN IF NOT EXISTS edit_token_hash TEXT;
