// What replaces each name Chat hides in a tool's result (toolOutput.ts),
// and in what order: an owner's label holding a name as it reads without it,
// what labelled rows would have been shown as, full names, the shops kept
// whole, then single words. Earlier ones win where two overlap, so each is
// looked for before anything that would garble it. It lives beside the
// patterns it builds (namePatterns.ts), which the domain never imports. Pure.

import { wordsOf } from '../domain/chat/billLabels.js'
import { isNamedLikeAPerson } from '../domain/chat/givenNames.js'
import type { PaymentPeople } from '../domain/chat/people.js'
import { straight } from '../domain/chat/shownText.js'
import {
  fullNamePattern,
  loneNamePattern,
  maskPattern,
  replacedIn,
  type Replacement,
} from './namePatterns.js'

/** Stands in for a person's name wherever one would show. */
export const SOMEONE = 'someone'

/** Stands in for an account mask wherever one is written. */
export const MASKED = '••••'

/** What replaces hidden things, in the order each list is looked for. */
export interface HiddenNames {
  /**
   * Owner's labels holding a name as they read without it, then shown names
   * by their label, full names, and single words of names by "someone", but
   * a word of the owner's account names, which stay.
   */
  names: Replacement[]
  /** Account masks, looked for once names are gone, so one inside a kept shop's name goes too. */
  masks: Replacement[]
}

/**
 * The names of shops the owner buys from that hold a word hidden alone, each
 * kept as written: Chat shows them anyway, and "Trader Joe's" must not read
 * "Trader someone's" because the owner paid a Joe through Zelle, nor "HBO
 * Max" read "HBO someone" because the owner has a category "Max". A shop
 * of one word named like a person ("Ross") keeps nothing, so a label
 * "Ross's" or "Venmo/Ross" still reads without the name (ownerText.ts).
 */
function shopsKept(people: PaymentPeople): Replacement[] {
  const alone = [
    ...people.loneAnyCase,
    ...people.loneNames,
    ...people.phrases.map(([phrase]) => phrase),
    ...people.labels.flatMap(({ words }) => words),
  ]
  const hidden = new Set(alone.flatMap(wordsOf))
  const namedLikeAPerson = (shop: string) => !/\s/.test(shop) && isNamedLikeAPerson(shop)
  return [...people.shops.names]
    .filter((shop) => !namedLikeAPerson(shop) && wordsOf(shop).some((word) => hidden.has(word)))
    .map((shop) => ({ pattern: fullNamePattern(shop), with: null }))
}

/** The names Chat hides that were read from labelled rows, in the order they are looked for. */
interface OfPeople {
  /** What labelled rows would have been shown as, and full names: looked for first. */
  phrases: Replacement[]
  /** Single words: one-word phrases, then words of names. */
  words: Replacement[]
}

/**
 * Each owner's label holding a word that could be a name, as it reads with
 * those words (and any other hidden name) as "someone", longest first, so
 * the label goes wherever it is written and its words nowhere else. The
 * whole name of a shop of two words or more stays ("Trader Joe's with Joe"
 * reads "Trader Joe's with someone"), as does a shop's name of one word
 * that is no given name ("Wegmans groceries", but "Ross allowance"). Labels
 * of one word come apart, looked for only after the shops kept, so a
 * category "Max" leaves "HBO Max".
 */
function labelsAsShown(people: PaymentPeople, ofPeople: OfPeople): OfPeople {
  const shopsIn = (label: string) => {
    const plain = straight(label.toLowerCase())
    return [...people.shops.names]
      .filter((shop) => /\s/.test(shop) && plain.includes(shop))
      .map((shop) => ({ pattern: fullNamePattern(shop), with: null }))
  }
  const asSomeone = (words: readonly string[]) =>
    words.map((word) => ({ pattern: fullNamePattern(word), with: SOMEONE }))
  const shown = [...people.labels]
    .sort((a, b) => b.label.length - a.label.length)
    .flatMap(({ label, words }) => {
      const order = [...shopsIn(label), ...ofPeople.phrases, ...asSomeone(words), ...ofPeople.words]
      const reads = replacedIn(label, order)
      return reads === label ? [] : [{ label, pattern: fullNamePattern(label), with: reads }]
    })
  const oneWord = ({ label }: { label: string }) => !/\s/.test(label.trim())
  return {
    phrases: shown.filter((one) => !oneWord(one)),
    words: shown.filter(oneWord),
  }
}

/** What replaces each hidden thing, in the order they are looked for. */
export function replacementsOf(people: PaymentPeople): HiddenNames {
  // A phrase of one word is a name alone ("Brightwater"), looked for after full names.
  const oneWord = ([phrase]: readonly [string, string]) => wordsOf(phrase).length === 1
  const phrases = people.phrases
    .filter((phrase) => !oneWord(phrase))
    .map(([phrase, label]) => ({ pattern: fullNamePattern(phrase), with: label }))
  const words = people.phrases
    .filter(oneWord)
    .map(([phrase]) => ({ pattern: fullNamePattern(phrase), with: SOMEONE }))
  const names = people.names
    .filter((name) => name.trim())
    .sort((a, b) => b.length - a.length)
    .map((name) => ({ pattern: fullNamePattern(name), with: SOMEONE }))
  // A single word of the owner's account names is never hidden alone, so account names stay.
  const account = new Set(people.accountWords)
  const lone = [
    ...people.loneAnyCase.map((word) => ({ word, pattern: fullNamePattern(word) })),
    ...people.loneNames.map((word) => ({ word, pattern: loneNamePattern(word) })),
  ]
    .filter(({ word }) => !account.has(word.toLowerCase()))
    .map(({ pattern }) => ({ pattern, with: SOMEONE }))
  const ofPeople = { phrases: [...phrases, ...names], words: [...words, ...lone] }
  const labels = labelsAsShown(people, ofPeople)
  const masks = people.masks.map((mask) => ({ pattern: maskPattern(mask), with: MASKED }))
  return {
    names: [
      ...labels.phrases,
      ...ofPeople.phrases,
      ...shopsKept(people),
      ...labels.words,
      ...ofPeople.words,
    ],
    masks,
  }
}
