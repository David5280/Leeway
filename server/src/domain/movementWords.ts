// Words that say how money moved, never who it moved to, and whether a name
// has anything more (betweenPeople.ts, chat/). Bank codes like BofA's "DES",
// "INDN" and "CO ID" count among them. Pure.

/**
 * Words that say how money moved, never who it moved to. A name made only
 * of these ("Venmo Payment", "Online transfer") names nobody, so it stays.
 */
const MOVEMENT_WORDS = new Set(
  (
    'a ach add apple app bank cash cashout ccd co conf credit debit dep deposit des from fund ' +
    'funds id indn inst instant memo mobile money online out p2p payment payments paypal ppd ' +
    'quickpay received recurring ref request sent standard the to transaction transfer ' +
    'transfers venmo web with withdrawal xfer zel zelle'
  ).split(' '),
)

/** Whether a word, in any case, only says how money moved. */
export function isMovementWord(word: string): boolean {
  return MOVEMENT_WORDS.has(word.toLowerCase())
}

/** Whether a name has a word beyond how money moved, so it could be a person. */
export function namesSomeone(name: string): boolean {
  const words = name.toLowerCase().match(/\p{L}+/gu) ?? []
  return words.some((word) => word.length > 1 && !isMovementWord(word))
}
