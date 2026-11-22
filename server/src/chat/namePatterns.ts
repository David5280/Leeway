// How a hidden name is found in text (toolOutput.ts): as a whole word,
// accents aside ("Núñez" also matches "NUNEZ"), however a full name's words
// are joined, and whatever look-alike or invisible characters are in it.
// Text is searched in a folded copy (searchable), where an accent is a mark
// after its letter, so each letter can take its accents or none. Only the
// names found are replaced; the rest of the text stays as written. Pure.

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

/**
 * A RegExp source matching a word letter by letter, each with or without
 * accents, and with a hyphen between any two ("Bright-water").
 */
function lettersOf(word: string): string {
  return [...withoutAccents(word)].map((letter) => `${escaped(letter)}\\p{M}*`).join('-?')
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
  const words = name.trim().split(/\s+/).map(lettersOf).join('[\\s._,/-]*')
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

/** An account mask's digits as a whole number: "4417" in "acct 4417", never in "44170". */
export function maskPattern(mask: string): RegExp {
  return new RegExp(`(?<!\\p{N})${escaped(mask)}(?!\\p{N})`, 'gu')
}

/** What a pattern's matches are replaced with. */
export interface Replacement {
  pattern: RegExp
  with: string
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
        found.push([start, end, replacement])
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
