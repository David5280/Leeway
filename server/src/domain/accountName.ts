// An account's name as Leeway shows it everywhere: in alerts, the dashboard
// summary, the Accounts page, the weekly email and to assistants. Pure.
//
// The owner's own name for an account wins. Otherwise banks send names like
// "TOTAL CHECKING" from "BOK Financial - Online Banking", which read better as
// "BOK Total Checking": the bank's short name, then the account in plain case.

/** What naming an account needs. */
export interface AccountNameParts {
  /** The owner's own name for the account, if they gave one. */
  nickname: string | null
  /** The account's name as the bank sends it, or as typed for one added by hand. */
  bankName: string
  institutionName: string | null
  /** Added by hand: its name is the owner's own, so it is shown as typed. */
  manual: boolean
}

/** Short words that stay uppercase: acronyms people know in an account's or bank's name. */
const ACRONYMS = new Set([
  'ATM',
  'BMO',
  'BOK',
  'CD',
  'FSA',
  'HELOC',
  'HSA',
  'IRA',
  'LLC',
  'PNC',
  'SEP',
  'TD',
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

/** The account's name as shown everywhere. */
export function accountDisplayName(parts: AccountNameParts): string {
  const nickname = parts.nickname?.trim()
  if (nickname) return nickname
  if (parts.manual) return parts.bankName

  const account = readableCase(parts.bankName.trim())
  const bank = parts.institutionName ? shortBankName(parts.institutionName) : ''
  // "Chase Sapphire" from Chase already says the bank; "Chasewood" does not.
  const saysBank = `${account} `.toLowerCase().startsWith(`${bank} `.toLowerCase())
  if (!bank || saysBank) return account
  return `${bank} ${account}`
}

/**
 * A bank's name without what it ends with: an app or division after " - ",
 * and words like "Bank" or "N.A.". A name of nothing but those words, like
 * "Online Banking", is kept whole.
 */
export function shortBankName(institution: string): string {
  const [main = ''] = institution.split(/\s+-\s+/)
  const words = main.replaceAll(',', ' ').split(/\s+/).filter(Boolean)
  let end = words.length
  while (end > 0 && BOILERPLATE.has(words[end - 1]!.toLowerCase())) end--
  return readableCase((end > 0 ? words.slice(0, end) : words).join(' '))
}

/**
 * A name in plain case. A name in all capitals becomes title case, keeping
 * known acronyms and codes with digits. A name with any lowercase letter, like
 * "eSavings PLUS", is how the bank or owner styled it, and is kept.
 */
export function readableCase(name: string): string {
  const shouted = name === name.toUpperCase()
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

/** One word of an all-capitals name, as people would write it. */
function quieterWord(word: string, first: boolean): string {
  if (/\d/.test(word) || ACRONYMS.has(word)) return word
  const lower = word.toLowerCase()
  if (!first && SMALL_WORDS.has(lower)) return lower
  // Capitalize each part of a hyphenated word: "PRE-PAID" reads "Pre-Paid".
  return lower.replace(/(^|-)(\p{L})/gu, (_match, start: string, letter: string) => {
    return start + letter.toUpperCase()
  })
}

/**
 * An account's name parts as a query of another table reads them, prefixed
 * so they never clash with that table's own columns, like a transaction's `manual`.
 */
export interface AccountNameColumns {
  accountNickname: string | null
  accountBankName: string
  accountInstitution: string | null
  accountByHand: boolean
}

/**
 * The columns that read AccountNameColumns, for a query with the accounts
 * table as `a`. The bank's name comes by subquery, so no join is needed.
 */
export const ACCOUNT_NAME_COLUMNS = `a.display_name AS "accountNickname",
  a.name AS "accountBankName", a.connection_id IS NULL AS "accountByHand",
  (SELECT c.institution_name FROM connections c WHERE c.id = a.connection_id) AS "accountInstitution"`

/** A row read with ACCOUNT_NAME_COLUMNS, with those columns swapped for the account's name. */
export function withAccountName<Row extends AccountNameColumns>(
  row: Row,
): Omit<Row, keyof AccountNameColumns> & { accountName: string } {
  const { accountNickname, accountBankName, accountInstitution, accountByHand, ...rest } = row
  const accountName = accountDisplayName({
    nickname: accountNickname,
    bankName: accountBankName,
    institutionName: accountInstitution,
    manual: accountByHand,
  })
  return { ...rest, accountName }
}
