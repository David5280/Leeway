// The pension plan's name kept from a paystub's pension line, to name a new
// pension by. The name reaches assistants and the AI, so it is built by
// allow-list, never by spotting the person: the line is split into words, and
// only words of a plan's own vocabulary are kept (plan words, known systems
// and providers, unions, whose plan it is, a plan's own number, and a state
// that opens the name). Everything else goes, so a member's name, number or
// city can never survive unless it is itself one of those words. A name with
// no plan, system or provider word left is no name at all. Pure.

import {
  BRAND_PHRASES,
  BRANDS,
  CONNECTORS,
  GROUP_WORDS,
  LABEL_WORDS,
  NUMBERED_WORDS,
  PLAN_PHRASES,
  PLAN_WORDS,
  PROVIDER_SUFFIXES,
  STATE_CODES,
  STATE_NAMES,
  SYSTEMS,
  UNIONS,
} from './planWords.js'
import { MAX_PLAN_NAME_LENGTH, redact } from './redact.js'

/**
 * Why a word is kept. A plan or provider word is the core a name needs; the
 * others are kept only beside one.
 */
type Role = 'plan' | 'provider' | 'group' | 'number' | 'label' | 'state' | 'connector'

/** A word of the line, with the separators printed either side of it. */
interface Token {
  text: string
  form: string
  before: string
  after: string
}

/**
 * A word, split on spaces and punctuation. A tax code keeps its brackets
 * ("401(k)", "457 (b)") and "Pre-tax" its hyphen; a dot stays inside a word,
 * so "2.5" and "No.4417" are never read as a plan's number.
 */
const WORD = /\d{3}\s?\([a-z]\)|(?:pre|post|after)-tax|[^\s,/()[\]{}:;|\u2013\u2014-]+/giu

/** A tax code section: "401(a)", "457(b)", "414(h)". */
const TAX_CODE = /^\d{3}\([a-z]\)$/

/** A tax code section written plain: "401k", "403b", "457". */
const PLAIN_TAX_CODE = /^(?:401|403|409|414|457)[a-z]?$/

/** A plan's own number after "Plan" or "Tier", from 1 to 99: "PERS Plan 2", "Tier 10". */
const PLAN_NUMBER = /^[1-9]\d?$/

/** A union local's number after "Local": "Local 727". */
const LOCAL_NUMBER = /^[1-9]\d{0,3}$/

/** A word as the lists hold it: lower case, no spaces, quotes, possessive or closing "." and ":". */
function formOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/^['\u2019"]+/, '')
    .replace(/['\u2019]s$/, '')
    .replace(/['\u2019".:]+$/, '')
}

/** The words of a line, each with the separators around it. */
function tokenize(line: string): Token[] {
  const matches = [...line.matchAll(WORD)]
  return matches.map((match, index) => {
    const start = match.index
    const end = start + match[0].length
    const previous = matches[index - 1]
    const next = matches[index + 1]
    return {
      text: match[0],
      form: formOf(match[0]),
      before: line.slice(previous ? previous.index + previous[0].length : 0, start),
      after: line.slice(end, next ? next.index : line.length),
    }
  })
}

/** What a word is by itself, before its neighbours are weighed. */
function ownRole({ form }: Token): Role | null {
  if (PLAN_WORDS.has(form) || SYSTEMS.has(form) || UNIONS.has(form)) return 'plan'
  if (isTaxCode(form)) return 'plan'
  if (BRANDS.has(form)) return 'provider'
  if (GROUP_WORDS.has(form)) return 'group'
  return null
}

/** Whether the word at `index` is there and kept, for any reason. */
function isKept(roles: (Role | null)[], index: number): boolean {
  return (roles[index] ?? null) !== null
}

/** Whether the words from `index` on spell `phrase`. */
function spells(tokens: Token[], index: number, phrase: readonly string[]): boolean {
  return phrase.every((word, offset) => tokens[index + offset]?.form === word)
}

/** Marks each provider or plan kind named by more than one word ("T. Rowe Price"). */
function markPhrases(tokens: Token[], roles: (Role | null)[]): void {
  const phrases = [
    ...BRAND_PHRASES.map((phrase) => [phrase, 'provider'] as const),
    ...PLAN_PHRASES.map((phrase) => [phrase, 'plan'] as const),
  ]
  tokens.forEach((_token, index) => {
    for (const [phrase, role] of phrases) {
      if (spells(tokens, index, phrase)) roles.fill(role, index, index + phrase.length)
    }
  })
}

/** Whether a tax code section names the word: "401(k)", "457b". */
function isTaxCode(form: string): boolean {
  return TAX_CODE.test(form) || PLAIN_TAX_CODE.test(form)
}

/** Whether plan words or a tax code follow the label at `index`, past any other labels. */
function opensPlan(tokens: Token[], index: number): boolean {
  let next = index + 1
  while (next < tokens.length && LABEL_WORDS.has(tokens[next]!.form)) next++
  const form = tokens[next]?.form ?? ''
  return PLAN_WORDS.has(form) || isTaxCode(form)
}

/**
 * What a word is beside its neighbours: a provider's suffix ("Fidelity
 * Investments"), a plan's or local's own number, or a label that opens a
 * plan's name ("Member Retirement Plan").
 */
function roleBeside(tokens: Token[], roles: (Role | null)[], index: number): Role | null {
  const { form } = tokens[index]!
  const before = tokens[index - 1]?.form ?? ''
  if (PROVIDER_SUFFIXES.has(form) && roles[index - 1] === 'provider') return 'provider'
  if (PLAN_NUMBER.test(form) && NUMBERED_WORDS.has(before)) return 'number'
  if (LOCAL_NUMBER.test(form) && before === 'local') return 'number'
  if (LABEL_WORDS.has(form) && opensPlan(tokens, index)) return 'label'
  return null
}

/** How many words from `index` name a state: a name, or a postal code in capitals. */
function stateLength(tokens: Token[], index: number): number {
  const name = STATE_NAMES.find((phrase) => spells(tokens, index, phrase))
  if (name) return name.length
  return STATE_CODES.has(tokens[index]!.text) ? 1 : 0
}

/**
 * Marks a state that is part of the plan's name: one that opens the line
 * right before a kept word ("Ohio PERS", "New York State Teachers"), or one
 * after "of" after a kept word ("Teachers Retirement System of Texas"). A
 * state anywhere else, like a city and state printed after the name, goes.
 */
function markStates(tokens: Token[], roles: (Role | null)[]): void {
  tokens.forEach((_token, index) => {
    const length = stateLength(tokens, index)
    if (length === 0 || roles[index] !== null) return
    const next = index + length
    const opensName = index === 0 && isKept(roles, next) && tokens[next]!.before.trim() === ''
    const afterOf = tokens[index - 1]?.form === 'of' && isKept(roles, index - 2)
    if (opensName || afterOf) roles.fill('state', index, next)
  })
}

/** Marks a joining word between two kept words ("Police and Fire"). */
function markConnectors(tokens: Token[], roles: (Role | null)[]): void {
  tokens.forEach((token, index) => {
    const between = isKept(roles, index - 1) && isKept(roles, index + 1)
    if (roles[index] === null && CONNECTORS.has(token.form) && between) roles[index] = 'connector'
  })
}

/**
 * A kept word as shown: its closing "." or ":" dropped, except on an initial
 * ("T. Rowe Price"), and its brackets kept when it stood alone in them ("PERA (DB)").
 */
function shown({ text, before, after }: Token): string {
  const word = /^\p{L}\.$/u.test(text) ? text : text.replace(/[.:]+$/, '')
  const open = before.trim().at(-1)
  const close = after.trim()[0]
  const bracketed = (open === '(' || open === '[') && (close === ')' || close === ']')
  return bracketed ? `${open}${word}${close}` : word
}

/** The kept words joined, stopping before a word that would pass the longest name. */
function joined(words: string[]): string {
  let name = ''
  for (const word of words) {
    const longer = name === '' ? word : `${name} ${word}`
    if (longer.length > MAX_PLAN_NAME_LENGTH) break
    name = longer
  }
  return name
}

/**
 * The pension plan's name only, like "PERA", "Ohio PERS" or "PERS Plan 2",
 * from the first line of what the paystub printed: "PERA Member 11.00%
 * 422.95", "PERA Doe, Jane" and "Jane Doe PERA" are all "PERA"; "Jane Doe
 * 422.95" is null.
 */
export function redactPlanName(text: string | null): string | null {
  if (text === null) return null
  // Identifiers such as a Social Security number go before the words are read.
  const tokens = tokenize(redact(text.split('\n')[0]!))
  const roles = tokens.map(ownRole)
  markPhrases(tokens, roles)
  tokens.forEach((_token, index) => {
    roles[index] ??= roleBeside(tokens, roles, index)
  })
  markStates(tokens, roles)
  markConnectors(tokens, roles)
  if (!roles.some((role) => role === 'plan' || role === 'provider')) return null
  const name = joined(tokens.filter((_token, index) => isKept(roles, index)).map(shown))
  return name === '' ? null : name
}
