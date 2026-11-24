// The Scriptable widget's plain logic: connecting, formatting and layout. The
// script is one file for Scriptable; everything above its "Scriptable"
// section runs here as it is. Its Scriptable part is in scriptable.test.ts.

import { describe, expect, it } from 'vitest'
import {
  alertBlock,
  change,
  connectionFrom,
  count,
  familyOf,
  figuresOf,
  headlineOf,
  KEYCHAIN_SERVER,
  KEYCHAIN_TOKEN,
  layoutFor,
  LIST_LENGTH,
  MESSAGES,
  messageLayout,
  money,
  originOf,
  outcomeOf,
  paletteFor,
  parseConnection,
  parseJson,
  REFRESH_MINUTES,
  shortDate,
  SUMMARY_VERSION,
  summaryUrl,
  THEME_COLORS,
  THEME_MODES,
  toneColors,
  updatedText,
} from '../../../widget/leeway-widget.js'
import { THEMES, type ThemeId } from '../lib/theme'
import { troubledWidgetSummary, widgetSummary } from '../test/widget'

const usd = { currency: 'USD', locale: 'en-US' }
const TOKEN = 'lww_abcDEF123_-xyz'

/** Every block in a layout, columns opened up, in order. */
type Block = ReturnType<typeof layoutFor>['blocks'][number]
function flatten(blocks: Block[]): Block[] {
  return blocks.flatMap((block) =>
    block.type === 'columns' ? block.columns.flatMap(flatten) : [block],
  )
}

/** The words a layout shows, with the tone of each. */
function words(blocks: Block[]): { text: string; tone: string }[] {
  return flatten(blocks).flatMap((block) => {
    if (block.type === 'text') return [{ text: block.text, tone: block.tone }]
    if (block.type === 'row') {
      return [
        { text: block.label, tone: 'muted' },
        { text: block.value, tone: block.tone },
      ]
    }
    return []
  })
}

function keychain(entries: Record<string, string> = {}) {
  return {
    contains: (key: string) => key in entries,
    get: (key: string) => entries[key]!,
  }
}

describe('connecting', () => {
  it('reads the address and token from the parameter, however they were pasted', () => {
    const expected = { server: 'https://leeway.example.com', token: TOKEN }
    expect(parseConnection(`https://leeway.example.com|${TOKEN}`)).toEqual(expected)
    expect(parseConnection(`  ${TOKEN}\nhttps://leeway.example.com  `)).toEqual(expected)
    expect(parseConnection(`https://leeway.example.com | ${TOKEN}`)).toEqual(expected)
  })

  it('needs both halves', () => {
    expect(parseConnection(null)).toBeNull()
    expect(parseConnection(undefined)).toBeNull()
    expect(parseConnection('')).toBeNull()
    expect(parseConnection('https://leeway.example.com')).toBeNull()
    expect(parseConnection(TOKEN)).toBeNull()
    // An agent key is not a widget token.
    expect(parseConnection('https://leeway.example.com|lw_agentkey')).toBeNull()
  })

  it('prefers the parameter, then what the script saved in the Keychain', () => {
    const saved = keychain({ [KEYCHAIN_SERVER]: 'https://saved.example', [KEYCHAIN_TOKEN]: TOKEN })
    expect(connectionFrom(`https://param.example|${TOKEN}`, saved)?.server).toBe(
      'https://param.example',
    )
    expect(connectionFrom(null, saved)).toEqual({ server: 'https://saved.example', token: TOKEN })
    expect(connectionFrom('nonsense', saved)?.server).toBe('https://saved.example')
    expect(
      connectionFrom(null, keychain({ [KEYCHAIN_SERVER]: 'https://saved.example' })),
    ).toBeNull()
    expect(connectionFrom(null, keychain({ [KEYCHAIN_TOKEN]: TOKEN }))).toBeNull()
    expect(connectionFrom(null, keychain())).toBeNull()
  })

  it('only ever sends the token over https, to the summary on the same host', () => {
    expect(originOf(' https://leeway.example.com/settings?x=1 ')).toBe('https://leeway.example.com')
    expect(summaryUrl('https://leeway.example.com:8443/')).toBe(
      'https://leeway.example.com:8443/api/widget',
    )
    expect(summaryUrl('HTTPS://Leeway.example.com')).toBe('HTTPS://Leeway.example.com/api/widget')
    expect(summaryUrl('http://leeway.example.com')).toBeNull()
    expect(summaryUrl('leeway.example.com')).toBeNull()
    expect(originOf('https://')).toBeNull()
  })

  it('turns each reply into the summary or a problem to explain', () => {
    const summary = widgetSummary()
    expect(outcomeOf(200, summary)).toEqual({ ok: true, summary })
    expect(outcomeOf(401, {})).toEqual({ ok: false, problem: 'bad_token' })
    expect(outcomeOf(403, {})).toEqual({ ok: false, problem: 'bad_token' })
    expect(outcomeOf(429, {})).toEqual({ ok: false, problem: 'busy' })
    expect(outcomeOf(500, {})).toEqual({ ok: false, problem: 'server' })
    expect(outcomeOf(200, null)).toEqual({ ok: false, problem: 'server' })
    expect(outcomeOf(200, 'text')).toEqual({ ok: false, problem: 'server' })
    // A summary of another shape: an older script on a newer server says to update.
    expect(outcomeOf(200, { ...summary, version: 3 })).toEqual({ ok: false, problem: 'outdated' })
  })

  it('reads JSON, or nothing', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 })
    expect(parseJson('<html>')).toBeNull()
  })
})

describe('formatting, by the app rules', () => {
  it('shows money in whole units, in the owner currency and locale', () => {
    expect(money(123_456, usd)).toBe('$1,235')
    expect(money(-50_000, usd)).toBe('-$500')
    expect(money(99_900, { currency: 'EUR', locale: 'de-DE' })).toBe('999 €')
  })

  it('marks money in green with a plus, and never by color alone', () => {
    expect(change(120_000, usd)).toEqual({ text: '+$1,200', tone: 'good' })
    // Money out is no problem in itself: a minus sign in plain ink.
    expect(change(-30_000, usd)).toEqual({ text: '-$300', tone: 'ink' })
    expect(change(0, usd)).toEqual({ text: '$0', tone: 'muted' })
  })

  it('writes dates and times briefly', () => {
    expect(shortDate('2026-11-20', 'en-US')).toBe('Nov 20')
    expect(shortDate('2026-01-01', 'en-GB')).toBe('1 Jan')
    expect(updatedText('2026-11-17T18:05:00Z', 'en-US', 'America/Denver')).toBe('Updated 11:05 AM')
    expect(updatedText('2026-11-17T18:05:00Z', 'en-US')).toMatch(/^Updated \d{1,2}:05/)
    expect(count(1, 'day')).toBe('1 day')
    expect(count(3, 'day')).toBe('3 days')
  })
})

describe('themes', () => {
  it('uses the same colors as the app, for every theme in light and dark', () => {
    for (const theme of Object.keys(THEMES) as ThemeId[]) {
      for (const mode of ['light', 'dark'] as const) {
        const app = THEMES[theme][mode]
        const widget = THEME_COLORS[theme][mode]
        for (const tone of Object.keys(widget) as (keyof typeof widget)[]) {
          expect(widget[tone], `${theme} ${mode} ${tone}`).toBe(app[tone])
        }
      }
      expect(THEME_MODES[theme]).toBe(THEMES[theme].mode)
    }
    expect(Object.keys(THEME_COLORS).sort()).toEqual(Object.keys(THEMES).sort())
  })

  it('follows the app choice of light or dark, or the device when it is set to system', () => {
    expect(paletteFor({ theme: 'harbor', mode: 'theme' }).mode).toBe('light')
    expect(paletteFor({ theme: 'night', mode: 'theme' }).mode).toBe('dark')
    expect(paletteFor({ theme: 'neon', mode: 'light' }).mode).toBe('light')
    expect(paletteFor({ theme: 'harbor', mode: 'dark' }).mode).toBe('dark')
    expect(paletteFor({ theme: 'harbor', mode: 'system' })).toEqual({
      ...THEME_COLORS.harbor,
      mode: 'system',
    })
    // No appearance (a problem message) or a theme this script does not know yet.
    expect(paletteFor(null)).toEqual({ ...THEME_COLORS.night, mode: 'system' })
    const unknown = { theme: 'aurora', mode: 'theme' } as unknown as Parameters<
      typeof paletteFor
    >[0]
    expect(paletteFor(unknown).light).toBe(THEME_COLORS.night.light)
  })

  it('gives each tone one color when the mode is fixed, and two when it follows the device', () => {
    const fixed = paletteFor({ theme: 'night', mode: 'dark' })
    expect(toneColors(fixed, 'over')).toEqual({ light: '#F7705E', dark: '#F7705E' })
    const system = paletteFor({ theme: 'night', mode: 'system' })
    expect(toneColors(system, 'over')).toEqual({ light: '#A3281F', dark: '#F7705E' })
  })
})

describe('what the widget says', () => {
  it('leads with what is left to spend, and what that is a day', () => {
    expect(headlineOf(widgetSummary())).toEqual({
      label: 'Left to spend',
      value: '$843',
      tone: 'ink',
      note: 'About $65 a day for 13 days',
    })
  })

  it('says "Over budget" in red once the budgets are overspent', () => {
    expect(headlineOf(troubledWidgetSummary())).toEqual({
      label: 'Over budget',
      value: '$50 over',
      tone: 'over',
      note: 'Nothing left to spend this period',
    })
  })

  it('leads with safe to spend until payday before any budget is set, $0 in red when bills do not fit', () => {
    const until = (cents: number, shortfallCents: number, paydayEstimate = false) =>
      widgetSummary({
        headline: {
          kind: 'until_payday',
          cents,
          cashKnown: true,
          shortfallCents,
          perDayCents: 2_000,
          payday: '2026-11-28',
          paydayEstimate,
        },
      })
    expect(headlineOf(until(22_000, 0))).toEqual({
      label: 'Safe to spend',
      value: '$220',
      tone: 'ink',
      note: 'About $20 a day until Nov 28',
    })
    // $0, as the Overview shows it, with the shortfall on its own line.
    expect(headlineOf(until(0, 4_000))).toEqual({
      label: 'Safe to spend',
      value: '$0',
      tone: 'over',
      note: 'Checking is $40 short of bills due by Nov 28',
    })
    // Against a payday that is only a guess, the shortfall may be less: said, not red.
    expect(headlineOf(until(0, 4_000, true))).toEqual({
      label: 'Safe to spend',
      value: '$0',
      tone: 'ink',
      note: 'Checking may be $40 short of bills due by about Nov 28',
    })
  })

  it('says the cash is not known with no checking balance, never $0', () => {
    const unknown = widgetSummary({
      headline: {
        kind: 'until_payday',
        cents: 0,
        cashKnown: false,
        shortfallCents: 0,
        perDayCents: 0,
        payday: '2026-11-28',
        paydayEstimate: false,
      },
    })
    expect(headlineOf(unknown)).toEqual({
      label: 'Safe to spend',
      value: 'Not known yet',
      tone: 'muted',
      note: "Checking's balance isn't known yet",
    })
  })

  it('says checking is short of the bills when over budget too, as the Overview does', () => {
    const over = troubledWidgetSummary()
    const short = { ...over, headline: { ...over.headline, shortfallCents: 12_000 } }
    expect(headlineOf(short as typeof over)).toEqual({
      label: 'Over budget',
      value: '$50 over',
      tone: 'over',
      note: 'Checking is $120 short of bills due by Nov 28',
    })
  })

  it('is version 2: a script from before the shortfall had its own field asks to be updated', () => {
    // Version 1 sent the shortfall as a negative figure; that script would show $0 and no shortfall.
    expect(SUMMARY_VERSION).toBe(2)
    expect(outcomeOf(200, { ...widgetSummary(), version: 3 })).toEqual({
      ok: false,
      problem: 'outdated',
    })
  })

  it('asks for Leeway itself to be updated when this script is the newer one', () => {
    // A version 1 server cannot send the shortfall field this script reads.
    expect(outcomeOf(200, { ...widgetSummary(), version: 1 })).toEqual({
      ok: false,
      problem: 'server_outdated',
    })
    expect(MESSAGES.server_outdated).toEqual({
      title: 'Update your Leeway',
      detail:
        'This script is newer than your Leeway. Update Leeway, or copy the script again from Settings > Widget.',
    })
    // The older-script message never says the server is the newer one here.
    expect(MESSAGES.outdated.detail).toContain('Your Leeway is newer than this script')
  })

  it('lists budget left, net worth and the next bill', () => {
    expect(figuresOf(widgetSummary())).toEqual([
      { label: 'Budget left', value: '$1,120', tone: 'ink' },
      { label: 'Net worth', value: '$48,123', tone: 'ink' },
      { label: 'Next bill', value: 'Rent, Nov 20', tone: 'ink' },
    ])
    expect(figuresOf(troubledWidgetSummary())).toEqual([
      { label: 'Budget left', value: '$50 over', tone: 'over' },
      { label: 'Net worth', value: '$47,123', tone: 'ink' },
      { label: 'Next bill', value: 'Phone, overdue', tone: 'over' },
    ])
    expect(figuresOf(widgetSummary({ budgetLeftCents: null, nextBills: [] }))).toEqual([
      { label: 'Budget left', value: 'No budgets', tone: 'muted' },
      { label: 'Net worth', value: '$48,123', tone: 'ink' },
      { label: 'Next bill', value: 'None tracked', tone: 'muted' },
    ])
  })

  it('warns about accounts, in red only when one is overdrawn or over its limit', () => {
    const alerts = (count: number, urgent: number) =>
      alertBlock(widgetSummary({ alerts: { count, urgent } }))
    expect(alerts(0, 0)).toBeNull()
    expect(alerts(1, 0)).toMatchObject({ text: 'Heads up: 1 account low', tone: 'warn' })
    expect(alerts(2, 0)).toMatchObject({ text: 'Heads up: 2 accounts low', tone: 'warn' })
    expect(alerts(1, 1)).toMatchObject({ text: 'Heads up: 1 account in the red', tone: 'over' })
    expect(alerts(3, 1)).toMatchObject({
      text: 'Heads up: 1 account in the red, 2 low',
      tone: 'over',
    })
  })
})

describe('layouts', () => {
  it('fits the headline and one more line in the small size', () => {
    const small = layoutFor('small', widgetSummary())
    expect(small.family).toBe('small')
    expect(words(small.blocks).map((word) => word.text)).toEqual([
      'Left to spend',
      '$843',
      'About $65 a day for 13 days',
      'Heads up: 1 account low',
    ])
    const calm = layoutFor('small', widgetSummary({ alerts: { count: 0, urgent: 0 } }))
    expect(words(calm.blocks).at(-1)).toEqual({ text: 'Next: Rent, Nov 20', tone: 'ink' })
  })

  it('puts the figures beside the headline in the medium size', () => {
    const medium = layoutFor('medium', widgetSummary())
    expect(medium.blocks).toHaveLength(1)
    const [columns] = medium.blocks
    expect(columns?.type).toBe('columns')
    expect(words(medium.blocks).map((word) => word.text)).toEqual([
      'Left to spend',
      '$843',
      'About $65 a day for 13 days',
      'Heads up: 1 account low',
      'Budget left',
      '$1,120',
      'Net worth',
      '$48,123',
      'Next bill',
      'Rent, Nov 20',
    ])
    const calm = layoutFor('medium', widgetSummary({ alerts: { count: 0, urgent: 0 } }))
    expect(words(calm.blocks).map((word) => word.text)).not.toContain('Heads up')
  })

  it('adds the change in net worth and a short list of bills in the large size', () => {
    const large = layoutFor('large', widgetSummary(), 'America/Denver')
    expect(words(large.blocks)).toEqual([
      { text: 'Left to spend', tone: 'muted' },
      { text: '$843', tone: 'ink' },
      { text: 'About $65 a day for 13 days', tone: 'muted' },
      { text: 'Budget left', tone: 'muted' },
      { text: '$1,120', tone: 'ink' },
      { text: 'Net worth', tone: 'muted' },
      { text: '$48,123', tone: 'ink' },
      { text: 'Last 30 days', tone: 'muted' },
      { text: '+$1,200', tone: 'good' },
      { text: 'Heads up: 1 account low', tone: 'warn' },
      { text: 'Coming up', tone: 'muted' },
      { text: 'Rent', tone: 'muted' },
      { text: 'Nov 20', tone: 'muted' },
      { text: 'Phone', tone: 'muted' },
      { text: 'Nov 24', tone: 'muted' },
      { text: 'Car insurance', tone: 'muted' },
      { text: 'Dec 1', tone: 'muted' },
      { text: 'Updated 11:05 AM', tone: 'muted' },
    ])
  })

  it('keeps the list short, and says when there are no bills', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      name: `Bill ${i}`,
      dueDate: '2026-11-30',
      overdue: false,
    }))
    const large = layoutFor('large', widgetSummary({ nextBills: many }))
    const rows = flatten(large.blocks).filter(
      (block) => block.type === 'row' && block.label.startsWith('Bill'),
    )
    expect(rows).toHaveLength(LIST_LENGTH)
    const none = layoutFor(
      'large',
      widgetSummary({ nextBills: [], alerts: { count: 0, urgent: 0 } }),
    )
    expect(words(none.blocks).map((word) => word.text)).toContain('No bills tracked yet')
  })

  it('never shows a problem by color alone, and gives money in a plus', () => {
    // What each colored tone must also say in words.
    const saying = { over: /over|short|overdue|in the red/i, warn: /low/, good: /^\+/ }
    const shown = [widgetSummary(), troubledWidgetSummary()].flatMap((summary) =>
      (['small', 'medium', 'large'] as const).flatMap((family) =>
        words(layoutFor(family, summary).blocks),
      ),
    )
    for (const { text, tone } of shown) {
      if (tone in saying) expect(text).toMatch(saying[tone as keyof typeof saying])
    }
    const troubled = words(layoutFor('large', troubledWidgetSummary()).blocks)
    expect(troubled).toContainEqual({ text: '-$300', tone: 'ink' })
    expect(troubled).toContainEqual({ text: 'Overdue', tone: 'over' })
  })

  it('takes the look from the app settings', () => {
    const harbor = widgetSummary({ appearance: { theme: 'harbor', mode: 'system' } })
    expect(layoutFor('small', harbor).palette).toEqual(paletteFor(harbor.appearance))
  })

  it('maps every Scriptable widget size to a layout', () => {
    expect(familyOf('small')).toBe('small')
    expect(familyOf('medium')).toBe('medium')
    expect(familyOf('large')).toBe('large')
    expect(familyOf('extraLarge')).toBe('large')
    expect(familyOf('accessoryRectangular')).toBe('small')
    expect(familyOf(null)).toBe('small')
  })
})

describe('problem messages', () => {
  it('says what happened and what to do, in the default theme', () => {
    for (const problem of Object.keys(MESSAGES) as (keyof typeof MESSAGES)[]) {
      const layout = messageLayout(problem, 'medium')
      expect(layout.palette).toEqual(paletteFor(null))
      expect(words(layout.blocks).map((word) => word.text)).toEqual([
        'Leeway',
        MESSAGES[problem].title,
        MESSAGES[problem].detail,
      ])
    }
  })

  it('suggests when it will try again whenever trying again could help', () => {
    for (const problem of ['offline', 'busy', 'server'] as const) {
      expect(MESSAGES[problem].detail).toContain(`${REFRESH_MINUTES} minutes`)
    }
    const settingsHelps = [
      'setup',
      'bad_token',
      'bad_address',
      'outdated',
      'server_outdated',
    ] as const
    for (const problem of settingsHelps) {
      expect(MESSAGES[problem].detail).toMatch(/Settings > Widget/)
    }
  })

  it('gives the detail more lines in the narrow small size', () => {
    const detail = (family: 'small' | 'large') =>
      flatten(messageLayout('offline', family).blocks).at(-1)
    expect(detail('small')).toMatchObject({ lines: 5 })
    expect(detail('large')).toMatchObject({ lines: 3 })
  })
})
