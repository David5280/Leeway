-- An optional calendar the owner links by its private address, and the money
-- relevant events read from it.

-- At most one calendar. Its address is a secret (anyone with it can read the
-- calendar), so only the encrypted form is kept; host is shown to say which
-- calendar is linked without the address itself. last_error says why the
-- last read failed; read_note is a quiet note about the last good read, kept
-- apart since that read worked (some repeating events were left out).
CREATE TABLE calendar_feed (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  url_encrypted text NOT NULL,
  host text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  fetched_at timestamptz,
  last_error text,
  read_note text
);

-- The calendar's events from the last read, a few years back and a year ahead.
-- A yearly event (a birthday) has one row per year, told apart by its start.
CREATE TABLE calendar_events (
  uid text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  title text NOT NULL,
  location text,
  all_day boolean NOT NULL,
  PRIMARY KEY (uid, starts_on),
  CHECK (ends_on >= starts_on)
);

CREATE INDEX calendar_events_starts_on ON calendar_events (starts_on);
