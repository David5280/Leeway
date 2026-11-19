// An account's name as Leeway shows it everywhere: in alerts, the dashboard
// summary, the Accounts page, the weekly email and to assistants. Pure.
//
// The owner's own name for an account wins. Otherwise banks send names like
// "TOTAL CHECKING" from "BOK Financial - Online Banking", which read better as
// "BOK Total Checking": the bank's short name, then the account in plain case.
// Names leave the app (the weekly email, the AI writer), so a bank's name
// never carries the account number it sometimes ends with.

/** What naming one account needs. */
export interface AccountNameParts {
  /** The owner's own name for the account, if they gave one. */
  nickname: string | null
  /** The account's name as the bank sends it, or as typed for one added by hand. */
  bankName: string
  institutionName: string | null
  /** Added by hand: its name is the owner's own, so it is shown as typed. */
  manual: boolean
  /** The last digits of the account number, which a bank's name may repeat. */
  mask: string | null
}

/** What naming accounts side by side needs, to tell apart two with the same name. */
export interface NamingAccount extends AccountNameParts {
  id: string
  type: string
  subtype: string | null
}

/** Short words that stay uppercase: acronyms people know in an account's or bank's name. */
const ACRONYMS = new Set([
  'ATM',
  'BECU',
  'BMO',
  'BOK',
  'CD',
  'FSA',
  'HELOC',
  'HSA',
  'HSBC',
  'IRA',
  'LLC',
  'PNC',
  'SEP',
  'TD',
  'UMB',
  'US',
  'USA',
  'USAA',
])

/** Spelled their own way, whatever case the bank or owner sends. */
const SPECIAL = new Map([['401K', '401k']])

/** Small words that stay lowercase inside a name, as in "Bank of America". */
const SMALL_WORDS = new Set(['of', 'and', 'the', 'for', 'at', 'by', 'in', 'on'])

/**
 * Words a bank's legal or app name ends with that say nothing about which
 * bank it is: "Wells Fargo Bank, N.A." is Wells Fargo.
 */
const BOILERPLATE = new Set(['bank', 'banking', 'online', 'financial', 'n.a.', 'na', 'inc', 'inc.'])

/** Words left dangling once an account number is taken out, as in "CHECKING ENDING IN 4417". */
const NUMBER_LEAD_INS = new Set([
  'ending',
  'in',
  'acct',
  'acct.',
  'account#',
  'no',
  'no.',
  '#',
  '-',
])

/**
 * A word that is an account number, whole or masked: "4417", "...4417",
 * "X4417", "(XXXX-4417)". Four digits or more, so "401K" and "12 MONTH CD" stay.
 */
const MASKED_NUMBER = /^[x*•·.…#-]*\d{4,}$/i

/** Brackets and punctuation around a word, kept apart from the word itself. */
const WRAPPED = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u

/** The account's name as shown, before telling apart any that share it. */
export function accountDisplayName(parts: AccountNameParts): string {
  const nickname = parts.nickname?.trim()
  if (nickname) return nickname
  if (parts.manual) return parts.bankName.trim() || 'Account'

  const account = readableCase(withoutAccountNumber(parts.bankName, parts.mask))
  const bank = parts.institutionName ? shortBankName(parts.institutionName) : ''
  // "Chase Sapphire" from Chase already says the bank; "Chasewood" does not.
  const saysBank = `${account} `.toLowerCase().startsWith(`${bank} `.toLowerCase())
  const name = !bank || saysBank ? account : `${bank} ${account}`
  return name.trim() || 'Account'
}

/**
 * Every account's name, by id, with no two alike. Of accounts sharing a name,
 * the oldest keeps it and the rest are told apart by their kind, "Chase
 * Checking (savings)", or by order within it, "(second checking)". Never by
 * the account number, since names leave the app. Accounts must come oldest
 * first, so adding one never renames another.
 */
export function distinctAccountNames(accounts: readonly NamingAccount[]): Map<string, string> {
  const named = accounts.map((account) => ({ account, name: accountDisplayName(account) }))
  const sharing = groupBy(named, ({ name }) => name.toLowerCase())
  const names = new Map<string, string>()
  for (const group of sharing.values()) {
    if (group.length === 1) {
      names.set(group[0]!.account.id, group[0]!.name)
      continue
    }
    // How many accounts of each kind the group has named so far.
    const seen = new Map<string, number>()
    group.forEach(({ account, name }, index) => {
      const kind = kindOfAccount(account)
      const count = (seen.get(kind) ?? 0) + 1
      seen.set(kind, count)
      if (index === 0) names.set(account.id, name)
      else names.set(account.id, `${name} (${count === 1 ? kind : `${ordinal(count)} ${kind}`})`)
    })
  }
  return names
}

/**
 * A bank's name without what it ends with: an app or division after " - ",
 * and words like "Bank" or "N.A.". A name of nothing but those words, like
 * "Online Banking", is kept whole. Only a name sent in capitals changes case,
 * so "HSBC Bank" is HSBC and "M&T Bank" is M&T.
 */
export function shortBankName(institution: string): string {
  const [main = ''] = institution.split(/\s+-\s+/)
  const words = main.replaceAll(',', ' ').split(/\s+/).filter(Boolean)
  let end = words.length
  while (end > 0 && BOILERPLATE.has(words[end - 1]!.toLowerCase())) end--
  const kept = end > 0 ? words.slice(0, end) : words
  // A lone short word in capitals, like "BECU", is the bank's initials.
  const initials = words.length === 1 && /^\p{Lu}{2,4}$/u.test(words[0]!)
  if (initials) return words[0]!
  return readableCase(kept.join(' '), isShouted(main))
}

/**
 * A name in plain case. A name in all capitals becomes title case, keeping
 * acronyms, initials like "U.S.", names like "M&T" and codes with digits. A
 * name with any lowercase letter, like "eSavings PLUS", is how the bank or
 * owner styled it, and is kept.
 */
export function readableCase(name: string, shouted = isShouted(name)): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => {
      const special = SPECIAL.get(word.toUpperCase())
      if (special) return special
      return shouted ? quieterWord(word, index === 0) : word
    })
    .join(' ')
}

/** True when a name has no lowercase letters: a bank shouting it. */
function isShouted(name: string): boolean {
  return name === name.toUpperCase()
}

/** One word of an all-capitals name, as people would write it. */
function quieterWord(word: string, first: boolean): string {
  // Brackets around a word don't change what it is: "(IRA)" is still an acronym.
  const [, , core = ''] = WRAPPED.exec(word) ?? []
  if (/\d/.test(core) || ACRONYMS.has(core)) return word
  // Initials, "U.S." or "N.A.", and names joined by "&", "M&T", stay as sent.
  if (/^(\p{L}\.)+\p{L}?$/u.test(core) || core.includes('&')) return word
  const lower = word.toLowerCase()
  if (!first && SMALL_WORDS.has(lower)) return lower
  // A capital starts the word and each part after a bracket, hyphen or slash:
  // "PRE-PAID" reads "Pre-Paid", "(SAVINGS)" reads "(Savings)". Not after an
  // apostrophe, so "KOHL'S" reads "Kohl's".
  return lower.replace(/(^|[^\p{L}'’])(\p{L})/gu, (_match, before: string, letter: string) => {
    return before + letter.toUpperCase()
  })
}

/**
 * A bank's name for an account without the account number some banks put in
 * it, "CHECKING ...4417" or "CREDIT CARD (X4417)", and without the words that
 * led up to the number.
 */
function withoutAccountNumber(bankName: string, mask: string | null): string {
  const digits = mask?.replace(/\D/g, '') ?? ''
  const isNumber = (word: string) => {
    const [, , core = ''] = WRAPPED.exec(word) ?? []
    // A word holding the mask's digits, like "CHK4417", gives the number away too.
    const hasMask = digits.length >= 2 && word.replace(/\D/g, '').includes(digits)
    return MASKED_NUMBER.test(core) || hasMask
  }
  const words = bankName.split(/\s+/).filter(Boolean)
  const kept = words.filter((word) => !isNumber(word))
  if (kept.length === words.length) return words.join(' ')
  while (kept.length > 0 && NUMBER_LEAD_INS.has(kept.at(-1)!.toLowerCase())) kept.pop()
  return kept.join(' ')
}

/** The kind of account in a few words: "checking", "credit card", "IRA". */
function kindOfAccount({ type, subtype }: Pick<NamingAccount, 'type' | 'subtype'>): string {
  if (subtype?.trim()) {
    return subtype
      .trim()
      .split(/\s+/)
      .map((word) => SPECIAL.get(word.toUpperCase()) ?? acronymOr(word.toLowerCase()))
      .join(' ')
  }
  return TYPE_WORDS[type] ?? 'account'
}

const acronymOr = (word: string) => (ACRONYMS.has(word.toUpperCase()) ? word.toUpperCase() : word)

/** Each type of account in words, for one the bank gives no subtype. */
const TYPE_WORDS: Record<string, string> = {
  depository: 'bank account',
  credit: 'credit card',
  loan: 'loan',
  investment: 'investment',
  property: 'property',
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth']

/** "second", "third", and so on in words; past eighth, "9th" or "21st", which no one should need. */
function ordinal(count: number): string {
  const word = ORDINALS[count - 1]
  if (word) return word
  const teen = count % 100 >= 11 && count % 100 <= 13
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[count % 10]
  return `${count}${suffix ?? 'th'}`
}

function groupBy<Item>(items: readonly Item[], key: (item: Item) => string): Map<string, Item[]> {
  const groups = new Map<string, Item[]>()
  for (const item of items) {
    const group = groups.get(key(item))
    if (group) group.push(item)
    else groups.set(key(item), [item])
  }
  return groups
}
