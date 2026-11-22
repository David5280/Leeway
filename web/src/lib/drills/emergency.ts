// Drill-downs for the emergency fund on the Goals section: the offer (a month
// of essentials, and the essentials it is sized by) and the fund (how many
// months what it holds covers, and the accounts behind it). Pure: each takes
// the view get_emergency_fund returned and gives a DrillDown for DrillSheet.

import { accountDetailPath } from '../accounts'
import type { DrillDown, DrillItem, DrillMath } from '../drill'
import {
  countedWords,
  essentialsWords,
  monthsWord,
  targetWords,
  type EmergencyView,
  type FundChoice,
} from '../emergencyText'

/** Why an account the list shows does not count, in a few words. */
const LEFT_OUT_WORDS: Record<NonNullable<FundChoice['leftOut']>, string> = {
  hidden: 'Hidden, so not counted',
  not_shared: 'No longer shared, so not counted',
  other_goal: 'Another goal follows it',
  unavailable: 'No balance to count yet',
}

/** Whether an account counts, or why not: "Counted", "Trip follows it", "Hidden, so not counted". */
function detailOf(account: FundChoice): string {
  if (account.leftOut === null) return 'Counted'
  if (account.leftOut === 'other_goal' && account.otherGoal) {
    return `${account.otherGoal} follows it`
  }
  return LEFT_OUT_WORDS[account.leftOut]
}

/** One account on the fund's list: what it holds, and whether it counts. */
function accountRow(account: FundChoice): DrillItem {
  return {
    key: account.id,
    label: account.name,
    detail: detailOf(account),
    value: account.balanceCents === null ? undefined : { cents: account.balanceCents },
    to: accountDetailPath(account.id),
  }
}

/**
 * The accounts behind the fund, counted ones first, then any left out the
 * owner should see. None while the fund is counted by hand.
 */
function accountItems(view: EmergencyView): DrillDown['items'] {
  if (view.counts === 'hand') return undefined
  const counted = view.accounts.filter((a) => a.counted)
  const shown = view.accounts.filter((a) => !a.counted && (a.marked || a.leftOut === 'other_goal'))
  return { title: 'Accounts it counts', rows: [...counted, ...shown].map(accountRow) }
}

/** The target as months times a month of essentials, or the owner's own amount. */
function targetNote(view: EmergencyView): string {
  // A target with no months to it can only be the owner's own amount.
  if (view.ownTarget || view.months === null) return 'The target is your own amount.'
  return `The target is ${monthsWord(view.months)} of essentials.`
}

/**
 * How many months the fund covers: what it holds divided by a month of
 * essentials. Without essentials, what is left to the target instead.
 */
function coverMath(view: EmergencyView): DrillMath {
  const counts = `Counts ${countedWords(view)}.`
  if (view.essentials === null || view.monthsCovered === null) {
    return {
      terms: [
        { label: 'Target', value: { cents: view.targetCents } },
        { label: 'saved', value: { cents: view.savedCents }, op: 'minus' },
      ],
      result: { label: 'To go', value: { cents: Math.max(0, view.targetCents - view.savedCents) } },
      note: `${counts} Months of essentials show once a month of spending is in.`,
    }
  }
  return {
    terms: [
      { label: 'Saved', value: { cents: view.savedCents } },
      {
        label: `what ${essentialsWords(view.essentials)} cost a month`,
        value: { cents: view.essentials.cents },
        op: 'dividedBy',
      },
    ],
    result: { label: 'Covers', value: { text: monthsWord(view.monthsCovered) } },
    note: `${counts} ${targetNote(view)}`,
  }
}

/** The fund: what it holds, how many months that covers, and what it counts. */
export function emergencyFundDrill(view: EmergencyView, name: string): DrillDown {
  return {
    title: name,
    subtitle: targetWords(view),
    figure: { cents: view.savedCents },
    math: coverMath(view),
    // Each account left out says why on its own row.
    items: accountItems(view),
  }
}

/** The offer: a month of essentials, and what is put by already. */
export function emergencyOfferDrill(view: EmergencyView): DrillDown {
  const essentials = view.essentials
  return {
    title: 'Emergency fund',
    subtitle: 'Start with one month of essentials',
    figure: { cents: view.targetCents },
    math: {
      terms: [
        {
          label: `What ${essentialsWords(essentials)} cost a month`,
          // The first step is one month, so it is what a month of essentials costs.
          value: { cents: view.targetCents },
        },
        { label: 'months', value: { text: '1' }, op: 'times' },
      ],
      result: { label: 'First step', value: { cents: view.targetCents } },
      note: 'Enough for one month of the things that keep coming due, if income stopped.',
    },
    items:
      essentials?.categories && essentials.categories.length > 0
        ? {
            title: 'Counted as essential',
            rows: essentials.categories.map((category) => ({ key: category, label: category })),
          }
        : undefined,
  }
}
