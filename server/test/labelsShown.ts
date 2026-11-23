// The owner's labels as a tool's output shows them, read through every step
// Chat takes (ownerText.ts, personNames.ts, chat/toolOutput.ts), beside
// shops the owner buys from. Every name is made up.

import { chatToolText } from '../src/chat/toolOutput.js'
import { namesInLabels } from '../src/domain/chat/ownerText.js'
import { NO_PEOPLE } from '../src/domain/chat/people.js'
import { namedLabels } from '../src/domain/chat/personNames.js'
import { knownShops } from '../src/domain/knownShops.js'

// Shops the owner buys from: one-word ones named for no one, and ones named like a person.
export const SHOPS = knownShops(['Wegmans', 'Marshalls', 'Target', 'Ross', 'Ruby', "Trader Joe's"])

/** Each label as a tool's output shows it. */
export function shown(labels: readonly string[]): string[] {
  const words = namesInLabels(labels, () => false, SHOPS)
  const people = { ...NO_PEOPLE, shops: SHOPS, labels: namedLabels(words, SHOPS) }
  return (JSON.parse(chatToolText({ labels }, people)) as { labels: string[] }).labels
}

/** Each label beside how it is shown, so a failure names the label. */
export function pairs(labels: readonly string[]): [string, string][] {
  const each = shown(labels)
  return labels.map((label, at) => [label, each[at]!])
}
