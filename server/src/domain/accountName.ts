// An account's name as Leeway shows it everywhere: in alerts, the dashboard
// summary, the Accounts page, the weekly email and to assistants. Pure.
//
// The owner's own name for an account wins. Otherwise banks send names like
// "TOTAL CHECKING" from "BOK Financial - Online Banking", which read better as
// "BOK Total Checking": the bank's short name, then the account in plain case.
// Names leave the app (the weekly email, the AI writer), so a name built from
// the bank's text never shows the account's mask, as carriesMask defines it:
// see accountNumber.ts.

import { carriesMask, withoutAccountNumber } from './accountNumber.js'
import {
  coreOf,
  isInitials,
  isKnownAcronym,
  isShouted,
  readableCase,
  SMALL_WORDS,
} from './nameWords.js'

/** What naming one account needs. */
export interface AccountNameParts {
  /** The owner's own name for the account, if they gave one. */
  nickname: string | null
  /** The account's name as the bank sends it, or as typed for one added by hand. */
  bankName: string
  institutionName: string | null
  /** Added by hand: its name is the owner's own, so it is shown as typed. */
  manual: boolean
  /** The account number's last 2 to 4 characters, digits or letters, which a bank's name may repeat. */
  mask: string | null
  /** The kind of account, as Plaid sends it: "depository" and "checking". */
  type: string
  subtype: string | null
}

/** What naming accounts side by side needs, to tell apart two with the same name. */
export interface NamingAccount extends AccountNameParts {
  id: string
}

/**
 * Words a bank's legal or app name ends with that say nothing about which
 * bank it is: "Wells Fargo Bank, N.A." is Wells Fargo.
 */
const BOILERPLATE = new Set([
  'bank',
  'banking',
  'online',
  'financial',
  'n.a.',
  // "N.A." once its last dot is trimmed off, as bankAcronyms reads it.
  'n.a',
  'na',
  'inc',
  'inc.',
])

/** Words many banks' names are made of, so a name of only these keeps its "Bank". */
const COMMON_BANK_WORDS = new Set([
  'american',
  'citizens',
  'city',
  'commerce',
  'community',
  'county',
  'farmers',
  'federal',
  'first',
  'home',
  'merchants',
  'national',
  'peoples',
  'savings',
  'security',
  'state',
  'trust',
  'united',
])

/** The account's name as shown, before telling apart any that share it. */
export function accountDisplayName(parts: AccountNameParts): string {
  const nickname = parts.nickname?.trim()
  if (nickname) return nickname
  if (parts.manual) return parts.bankName.trim() || 'Account'

  const institution = parts.institutionName?.trim() ?? ''
  const acronyms = bankAcronyms(institution)
  const account = readableCase(withoutAccountNumber(parts.bankName, parts.mask), { acronyms })
  const bank = institution ? shortBankName(institution) : ''
  // The guarantee: a name that still shows the mask (see carriesMask), however
  // the bank wrote it, gives way to one made only of the bank and the kind of
  // account, "Chase Checking", and at worst to "Account", which has no digits
  // and could only match a mask of the letters it ends with, like "NT".
  const names = [
    withBank(bank, account),
    withBank(bank, kindOfAccount(parts)),
    withBank(bank, typeOfAccount(parts)),
    bank,
  ]
  return names.find((name) => name && !carriesMask(name, parts.mask)) ?? 'Account'
}

/**
 * Every account's name, by id, with no two alike, whatever their case. Of
 * accounts sharing a name, the oldest keeps it and the rest are told apart by
 * their kind, "Chase Checking (Savings)", or by order within it, "(Second
 * Checking)". Never by the account number, since names leave the app.
 * Accounts must come oldest first, so adding one never renames another.
 */
export function distinctAccountNames(accounts: readonly NamingAccount[]): Map<string, string> {
  const names = new Map<string, string>()
  const taken = new Set<string>()
  // How many accounts so far share each name and kind, so the next is "Second", "Third".
  const sharing = new Map<string, number>()
  for (const account of accounts) {
    const base = accountDisplayName(account)
    const kind = [kindOfAccount(account), typeOfAccount(account), 'Account'].find(
      (words) => !carriesMask(words, account.mask),
    )!
    const key = `${base.toLowerCase()}\n${kind}`
    let count = sharing.get(key) ?? 0
    let name = base
    // A suffixed name can match another account's own, so step on until it is free.
    while (taken.has(name.toLowerCase())) {
      count += 1
      const suffix = count <= 1 ? kind : `${ordinal(count)} ${kind}`
      // Past eighth the order is in digits, "21st", which must not show the mask either.
      if (!carriesMask(suffix, account.mask)) name = `${base} (${suffix})`
    }
    sharing.set(key, Math.max(count, 1))
    taken.add(name.toLowerCase())
    names.set(account.id, name)
  }
  return names
}

/**
 * A bank's name without what it ends with: an app or division after " - ",
 * and words like "Bank" or "N.A.". "Bank" stays where the rest would not be
 * a name of its own: "U.S. Bank", "TD Bank", "First National Bank". A name of
 * nothing but such words, like "Online Banking", is kept whole. Only a name
 * sent in capitals changes case, so "HSBC Bank" keeps HSBC.
 */
export function shortBankName(institution: string): string {
  const main = institution.split(/\s+-\s+/)[0]!
  const words = main.replaceAll(',', ' ').split(/\s+/).filter(Boolean)
  const shouted = isShouted(main)
  const acronyms = bankAcronyms(main)
  let end = words.length
  while (end > 0 && BOILERPLATE.has(words[end - 1]!.toLowerCase())) {
    const isBank = words[end - 1]!.toLowerCase() === 'bank'
    if (isBank && needsBank(words.slice(0, end - 1), shouted, acronyms)) break
    end--
  }
  const kept = end > 0 ? words.slice(0, end) : words
  return readableCase(kept.join(' '), { shouted, acronyms })
}

/** Whether a bank's name without "Bank" would be too little: initials, one short word, or common words. */
function needsBank(
  rest: readonly string[],
  shouted: boolean,
  acronyms: ReadonlySet<string>,
): boolean {
  if (rest.length === 0) return false
  if (rest.length === 1) {
    const [word] = rest as [string]
    if (coreOf(word).length <= 3) return true
    if (isInitials(word)) {
      // In a name sent in capitals, "ALLY" may be a word: only known or unsayable letters count.
      const letters = /^\p{Lu}+$/u.test(word)
      return !shouted || !letters || acronyms.has(word) || isKnownAcronym(word)
    }
  }
  return rest.every((word) => COMMON_BANK_WORDS.has(word.toLowerCase()))
}

/**
 * The words a bank writes in capitals, which stay that way in its accounts'
 * names too: "BOK" in "BOK Financial", and its initials, "NFCU" for Navy
 * Federal Credit Union. A name sent all in capitals shows no styling, so of
 * its words only those no one could say as a word count, like "PNC": "KEY" in
 * "KEY BANK" is a word. Known acronyms with vowels, like TIAA, are listed in
 * nameWords.ts.
 */
export function bankAcronyms(institution: string): ReadonlySet<string> {
  const words = institution
    .split(/[\s,]+/)
    .map(coreOf)
    .filter((word) => word && !SMALL_WORDS.has(word.toLowerCase()))
  const named = words.filter((word) => !BOILERPLATE.has(word.toLowerCase()))
  const shouted = isShouted(institution)
  const acronyms = new Set(
    named.filter((word) => /^\p{Lu}{2,4}$/u.test(word) && (!shouted || !/[AEIOUY]/.test(word))),
  )
  const initials = initialsOf(named)
  if (initials) acronyms.add(initials)
  return acronyms
}

/**
 * The initials of a name of three or four words, "NFCU" for Navy Federal
 * Credit Union, or '' for a name too short or long to go by them. Two
 * letters would too often be a word, like "ON" for Old National.
 */
function initialsOf(words: readonly string[]): string {
  const initials = words.map((word) => word[0]!.toUpperCase()).join('')
  return initials.length >= 3 && initials.length <= 4 ? initials : ''
}

/**
 * The bank's name, then the account's. Where the account's name already
 * starts with the bank's, as "BBVA CHECKING" at BBVA USA, that part is
 * written the bank's way once: "BBVA USA Checking", and "Chase Sapphire" at
 * Chase stays as it is. So are the bank's initials: "NFCU CHECKING" at Navy
 * Federal Credit Union is "Navy Federal Credit Union Checking". "Chasewood
 * Savings" at Chase is "Chase Chasewood Savings".
 */
function withBank(bank: string, account: string): string {
  const bankWords = bank.split(' ').filter(Boolean)
  const accountWords = account.split(' ').filter(Boolean)
  let shared = 0
  while (
    shared < bankWords.length &&
    shared < accountWords.length &&
    bankWords[shared]!.toLowerCase() === accountWords[shared]!.toLowerCase()
  ) {
    shared++
  }
  const initials = initialsOf(bankWords.filter((word) => !SMALL_WORDS.has(word.toLowerCase())))
  if (shared === 0 && initials && accountWords[0]?.toUpperCase() === initials) shared = 1
  return [...bankWords, ...accountWords.slice(shared)].join(' ')
}

/** The kind of account, written like a name: "Checking", "Credit Card", "Roth IRA". */
function kindOfAccount({ type, subtype }: Pick<AccountNameParts, 'type' | 'subtype'>): string {
  const kind = subtype?.trim() || TYPE_WORDS[type] || 'account'
  return readableCase(kind.toUpperCase())
}

/** The type of account alone, written like a name: "Investment" for a 401k. */
function typeOfAccount({ type }: Pick<AccountNameParts, 'type'>): string {
  return readableCase((TYPE_WORDS[type] ?? 'account').toUpperCase())
}

/** Each type of account in words, for one the bank gives no subtype. */
const TYPE_WORDS: Record<string, string> = {
  depository: 'bank account',
  credit: 'credit card',
  loan: 'loan',
  investment: 'investment',
  property: 'property',
}

const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth']

/** "Second", "Third", and so on in words; past eighth, "9th" or "21st", which no one should need. */
function ordinal(count: number): string {
  const word = ORDINALS[count - 1]
  if (word) return word
  const teen = count % 100 >= 11 && count % 100 <= 13
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[count % 10]
  return `${count}${suffix ?? 'th'}`
}
