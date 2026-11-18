-- The weekly summary email: the owner's choices and a record of each send.
-- One row, like settings, but kept out of the settings document so the
-- address and the switch never travel through update_settings, an export or
-- an import, and an assistant can neither read nor change them.
CREATE TABLE weekly_email (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  -- Null sends to the owner's sign-in email.
  send_to text,
  -- 0 = Sunday through 6 = Saturday, and the hour of the day, in the owner's time zone.
  weekday smallint NOT NULL DEFAULT 1 CHECK (weekday BETWEEN 0 AND 6),
  hour smallint NOT NULL DEFAULT 8 CHECK (hour BETWEEN 0 AND 23),
  -- When it was turned on or its day or hour last changed. Sends due before
  -- then are skipped, so a change takes effect from the next chosen time.
  scheduled_since timestamptz,
  -- The scheduled moment of the last email that went out, and when it went.
  sent_slot timestamptz,
  sent_at timestamptz,
  -- The scheduled moment being tried, when, and how many times, so a failed
  -- send is retried a few times and never on every tick.
  attempt_slot timestamptz,
  attempt_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  last_error_at timestamptz,
  -- The last test email, so the test button cannot be pressed into a flood.
  test_sent_at timestamptz,
  -- Bumped on every write. A send claims its moment only if nothing changed
  -- since it looked, so two servers running at once never both send.
  revision integer NOT NULL DEFAULT 0,
  CHECK (send_to IS NULL OR send_to <> '')
);
INSERT INTO weekly_email (id) VALUES (true);
