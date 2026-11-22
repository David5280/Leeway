// A drill-down: what a card's figure is made of, opened by tapping the card.
// Every figure card describes one (see Card in components/ui.tsx), always in
// the same order, leaving out any part it has no data for:
//   1. the figure and the math behind it, in plain words;
//   2. its trend over time, as a small chart;
//   3. how it compares with the usual, by a sign, a word and a color;
//   4. what makes it up (transactions, categories, accounts), each tappable;
//   5. a link on to its full page.
// Drill-downs are plain data built by pure functions in lib/drills/, so the
// math is tested on its own and the sheet (DrillSheet) only draws it.

import type { Category } from '../api/client'
import type { MoneySign, MoneyTone } from './money'

/** A value in a drill-down: an amount of money, or words for anything else ("4.0 months"). */
export type DrillValue =
  { cents: number; sign?: MoneySign; tone?: MoneyTone } | { text: string; tone?: MoneyTone }

/** How a term joins what came before: added, taken away, multiplied, divided, or listed beside it. */
export type MathOp = 'plus' | 'minus' | 'times' | 'dividedBy' | 'and'

/** One term of the math, joined to what came before by its operation; the first has none. */
export interface MathTerm {
  label: string
  value: DrillValue
  op?: MathOp
}

/** Each operation as a sign in the equation and as words in the sentence read aloud. */
export const MATH_OPS: Record<MathOp, { sign: string; words: string }> = {
  plus: { sign: '+', words: 'plus' },
  // The true minus sign, not a hyphen.
  minus: { sign: '−', words: 'minus' },
  times: { sign: '×', words: 'times' },
  dividedBy: { sign: '÷', words: 'divided by' },
  // One of several values a figure is picked from, like the months a middle is taken of.
  and: { sign: '·', words: 'and' },
}

/** The math behind a figure: the terms, in order, and the result they come to. */
export interface DrillMath {
  terms: MathTerm[]
  result: { label: string; value: DrillValue }
  /** A short plain-language note under the math, like what a cushion is for. */
  note?: string
}

/** How the figure moved, oldest point first, drawn as the app's line chart. */
export interface DrillTrend {
  points: { date: string; cents: number }[]
  /** The chart's question or answer, as its name: "Net worth over the last year". */
  label: string
  /** One sentence on what the line shows, for screen readers. */
  description: string
  /** Where the line should be, drawn as a dashed level: "Under 30% of the limit". */
  reference?: { cents: number; label: string; at?: 'start' | 'end' }
}

/**
 * What a trend's chart says to a screen reader: its description, and where
 * the dashed level is, since that level is only drawn.
 */
export function trendDescription(trend: DrillTrend, money: (cents: number) => string): string {
  if (!trend.reference) return trend.description
  const { label, cents } = trend.reference
  return `${trend.description} The dashed line marks where it should be (${label}, ${money(cents)}).`
}

/** The figure against what is usual for it. */
export interface DrillUsual {
  currentCents: number
  usualCents: number
  /** Which way is good news: `down` for spending, `up` for savings. */
  goodWhen: 'up' | 'down'
  /** What the usual is, finishing "than ...": "this point last paycheck". */
  basis: string
  /** What is compared, for a chip's few words: "spent" reads "▼ $40 less spent". */
  subject?: string
  /**
   * The section's title when the figure is measured against something other
   * than its usual, like a budget: "Compared with the budget".
   */
  heading?: string
}

/** One thing that makes up the figure: a transaction, a category or an account. */
export interface DrillItem {
  key: string
  label: string
  detail?: string
  value?: DrillValue
  /** Where tapping it goes; the row is plain text without one. */
  to?: string
  /** The icon to draw: a category (null for none yet) or a transfer. */
  icon?: { category: Pick<Category, 'name' | 'color' | 'icon' | 'kind'> | null; transfer?: boolean }
}

export interface DrillDown {
  title: string
  /** A line under the title, like the period it covers. */
  subtitle?: string
  figure: DrillValue
  math: DrillMath
  trend?: DrillTrend
  usual?: DrillUsual
  items?: { title: string; rows: DrillItem[] }
  more?: { to: string; label: string }
}

/** A value as text, money through the app's formatter so it matches every other amount. */
export function valueText(value: DrillValue, money: (cents: number) => string): string {
  return 'text' in value ? value.text : money(value.cents)
}

/**
 * The math as one plain sentence, for reading aloud and for the line under
 * the equation: "Left to spend $352 = budgets $740 minus spent $388".
 */
export function mathSentence(math: DrillMath, money: (cents: number) => string): string {
  const terms = math.terms
    .map((term, index) => {
      const words = `${term.label} ${valueText(term.value, money)}`
      if (index === 0 || !term.op) return words
      return `${MATH_OPS[term.op].words} ${words}`
    })
    .join(' ')
  return `${math.result.label} ${valueText(math.result.value, money)} = ${terms}`
}

export type UsualTone = 'good' | 'warn' | 'flat'

export interface UsualComparison {
  /** How far from the usual, always positive. */
  differenceCents: number
  direction: 'more' | 'less' | 'same'
  /** Good news is green, a move the wrong way amber: never red, as nothing is wrong yet. */
  tone: UsualTone
  /** The arrow that goes with the word, so color is never the only signal. */
  arrow: '▲' | '▼' | '='
}

/** Within this share of the usual reads as the same, so a few dollars is not news. */
const SAME_SHARE = 0.03

/** How a figure compares with its usual, in a direction, a tone and an arrow. */
export function compareToUsual(usual: DrillUsual): UsualComparison {
  const difference = usual.currentCents - usual.usualCents
  const differenceCents = Math.abs(difference)
  if (differenceCents <= Math.abs(usual.usualCents) * SAME_SHARE || difference === 0) {
    return { differenceCents, direction: 'same', tone: 'flat', arrow: '=' }
  }
  const direction = difference > 0 ? 'more' : 'less'
  const hoped = usual.goodWhen === 'up' ? 'more' : 'less'
  return {
    differenceCents,
    direction,
    tone: direction === hoped ? 'good' : 'warn',
    arrow: direction === 'more' ? '▲' : '▼',
  }
}

/** The comparison in words: "$40 less than this point last paycheck", or "About the same as ...". */
export function usualSentence(usual: DrillUsual, money: (cents: number) => string): string {
  const comparison = compareToUsual(usual)
  if (comparison.direction === 'same') return `About the same as ${usual.basis}`
  return `${money(comparison.differenceCents)} ${comparison.direction} than ${usual.basis}`
}
