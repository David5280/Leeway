// Everyday words that businesses, bills and budgets are named with, and that
// are no one's name: "Taco Bell", "State Farm Insurance", a bill "Cleaner".
// Telling a person from a business reads these (modelLabels.ts,
// chat/personNames.ts, chat/billLabels.ts). Pure.

const BUSINESS_WORDS = new Set(
  [
    // What a shop sells or is.
    'apparel auto bakery bar barber books boutique brewery burger burgers cafe candy car',
    'cinema clinic club coffee cleaner cleaners cleaning deli dental depot diner donuts',
    'drugs eats electric electronics express farm farms fitness florist food foods fuel',
    'furniture garden gas gourmet grill grocery gym hardware health home hotel house hut',
    'kitchen lab laundry liquor lounge mart market meats motel motors music nails noodle',
    'nursery optical outlet pantry parking pets pharmacy pizza plumbing pub repair',
    'restaurant salon shack shop shoes spa sports station store studio supply sushi taco',
    'tacos tavern tea theater theatre tire tires tool tools toys travel tree trip wine',
    // How a company or service is called.
    'agency airlines airways associates bros brothers center centre city company county',
    'department energy enterprises group guys insurance international lawn labs lessons',
    'management media mobile network partners power property rental school services',
    'service solutions state supplies systems tech trust tuition utility water wireless',
    'air airline bank capital charity church co corp cross donation fee financial',
    'foundation fund inc interest llc ltd oil premium rewards union',
    // What a budget or bill is for.
    'allowance babysitting bills care childcare daycare dues fees gifts groceries',
    'loan lunch mortgage payment phone piano rent savings subscription taxes tutor tutoring',
  ]
    .join(' ')
    .split(' '),
)

/** Whether a word, in any case, is one businesses and bills are named with. */
export function isBusinessWord(word: string): boolean {
  return BUSINESS_WORDS.has(word.toLowerCase())
}
