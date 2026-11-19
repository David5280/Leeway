// Takes identifiers out of text read from a paystub before anything keeps,
// shows or logs it. A paystub carries a Social Security number, an employee
// ID, bank account and routing numbers and a home address; Leeway keeps only
// money figures, dates and the employer's name. Pure.

/** Put where something was taken out, so the owner sees that it was. */
export const REMOVED = '[removed]'

/** The longest source line kept: a label and an amount fit with room to spare. */
export const MAX_SOURCE_LENGTH = 120

/** The longest employer name kept. */
export const MAX_EMPLOYER_LENGTH = 80

/**
 * A Social Security number, plain or masked: 123-45-6789, 123 45 6789,
 * XXX-XX-6789, ***-**-6789. A mask is no word character, so the start is
 * "nothing like it before" rather than a word boundary.
 */
const SSN = /(?<![\w*•])[\dXx*•]{3}[-\s.]?[\dXx*•]{2}[-\s.]?\d{4}\b/g

/**
 * A label that names an identifier, with everything after it on the line,
 * since the value may be printed in any format after it. A label may end in
 * "#", so its end is "no word character next" rather than a word boundary.
 */
const LABELED_ID =
  /\b(?:ssn|soc(?:ial)?\.?\s*sec(?:urity)?|employee\s*(?:id|no|num(?:ber)?|#)|emp\.?\s*(?:id|no|#)|acct|account|routing|aba|transit|file\s*(?:no|#)|badge|clock\s*(?:no|#)|tax\s*id|ein|id\s*(?:no|#))(?!\w).*$/gim

/** A street address: a house number, up to four words, and a street word. */
const STREET =
  /\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s+){0,4}(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|court|ct|place|pl|parkway|pkwy|circle|cir|highway|hwy|terrace|ter|trail|trl)\b\.?(?:\s*(?:apt|unit|suite|ste|#)\s*[\w-]+)?/gi

/** A post office box. */
const PO_BOX = /\bp\.?\s*o\.?\s*box\s*\d+/gi

/** A state and ZIP code, as at the end of an address: CO 80220 or CO 80220-1234. */
const STATE_ZIP = /\b[A-Z]{2},?\s+\d{5}(?:-\d{4})?\b/g

/** An email address. */
const EMAIL = /\S+@\S+/g

/** A money amount as a paystub prints one: 1,234.56, $275.00, (12.50) or -275.00. */
const MONEY = /^[-(]?\$?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\)?$|^[-(]?\$?\d+\.\d{2}\)?$/

/** A date: 11/14/2026, 11-14-26 or 2026-11-14. */
const DATE = /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$|^\d{4}-\d{2}-\d{2}$/

/** A percent or a count of hours: 11.00%, 80.00. */
const PERCENT = /^\d{1,3}(?:\.\d+)?%$/

/**
 * Any other word holding five or more digits is an identifier: an account
 * number, a check number, an ID. Money, dates and percents are kept.
 */
function redactWord(word: string): string {
  const digits = word.replace(/\D/g, '').length
  if (digits < 5) return word
  if (MONEY.test(word) || DATE.test(word) || PERCENT.test(word)) return word
  return REMOVED
}

/** Runs of the removed marker, which read as one. */
const REPEATED = new RegExp(`(?:${escape(REMOVED)}\\s*){2,}`, 'g')

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Text with every identifier this module knows replaced by REMOVED, on one line. */
export function redact(text: string): string {
  const patterns = [LABELED_ID, SSN, STREET, PO_BOX, STATE_ZIP, EMAIL]
  const scrubbed = patterns.reduce((current, pattern) => current.replace(pattern, REMOVED), text)
  return scrubbed
    .split(/\s+/)
    .filter((word) => word !== '')
    .map(redactWord)
    .join(' ')
    .replace(REPEATED, `${REMOVED} `)
    .trim()
}

/** A source line, redacted and cut to length; null when nothing useful is left. */
export function redactSource(text: string | null): string | null {
  if (text === null) return null
  const clean = redact(text).slice(0, MAX_SOURCE_LENGTH).trim()
  return clean === '' || clean === REMOVED ? null : clean
}

/**
 * The employer's name, redacted and cut to length. Only the name is kept: an
 * address printed after it, on the same line or after a comma, is dropped.
 */
export function redactEmployer(text: string | null): string | null {
  if (text === null) return null
  const name = redact(text.split(/[\n,]/)[0]!).replaceAll(REMOVED, '').replace(/\s+/g, ' ').trim()
  return name === '' ? null : name.slice(0, MAX_EMPLOYER_LENGTH).trim()
}
