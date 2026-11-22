-- A quiet note about the last good read, kept apart from last_error since the
-- read worked: some repeating events had too many repeats to work out and
-- were left out. Null when the read held nothing to note.
ALTER TABLE calendar_feed ADD COLUMN read_note text;
