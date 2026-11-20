-- Account alerts the owner hid from the home screen, keyed by the same kind
-- and subject as their notification (notifications/words.ts), so a hide and
-- an inbox dismissal speak of the same alert. Hiding never touches the inbox.
-- A condition's hide lasts a day while it holds; a fee's lasts while that fee
-- is the latest. The notifier drops a hide once its alert has been gone for a
-- while (see notifications/homeAlerts.ts).
CREATE TABLE alert_hides (
  kind text NOT NULL,
  subject text NOT NULL,
  hidden_at timestamptz NOT NULL,
  -- When the notifier last saw the alert gone; null while it is current.
  cleared_at timestamptz,
  PRIMARY KEY (kind, subject)
);
