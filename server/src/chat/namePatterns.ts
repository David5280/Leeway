// How a hidden name is found in text (toolOutput.ts): as a whole word,
// accents aside ("Núñez" also matches "NUNEZ"), however a full name's words
// are joined, and whatever look-alike or invisible characters are in it.
// Text is searched in a folded copy (searchable), where an accent is a mark
// after its letter, so each letter can take its accents or none. Only the
// names found are replaced; the rest of the text stays as written. Pure.

// Not inside a longer word: no letter, digit or accent mark either side.
const WORD_START = '(?<![\\p{L}\\p{N}\\p{M}])'
const WORD_END = '(?![\\p{L}\\p{N}\\p{M}])'

/** A word's letters without their accents: "Núñez" reads "Nunez". */
function withoutAccents(word: string): string {
  return word.normalize('NFD').replace(/\p{M}/gu, '')
}

/** A RegExp source matching a word letter by letter, each with or without accents. */
function lettersOf(word: string): string {
  return [...withoutAccents(word)]
    .map((letter) => `${letter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\p{M}*`)
    .join('')
}

/**
 * A full name as a whole, in any case, its words joined any way or not at
 * all: "Jane Doe" also matches "JANE_DOE", "jane-doe", "Jane.Doe" and "JaneDoe".
 */
export function fullNamePattern(name: string): RegExp {
  const words = name.trim().split(/\s+/).map(lettersOf).join('[\\s._-]*')
  return new RegExp(`${WORD_START}${words}${WORD_END}`, 'giu')
}

/** A word as a name is written alone: with a capital ("Jane") or in capitals ("JANE"). */
export function loneNamePattern(word: string): RegExp {
  const plain = withoutAccents(word)
  const rest = plain === plain.toUpperCase() ? plain.slice(1).toLowerCase() : plain.slice(1)
  const forms = [plain[0]!.toUpperCase() + rest, plain.toUpperCase()].map(lettersOf)
  return new RegExp(`${WORD_START}(?:${forms.join('|')})${WORD_END}`, 'gu')
}

// Characters that show nothing (format characters: zero-width spaces and
// joiners, the soft hyphen, direction marks, the word joiner), searched as
// if absent, since a full name may have its words joined (fullNamePattern).
const INVISIBLE = /^\p{Cf}$/u

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
 * Text folded for searching, one character of the original at a time:
 * look-alike letters made plain and accents split off (NFKD, so "Ｊ" reads
 * "J" and "é" reads "e" and its mark), invisible characters dropped. Plain
 * ASCII, most of what is searched, has nothing to fold.
 */
function searchable(original: string): Searchable {
  if (/^[\x20-\x7e]*$/.test(original)) return { text: original, from: null }
  const folded = { text: '', from: [] as { start: number; end: number }[] }
  let start = 0
  for (const character of original) {
    const end = start + character.length
    const plain = INVISIBLE.test(character) ? '' : character.normalize('NFKD')
    folded.text += plain
    for (let unit = 0; unit < plain.length; unit += 1) folded.from.push({ start, end })
    start = end
  }
  return folded
}

/** Whether any of the patterns is found in the text. */
export function foundIn(text: string, patterns: readonly RegExp[]): boolean {
  const { text: folded } = searchable(text)
  return patterns.some((pattern) => folded.search(pattern) >= 0)
}

/** Where the patterns match in the original text, earlier patterns first, none overlapping. */
function matchesIn(original: string, patterns: readonly RegExp[]): [number, number][] {
  const { text, from } = searchable(original)
  const found: [number, number][] = []
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const last = match.index + match[0].length - 1
      const span: [number, number] = from
        ? [from[match.index]!.start, from[last]!.end]
        : [match.index, last + 1]
      if (!found.some(([start, end]) => span[0] < end && start < span[1])) found.push(span)
    }
  }
  return found.sort((a, b) => a[0] - b[0])
}

/**
 * The text with every match of the patterns replaced and the rest kept as
 * written ("2²" stays "2²"), or the very same text when none matched.
 */
export function replacedIn(text: string, patterns: readonly RegExp[], replacement: string): string {
  const spans = matchesIn(text, patterns)
  if (spans.length === 0) return text
  let replaced = ''
  let kept = 0
  for (const [start, end] of spans) {
    replaced += text.slice(kept, start) + replacement
    kept = end
  }
  return replaced + text.slice(kept)
}
