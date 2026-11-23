// The pension plan's name kept from a paystub's pension line, to name a new
// pension by. Digits come into a name only in the shapes a plan's own name
// takes; any other word holding one may be a member number, so the name ends
// there. Labels for the member or the deduction end it too, and a person's
// name left after the plan's own words ("PERA Jane Doe", "PERA Doe, Jane")
// goes, since the name reaches assistants and the AI. Pure.

import { looksLikePerson } from '../leaks/personNames.js'
import { leadingName, MAX_PLAN_NAME_LENGTH } from './redact.js'

/** A plan's own number after "Plan" or "Tier", from 1 to 99: "PERS Plan 2", "Tier 10". */
const PLAN_NUMBER = /^[1-9]\d?$/
const NUMBERED_WORDS = new Set(['plan', 'tier'])

/** A union local's number and letters: "1199SEIU", "32BJ". */
const UNION_LOCAL = /^\d{1,4}\p{Lu}{2,}$/u

/** A tax code section: "401(a)", "457(b)", "403(b)". */
const TAX_CODE = /^\d{3}\([a-z]\)$/i

/** Words labelling a member number, so whatever follows them is no part of the plan's name. */
const ID_LABELS = new Set(['no', 'id'])

/**
 * Words a pension line prints for the member or the deduction, so whatever
 * follows them, such as the member's name or number, is no part of the plan's
 * name. One opens a name only when plan words follow it, other labels aside,
 * as in "Member Retirement Plan", "Employee Savings Plan" or "Defined
 * Contribution Plan", so "Member Jane Doe" and "PERA EE Jane Doe" still lose
 * the person's name.
 */
const LABEL_WORDS = new Set([
  'member',
  'mbr',
  'employee',
  'ee',
  'participant',
  'pre-tax',
  'pretax',
  'contribution',
  'contrib',
  'deduction',
  'ded',
])

/** Words that say a plan's own name goes on: what a label may open, and what anchors a name. */
const PLAN_WORDS = new Set(
  'retirement pension pensions plan plans benefit benefits savings system fund trust annuity association'.split(
    ' ',
  ),
)

/** Words naming whose plan it is ("State Employees", "Police and Fire"), part of its own name. */
const GROUP_WORDS = new Set(
  'employees teachers workers police fire firefighters public state county city municipal school schools national'.split(
    ' ',
  ),
)

/** A word with any closing ".", ":" or "," taken off, as a shape is matched. */
const bare = (word: string) => word.replace(/[.:,]+$/, '')

/**
 * A word as the label sets hold it: lower case, with no brackets around it
 * and no closing punctuation, so "(Member)", "No." and "ID:" count.
 */
const labelForm = (word: string) => bare(word.toLowerCase().replace(/^[([]+|[)\]]+$/g, ''))

/** Whether a word holding a digit is in a shape a plan's own name takes. */
function digitsFitName(word: string, before: string | undefined): boolean {
  const shape = bare(word)
  if (UNION_LOCAL.test(shape) || TAX_CODE.test(shape)) return true
  return PLAN_NUMBER.test(shape) && NUMBERED_WORDS.has(labelForm(before ?? ''))
}

/**
 * Whether the label at `index` labels the member or deduction here, rather
 * than opening a name: true unless plan words follow it, past any other labels.
 */
function labelsMember(words: string[], index: number): boolean {
  let next = index + 1
  while (next < words.length && LABEL_WORDS.has(labelForm(words[next]!))) next++
  return !PLAN_WORDS.has(labelForm(words[next] ?? ''))
}

/**
 * Whether the word at `index` ends a plan's name: an ID label, a label that
 * labels the member, a figure holding #, % or $, or a digit in any shape but
 * a plan's own, as in "A1234", "ID:4417" or "4417A".
 */
function endsName(words: string[], index: number): boolean {
  const word = words[index]!
  const label = labelForm(word)
  if (ID_LABELS.has(label)) return true
  if (LABEL_WORDS.has(label) && labelsMember(words, index)) return true
  if (/[#%$]/.test(word)) return true
  return /\d/.test(word) && !digitsFitName(word, words[index - 1])
}

/**
 * Whether a word left at the end of a name labels the deduction rather than
 * naming the plan, or is bare punctuation, like a bracket left open where a
 * member number was taken out.
 */
function isTrailingLabel(word: string): boolean {
  const form = labelForm(word)
  return LABEL_WORDS.has(form) || !/[\p{L}\p{N}]/u.test(form)
}

/**
 * Whether a word kept is the plan's own: a plan or group word, a number in a
 * plan's shape (only those are left by now), or, where the name is not all
 * capitals, an acronym ("PERA", "CalPERS"). In a name all in capitals an
 * acronym and a person's name look alike, so neither counts.
 */
function isPlansOwn(word: string, mixedCase: boolean): boolean {
  const form = labelForm(word)
  if (PLAN_WORDS.has(form) || GROUP_WORDS.has(form) || /\d/.test(word)) return true
  return mixedCase && /\p{Lu}{2,}/u.test(word)
}

/**
 * Drops a person's name left after the plan's own words: the words after the
 * last one that is the plan's own, when together they read as a person
 * ("PERA Jane Doe" is "PERA"). A name with none of its own is judged whole.
 */
function dropPersonTail(kept: string[], mixedCase: boolean): void {
  const own = kept.findLastIndex((word) => isPlansOwn(word, mixedCase))
  if (looksLikePerson(kept.slice(own + 1).join(' '))) kept.length = own + 1
}

/** The first word after the first comma on the line, as "Jane" in "PERA Doe, Jane". */
function wordAfterComma(text: string): string | undefined {
  const after = text.split('\n')[0]!.split(',')[1]
  return after?.trim().split(/\s+/)[0] || undefined
}

/**
 * Drops a surname written "Surname, Given" at the end of a name, which
 * reading up to the comma left on it: "PERA Doe, Jane" is "PERA".
 */
function dropSurname(kept: string[], given: string | undefined, mixedCase: boolean): void {
  const last = kept.at(-1)
  if (!given || !last || isPlansOwn(last, mixedCase)) return
  if (looksLikePerson(`${last} ${given}`)) kept.pop()
}

/** Takes label words and bare punctuation off the end of a name. */
function dropTrailingLabels(kept: string[]): void {
  while (kept.length > 0 && isTrailingLabel(kept.at(-1)!)) kept.pop()
}

/**
 * The pension plan's name only, like "PERA" or "PERS Plan 2", short enough to
 * name a pension by: everything from the first label, figure or member
 * number on is dropped, then any label words left at its end, a person's
 * name and a trailing colon. "PERA Member 11.00% 422.95", "PERA ID:4417",
 * "PERA (Member)", "PERA EE Jane Doe" and "PERA Doe, Jane" are all "PERA";
 * "PERA (DB)" and "1199SEIU Pension" are kept whole.
 */
export function redactPlanName(text: string | null): string | null {
  if (text === null) return null
  const name = leadingName(text, MAX_PLAN_NAME_LENGTH)
  if (name === null) return null
  const words = name.split(' ')
  const mixedCase = /\p{Ll}/u.test(name)
  const cut = words.findIndex((_word, index) => endsName(words, index))
  const kept = cut === -1 ? words : words.slice(0, cut)
  dropTrailingLabels(kept)
  // Only a name read all the way to the comma can end in a surname before it.
  if (cut === -1) dropSurname(kept, wordAfterComma(text), mixedCase)
  dropPersonTail(kept, mixedCase)
  dropTrailingLabels(kept)
  // A label's colon may be left on the name itself, as in "PERA: 422.95".
  const named = kept.join(' ').replace(/:$/, '')
  return named === '' ? null : named
}
