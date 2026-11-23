// Words that name well-known businesses, as an owner writes them in a bill,
// a budget or a goal before any row of theirs shows the business ("Netflix",
// "Geico", "Peloton fund"). They are no one's name, so Chat keeps them
// (chat/ownerText.ts). A brand that is also a given name or surname ("Ford",
// "Marcus", "Claude") is never added here. Pure.

const BRAND_WORDS = new Set(
  [
    // Streaming, music, games and apps.
    'audible crunchyroll disney espn fubo hbo hulu kindle netflix paramount peacock',
    'playstation siriusxm sling spotify steam twitch xbox youtube nintendo patreon',
    'adobe canva dropbox duolingo github grammarly headspace icloud microsoft notion',
    'openai slack strava zoom google',
    // Shops and delivery.
    'aldi amazon bestbuy costco cvs doordash ebay etsy grubhub ikea instacart kohls kroger',
    'lowes lululemon macys nike nordstrom publix rei safeway sephora starbucks ulta walgreens',
    'walmart',
    'wholefoods chipotle mcdonalds airbnb uber lyft',
    // Phones, internet, power and insurance.
    'att comcast spectrum tmobile verizon xfinity xcel allstate geico progressive',
    'statefarm usaa aetna cigna humana anthem',
    // Money, cars and fitness.
    'acorns affirm afterpay betterment fidelity klarna paypal robinhood schwab sofi',
    'synchrony vanguard wealthfront hyundai nissan peloton fitbit garmin',
  ]
    .join(' ')
    .split(' '),
)

/** Whether a word, in any case, names a well-known business. */
export function isBrandWord(word: string): boolean {
  return BRAND_WORDS.has(word.toLowerCase())
}
