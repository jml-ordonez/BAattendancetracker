-- Events can say when students may start registering, so they can have their QR
-- pass ready the day before (or earlier) and just show it when attendance opens.
--
-- * NULL means registration opens as soon as the event is published (the old behaviour).
-- * Registration must open before the event starts.
-- Safe to run more than once.

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS registration_opens_at TIMESTAMPTZ;

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_registration_before_start;
ALTER TABLE public.events
    ADD CONSTRAINT events_registration_before_start
    CHECK (registration_opens_at IS NULL OR registration_opens_at < start_time);
