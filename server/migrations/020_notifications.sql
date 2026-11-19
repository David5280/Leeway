-- Notifications: an inbox in the app, fed by the same alerts the dashboard
-- shows, and optional Web Push to the owner's devices.

-- One row per alert, kept once per kind and subject (an account, a bill's due
-- date, a transaction), so the same news never shows or pushes twice.
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  subject text NOT NULL,
  title text NOT NULL,
  -- The full sentence, amounts included, shown only in the app.
  message text NOT NULL,
  -- The words a push may carry: shown names only, never amounts or bank text.
  push_body text NOT NULL,
  -- The screen in the app that explains it, like /alerts.
  link text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  dismissed_at timestamptz,
  -- When a condition like "overdrawn" cleared. It comes back as new if it recurs.
  resolved_at timestamptz,
  -- Whether a push is owed: none, pending (waiting for quiet hours or the rate
  -- limit), sent, or skipped (no device, turned off, or no longer true).
  push_state text NOT NULL DEFAULT 'none'
    CHECK (push_state IN ('none', 'pending', 'sent', 'skipped')),
  pushed_at timestamptz,
  UNIQUE (kind, subject)
);
CREATE INDEX notifications_created_at ON notifications (created_at DESC);
CREATE INDEX notifications_pending ON notifications (push_state) WHERE push_state = 'pending';

-- Each device that turned push on. The endpoint is the push service's address
-- for that browser; p256dh and auth are its keys for encrypting messages.
CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz
);

-- The server's own VAPID key pair, made on first start. The private key is
-- encrypted with ENCRYPTION_KEY, like bank tokens, and never leaves the server.
CREATE TABLE push_keys (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  public_key text NOT NULL,
  private_key_encrypted text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The owner's notification choices. One row, kept out of the settings
-- document (like weekly_email), so an assistant, an export or an import can
-- neither read nor change them.
CREATE TABLE notification_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  data jsonb NOT NULL DEFAULT '{}',
  -- The last push sent, so a burst of syncs sends one push, not many.
  last_push_at timestamptz,
  -- The last time the bell brought the inbox up to date, so open tabs
  -- checking the count do not redo the work every minute each.
  refreshed_at timestamptz
);
INSERT INTO notification_settings (id) VALUES (true);
