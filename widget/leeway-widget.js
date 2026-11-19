// Leeway for Scriptable: your leeway, budget, net worth, next bill and alerts
// on your iPhone home screen or Mac desktop.
//
// Set up (Leeway's Settings > Widget has the same steps):
// 1. In Leeway, open Settings > Widget and create the widget token.
// 2. In Scriptable, add this script.
// 3. Add a Scriptable widget, choose this script, and paste the parameter
//    Leeway gave you, "https://your-leeway|lww_...", as its Parameter.
//    Or run the script in Scriptable once to save them in its Keychain.
//
// The token only reads this summary. It is never written into this file, and
// nothing here logs it. Revoke it in Leeway at any time.
//
// Everything above the "Scriptable" section is plain logic with no Scriptable
// calls, so Leeway's tests run it as it is (web/src/widget).

/** @typedef {import('../server/src/domain/widget.js').WidgetSummary} Summary */
/** @typedef {'light' | 'dark'} Mode */
/** @typedef {'surface' | 'ink' | 'muted' | 'good' | 'warn' | 'over' | 'accent'} Tone */
/** @typedef {Record<Tone, string>} Tokens */
/** @typedef {{ light: Tokens, dark: Tokens, mode: Mode | 'system' }} Palette */
/** @typedef {'eyebrow' | 'big' | 'title' | 'body' | 'caption'} TextStyle */
/**
 * @typedef {{ type: 'text', text: string, style: TextStyle, tone: Tone, lines: number }
 *   | { type: 'row', label: string, value: string, tone: Tone }
 *   | { type: 'spacer', size: number | null }
 *   | { type: 'columns', columns: Block[][] }} Block
 */
/** @typedef {'small' | 'medium' | 'large'} Family */
/** @typedef {{ family: Family, blocks: Block[], palette: Palette }} Layout */
/** @typedef {'setup' | 'bad_address' | 'offline' | 'bad_token' | 'busy' | 'server' | 'outdated'} Problem */
/** @typedef {{ ok: true, summary: Summary } | { ok: false, problem: Problem }} Outcome */
/** @typedef {{ server: string, token: string }} Connection */

/** How often the widget asks iOS or macOS to refresh it, in minutes. */
const REFRESH_MINUTES = 30

/** The summary shape this script reads; the server bumps it only if a field changes meaning. */
const SUMMARY_VERSION = 1

/** Where the script keeps the address and token when they are not the widget's parameter. */
const KEYCHAIN_SERVER = 'leeway.widget.server'
const KEYCHAIN_TOKEN = 'leeway.widget.token'

/** Widget tokens start with this; an agent key or anything else is not one. */
const TOKEN_PREFIX = 'lww_'

/** Bills the large widget lists at most. */
const LIST_LENGTH = 3

/**
 * The app's colors for each theme, light and dark: the same values as
 * web/src/lib/theme.ts, which a test checks so the two never drift apart.
 * The widget is painted with the theme's surface, as the app's cards are,
 * which every tone is readable on.
 * @type {Record<'night' | 'harbor' | 'neon', Record<Mode, Tokens>>}
 */
const THEME_COLORS = {
  night: {
    light: {
      surface: '#FFFFFF',
      ink: '#14171B',
      muted: '#5B636D',
      good: '#1B7A47',
      warn: '#935400',
      over: '#BA3127',
      accent: '#2F54D9',
    },
    dark: {
      surface: '#15181D',
      ink: '#EDEFF2',
      muted: '#9AA1AA',
      good: '#5CCF8C',
      warn: '#F2B24A',
      over: '#FF8371',
      accent: '#86A8FF',
    },
  },
  harbor: {
    light: {
      surface: '#FFFFFF',
      ink: '#15171A',
      muted: '#596068',
      good: '#1B7A47',
      warn: '#935400',
      over: '#BA3127',
      accent: '#1F4FE0',
    },
    dark: {
      surface: '#151C23',
      ink: '#E8EDF2',
      muted: '#93A0AD',
      good: '#5CCF8C',
      warn: '#F2B24A',
      over: '#FF8371',
      accent: '#7FA2FF',
    },
  },
  neon: {
    light: {
      surface: '#FFFFFF',
      ink: '#0B0B1A',
      muted: '#5A5F80',
      good: '#007864',
      warn: '#806200',
      over: '#C2185B',
      accent: '#007864',
    },
    dark: {
      surface: '#10101C',
      ink: '#E8F0FF',
      muted: '#8F96BA',
      good: '#00E5C0',
      warn: '#FFD23F',
      over: '#FF5C85',
      accent: '#00E5C0',
    },
  },
}

/** Each theme's own look when its mode is "theme", as the app has it. */
const THEME_MODES = { night: 'dark', harbor: 'light', neon: 'dark' }

// Connecting ----------------------------------------------------------------

/**
 * The address and token from the widget's parameter, "https://host|lww_...".
 * A space or a new line between them works too, since a paste may bring one.
 * @param {string | null | undefined} text
 * @returns {Connection | null}
 */
function parseConnection(text) {
  const parts = (text ?? '').split(/[\s|]+/).filter((part) => part.length > 0)
  const token = parts.find((part) => part.startsWith(TOKEN_PREFIX))
  const server = parts.find((part) => /^https?:\/\//i.test(part))
  return token && server ? { server, token } : null
}

/**
 * The widget's parameter wins; otherwise what the script saved in the Keychain.
 * @param {string | null | undefined} parameter
 * @param {{ contains(key: string): boolean, get(key: string): string }} keychain
 * @returns {Connection | null}
 */
function connectionFrom(parameter, keychain) {
  const fromParameter = parseConnection(parameter)
  if (fromParameter) return fromParameter
  if (!keychain.contains(KEYCHAIN_SERVER) || !keychain.contains(KEYCHAIN_TOKEN)) return null
  return parseConnection(`${keychain.get(KEYCHAIN_SERVER)}|${keychain.get(KEYCHAIN_TOKEN)}`)
}

/**
 * The owner's server as "https://host", or null unless it is https: the token
 * must never cross the network in the clear.
 * @param {string} server
 * @returns {string | null}
 */
function originOf(server) {
  const origin = server.trim().match(/^https:\/\/[^\s/?#]+/i)
  return origin ? origin[0] : null
}

/**
 * Where the summary is read, or null for an address that is not https.
 * @param {string} server
 */
function summaryUrl(server) {
  const origin = originOf(server)
  return origin ? `${origin}/api/widget` : null
}

/**
 * What a reply means for the widget: the summary, or the problem to explain.
 * @param {number} status
 * @param {unknown} body
 * @returns {Outcome}
 */
function outcomeOf(status, body) {
  if (status === 401 || status === 403) return { ok: false, problem: 'bad_token' }
  if (status === 429) return { ok: false, problem: 'busy' }
  if (status !== 200 || typeof body !== 'object' || body === null) {
    return { ok: false, problem: 'server' }
  }
  const summary = /** @type {Summary} */ (body)
  if (summary.version !== SUMMARY_VERSION) return { ok: false, problem: 'outdated' }
  return { ok: true, summary }
}

// Formatting, by the app's rules --------------------------------------------

/**
 * Money in whole units, as the app's dashboard shows it: "$1,234".
 * @param {number} cents
 * @param {{ currency: string, locale: string }} options
 */
function money(cents, { currency, locale }) {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100))
}

/**
 * A change in money: "+$1,200" in green for money in, "-$300" in plain ink for
 * money out, which is no problem in itself. The sign says it, not only the color.
 * @param {number} cents
 * @param {{ currency: string, locale: string }} options
 * @returns {{ text: string, tone: Tone }}
 */
function change(cents, options) {
  const amount = money(Math.abs(cents), options)
  if (cents > 0) return { text: `+${amount}`, tone: 'good' }
  if (cents < 0) return { text: `-${amount}`, tone: 'ink' }
  return { text: amount, tone: 'muted' }
}

/**
 * "Nov 17", read in UTC like the app, since a date has no time of day.
 * @param {string} iso
 * @param {string} locale
 */
function shortDate(iso, locale) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * "Updated 2:05 PM", in the device's own time zone unless one is given.
 * @param {string} asOf
 * @param {string} locale
 * @param {string} [timeZone]
 */
function updatedText(asOf, locale, timeZone) {
  const time = new Date(asOf).toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  })
  return `Updated ${time}`
}

/**
 * "1 day", "3 days"
 * @param {number} n
 * @param {string} word
 */
function count(n, word) {
  return `${n} ${n === 1 ? word : `${word}s`}`
}

/**
 * The colors for the app's theme and light or dark choice. "system" follows
 * the device, as the app does, so the widget turns dark with the phone.
 * @param {Summary['appearance'] | null} appearance
 * @returns {Palette}
 */
function paletteFor(appearance) {
  const theme = appearance && appearance.theme in THEME_COLORS ? appearance.theme : 'night'
  const colors = THEME_COLORS[theme]
  const choice = appearance?.mode ?? 'system'
  /** @type {Palette['mode']} */
  let mode = 'system'
  if (choice === 'light' || choice === 'dark') mode = choice
  else if (choice === 'theme') mode = /** @type {Mode} */ (THEME_MODES[theme])
  return { light: colors.light, dark: colors.dark, mode }
}

// What the widget says --------------------------------------------------------

/**
 * The leading number, as the Overview leads: safe to spend, or before any
 * budget is set, cash until payday. A problem is in red and in words ("over",
 * "short"), so color is never the only sign.
 * @param {Summary} summary
 * @returns {{ label: string, value: string, tone: Tone, note: string }}
 */
function headlineOf(summary) {
  const { headline, locale } = summary
  const amount = money(Math.abs(headline.cents), summary)
  const short = headline.cents < 0
  if (headline.kind === 'leeway') {
    const perDay = headline.perDayCents
    return {
      label: 'Safe to spend',
      value: short ? `${amount} over` : amount,
      tone: short ? 'over' : 'ink',
      note:
        perDay === null
          ? 'Nothing left to spend this period'
          : `About ${money(perDay, summary)} a day for ${count(headline.daysLeft, 'day')}`,
    }
  }
  const payday = shortDate(headline.payday, locale)
  return {
    label: 'Until payday',
    value: short ? `${amount} short` : amount,
    tone: short ? 'over' : 'ink',
    note: short
      ? `Bills due before ${payday} are more than your cash`
      : `About ${money(headline.perDayCents, summary)} a day until ${payday}`,
  }
}

/**
 * The figures beside or under the headline: budget left, net worth, next bill.
 * @param {Summary} summary
 * @returns {{ label: string, value: string, tone: Tone }[]}
 */
function figuresOf(summary) {
  const left = summary.budgetLeftCents
  /** @type {{ value: string, tone: Tone }} */
  let budget = { value: 'No budgets', tone: 'muted' }
  if (left !== null && left < 0) budget = { value: `${money(-left, summary)} over`, tone: 'over' }
  else if (left !== null) budget = { value: money(left, summary), tone: 'ink' }
  return [
    { label: 'Budget left', ...budget },
    { label: 'Net worth', value: money(summary.netWorth.cents, summary), tone: 'ink' },
    { label: 'Next bill', ...nextBillOf(summary) },
  ]
}

/**
 * "Rent, Nov 20", or "Rent, overdue" in red.
 * @param {Summary} summary
 * @returns {{ value: string, tone: Tone }}
 */
function nextBillOf(summary) {
  const bill = summary.nextBills[0]
  if (!bill) return { value: 'None tracked', tone: 'muted' }
  if (bill.overdue) return { value: `${bill.name}, overdue`, tone: 'over' }
  return { value: `${bill.name}, ${shortDate(bill.dueDate, summary.locale)}`, tone: 'ink' }
}

/**
 * "Heads up: 1 account in the red, 2 low", or null when every account is fine.
 * Red only when one is overdrawn or over its limit; a low balance is a warning.
 * @param {Summary} summary
 * @returns {Block | null}
 */
function alertBlock(summary) {
  const { count: total, urgent } = summary.alerts
  if (total === 0) return null
  const low = total - urgent
  const parts = [
    ...(urgent > 0 ? [`${count(urgent, 'account')} in the red`] : []),
    ...(low > 0 ? [urgent > 0 ? `${low} low` : `${count(low, 'account')} low`] : []),
  ]
  return text(`Heads up: ${parts.join(', ')}`, 'caption', urgent > 0 ? 'over' : 'warn', 2)
}

/**
 * @param {string} words
 * @param {TextStyle} style
 * @param {Tone} tone
 * @param {number} [lines]
 * @returns {Block}
 */
function text(words, style, tone, lines = 1) {
  return { type: 'text', text: words, style, tone, lines }
}

/** @param {number | null} size @returns {Block} */
function spacer(size) {
  return { type: 'spacer', size }
}

/**
 * The headline as three lines of text, which every size starts with.
 * @param {Summary} summary
 * @returns {Block[]}
 */
function headlineBlocks(summary) {
  const { label, value, tone, note } = headlineOf(summary)
  return [
    text(label, 'eyebrow', 'muted'),
    text(value, 'big', tone),
    text(note, 'caption', 'muted', 2),
  ]
}

/** @param {Summary} summary @returns {Block[]} */
function smallBlocks(summary) {
  const next = nextBillOf(summary)
  return [
    ...headlineBlocks(summary),
    spacer(null),
    alertBlock(summary) ?? text(`Next: ${next.value}`, 'caption', next.tone),
  ]
}

/** @param {Summary} summary @returns {Block[]} */
function mediumBlocks(summary) {
  const alert = alertBlock(summary)
  const figures = figuresOf(summary).flatMap((figure, index) => [
    ...(index > 0 ? [spacer(6)] : []),
    text(figure.label, 'caption', 'muted'),
    text(figure.value, 'body', figure.tone),
  ])
  const left = [...headlineBlocks(summary), spacer(null), ...(alert ? [alert] : [])]
  return [{ type: 'columns', columns: [left, figures] }]
}

/**
 * @param {Summary} summary
 * @param {string} [timeZone]
 * @returns {Block[]}
 */
function largeBlocks(summary, timeZone) {
  const alert = alertBlock(summary)
  const worthChange = change(summary.netWorth.changeCents, summary)
  const bills = summary.nextBills.slice(0, LIST_LENGTH).map(
    (bill) =>
      /** @type {Block} */ ({
        type: 'row',
        label: bill.name,
        value: bill.overdue ? 'Overdue' : shortDate(bill.dueDate, summary.locale),
        tone: bill.overdue ? 'over' : 'muted',
      }),
  )
  return [
    ...headlineBlocks(summary),
    spacer(12),
    ...figuresOf(summary)
      .slice(0, 2)
      .map((figure) => /** @type {Block} */ ({ type: 'row', ...figure })),
    {
      type: 'row',
      label: `Last ${summary.netWorth.sinceDays} days`,
      value: worthChange.text,
      tone: worthChange.tone,
    },
    ...(alert ? [spacer(6), alert] : []),
    spacer(12),
    text('Coming up', 'eyebrow', 'muted'),
    ...(bills.length > 0 ? bills : [text('No bills tracked yet', 'caption', 'muted')]),
    spacer(null),
    text(updatedText(summary.asOf, summary.locale, timeZone), 'caption', 'muted'),
  ]
}

/**
 * The widget for a size, as plain data: what to write, in what style and
 * tone. The Scriptable section draws it; tests and previews read it.
 * @param {Family} family
 * @param {Summary} summary
 * @param {string} [timeZone] Only for tests and previews; the device's own otherwise.
 * @returns {Layout}
 */
function layoutFor(family, summary, timeZone) {
  const palette = paletteFor(summary.appearance)
  if (family === 'small') return { family, palette, blocks: smallBlocks(summary) }
  if (family === 'medium') return { family, palette, blocks: mediumBlocks(summary) }
  return { family, palette, blocks: largeBlocks(summary, timeZone) }
}

/**
 * What each problem says: what happened, then what to do about it.
 * @type {Record<Problem, { title: string, detail: string }>}
 */
const MESSAGES = {
  setup: {
    title: 'Connect your Leeway',
    detail: "Paste the parameter from Leeway's Settings > Widget into this widget's Parameter.",
  },
  bad_address: {
    title: "Use your Leeway's https address",
    detail:
      'The widget only sends its token over https. Copy the parameter from Settings > Widget.',
  },
  offline: {
    title: "Can't reach Leeway",
    detail: `Check your connection. The widget tries again in ${REFRESH_MINUTES} minutes.`,
  },
  bad_token: {
    title: 'Token not accepted',
    detail: 'It may have been revoked. Make a new one in Settings > Widget and paste it in.',
  },
  busy: {
    title: 'Leeway is busy',
    detail: `Too many refreshes at once. The widget tries again in ${REFRESH_MINUTES} minutes.`,
  },
  server: {
    title: 'Leeway had a problem',
    detail: `Something went wrong on your server. The widget tries again in ${REFRESH_MINUTES} minutes.`,
  },
  outdated: {
    title: 'Update the widget script',
    detail: 'Your Leeway is newer than this script. Copy the script again from Settings > Widget.',
  },
}

/**
 * A plain message in place of the numbers, in the default theme.
 * @param {Problem} problem
 * @param {Family} family
 * @returns {Layout}
 */
function messageLayout(problem, family) {
  const { title, detail } = MESSAGES[problem]
  return {
    family,
    palette: paletteFor(null),
    blocks: [
      text('Leeway', 'eyebrow', 'accent'),
      spacer(4),
      text(title, 'title', 'ink', 2),
      spacer(4),
      text(detail, 'caption', 'muted', family === 'small' ? 5 : 3),
    ],
  }
}

// How it is drawn --------------------------------------------------------------

/**
 * Each text style's size and weight, shared by the Scriptable drawing and the
 * previews. Scale is how far iOS may shrink a line to fit before it cuts it.
 * @type {Record<TextStyle, { size: number, weight: 'regular' | 'semibold' | 'bold', scale: number }>}
 */
const STYLES = {
  eyebrow: { size: 11, weight: 'semibold', scale: 1 },
  big: { size: 30, weight: 'bold', scale: 0.5 },
  title: { size: 15, weight: 'semibold', scale: 0.8 },
  body: { size: 14, weight: 'semibold', scale: 0.7 },
  caption: { size: 11, weight: 'regular', scale: 0.8 },
}

/**
 * A tone's color in light and in dark. With the mode fixed both are the same,
 * so the widget keeps the app's look whatever the device is set to.
 * @param {Palette} palette
 * @param {Tone} tone
 * @returns {{ light: string, dark: string }}
 */
function toneColors(palette, tone) {
  if (palette.mode === 'system') return { light: palette.light[tone], dark: palette.dark[tone] }
  const fixed = palette[palette.mode][tone]
  return { light: fixed, dark: fixed }
}

/**
 * The layout for a widget size. The Mac's extra large gets the large layout;
 * the lock screen's small accessory sizes get the small one.
 * @param {string | null | undefined} widgetFamily
 * @returns {Family}
 */
function familyOf(widgetFamily) {
  if (widgetFamily === 'medium') return 'medium'
  if (widgetFamily === 'large' || widgetFamily === 'extraLarge') return 'large'
  return 'small'
}

/** @param {string} body @returns {unknown} */
function parseJson(body) {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

// Scriptable --------------------------------------------------------------------
// The thin part that talks to Scriptable. Its globals come in as `env`, so the
// tests can hand in stand-ins; the last line passes the real ones.

/** Seconds to wait for the server before calling it offline. */
const TIMEOUT_SECONDS = 15

/**
 * @typedef {{
 *   args: { widgetParameter: string | null },
 *   config: { runsInWidget: boolean, widgetFamily: string | null },
 *   Keychain: ScriptableKeychain,
 *   Request: new (url: string) => ScriptableRequest,
 *   ListWidget: new () => ScriptableWidget,
 *   Color: ScriptableColorClass,
 *   Font: ScriptableFontClass,
 *   Alert: new () => ScriptableAlert,
 *   Script: { setWidget(widget: ScriptableWidget): void, complete(): void },
 * }} Env
 */

/**
 * Asks the owner's server for the summary. Any failure to get a reply at all
 * means offline; the token goes only in the header, over https.
 * @param {Connection | null} connection
 * @param {Env} env
 * @returns {Promise<Outcome>}
 */
async function loadOutcome(connection, env) {
  if (!connection) return { ok: false, problem: 'setup' }
  const url = summaryUrl(connection.server)
  if (!url) return { ok: false, problem: 'bad_address' }
  const request = new env.Request(url)
  request.headers = { Authorization: `Bearer ${connection.token}`, Accept: 'application/json' }
  request.timeoutInterval = TIMEOUT_SECONDS
  try {
    const body = await request.loadString()
    return outcomeOf(request.response.statusCode, parseJson(body))
  } catch {
    return { ok: false, problem: 'offline' }
  }
}

/**
 * @param {Palette} palette
 * @param {Tone} tone
 * @param {Env} env
 * @returns {ScriptableColor}
 */
function colorOf(palette, tone, env) {
  const { light, dark } = toneColors(palette, tone)
  return light === dark
    ? new env.Color(light)
    : env.Color.dynamic(new env.Color(light), new env.Color(dark))
}

/**
 * @param {TextStyle} style
 * @param {Env} env
 */
function fontOf(style, env) {
  const { size, weight } = STYLES[style]
  if (weight === 'bold') return env.Font.boldRoundedSystemFont(size)
  if (weight === 'semibold') return env.Font.semiboldSystemFont(size)
  return env.Font.systemFont(size)
}

/**
 * Draws blocks into a widget or one of its stacks.
 * @param {ScriptableStack} stack
 * @param {Block[]} blocks
 * @param {Palette} palette
 * @param {Env} env
 */
function drawBlocks(stack, blocks, palette, env) {
  for (const block of blocks) {
    if (block.type === 'spacer') {
      stack.addSpacer(block.size ?? undefined)
    } else if (block.type === 'text') {
      const line = stack.addText(block.text)
      line.font = fontOf(block.style, env)
      line.textColor = colorOf(palette, block.tone, env)
      line.lineLimit = block.lines
      line.minimumScaleFactor = STYLES[block.style].scale
    } else if (block.type === 'row') {
      const row = stack.addStack()
      row.layoutHorizontally()
      drawBlocks(
        row,
        [{ type: 'text', text: block.label, style: 'body', tone: 'muted', lines: 1 }],
        palette,
        env,
      )
      row.addSpacer()
      drawBlocks(
        row,
        [{ type: 'text', text: block.value, style: 'body', tone: block.tone, lines: 1 }],
        palette,
        env,
      )
    } else {
      const columns = stack.addStack()
      columns.layoutHorizontally()
      block.columns.forEach((column, index) => {
        if (index > 0) columns.addSpacer(12)
        const inner = columns.addStack()
        inner.layoutVertically()
        drawBlocks(inner, column, palette, env)
      })
    }
  }
}

/**
 * Builds the Scriptable widget for a layout.
 * @param {Layout} layout
 * @param {string | null} link Where a tap goes: the owner's Leeway.
 * @param {Date} now
 * @param {Env} env
 * @returns {ScriptableWidget}
 */
function render(layout, link, now, env) {
  const widget = new env.ListWidget()
  widget.backgroundColor = colorOf(layout.palette, 'surface', env)
  widget.setPadding(14, 14, 14, 14)
  widget.refreshAfterDate = new Date(now.getTime() + REFRESH_MINUTES * 60_000)
  if (link) widget.url = link
  drawBlocks(widget, layout.blocks, layout.palette, env)
  return widget
}

/**
 * Saves the address and token in Scriptable's Keychain, from a pasted
 * parameter, so the widget needs no Parameter. The token is typed into a
 * secure field and only ever written to the Keychain.
 * @param {Env} env
 */
async function saveConnection(env) {
  const ask = new env.Alert()
  ask.title = 'Connect Leeway'
  ask.message = 'Paste the parameter from Settings > Widget in Leeway.'
  ask.addSecureTextField('https://your-leeway|lww_...', '')
  ask.addAction('Save')
  ask.addCancelAction('Cancel')
  if ((await ask.presentAlert()) === -1) return
  const connection = parseConnection(ask.textFieldValue(0))
  const done = new env.Alert()
  if (connection && originOf(connection.server)) {
    env.Keychain.set(KEYCHAIN_SERVER, connection.server)
    env.Keychain.set(KEYCHAIN_TOKEN, connection.token)
    done.title = 'Saved'
    done.message = 'Add a Scriptable widget and choose this script.'
  } else {
    done.title = MESSAGES.bad_address.title
    done.message = MESSAGES.bad_address.detail
  }
  done.addAction('OK')
  await done.presentAlert()
}

/** @param {Env} env */
function forgetConnection(env) {
  for (const key of [KEYCHAIN_SERVER, KEYCHAIN_TOKEN]) {
    if (env.Keychain.contains(key)) env.Keychain.remove(key)
  }
}

/** The menu shown when the script is run in Scriptable rather than as a widget. */
const MENU = [
  'Preview small',
  'Preview medium',
  'Preview large',
  'Save address and token',
  'Forget saved token',
]

/** @type {Record<Family, (widget: ScriptableWidget) => Promise<void>>} */
const PRESENT = {
  small: (widget) => widget.presentSmall(),
  medium: (widget) => widget.presentMedium(),
  large: (widget) => widget.presentLarge(),
}

/**
 * In the app: a menu of previews and the Keychain choices.
 * @param {Env} env
 * @param {Date} now
 */
async function useInApp(env, now) {
  const menu = new env.Alert()
  menu.title = 'Leeway widget'
  MENU.forEach((label) => menu.addAction(label))
  menu.addCancelAction('Cancel')
  const choice = await menu.presentAlert()
  const preview = /** @type {Family[]} */ (['small', 'medium', 'large'])[choice]
  if (preview) await show(preview, env, now)
  else if (choice === 3) await saveConnection(env)
  else if (choice === 4) forgetConnection(env)
}

/**
 * Draws the widget for a size: the numbers, or the problem in their place.
 * @param {Family} family
 * @param {Env} env
 * @param {Date} now
 */
async function show(family, env, now) {
  const connection = connectionFrom(env.args.widgetParameter, env.Keychain)
  const outcome = await loadOutcome(connection, env)
  const layout = outcome.ok
    ? layoutFor(family, outcome.summary)
    : messageLayout(outcome.problem, family)
  const widget = render(layout, connection && originOf(connection.server), now, env)
  if (env.config.runsInWidget) env.Script.setWidget(widget)
  else await PRESENT[family](widget)
}

/**
 * Runs the script: draws the widget on the home screen or desktop, or in the
 * app offers previews and the Keychain choices.
 * @param {Env} env
 * @param {Date} [now]
 */
async function run(env, now = new Date()) {
  if (env.config.runsInWidget) await show(familyOf(env.config.widgetFamily), env, now)
  else await useInApp(env, now)
  env.Script.complete()
}

module.exports = {
  REFRESH_MINUTES,
  SUMMARY_VERSION,
  KEYCHAIN_SERVER,
  KEYCHAIN_TOKEN,
  LIST_LENGTH,
  THEME_COLORS,
  THEME_MODES,
  parseConnection,
  connectionFrom,
  originOf,
  summaryUrl,
  outcomeOf,
  money,
  change,
  shortDate,
  updatedText,
  count,
  paletteFor,
  headlineOf,
  figuresOf,
  alertBlock,
  layoutFor,
  messageLayout,
  MESSAGES,
  STYLES,
  toneColors,
  familyOf,
  parseJson,
  loadOutcome,
  render,
  MENU,
  run,
}

// In Scriptable, run with its own globals. Anywhere else (the tests) this
// file only provides the functions above.
if (typeof ListWidget !== 'undefined') {
  await run({ args, config, Keychain, Request, ListWidget, Color, Font, Alert, Script })
}
