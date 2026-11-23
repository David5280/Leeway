// How a hidden name is found in text (toolOutput.ts): as a whole word,
// accents aside ("Núñez" also matches "NUNEZ"), however a full name's words
// are joined, and whatever look-alike or invisible characters are in it.
// Text is searched in a folded copy (searchable), where an accent is a mark
// after its letter, so each letter can take its accents or none. Only the
// names found are replaced; the rest of the text stays as written. Pure.

import { APOSTROPHES } from '../domain/personShape.js'
import { plainCharacter } from '../domain/plainLetters.js'

// Not inside a longer word: no letter or accent mark either side. A digit
// may touch it ("Jane Doe2" still names her).
const WORD_START = '(?<![\\p{L}\\p{M}])'
const WORD_END = '(?![\\p{L}\\p{M}])'

/** A word's letters without their accents: "Núñez" reads "Nunez". */
function withoutAccents(word: string): string {
  return word.normalize('NFD').replace(/\p{M}/gu, '')
}

/** Text as a RegExp source matching it literally. */
function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// A hyphen as written: plain, or a non-breaking one (U+2011), which text is
// searched with as the hyphen U+2010 (plainLetters.ts).
const HYPHENS = '\\u2010\\u2011-'

// Between the parts of a hyphenated name: a hyphen, a space, or nothing
// ("Núñez-García" is also "NUNEZ GARCIA" and "NunezGarcia").
const HYPHEN = `[\\s${HYPHENS}]?`
const A_HYPHEN = new RegExp(`^[${HYPHENS}]$`)

/** A RegExp source matching one character of a name: a letter with or without accents. */
function characterOf(character: string): string {
  if (A_HYPHEN.test(character)) return HYPHEN
  // Text is searched folded, where every apostrophe is a straight one (plainCharacter).
  if (APOSTROPHES.includes(character)) return "'"
  return `${escaped(character)}\\p{M}*`
}

/**
 * A RegExp source matching a word letter by letter, each with or without
 * accents, and with a hyphen between any two ("Bright-water").
 */
function lettersOf(word: string): string {
  return [...withoutAccents(word)].map(characterOf).join(`[${HYPHENS}]?`)
}

// A name made plural: "BRIGHTWATERS", "the Prycewoods'". One owned
// ("Brightwater's") is found without it, and keeps its "'s".
const ENDING = '[sS]?'

/**
 * A full name (or any phrase) as a whole, in any case, its words joined any
 * way or not at all: "Jane Doe" also matches "JANE_DOE", "jane-doe",
 * "Jane.Doe", "Jane/Doe", "Jane, Doe", "JaneDoe" and "Jane Does".
 */
export function fullNamePattern(name: string): RegExp {
  const words = name.trim().split(/\s+/).map(lettersOf).join(`[\\s._,/${HYPHENS}]*`)
  return new RegExp(`${WORD_START}${words}${ENDING}${WORD_END}`, 'giu')
}

/** A word as a name is written alone: with a capital ("Jane") or in capitals ("JANE", "JANE'S"). */
export function loneNamePattern(word: string): RegExp {
  const plain = withoutAccents(word)
  const rest = plain === plain.toUpperCase() ? plain.slice(1).toLowerCase() : plain.slice(1)
  const forms = [plain[0]!.toUpperCase() + rest, plain.toUpperCase()].map(lettersOf)
  return new RegExp(`${WORD_START}(?:${forms.join('|')})${ENDING}${WORD_END}`, 'gu')
}

/** Text as names are searched in, and where each of its characters came from. */
interface Searchable {
  text: string
  /**
   * For each UTF-16 unit of `text`, the start and end of the original's
   * character it came from; null when the text is the original itself.
   */
  from: { start: number; end: number }[] | null
}

/**
 * Text folded for searching, one character of the original at a time, as
 * domain/plainLetters.ts reads it: look-alike letters made plain, accents
 * split off ("é" reads "e" and its mark) and invisible characters dropped.
 * Plain ASCII, most of what is searched, has nothing to fold.
 */
function searchable(original: string): Searchable {
  if (/^[\x20-\x7e]*$/.test(original)) return { text: original, from: null }
  const search = { text: '', from: [] as { start: number; end: number }[] }
  let start = 0
  for (const character of original) {
    const end = start + character.length
    const plain = plainCharacter(character)
    search.text += plain
    for (let unit = 0; unit < plain.length; unit += 1) search.from.push({ start, end })
    start = end
  }
  return search
}

/**
 * An account mask's digits as a whole number: "4417" in "acct 4417" and
 * "card ...4417", never inside a longer number ("44170"), a date's year
 * ("2026-11-17" or "11/2026" with a mask 2026) or an amount ("$4417.50", "1,4417").
 */
export function maskPattern(mask: string): RegExp {
  const before = '(?<!\\p{N}|\\p{N}[.,:/])'
  const after = '(?!\\p{N}|[-.,:/]\\p{N})'
  return new RegExp(`${before}${escaped(mask)}${after}`, 'gu')
}

/** What a pattern's matches are replaced with; null keeps them as written, so none cuts in. */
export interface Replacement {
  pattern: RegExp
  with: string | null
}

/** A match in the original text: where it starts and ends, and what replaces it. */
type Span = [start: number, end: number, replacement: string]

/** Where the patterns match in the original text, earlier patterns first, none overlapping. */
function matchesIn(original: string, replacements: readonly Replacement[]): Span[] {
  const { text, from } = searchable(original)
  const found: Span[] = []
  for (const { pattern, with: replacement } of replacements) {
    for (const match of text.matchAll(pattern)) {
      const last = match.index + match[0].length - 1
      const [start, end] = from
        ? [from[match.index]!.start, from[last]!.end]
        : [match.index, last + 1]
      if (!found.some(([other, otherEnd]) => start < otherEnd && other < end)) {
        found.push([start, end, replacement ?? original.slice(start, end)])
      }
    }
  }
  return found.sort((a, b) => a[0] - b[0])
}

/**
 * The text with every match replaced, earlier replacements first, and the
 * rest kept as written ("2²" stays "2²"), or the very same text when none matched.
 */
export function replacedIn(text: string, replacements: readonly Replacement[]): string {
  const spans = matchesIn(text, replacements)
  if (spans.length === 0) return text
  let replaced = ''
  let kept = 0
  for (const [start, end, replacement] of spans) {
    replaced += text.slice(kept, start) + replacement
    kept = end
  }
  return replaced + text.slice(kept)
}
