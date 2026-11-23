// Words that are names but very often mean something else, and how each
// kind is read. Pure.
//
// - A name that is also an everyday word ("Mark", "Grace", "King") could
//   still be someone, so a merchant or pay line made of name words is a
//   person's ("MARK OSTROWSKI", "JANE BROWN"), a note holding one is not sent,
//   and an owner's label hides it ("Grace's college fund"). It is never hidden
//   alone in other text, where it far more often means the word (loneNames.ts).
// - A word whose everyday sense wins in money text ("bill", "May") reads as
//   the word in notes and labels, and as a name only in a merchant or pay line.
// - Months, days, banks and what a contact is saved as ("Mom", "Rent") are
//   never a name.

/** Splits groups of words written as lines into one set. */
function wordSet(lines: readonly string[]): ReadonlySet<string> {
  return new Set(lines.join(' ').split(' '))
}

// Names that are everyday words: possible name words everywhere but alone in text.
const NAMES_AS_WORDS = wordSet([
  'amber autumn baker black bob brown buck bud cook daisy dawn dean drew duke earl faith fox',
  'frank gene grace grant gray green grey hall hill holly hope hunter iris ivy jack jade joy',
  'king lane lily love mark max miles park pat pearl penny price ray rich rose ruby stone',
  'summer walker ward wells white will winter wolf young',
])

// Names whose everyday sense wins in notes and labels ("Electric bill", "May rent").
const WORDS_AS_NAMES = wordSet(['bill april may june august'])

// Never a name: everyday words, months and days, banks, and contacts.
const NEVER_NAMES = wordSet([
  // Everyday words that are names too rarely to count, and months and days.
  'art banks best bond cash chance chase chip gold golden little long major sky sunny',
  'january february march july september october november december',
  'monday tuesday wednesday thursday friday saturday sunday',
  // Banks and card issuers.
  'ally amex capital chime citi discover fargo fifth navy regions third truist union',
  // What a contact is often saved as, rather than a name.
  'aunt babysitter brother cousin dad daughter family friend grandma grandpa home husband',
  'landlord mom mother mum nanny rent roommate sister son test uncle utilities water wife',
])

/** Whether a word, in any case, is a name too common to hide alone in text (any group above). */
export function isCommonWord(word: string): boolean {
  const lower = word.toLowerCase()
  return NAMES_AS_WORDS.has(lower) || WORDS_AS_NAMES.has(lower) || NEVER_NAMES.has(lower)
}

/** Whether a word, in any case, is a name that is also an everyday word ("Mark", "Grace"). */
export function isNameAsWord(word: string): boolean {
  return NAMES_AS_WORDS.has(word.toLowerCase())
}

/** Whether a common word could be a name in a merchant or pay line ("Mark", "Bill", "June"). */
export function isNameInALine(word: string): boolean {
  const lower = word.toLowerCase()
  return NAMES_AS_WORDS.has(lower) || WORDS_AS_NAMES.has(lower)
}

/** Whether a common word reads as no one's in notes and labels ("bill", "May", "Mom", "Chase"). */
export function isEverydayCommonWord(word: string): boolean {
  const lower = word.toLowerCase()
  return WORDS_AS_NAMES.has(lower) || NEVER_NAMES.has(lower)
}
