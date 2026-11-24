// Text as a reader sees it, for telling names apart: characters that show
// nothing dropped, and Cyrillic and Greek letters drawn like Latin ones read
// as those, so "Jаne" with a Cyrillic "а" is Jane and "Tam­sin" is Tamsin.
// Hidden names are read from bank lines folded this way (chat/personNames.ts)
// and looked for in text folded the same way (chat/namePatterns.ts). Pure.

// A character that shows nothing, as a RegExp source: a format character
// like a zero-width space or joiner, the soft hyphen or a direction mark, or
// another ignorable one, like the combining grapheme joiner or a Hangul filler.
export const INVISIBLE_CHARACTER = '[\\p{Cf}\\p{Default_Ignorable_Code_Point}]'
const INVISIBLE = new RegExp(`^${INVISIBLE_CHARACTER}$`, 'u')

// Cyrillic and Greek letters drawn like Latin ones, read as those ("Јane" reads "Jane").
const LOOK_ALIKES = new Map(
  [
    ...['аa', 'сc', 'еe', 'һh', 'іi', 'јj', 'оo', 'рp', 'ѕs', 'хx', 'уy', 'ԁd', 'ԛq', 'ԝw'],
    ...['АA', 'ВB', 'СC', 'ЕE', 'НH', 'ІI', 'ЈJ', 'КK', 'МM', 'ОO', 'РP', 'ЅS', 'ТT', 'ХX', 'УY'],
    ...['οo', 'ιi', 'νv', 'ρp', 'ΑA', 'ΒB', 'ΕE', 'ΖZ', 'ΗH', 'ΙI', 'ΚK', 'ΜM', 'ΝN', 'ΟO'],
    ...['ΡP', 'ΤT', 'ΥY', 'ΧX'],
  ].map((pair) => [pair[0]!, pair[1]!]),
)

// Apostrophes written curly or as a letter, read as a straight one: "O’Brien" is O'Brien.
const APOSTROPHE = /^[’‘ʼ]$/u

/**
 * One character as names are read: nothing for an invisible one, a straight
 * apostrophe for any other, otherwise its compatibility form (NFKD, so "Ｊ"
 * reads "J" and "é" reads "e" and its mark) with look-alike letters made plain.
 */
export function plainCharacter(character: string): string {
  if (INVISIBLE.test(character)) return ''
  if (APOSTROPHE.test(character)) return "'"
  return [...character.normalize('NFKD')].map((one) => LOOK_ALIKES.get(one) ?? one).join('')
}

/** A text with every character read as names are (plainCharacter), accents put back on. */
export function plainLetters(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return text
  return [...text].map(plainCharacter).join('').normalize('NFC')
}
