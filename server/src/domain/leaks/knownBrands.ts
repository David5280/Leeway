// National brands named in two or more plain words, which read like a
// person's name ("Taco Bell", "Best Buy", "Warby Parker"). A line imported
// from a CSV or entered by hand carries no merchant code for the bank to
// vouch with, so this short list vouches instead, for a leak alert
// (leakNames.ts) and for what Chat shows by name (modelLabels.ts). Only a
// whole name matches, so "Jane Bell" or "Taco Bell Jane" never does. Pure.

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
  'Bob Evans',
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
  'Grant Thornton',
  'Great Clips',
  'Harbor Freight',
  'Hobby Lobby',
  'Home Depot',
  'Hunter Douglas',
  'Jack Henry',
  'Jack in the Box',
  "Jimmy John's",
  'Johns Hopkins',
  'Krispy Kreme',
  'Lane Bryant',
  'Liberty Mutual',
  'Little Caesars',
  'Old Navy',
  'Olive Garden',
  'Optum Rx',
  'Panda Express',
  "Papa John's",
  'Pizza Hut',
  'Planet Fitness',
  'Planned Parenthood',
  'Price Chopper',
  "Sam's Club",
  'Shake Shack',
  'Sirius XM',
  'State Farm',
  'T Mobile',
  'Taco Bell',
  "Taco John's",
  'The Home Depot',
  "Trader Joe's",
  'Warby Parker',
  'White Castle',
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

/** Every brand's key (brandKey), longest first, so "Whole Foods Market" goes before "Whole Foods". */
const LONGEST_FIRST = [...BRAND_KEYS].sort((a, b) => b.length - a.length)

/**
 * A name with each known brand in it left out, as brandKey reads it (lower
 * case, store numbers gone): "GRANT THORNTON LLP PAYROLL" reads "llp
 * payroll". Whole words only, so "Jane Doe Grant Thornton" still reads "jane doe".
 */
export function withoutKnownBrands(name: string): string {
  let key = ` ${brandKey(name)} `
  for (const brand of LONGEST_FIRST) key = key.split(` ${brand} `).join(' ')
  return key.trim()
}
