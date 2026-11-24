-- The day each repeat of a repeating event was set for in its series (its
-- RECURRENCE-ID), which stays the same when that repeat alone is moved; null
-- for an event that happens once. With the event's id it tells one repeat
-- from its neighbours, so a trip budget follows its own repeat (match.ts).
-- Events read before this are filled in by the next read of the calendar.
ALTER TABLE calendar_events ADD COLUMN repeat_on date;
