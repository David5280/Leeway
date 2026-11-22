// How a hidden name is found in text (toolOutput.ts): as a whole word,
// accents aside ("Núñez" also matches "NUNEZ"), however a full name's words
// are joined, and whatever look-alike or invisible characters are in it.
// Text is searched in decomposed form (NFD), where an accent is a mark after
// its letter, so each letter can take its accents or none. Pure.

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
 * A full name as a whole, in any case, with its words apart however they
 * are joined: "Jane Doe" also matches "JANE_DOE", "jane-doe" and "Jane.Doe".
 */
export function fullNamePattern(name: string): RegExp {
  const words = name.trim().split(/\s+/).map(lettersOf).join('[\\s._-]+')
  return new RegExp(`${WORD_START}${words}${WORD_END}`, 'giu')
}

/** A word as a name is written alone: with a capital ("Jane") or in capitals ("JANE"). */
export function loneNamePattern(word: string): RegExp {
  const plain = withoutAccents(word)
  const rest = plain === plain.toUpperCase() ? plain.slice(1).toLowerCase() : plain.slice(1)
  const forms = [plain[0]!.toUpperCase() + rest, plain.toUpperCase()].map(lettersOf)
  return new RegExp(`${WORD_START}(?:${forms.join('|')})${WORD_END}`, 'gu')
}

// Characters that show nothing: a zero-width space or byte order mark stands
// between words, while joiners and the soft hyphen sit inside one.
const INVISIBLE_SPACE = /[\u200B\uFEFF]/g
// Listed one by one: a joiner inside a character class reads as joining its neighbours.
const INVISIBLE_JOIN = /\u200C|\u200D|\u00AD/g

/**
 * Text as names are searched in: fullwidth and other look-alike letters
 * folded to plain ones (NFKC), invisible characters read as what they stand
 * for, then decomposed.
 */
function searchable(text: string): string {
  const folded = text.normalize('NFKC')
  return folded.replace(INVISIBLE_SPACE, ' ').replace(INVISIBLE_JOIN, '').normalize('NFD')
}

/** Whether any of the patterns is found in the text. */
export function foundIn(text: string, patterns: readonly RegExp[]): boolean {
  const decomposed = searchable(text)
  return patterns.some((pattern) => decomposed.search(pattern) >= 0)
}

/** The text with every match of the patterns replaced, or the very same text when none matched. */
export function replacedIn(text: string, patterns: readonly RegExp[], replacement: string): string {
  const decomposed = searchable(text)
  const replaced = patterns.reduce(
    (result, pattern) => result.replace(pattern, replacement),
    decomposed,
  )
  return replaced === decomposed ? text : replaced.normalize('NFC')
}
