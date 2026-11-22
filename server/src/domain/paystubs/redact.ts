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

/** The longest pension plan name kept: the most a pension's name may be. */
export const MAX_PLAN_NAME_LENGTH = 80

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
  /\b(?:ssn|soc(?:ial)?\.?\s*sec(?:urity)?|employee\s*(?:id|no|num(?:ber)?|#)|member\s*(?:id|no|num(?:ber)?|#)|emp\.?\s*(?:id|no|#)|acct|account|routing|aba|transit|file\s*(?:no|#)|badge|clock\s*(?:no|#)|tax\s*id|ein|id\s*(?:no|#))(?!\w).*$/gim

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
 * The name at the start of a line, redacted and cut to `max`: an address or
 * detail printed after it, on the same line or after a comma, is dropped, and
 * so is everything after the first thing taken out, since a city and state
 * follow a street address ("1437 Bannock St Denver CO").
 */
function leadingName(text: string | null, max: number): string | null {
  if (text === null) return null
  const parts = redact(text.split(/[\n,]/)[0]!).split(REMOVED)
  // The name is what comes before the first removal, or after it when the line began with one.
  const name = parts.map((part) => part.trim()).find((part) => part !== '') ?? ''
  return name === '' ? null : name.slice(0, max).trim()
}

/** The employer's name only, never the address printed after it. */
export function redactEmployer(text: string | null): string | null {
  return leadingName(text, MAX_EMPLOYER_LENGTH)
}

/**
 * A word that starts a member number or a figure, never part of a plan's
 * name: one holding #, % or $, like a rate or "#4417", or a number on its own
 * with no letters, like "4417" or "422.95". Letters with digits, as in
 * "1199SEIU", may be a name.
 */
const NOT_A_NAME_WORD = /[#%$]|^\P{L}*\d\P{L}*$/u

/**
 * A plan's own number after "Plan" or "Tier", one digit from 1 to 9, as in
 * "PERS Plan 2" or "NYSLRS Tier 6"; a closing "." or ":" may follow it.
 */
const PLAN_NUMBER = /^[1-9][.:]?$/
const NUMBERED_WORDS = new Set(['plan', 'tier'])

/** Words that label the member number printed after them, so the name ends before them. */
const ID_LABELS = new Set(['no', 'id'])

/**
 * Words a pension line prints after the plan's name, which name the
 * deduction or the member, not the plan.
 */
const LABEL_WORDS = new Set([
  'member',
  'mbr',
  'employee',
  'ee',
  'pre-tax',
  'pretax',
  'contribution',
  'contrib',
  'deduction',
  'ded',
])

/**
 * A word as LABEL_WORDS and ID_LABELS hold it: lower case, with no brackets
 * around it and no closing "." or ":", so "(Member)", "No." and "ID:" count.
 */
const labelForm = (word: string) =>
  word
    .toLowerCase()
    .replace(/^[([]+|[)\]]+$/g, '')
    .replace(/[.:]$/, '')

/** Whether a word ends a plan's name: a member number, a figure or an ID label. */
function endsName(word: string, before: string | undefined): boolean {
  if (ID_LABELS.has(labelForm(word))) return true
  if (!NOT_A_NAME_WORD.test(word)) return false
  // "Plan 2" and "Tier 6" are the plan's own name, not a member number.
  const planNumber = PLAN_NUMBER.test(word) && NUMBERED_WORDS.has(labelForm(before ?? ''))
  return !planNumber
}

/**
 * Whether a word left at the end of a name labels the deduction or member
 * rather than naming the plan, or is bare punctuation, like a bracket left
 * open where a member number was taken out.
 */
function isTrailingLabel(word: string): boolean {
  const form = labelForm(word)
  return LABEL_WORDS.has(form) || !/[\p{L}\p{N}]/u.test(form)
}

/**
 * The pension plan's name only, like "PERA" or "PERS Plan 2", short enough to
 * name a pension by: everything from the first member number, figure or ID
 * label on is dropped, then any label words left at its end and a trailing
 * colon. "PERA Member 11.00% 422.95", "PERA No. 4417" and "PERA (Member)" are
 * all "PERA"; "PERA (DB)" and "1199SEIU Pension" are kept whole.
 */
export function redactPlanName(text: string | null): string | null {
  const name = leadingName(text, MAX_PLAN_NAME_LENGTH)
  if (name === null) return null
  const words = name.split(' ')
  const cut = words.findIndex((word, index) => endsName(word, words[index - 1]))
  const kept = cut === -1 ? words : words.slice(0, cut)
  while (kept.length > 0 && isTrailingLabel(kept.at(-1)!)) kept.pop()
  // A label's colon may be left on the name itself, as in "PERA: 422.95".
  const named = kept.join(' ').replace(/:$/, '')
  return named === '' ? null : named
}
