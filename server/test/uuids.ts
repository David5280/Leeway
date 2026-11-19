// Ids taken out of a test's text before it is checked for figures that must
// not be there, like an account's last four digits: a random UUID can hold
// any run of digits, so "4321" turns up in about one id in a few hundred.

/** A UUID as Postgres and crypto.randomUUID write it. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** The text with each UUID replaced by "<uuid>", so a check for digits sees only what was written. */
export const withoutUuids = (text: string): string => text.replace(UUID, '<uuid>')
