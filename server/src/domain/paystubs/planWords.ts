// The words a pension plan's name may keep, for redactPlanName. Every list
// holds words in their matching form: lower case, with no closing "." or ":"
// and no possessive "'s". Words that are also common names (Roth, Ira) are
// left out of the core lists and kept only in a plan's shape ("Roth 401(k)",
// "Roth IRA"). A rare name that is itself a listed word (a surname Schwab)
// can still match. Pure data.

/** Builds a set from words written on one line, split on spaces. */
const words = (line: string): ReadonlySet<string> => new Set(line.trim().split(/\s+/))

/** Words naming a plan itself; any one of them makes a name worth keeping. */
export const PLAN_WORDS = words(`
  plan plans pension pensions retirement savings system systems fund funds trust
  annuity annuities deferred compensation comp benefit benefits association
  thrift db dc hybrid
`)

/**
 * Public retirement systems by their acronyms: CalPERS, OPERS, CalSTRS,
 * NYSLRS and the like. Matched whole, so a surname ending in "pers" or
 * "ers" never counts.
 */
export const SYSTEMS = words(`
  pera pers calpers opers kpers ipers apers njpers ndpers persi mainepers
  psers sers osers mosers mpsers lasers lagers tsers lgers ers ersri
  strs calstrs nystrs trs trsl ktrs otrs atrs tra nyslrs imrf lacera lacers
  sfers ocers sdcera frs tcrs vrs nhrs mers surs srs asrs psprs msrs wrs drs
  scrs sdrs tmrs tcdrs hmeps fers csrs tsp pepra op&f
`)

/** Plan providers and record keepers named by one word. */
export const BRANDS = words(`
  tiaa cref fidelity vanguard empower principal voya nationwide schwab
  missionsquare icma transamerica massmutual prudential ameriprise valic
  corebridge securian
`)

/** Providers named by more than one word, matched only whole. */
export const BRAND_PHRASES: readonly (readonly string[])[] = [
  ['t', 'rowe', 'price'],
  ['john', 'hancock'],
  ['lincoln', 'financial'],
  ['mass', 'mutual'],
  ['mission', 'square'],
  ['charles', 'schwab'],
]

/** Plan kinds named by more than one word, matched only whole. */
export const PLAN_PHRASES: readonly (readonly string[])[] = [
  ['defined', 'benefit'],
  ['defined', 'contribution'],
  ['roth', 'ira'],
  ['simple', 'ira'],
  ['sep', 'ira'],
]

/** Words a provider's name may go on with, kept only right after the provider. */
export const PROVIDER_SUFFIXES = words('investments financial group')

/** Unions that sponsor plans, which name a plan as much as a plan word does. */
export const UNIONS = words(`
  teamsters ibew seiu afscme aft nea uaw ufcw liuna iuoe cwa 1199seiu 32bj
`)

/**
 * Words naming whose plan it is ("State Employees", "Police and Fire") or
 * which part of it ("Tier", "Match"): kept wherever they stand on a line that
 * names a plan, but no plan alone.
 */
export const GROUP_WORDS = words(`
  employees teachers educators police fire firefighters sheriffs officers peace
  safety municipal county city state public national school schools district
  college colleges university judges judicial legislators highway patrol transit
  workers union local laborers carpenters electrical plumbers pipefitters
  ironworkers engineers operating nurses hospital tier match
`)

/** Words that join two kept words ("Police and Fire", "System of Ohio"), kept only between them. */
export const CONNECTORS = words('of and & for')

/**
 * Words a pension line prints for the member, the deduction or the account
 * kind. One is kept only where plan words or a tax code follow it, other
 * labels aside ("Member Retirement Plan", "Employee Pre-tax Savings Plan",
 * "Roth 401(k)"); otherwise it goes, as in "PERA EE". Roth is here, not a plan
 * word, because it is also a surname: "PERA Jane Roth" is "PERA".
 */
export const LABEL_WORDS = words(`
  member mbr employee ee employer er participant pre-tax pretax post-tax
  after-tax contribution contrib deduction ded roth
`)

/** The words before a plan's own number: "PERS Plan 2", "IMRF Tier 3". */
export const NUMBERED_WORDS = words('plan tier')

/** The fifty states as their names, one or two words each. */
export const STATE_NAMES: readonly (readonly string[])[] = `
  alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|
  florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|
  maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|
  nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|
  north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|
  south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|
  wisconsin|wyoming`
  .split('|')
  .map((name) => name.trim().split(' '))

/** The fifty states' postal abbreviations, matched only when written in capitals. */
export const STATE_CODES = words(`
  AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT
  NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY
`)
