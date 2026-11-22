// Words that say how money moved, never who it moved to, and whether a name
// has anything more. Pure.

/**
 * Words that say how money moved, never who it moved to. A name made only
 * of these ("Venmo Payment", "Online transfer") names nobody, so it stays.
 */
const MOVEMENT_WORDS = new Set(
  (
    'a ach add apple app bank cash cashout conf credit debit deposit from fund funds id inst ' +
    'instant memo mobile money online p2p payment payments paypal quickpay received recurring ref request sent ' +
    'standard the to transaction transfer transfers venmo web with withdrawal xfer zelle'
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
