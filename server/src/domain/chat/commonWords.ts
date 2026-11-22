// Words that are names but far more often mean something else, so Chat
// never hides them alone (loneNames.ts). Pure.

/**
 * Names that are also everyday words, months, days, banks, or what people
 * save a contact as ("Mom", "Rent"). Written alone they far more often mean
 * the word ("Electric bill, Will pay May 3"), the bank ("Chase autopay") or
 * no one in particular than the person, so they are never hidden alone.
 */
const COMMON_WORDS = new Set(
  [
    // Months and days.
    'january february march april may june july august september october november december',
    'monday tuesday wednesday thursday friday saturday sunday',
    // Names that are everyday words.
    'amber art autumn baker banks best bill black bob bond brown buck bud cash chance chase',
    'chip cook daisy dawn dean drew duke earl faith fox frank gene gold golden grace grant',
    'gray green grey hall hill holly hope hunter iris ivy jack jade joy king lane lily',
    'little long love major mark max miles park pat pearl penny price ray rich rose ruby',
    'sky stone summer sunny ward wells white will winter wolf young',
    // Banks and card issuers.
    'ally amex capital chime citi discover fargo fifth navy regions third truist union',
    // What a contact is often saved as, rather than a name.
    'aunt babysitter brother cousin dad daughter family friend grandma grandpa home husband',
    'landlord mom mother mum nanny rent roommate sister son test uncle utilities water wife',
  ]
    .join(' ')
    .split(' '),
)

/** Whether a word, in any case, is a name too common to hide alone. */
export function isCommonWord(word: string): boolean {
  return COMMON_WORDS.has(word.toLowerCase())
}
