// Whether a name reads as a person's, for the leak alerts: a leak's name
// reaches the AI summary writer, the weekly email, the inbox and assistants,
// so a name that may be someone the owner paid is never shown. Bank text
// dresses a person's name up in many ways ("BILL PAYMENT - JANE DOE",
// "DOE/JANE", "Doe, Jane", "John & Jane Doe", "Jane Doe2"), so the words
// that only say money moved are dropped before the rest is judged. Pure.
//
// Missing a merchant's name costs a word ("A payment went out twice"), while
// showing a person's costs their privacy, so a doubtful name reads as a person.

/** Invisible format characters, such as a zero-width space or a direction mark. */
const INVISIBLE = /\p{Cf}/gu

/**
 * Text as it is shown: in its compatibility form (so look-alike letters are
 * plain ones), with invisible characters taken out.
 */
export function plainText(text: string): string {
  return text.normalize('NFKC').replace(INVISIBLE, '')
}

/**
 * Text as it is judged: like plainText, but an invisible character splits
 * words, so "Jane" and "Doe" joined by a zero-width space are still two.
 */
export function judgedText(text: string): string {
  return text.normalize('NFKC').replace(INVISIBLE, ' ')
}

/** What splits a name into words: spaces, commas, slashes, "&" and "+". */
const WORD_BREAKS = /[\s,/&+]+/u

/** Words that only say money moved, never part of whom it went to. */
const PAYMENT_WORDS = new Set(
  [
    'online mobile web internet bill pay payment pmt pymt authorized',
    'ach debit dr p2p wire out outgoing domestic transfer xfer sent send',
    'to from money order e-transfer interac quickpay friends',
  ].flatMap((line) => line.split(' ')),
)

/**
 * Words that mark a business, so a name holding one is never read as a
 * person's: "Planet Fitness", "Corner Hardware", "Acme Insurance Co".
 */
const BUSINESS_WORDS = new Set(
  [
    'inc llc ltd lp llp co corp corporation company group holdings',
    'the of at on for',
    'store stores shop shops market mart supermarket grocery foods food',
    'fitness gym club yoga pilates studio salon spa barber',
    'cafe coffee bar grill kitchen restaurant pizza bakery diner deli',
    'clinic dental medical health pharmacy care vet hospital',
    'insurance auto car cars motors wash parking rental rentals',
    'energy electric power gas water utilities utility',
    'bank financial services service center centre',
    'wireless cable tv music media radio news',
    'plus prime premium pro one cloud app apps games labs',
    'systems solutions software tech home garden books hotel travel',
    'air airlines delivery express supply depot hardware subscription',
  ].flatMap((line) => line.split(' ')),
)

/**
 * A word a name can be made of: letters with digits, apostrophes, periods or
 * hyphens, so "O'Neil", "J." and the "Doe2" a bank appends a number to all
 * count. A word with any other mark ("AMAZON.COM*AB12") is no part of a name.
 */
const NAME_WORD = /^[\p{L}\p{N}'.-]+$/u

/** The most and fewest words a person's name takes here: "Jane Doe" up to "Maria De Los Santos Garcia Lopez". */
const NAME_WORDS = { fewest: 2, most: 6 } as const

/** A word as compared with the word lists: lower case, without periods or apostrophes. */
const bare = (word: string) => word.toLowerCase().replace(/[.']/g, '')

/**
 * The words of a name as they are judged: split at WORD_BREAKS (and at any
 * invisible character), with no word that holds no letter (a dash, a date)
 * and none that only says money moved (PAYMENT_WORDS).
 */
export function nameWords(name: string): string[] {
  return judgedText(name)
    .split(WORD_BREAKS)
    .filter((word) => /\p{L}/u.test(word) && !PAYMENT_WORDS.has(bare(word)))
}

/**
 * Whether a name reads as a person's: two to six plain words once the
 * payment words are gone, none of them a business word, like "Jane Doe",
 * "John and Jane Doe" or "Doe, Jane". A two-word brand with no business word
 * ("Taco Bell") reads so too; leakNames.ts lets the bank's codes vouch for it.
 */
export function looksLikePerson(name: string): boolean {
  const words = nameWords(name)
  if (words.length < NAME_WORDS.fewest || words.length > NAME_WORDS.most) return false
  if (!words.every((word) => NAME_WORD.test(word))) return false
  return !words.some((word) => BUSINESS_WORDS.has(bare(word)))
}
