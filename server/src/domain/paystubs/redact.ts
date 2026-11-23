// Takes identifiers out of text read from a paystub before anything keeps,
// shows or logs it. A paystub carries a Social Security number, an employee
// ID, bank account and routing numbers, a home address and the employee's
// name; Leeway keeps only money figures, dates and the employer's name. A line
// naming a garnishment or support order is dropped whole. Pure.
//
// A name is caught here only beside a label or a title ("Employee: Jane Doe",
// "Ms. Doe"). A bare name like "DOE, JANE" looks like any other words, so
// only the reader's prompt can keep it out, and the prompt forbids names.

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

/**
 * Where a "to" names an account or a column, not a person: "Gross Pay To
 * Date", "Net Pay to Checking", "Deposited to Savings".
 */
const NOT_A_PERSON = String.raw`(?!\s+(?:date|checking|savings|account|acct)\b)`

/**
 * Labels that introduce a person's name. "Plan Name: PERA" is a plan, not a
 * person, and stays.
 */
const NAME_LABELS = [
  // "Name: Jane Doe" at the start of a line.
  String.raw`^\s*name\b`,
  // "EE: Jane Doe" at the start of a line; "PERA EE: 422.95" is a plan's line and stays.
  String.raw`^\s*ee\s*:`,
  // "Employee Name Jane Doe", "Emp. Name", "Employee: Jane Doe".
  String.raw`\b(?:employee|emp\.?)\s+name\b`,
  String.raw`\bemployee\s*:`,
  // "Pay to (the order of) Jane Doe", "Payable to", "Paid to", "Deposited to".
  String.raw`\b(?:pay(?:able)?|paid|deposited)\s+to\b${NOT_A_PERSON}`,
  // "Payroll for: Jane Doe", "Deposited for Jane Doe", "Payee Jane Doe".
  String.raw`\b(?:payroll|deposited)\s+for\b`,
  String.raw`\bpayee\b`,
]

/** Any name label, with the rest of its line, since the name may run to the end of it. */
const LABELED_NAME = new RegExp(`(?:${NAME_LABELS.join('|')})(?!\\w).*$`, 'gim')

/** A name after a title of address: "Ms. Jane Doe", "Dr Doe". */
const TITLED_NAME =
  /\b(?:[Mm]rs?|[Mm][sx]|[Mm]iss|[Dd]r)\.?\s+[A-Z][\w'-]*(?:\s+[A-Z][\w'-]*){0,3}/g

/**
 * A masked account or card number, which keeps too few digits for the long
 * number rule: XXXXXX1234, ****1234, xx-1234. A mask is no word character,
 * so the start is "nothing like it before" rather than a word boundary.
 */
const MASKED_NUMBER = /(?<![\w*•])[Xx*•#]{2,}[-\s]?\d{2,}(?!\w)/g

/**
 * Words that mark a garnishment, levy, alimony or support order, which Leeway
 * never names: "Support - Jane Doe", "Child Supp", "Support Ord", "CSE ORDER"
 * (child support enforcement), "AWG" (an administrative wage garnishment).
 * "Spousal support" and "spousal maintenance" go; "Spousal Life" insurance
 * stays. Whole words only, so "Supplemental Life" and "courses" stay too.
 */
const SENSITIVE_DEDUCTION =
  /\b(?:garnish\w*|levy|levies|alimony|spousal\s+maint\w*|support|child\s+supp\w*|supp\.?\s+ord\w*|cse|awg|wage\s+(?:assignment|order)|bankruptcy|chapter\s+13|creditor|tax\s+lien)\b/i

/** An email address. */
const EMAIL = /\S+@\S+/g

/** A money amount as a paystub prints one: 1,234.56, $275.00, (12.50), $(12.50), -275.00 or 275.00-. */
const MONEY = /^(?:-|\$?\()?\$?(?:\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+\.\d{2})\)?-?$/

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
  const patterns = [
    LABELED_ID,
    LABELED_NAME,
    SSN,
    MASKED_NUMBER,
    STREET,
    PO_BOX,
    STATE_ZIP,
    EMAIL,
    TITLED_NAME,
  ]
  const scrubbed = patterns.reduce((current, pattern) => current.replace(pattern, REMOVED), text)
  return scrubbed
    .split(/\s+/)
    .filter((word) => word !== '')
    .map(redactWord)
    .join(' ')
    .replace(REPEATED, `${REMOVED} `)
    .trim()
}

/**
 * A source line, redacted and cut to length; null when nothing useful is left,
 * or when it names a garnishment or support order.
 */
export function redactSource(text: string | null): string | null {
  if (text === null || SENSITIVE_DEDUCTION.test(text)) return null
  const clean = redact(text).slice(0, MAX_SOURCE_LENGTH).trim()
  return clean === '' || clean === REMOVED ? null : clean
}

/**
 * The name at the start of a line, redacted and cut to `max`: an address or
 * detail printed after it, on the same line or after a comma, is dropped, and
 * so is everything after the first thing taken out, since a city and state
 * follow a street address ("1437 Bannock St Denver CO").
 */
export function leadingName(text: string | null, max: number): string | null {
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
