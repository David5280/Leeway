// Words that are names but very often mean something else, and how each
// kind is read. Pure.
//
// - A name that is also an everyday word ("Mark", "Grace", "King") could
//   still be someone, so a merchant or pay line made of name words is a
//   person's ("MARK OSTROWSKI", "JANE BROWN"), and an owner's label hides it
//   ("Grace's college fund"). It is never hidden alone in other text, where
//   it far more often means the word (loneNames.ts).
// - Of those, a surname that is no given name ("Black Friday", "Price Club")
//   reads as the word in the owner's labels, since a label names family by
//   given name, unless it is owned ("Brown's tuition"), beside another name
//   ("Hope Brown") or after a word a person is named after ("Venmo Brown").
//   A given name ("Hope", "Rose", "Will") is a person in a label but in a
//   few set phrases ("Hope chest", "Rose Garden", "Will & Trust").
// - A word whose everyday sense wins in money text ("bill", "May") reads as
//   the word in labels, but a given name ("Bill", "June") only where its
//   everyday sense is vouched for (wordNames.ts), and as a name in a
//   merchant or pay line.
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

// Of NAMES_AS_WORDS, the surnames and words an owner's label means as the
// word ("Price Club", "Green fees"). No given name is ever one (givenNames.ts).
export const WORDS_IN_LABELS = wordSet([
  'baker black brown cook fox gray green grey hall hill love park price stone wells white young',
])

// Set phrases a label means as words though they start with a given name.
const EVERYDAY_PHRASES = [
  'dog walker',
  'hope chest',
  'rose garden',
  'rose bushes',
  'summer camp',
  'summer vacation',
  'summer break',
  'winter break',
  'winter tires',
  'hunter education',
  'hunter safety',
  'holly tree',
  'will and trust',
  'will & trust',
  'living will',
  'pell grant',
  'grant money',
  'airline miles',
  // "Bill" leading a label is someone ("Bill tuition") but in these.
  'bill pay',
  'bill paying',
  'bill payment',
  'bill payments',
  'bill splitting',
]

/** A phrase as a RegExp source: its words with any spaces between ("Hope  Chest"). */
const phraseSource = (phrase: string) => phrase.split(' ').join('\\s+')

// The phrases as one pattern, whole words only, in any case.
const PHRASES = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${EVERYDAY_PHRASES.map(phraseSource).join('|')})(?![\\p{L}\\p{N}])`,
  'giu',
)

// Names whose everyday sense wins in labels ("Electric bill", "May rent").
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

/**
 * Whether a word, in any case, may read as the word in the owner's labels:
 * a surname that is no given name ("Brown", "Price").
 */
export function isWordInLabels(word: string): boolean {
  return WORDS_IN_LABELS.has(word.toLowerCase())
}

/** A label without the set phrases it means as words: "Hope chest for Ana" reads " for Ana". */
export function withoutEverydayPhrases(text: string): string {
  return text.replace(PHRASES, ' ')
}

/** Whether a common word could be a name in a merchant or pay line ("Mark", "Bill", "June"). */
export function isNameInALine(word: string): boolean {
  const lower = word.toLowerCase()
  return NAMES_AS_WORDS.has(lower) || WORDS_AS_NAMES.has(lower)
}

/** Whether a common word reads as no one's in labels ("bill", "May", "Mom", "Chase"). */
export function isEverydayCommonWord(word: string): boolean {
  const lower = word.toLowerCase()
  return WORDS_AS_NAMES.has(lower) || NEVER_NAMES.has(lower)
}
