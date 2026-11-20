-- Account alerts the owner hid from the home screen, keyed by the same kind
-- and subject as their notification (notifications/words.ts), so a hide and
-- an inbox dismissal speak of the same alert. Hiding never touches the inbox.
-- A hide lasts a day while the alert holds, and goes once the alert clears.
CREATE TABLE alert_hides (
  kind text NOT NULL,
  subject text NOT NULL,
  hidden_at timestamptz NOT NULL,
  PRIMARY KEY (kind, subject)
);
