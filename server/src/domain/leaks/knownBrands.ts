// National brands named in two or more plain words, which a leak alert may
// name though they read like a person's name ("Taco Bell", "Best Buy"). A
// line imported from a CSV or entered by hand carries no merchant code for the
// bank to vouch with (leakNames.ts), so this short list vouches instead. Only
// a whole name matches, so "Jane Bell" or "Taco Bell Jane" never does. Pure.

/**
 * The brands, as people write them. Each is matched the way brandKey reads a
 * name, so "TACO BELL #031", "Chick-Fil-A" and "TRADER JOE S" all match.
 */
const BRANDS = [
  'American Eagle',
  'Barnes and Noble',
  'Bath and Body Works',
  'Bed Bath and Beyond',
  'Best Buy',
  'Big Lots',
  'Buffalo Wild Wings',
  'Burger King',
  'Chick-fil-A',
  'Circle K',
  'Cracker Barrel',
  'Dairy Queen',
  "Dick's Sporting Goods",
  'Dollar General',
  'Dollar Tree',
  'Dunkin Donuts',
  'Family Dollar',
  'Five Guys',
  'Foot Locker',
  'Google Fi',
  'Great Clips',
  'Harbor Freight',
  'Hobby Lobby',
  'Home Depot',
  'The Home Depot',
  'Jack in the Box',
  "Jimmy John's",
  'Krispy Kreme',
  'Liberty Mutual',
  'Little Caesars',
  'Old Navy',
  'Olive Garden',
  'Panda Express',
  "Papa John's",
  'Pizza Hut',
  'Planet Fitness',
  "Sam's Club",
  'Shake Shack',
  'Sirius XM',
  'State Farm',
  'T Mobile',
  'Taco Bell',
  "Taco John's",
  "Trader Joe's",
  'Whole Foods',
  'Whole Foods Market',
]

/**
 * A name as it is compared with the brands: lower case, "&" read as "and",
 * hyphens as spaces, apostrophes gone, a lone "s" a bank split off joined
 * back ("JOE S" reads "joes"), and words with no letter (a store number like
 * "#031") left out.
 */
export function brandKey(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/-/g, ' ')
    .replace(/['’]/g, '')
    .split(/\s+/)
    .filter((word) => /\p{L}/u.test(word))
    .join(' ')
    .replace(/(\p{L}) s\b/gu, '$1s')
}

/** Every brand, as brandKey reads it. */
const BRAND_KEYS: ReadonlySet<string> = new Set(BRANDS.map(brandKey))

/** Whether the name, as shown, is one of the known national brands (BRANDS). */
export function isKnownBrand(name: string): boolean {
  return BRAND_KEYS.has(brandKey(name))
}
