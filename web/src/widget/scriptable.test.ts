// The widget script's thin Scriptable part, run against stand-ins for
// Scriptable's globals that record what the script asks of them.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  KEYCHAIN_SERVER,
  KEYCHAIN_TOKEN,
  layoutFor,
  loadOutcome,
  MENU,
  MESSAGES,
  messageLayout,
  paletteFor,
  REFRESH_MINUTES,
  render,
  run,
  STYLES,
  THEME_COLORS,
  toneColors,
} from '../../../widget/leeway-widget.js'
import { troubledWidgetSummary, widgetSummary } from '../test/widget'

const NOW = new Date('2026-11-17T18:05:00Z')
const TOKEN = 'lww_secretTOKEN_value123'
const SERVER = 'https://leeway.example.com'

class FakeColor {
  constructor(
    readonly hex: string,
    readonly dark: string | null = null,
  ) {}
  static dynamic(light: FakeColor, dark: FakeColor) {
    return new FakeColor(light.hex, dark.hex)
  }
}

class FakeFont {
  constructor(readonly name: string) {}
  static systemFont = (size: number) => new FakeFont(`regular ${size}`)
  static semiboldSystemFont = (size: number) => new FakeFont(`semibold ${size}`)
  static boldRoundedSystemFont = (size: number) => new FakeFont(`bold rounded ${size}`)
}

type Drawn =
  | {
      text: string
      font?: FakeFont
      textColor?: FakeColor
      lineLimit?: number
      minimumScaleFactor?: number
    }
  | { spacer: number | null }
  | FakeStack

class FakeStack {
  layout: 'vertical' | 'horizontal' = 'vertical'
  children: Drawn[] = []
  addText(text: string) {
    const line = { text } as Extract<Drawn, { text: string }>
    this.children.push(line)
    return line
  }
  addSpacer(length?: number) {
    this.children.push({ spacer: length ?? null })
  }
  addStack() {
    const stack = new FakeStack()
    this.children.push(stack)
    return stack
  }
  layoutHorizontally() {
    this.layout = 'horizontal'
  }
  layoutVertically() {
    this.layout = 'vertical'
  }
}

class FakeWidget extends FakeStack {
  static made: FakeWidget[] = []
  backgroundColor?: FakeColor
  refreshAfterDate?: Date
  url?: string
  padding?: number[]
  presented: string | null = null
  constructor() {
    super()
    FakeWidget.made.push(this)
  }
  setPadding(...padding: number[]) {
    this.padding = padding
  }
  async presentSmall() {
    this.presented = 'small'
  }
  async presentMedium() {
    this.presented = 'medium'
  }
  async presentLarge() {
    this.presented = 'large'
  }
}

/** Every line of text a widget draws, in order. */
function texts(stack: FakeStack): string[] {
  return stack.children.flatMap((child) => {
    if (child instanceof FakeStack) return texts(child)
    return 'text' in child ? [child.text] : []
  })
}

/** Every color a widget draws text in, light and dark. */
function textColors(stack: FakeStack): FakeColor[] {
  return stack.children.flatMap((child) => {
    if (child instanceof FakeStack) return textColors(child)
    return 'textColor' in child && child.textColor ? [child.textColor] : []
  })
}

/** WCAG relative luminance of "#RRGGBB". */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** WCAG contrast ratio between two colors, from 1 to 21. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

/** A server that answers with a status and body, or cannot be reached. */
function fakeRequest(reply: { status: number; body: string } | 'offline') {
  const made: FakeRequest[] = []
  class FakeRequest {
    headers: Record<string, string> = {}
    timeoutInterval = 60
    response = { statusCode: 0 }
    constructor(readonly url: string) {
      made.push(this)
    }
    async loadString() {
      if (reply === 'offline') throw new Error('The Internet connection appears to be offline.')
      this.response = { statusCode: reply.status }
      return reply.body
    }
  }
  return { Request: FakeRequest, made }
}

/** Alerts that answer with the given choices in turn, and a text field value. */
function fakeAlerts(choices: number[], typed = '') {
  const shown: FakeAlert[] = []
  class FakeAlert {
    title = ''
    message = ''
    actions: string[] = []
    fields: string[] = []
    constructor() {
      shown.push(this)
    }
    addAction(title: string) {
      this.actions.push(title)
    }
    addCancelAction(title: string) {
      this.actions.push(`cancel: ${title}`)
    }
    addSecureTextField(placeholder: string) {
      this.fields.push(placeholder)
    }
    textFieldValue() {
      return typed
    }
    async presentAlert() {
      return choices.shift() ?? -1
    }
  }
  return { Alert: FakeAlert, shown }
}

function fakeKeychain(entries: Record<string, string> = {}) {
  return {
    entries,
    contains: (key: string) => key in entries,
    get: (key: string) => entries[key]!,
    set: (key: string, value: string) => {
      entries[key] = value
    },
    remove: (key: string) => {
      delete entries[key]
    },
  }
}

function fakeEnv(
  options: {
    parameter?: string | null
    runsInWidget?: boolean
    family?: string
    reply?: { status: number; body: string } | 'offline'
    choices?: number[]
    typed?: string
    keychain?: Record<string, string>
  } = {},
) {
  const request = fakeRequest(
    options.reply ?? { status: 200, body: JSON.stringify(widgetSummary()) },
  )
  const alerts = fakeAlerts(options.choices ?? [], options.typed)
  const script = { setWidget: vi.fn(), complete: vi.fn() }
  const keychain = fakeKeychain(options.keychain)
  const env = {
    args: {
      widgetParameter: options.parameter === undefined ? `${SERVER}|${TOKEN}` : options.parameter,
    },
    config: {
      runsInWidget: options.runsInWidget ?? true,
      widgetFamily: options.family ?? 'medium',
    },
    Keychain: keychain,
    Request: request.Request,
    ListWidget: FakeWidget,
    Color: FakeColor,
    Font: FakeFont,
    Alert: alerts.Alert,
    Script: script,
  }
  return { env, requests: request.made, alerts: alerts.shown, script, keychain }
}

afterEach(() => {
  FakeWidget.made = []
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('loading the summary', () => {
  it('sends the token in the header only, to the summary over https, with a timeout', async () => {
    const { env, requests } = fakeEnv()
    const outcome = await loadOutcome({ server: `${SERVER}/settings`, token: TOKEN }, env)
    expect(outcome).toEqual({ ok: true, summary: widgetSummary() })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.url).toBe(`${SERVER}/api/widget`)
    expect(requests[0]!.url).not.toContain(TOKEN)
    expect(requests[0]!.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
    })
    expect(requests[0]!.timeoutInterval).toBe(15)
  })

  it('asks for setup, refuses plain http, and calls a failed request offline', async () => {
    const { env, requests } = fakeEnv({ reply: 'offline' })
    expect(await loadOutcome(null, env)).toEqual({ ok: false, problem: 'setup' })
    expect(await loadOutcome({ server: 'http://leeway.example.com', token: TOKEN }, env)).toEqual({
      ok: false,
      problem: 'bad_address',
    })
    expect(requests).toHaveLength(0)
    expect(await loadOutcome({ server: SERVER, token: TOKEN }, env)).toEqual({
      ok: false,
      problem: 'offline',
    })
  })

  it('reads a refusal or a broken reply as a problem', async () => {
    const refused = fakeEnv({ reply: { status: 401, body: '{"error":"unauthorized"}' } })
    expect(await loadOutcome({ server: SERVER, token: TOKEN }, refused.env)).toEqual({
      ok: false,
      problem: 'bad_token',
    })
    const broken = fakeEnv({ reply: { status: 502, body: '<html>Bad gateway</html>' } })
    expect(await loadOutcome({ server: SERVER, token: TOKEN }, broken.env)).toEqual({
      ok: false,
      problem: 'server',
    })
  })
})

describe('drawing', () => {
  it('draws the layout with the app colors, fonts and line limits', () => {
    const { env } = fakeEnv()
    const layout = layoutFor(
      'large',
      widgetSummary({ appearance: { theme: 'harbor', mode: 'light' } }),
    )
    const widget = render(layout, SERVER, NOW, env) as unknown as FakeWidget
    expect(widget.backgroundColor).toEqual(new FakeColor('#FFFFFF'))
    expect(widget.padding).toEqual([14, 14, 14, 14])
    expect(widget.url).toBe(SERVER)
    expect(widget.refreshAfterDate).toEqual(new Date(NOW.getTime() + REFRESH_MINUTES * 60_000))

    const [eyebrow, big, note] = widget.children as Extract<Drawn, { text: string }>[]
    expect(eyebrow).toMatchObject({ text: 'Left to spend', font: { name: 'semibold 11' } })
    expect(big).toMatchObject({
      text: '$843',
      font: { name: `bold rounded ${STYLES.big.size}` },
      textColor: new FakeColor('#15171A'),
      lineLimit: 1,
      minimumScaleFactor: STYLES.big.scale,
    })
    expect(note).toMatchObject({ font: { name: 'regular 11' }, lineLimit: 2 })

    // A row is a label, a flexible space and a value, side by side.
    const row = widget.children.find((child) => child instanceof FakeStack) as FakeStack
    expect(row.layout).toBe('horizontal')
    expect(row.children).toMatchObject([
      { text: 'Budget left' },
      { spacer: null },
      { text: '$1,120' },
    ])
    expect(widget.children).toContainEqual({ spacer: 12 })
    expect(texts(widget)).toContain('Coming up')
    expect(texts(widget).at(-1)).toMatch(/^Updated /)
  })

  it('follows the device between light and dark when the app is set to system', () => {
    const { env } = fakeEnv()
    const layout = layoutFor(
      'small',
      widgetSummary({ appearance: { theme: 'night', mode: 'system' } }),
    )
    const widget = render(layout, null, NOW, env) as unknown as FakeWidget
    expect(widget.backgroundColor).toEqual(new FakeColor('#FFFFFF', '#15181D'))
    expect(widget.url).toBeUndefined()
  })

  it('keeps every tone readable (WCAG AA) on the color painted behind it, in every theme', () => {
    const { env } = fakeEnv()
    const themes = Object.keys(THEME_COLORS) as (keyof typeof THEME_COLORS)[]
    const appearances = themes.flatMap((theme) =>
      (['light', 'dark'] as const).map((mode) => ({ theme, mode })),
    )
    for (const appearance of appearances) {
      const { theme, mode } = appearance
      const palette = paletteFor(appearance)
      // Every tone the widget can draw text in, whether a summary uses it or not.
      const tones = Object.keys(THEME_COLORS[theme][mode]).filter((tone) => tone !== 'surface')
      const colors = tones.map((tone) => toneColors(palette, tone as 'ink').light)
      // And every color a calm and a troubled summary do draw text in, on what is painted.
      const summaries = [widgetSummary(), troubledWidgetSummary()]
      const widgets = summaries.map((summary) => {
        const layout = layoutFor('large', { ...summary, appearance })
        return render(layout, SERVER, NOW, env) as unknown as FakeWidget
      })
      const painted = widgets[0]!.backgroundColor!.hex
      expect(widgets[1]!.backgroundColor!.hex).toBe(painted)
      colors.push(...widgets.flatMap(textColors).map((color) => color.hex))
      for (const color of colors) {
        const ratio = contrast(color, painted)
        expect(ratio, `${theme} ${mode}: ${color} on ${painted}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('draws columns side by side, each stacked', () => {
    const { env } = fakeEnv()
    const widget = render(
      layoutFor('medium', widgetSummary()),
      SERVER,
      NOW,
      env,
    ) as unknown as FakeWidget
    const columns = widget.children[0] as FakeStack
    expect(columns.layout).toBe('horizontal')
    const [left, gap, right] = columns.children
    expect(gap).toEqual({ spacer: 12 })
    expect((left as FakeStack).layout).toBe('vertical')
    expect(texts(right as FakeStack)).toEqual([
      'Budget left',
      '$1,120',
      'Net worth',
      '$48,123',
      'Next bill',
      'Rent, Nov 20',
    ])
  })
})

describe('running', () => {
  it('sets the widget for its size and finishes', async () => {
    const { env, script } = fakeEnv({ family: 'small' })
    await run(env, NOW)
    expect(script.setWidget).toHaveBeenCalledTimes(1)
    const widget = script.setWidget.mock.calls[0]![0] as FakeWidget
    expect(texts(widget)).toEqual([
      'Left to spend',
      '$843',
      'About $65 a day for 13 days',
      'Heads up: 1 account low',
    ])
    expect(widget.url).toBe(SERVER)
    expect(script.complete).toHaveBeenCalledTimes(1)
  })

  it('explains a problem in place of the numbers', async () => {
    const { env, script } = fakeEnv({ reply: 'offline' })
    await run(env, NOW)
    const widget = script.setWidget.mock.calls[0]![0] as FakeWidget
    expect(texts(widget)).toEqual(
      texts(render(messageLayout('offline', 'medium'), null, NOW, env) as unknown as FakeWidget),
    )
    expect(texts(widget)).toContain(MESSAGES.offline.title)
  })

  it('asks to be connected when there is no parameter and nothing saved', async () => {
    const { env, script, requests } = fakeEnv({ parameter: null })
    await run(env, NOW)
    const widget = script.setWidget.mock.calls[0]![0] as FakeWidget
    expect(texts(widget)).toContain(MESSAGES.setup.title)
    expect(widget.url).toBeUndefined()
    expect(requests).toHaveLength(0)
  })

  it('never logs anything, so the token cannot reach a log', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    )
    for (const reply of [undefined, 'offline', { status: 401, body: '{}' }] as const) {
      await run(fakeEnv({ reply }).env, NOW)
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })
})

describe('in the Scriptable app', () => {
  it('offers previews of each size', async () => {
    for (const [choice, size] of [
      [0, 'small'],
      [1, 'medium'],
      [2, 'large'],
    ] as const) {
      const { env, alerts, script } = fakeEnv({ runsInWidget: false, choices: [choice] })
      await run(env, NOW)
      expect(alerts[0]!.actions).toEqual([...MENU, 'cancel: Cancel'])
      expect(FakeWidget.made.at(-1)!.presented).toBe(size)
      expect(script.setWidget).not.toHaveBeenCalled()
      expect(script.complete).toHaveBeenCalledTimes(1)
    }
  })

  it('saves a pasted address and token in the Keychain, typed into a secure field', async () => {
    const { env, alerts, keychain, script } = fakeEnv({
      runsInWidget: false,
      choices: [3, 0, 0],
      typed: `${SERVER}|${TOKEN}`,
    })
    await run(env, NOW)
    expect(alerts[1]!.fields).toEqual(['https://your-leeway|lww_...'])
    expect(keychain.entries).toEqual({ [KEYCHAIN_SERVER]: SERVER, [KEYCHAIN_TOKEN]: TOKEN })
    expect(alerts[2]!.title).toBe('Saved')
    expect(FakeWidget.made).toHaveLength(0)
    expect(script.complete).toHaveBeenCalledTimes(1)
  })

  it('refuses to save an address that is not https, or anything without a token', async () => {
    for (const typed of [`http://leeway.example.com|${TOKEN}`, SERVER]) {
      const { env, alerts, keychain } = fakeEnv({ runsInWidget: false, choices: [3, 0, 0], typed })
      await run(env, NOW)
      expect(keychain.entries).toEqual({})
      expect(alerts[2]!.title).toBe(MESSAGES.bad_address.title)
    }
  })

  it('saves nothing when the paste is cancelled', async () => {
    const { env, alerts, keychain } = fakeEnv({
      runsInWidget: false,
      choices: [3, -1],
      typed: `${SERVER}|${TOKEN}`,
    })
    await run(env, NOW)
    expect(keychain.entries).toEqual({})
    expect(alerts).toHaveLength(2)
  })

  it('forgets what it saved', async () => {
    const saved = { [KEYCHAIN_SERVER]: SERVER, [KEYCHAIN_TOKEN]: TOKEN, other: 'kept' }
    const { env, keychain } = fakeEnv({ runsInWidget: false, choices: [4], keychain: saved })
    await run(env, NOW)
    expect(keychain.entries).toEqual({ other: 'kept' })
    // Nothing saved is fine too.
    await run(fakeEnv({ runsInWidget: false, choices: [4] }).env, NOW)
  })

  it('does nothing when the menu is cancelled', async () => {
    const { env, script, requests } = fakeEnv({ runsInWidget: false, choices: [-1] })
    await run(env, NOW)
    expect(requests).toHaveLength(0)
    expect(FakeWidget.made).toHaveLength(0)
    expect(script.complete).toHaveBeenCalledTimes(1)
  })
})
