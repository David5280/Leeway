// The pension plan's name kept from a paystub's pension line, to name a new
// pension by. Digits come into a name only in the shapes a plan's own name
// takes; any other word holding one may be a member number, so the name ends
// there. Labels for the member or the deduction go too. Pure.

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
 * Words naming the member, so whatever follows them, such as the member's
 * name or number, is no part of the plan's name. As the first word they begin
 * one only before a plan word, as in "Member Retirement Plan", so "Member
 * Jane Doe" still loses the person's name.
 */
const MEMBER_WORDS = new Set(['member', 'mbr'])

/** Words that show a leading member word starts the plan's own name. */
const PLAN_WORDS = new Set(['retirement', 'pension', 'plan', 'benefit', 'benefits', 'savings'])

/** Words a pension line prints after the plan's name, which name the member or deduction. */
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
 * Whether a member word labels the member here, rather than opening a name
 * like "Member Retirement Plan".
 */
function labelsMember(before: string | undefined, after: string | undefined): boolean {
  return before !== undefined || !PLAN_WORDS.has(labelForm(after ?? ''))
}

/**
 * Whether a word ends a plan's name: an ID label, a member word that labels
 * the member, a figure holding #, % or $, or a digit in any shape but a
 * plan's own, as in "A1234", "ID:4417" or "4417A".
 */
function endsName(word: string, before: string | undefined, after: string | undefined): boolean {
  const label = labelForm(word)
  if (ID_LABELS.has(label)) return true
  if (MEMBER_WORDS.has(label) && labelsMember(before, after)) return true
  if (/[#%$]/.test(word)) return true
  return /\d/.test(word) && !digitsFitName(word, before)
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
 * The pension plan's name only, like "PERA" or "PERS Plan 2", short enough to
 * name a pension by: everything from the first member label, figure or
 * member number on is dropped, then any label words left at its end and a
 * trailing colon. "PERA Member 11.00% 422.95", "PERA ID:4417" and "PERA
 * (Member)" are all "PERA"; "PERA (DB)" and "1199SEIU Pension" are kept whole.
 */
export function redactPlanName(text: string | null): string | null {
  const name = leadingName(text, MAX_PLAN_NAME_LENGTH)
  if (name === null) return null
  const words = name.split(' ')
  const cut = words.findIndex((word, index) => endsName(word, words[index - 1], words[index + 1]))
  const kept = cut === -1 ? words : words.slice(0, cut)
  while (kept.length > 0 && isTrailingLabel(kept.at(-1)!)) kept.pop()
  // A label's colon may be left on the name itself, as in "PERA: 422.95".
  const named = kept.join(' ').replace(/:$/, '')
  return named === '' ? null : named
}
