// The script's last lines run it when Scriptable provides its globals. A file
// of its own, so the script is loaded here only with those globals in place.

import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

it('runs by itself in Scriptable, and only there', async () => {
  const drawn: string[] = []
  const requests: string[] = []
  class Widget {
    setPadding() {}
    addSpacer() {}
    addText(text: string) {
      drawn.push(text)
      return {}
    }
  }
  class Color {
    static dynamic = () => new Color()
  }
  const script = { setWidget: vi.fn(), complete: vi.fn() }
  const globals = {
    args: { widgetParameter: null },
    config: { runsInWidget: true, widgetFamily: 'small' },
    Keychain: { contains: () => false },
    Request: class {
      constructor(url: string) {
        requests.push(url)
      }
    },
    ListWidget: Widget,
    Color,
    Font: { systemFont() {}, semiboldSystemFont() {}, boldRoundedSystemFont() {} },
    Alert: class {},
    Script: script,
  }
  for (const [name, value] of Object.entries(globals)) vi.stubGlobal(name, value)

  await import('../../../widget/leeway-widget.js')

  // With nothing to connect to, it draws the setup message without a request.
  expect(script.setWidget).toHaveBeenCalledWith(expect.any(Widget))
  expect(drawn).toContain('Connect your Leeway')
  expect(requests).toEqual([])
  expect(script.complete).toHaveBeenCalledTimes(1)
})
