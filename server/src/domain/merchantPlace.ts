// The place a card line ends with, a city and a state code: "LOWRY BEER
// GARDEN DENVER CO" is Lowry Beer Garden in Denver, Colorado. Pure. Used by
// merchantName.ts, which shows the name without its place.

/**
 * US state codes, which end a card line's place: "LOWRY BEER GARDEN DENVER
 * CO". Codes that are also common English words (IN, ME, OR, OK, OH, HI)
 * are left out, since a name can end in one.
 */
const STATES = new Set(
  (
    'AK AL AR AZ CA CO CT DC DE FL GA IA ID IL KS KY LA MA MD MI MN MO MS MT NC ND NE NH NJ NM ' +
    'NV NY PA RI SC SD TN TX UT VA VT WA WI WV WY'
  ).split(' '),
)

/** First words of cities named in two or three words: "SAN JOSE", "FORT COLLINS". */
const CITY_STARTS = new Set(
  'SAN SANTA LOS LAS NEW FORT FT ST SAINT EL PALM SALT WEST EAST NORTH SOUTH GRAND BATON BOCA COLORADO KANSAS OKLAHOMA JERSEY VIRGINIA LONG'.split(
    ' ',
  ),
)

/** Last words of cities named in two or three words: "KANSAS CITY", "LONG BEACH". */
const CITY_ENDS = new Set(
  'CITY BEACH SPRINGS PARK HEIGHTS FALLS VALLEY LAKE RAPIDS ROCK HILLS GROVE CREEK'.split(' '),
)

/**
 * Cities common on card lines, named in one word. With the words above they
 * are the known city words: a place is taken off a short name only when it
 * holds one, so "JERSEY MIKES NJ" keeps "Mikes".
 */
const CITIES = new Set(
  (
    'ALBUQUERQUE ANAHEIM ANCHORAGE ARLINGTON ARVADA ATLANTA AURORA AUSTIN BALTIMORE BELLEVUE ' +
    'BERKELEY BOISE BOSTON BOULDER BROOKLYN BROOMFIELD BUFFALO CENTENNIAL CHARLOTTE CHICAGO ' +
    'CINCINNATI CLEVELAND COLUMBUS DALLAS DENVER DETROIT DURHAM ENGLEWOOD FRESNO GOLDEN HONOLULU ' +
    'HOUSTON INDIANAPOLIS IRVINE LAKEWOOD LITTLETON LONGMONT LOUISVILLE MANHATTAN MEMPHIS MIAMI ' +
    'MILWAUKEE MINNEAPOLIS NASHVILLE NEWARK OAKLAND OMAHA ORLANDO PASADENA PHILADELPHIA PHOENIX ' +
    'PITTSBURGH PORTLAND RALEIGH RICHMOND SACRAMENTO SEATTLE SPOKANE SPRINGFIELD TACOMA TAMPA ' +
    'THORNTON TUCSON WESTMINSTER'
  ).split(' '),
)

/**
 * Words that say what a business does. One is never taken for a city
 * ("GRAND CANYON RAILWAY AZ"), and a "CO" after one is the company, not
 * Colorado ("GREAT DIVIDE BREWING CO").
 */
const BUSINESS_WORDS = new Set(
  (
    'AUTO BAKERY BAR BBQ BISTRO BOOKS BREWERY BREWING BURGERS CAFE CANDLE CHOCOLATE CLEANERS ' +
    'CLOTHING COFFEE CREAMERY DAIRY DELI DISTILLERY DISTILLING DONUTS DRUG ELECTRIC EXPRESS FARM ' +
    'FARMS FOOD FOODS FURNITURE GAS GOODS GRILL HARDWARE INSURANCE KITCHEN LAUNDRY LUMBER ' +
    'MANUFACTURING MARKET MEATS MILLS MOTOR MOTORS MUSIC OIL OUTFITTERS PAPER PHARMACY PIZZA PUB ' +
    'RAILROAD RAILWAY RANCH ROASTERS ROASTING SALOON SEAFOOD SERVICE SERVICES SHOP SPORTS STORE ' +
    'STUDIO SUPPLY TACOS TAVERN TEA TIRE TOYS TRADING WINE'
  ).split(' '),
)

/**
 * Takes off the place a card line or an ACH payer's name ends with, a city
 * and a state code in capitals: "LOWRY BEER GARDEN DENVER CO" reads "LOWRY
 * BEER GARDEN", and "JOHN SMITH DENVER CO" reads "JOHN SMITH". The state
 * goes whenever two or more words come before it; the city with it only when
 * it is a known city word or two words of name are left ("JERSEY MIKES NJ"
 * reads "JERSEY MIKES"). A line that is all place keeps its city ("SALT LAKE
 * CITY UT" reads "SALT LAKE CITY"), and "SMITH & CO" and "BREWING CO" keep
 * their "CO", which there means company.
 */
export function withoutPlace(text: string): string {
  const all = text.split(/\s+/).filter(Boolean)
  const state = all.at(-1)!
  if (all.length < 3 || !STATES.has(state)) return text
  const before = all.at(-2)!.toUpperCase()
  if (state === 'CO' && (/^(&|AND)$/.test(before) || BUSINESS_WORDS.has(before))) return text
  const name = all.slice(0, -1)
  return name.slice(0, name.length - cityLength(name)).join(' ')
}

/**
 * How many words at the end of a card line's name are its city: none, or one
 * to three ("SALT LAKE CITY"). See withoutPlace for when a city counts.
 */
function cityLength(name: string[]): number {
  const upper = name.map((word) => word.toUpperCase())
  let start = upper.length - 1
  if (!/^[\p{L}.'-]+$/u.test(name[start]!) || BUSINESS_WORDS.has(upper[start]!)) return 0
  // Take in more of a city named in more than one word: "FORT COLLINS", "KANSAS CITY".
  for (let more = 0; more < 2 && start > 0; more++) {
    if (!CITY_ENDS.has(upper[start]!) && !CITY_STARTS.has(upper[start - 1]!)) break
    start -= 1
  }
  const city = upper.slice(start)
  const left = start
  // A city after "OF" is the name's own: "CITY OF DENVER CO" reads "CITY OF DENVER".
  if (left === 0 || upper[start - 1] === 'OF') return 0
  const known = city.some(
    (word) => CITIES.has(word) || CITY_STARTS.has(word) || CITY_ENDS.has(word),
  )
  return known || left >= 2 ? city.length : 0
}
