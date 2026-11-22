// What a calendar event is about, beyond its kind: the words in its title that
// say whose birthday, which show or where a trip goes, and whether it is a
// trip's travel (a flight, a hotel) rather than the trip itself. spans.ts uses
// these to tell one occasion written as several events from two occasions
// that fall on the same days. Pure.

/**
 * Words that say what kind of event it is, or are filler, never whose or
 * where: "Alice's birthday dinner" is about Alice, "Flight to Rome" about Rome.
 * A holiday's own name (Christmas) is not here, since it is what that one is about.
 */
const FILLER = new Set(
  [
    // Birthdays, weddings and the parties around them.
    'birthday bday day party dinner lunch brunch breakfast drinks celebration cake surprise',
    'wedding rehearsal reception ceremony engagement shower bridal bachelor bachelorette stag hen',
    // Shows.
    'concert show tickets ticket gig theater theatre musical opera comedy night',
    // Trips and their travel.
    'trip flight flights fly flying hotel airbnb vrbo lodging motel hostel vacation getaway',
    'travel traveling travelling weekend home back return check stay',
    // Small words.
    'the and of for at with to from in on out my our his her their',
  ]
    .join(' ')
    .split(' '),
)

/** A trip's travel: getting there and somewhere to sleep, not the trip itself. */
const TRAVEL =
  /\b(flights?|fly(ing)?|hotel|airbnb|vrbo|lodging|motel|hostel|check[- ]?(in|out))\b|✈/i

/**
 * The words that say what an event is about, lower case: whose birthday,
 * which couple, which show, where a trip goes. Empty for a title that says
 * only what kind it is ("Birthday dinner", "Concert", "Flight home").
 */
export function occasionWords(title: string): Set<string> {
  const words = title
    .toLowerCase()
    // "Jo's" is about Jo.
    .replace(/['’]s\b/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    // A single letter is a leftover ("b-day", "&"), not a name.
    .filter((word) => word.length > 1 && !FILLER.has(word))
  return new Set(words)
}

/** True for a trip's travel: a flight, a hotel or another place to stay. */
export function isTravel(title: string): boolean {
  return TRAVEL.test(title)
}

/** True when the two have a word in common. */
export function sharesWord(a: Set<string>, b: Set<string>): boolean {
  for (const word of a) if (b.has(word)) return true
  return false
}

/**
 * True when the two name the same occasion: one says nothing about itself
 * (a "Birthday dinner" beside "Jo's birthday"), or every word of one is in
 * the other ("Christmas Eve" and "Christmas", "Jo's birthday" and "Jo's bday").
 */
export function sameOccasion(a: Set<string>, b: Set<string>): boolean {
  const [fewer, more] = a.size <= b.size ? [a, b] : [b, a]
  for (const word of fewer) if (!more.has(word)) return false
  return true
}
