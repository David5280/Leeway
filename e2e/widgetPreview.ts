// Previews of the Scriptable widget in a browser: the script's own layouts,
// drawn as HTML at the sizes iOS gives a widget, so a test can check that
// nothing spills out and a person can see what the widget looks like. They
// are previews, not screenshots from a device: iOS draws the real thing.

import { readFile } from 'node:fs/promises'
import type * as Script from '../widget/leeway-widget.js'

type WidgetScript = typeof Script
type Layout = ReturnType<WidgetScript['layoutFor']>
type Block = Layout['blocks'][number]
type Mode = 'light' | 'dark'

/** Points iOS gives each size on a 6.1-inch iPhone. */
export const SIZES = {
  small: { width: 170, height: 170 },
  medium: { width: 364, height: 170 },
  large: { width: 364, height: 382 },
} as const

/** The space ListWidget.setPadding leaves inside the widget's edge. */
const PADDING = 14

/**
 * Loads the script the way Scriptable runs it: its text as the body of an
 * async function, with `module` to export through. Without Scriptable's
 * globals it only defines its functions.
 */
export async function loadWidgetScript(): Promise<WidgetScript> {
  const source = await readFile('widget/leeway-widget.js', 'utf8')
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
    ...args: string[]
  ) => (module: { exports: unknown }) => Promise<void>
  const module = { exports: {} }
  await new AsyncFunction('module', source)(module)
  return module.exports as WidgetScript
}

const escape = (text: string) => text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`)

/** One block as HTML, its style and color taken from the script's own tables. */
function blockHtml(
  block: Block,
  color: (tone: string) => string,
  styles: WidgetScript['STYLES'],
): string {
  if (block.type === 'spacer') {
    return block.size === null
      ? '<div class="grow"></div>'
      : `<div style="height:${block.size}px;flex:none"></div>`
  }
  if (block.type === 'columns') {
    const columns = block.columns
      .map(
        (column) =>
          `<div class="column">${column.map((b) => blockHtml(b, color, styles)).join('')}</div>`,
      )
      .join('')
    return `<div class="columns">${columns}</div>`
  }
  if (block.type === 'row') {
    const label = blockHtml(
      { type: 'text', text: block.label, style: 'body', tone: 'muted', lines: 1 },
      color,
      styles,
    )
    const value = blockHtml(
      { type: 'text', text: block.value, style: 'body', tone: block.tone, lines: 1 },
      color,
      styles,
    )
    return `<div class="row">${label}${value}</div>`
  }
  const { size, weight, scale } = styles[block.style]
  const font = weight === 'bold' ? 'ui-rounded, system-ui, sans-serif' : 'system-ui, sans-serif'
  const weights = { regular: 400, semibold: 600, bold: 700 }
  // One line runs on and ends in an ellipsis; more lines wrap and cut off at their limit.
  const lines = block.lines === 1 ? 'one-line' : 'lines'
  const style = `font:${weights[weight]} ${size}px/1.2 ${font};color:${color(block.tone)};-webkit-line-clamp:${block.lines}`
  return `<div class="text ${lines}" data-size="${size}" data-scale="${scale}" style="${style}">${escape(block.text)}</div>`
}

/** A widget as HTML, in light or dark, labeled as a preview. */
function widgetHtml(layout: Layout, mode: Mode, title: string, script: WidgetScript): string {
  const { palette } = layout
  const tokens = palette.mode === 'system' ? palette[mode] : palette[palette.mode]
  const color = (tone: string) => tokens[tone as keyof typeof tokens]
  const { width, height } = SIZES[layout.family]
  const blocks = layout.blocks.map((block) => blockHtml(block, color, script.STYLES)).join('')
  return `<figure>
  <div class="widget" data-family="${layout.family}" style="width:${width}px;height:${height}px;background:${color('surface')}">
    <div class="inner">${blocks}</div>
  </div>
  <figcaption>Preview: ${escape(title)}</figcaption>
</figure>`
}

/**
 * A page of widget previews. Text shrinks to fit as iOS shrinks it (down to
 * each style's scale), then cuts off with an ellipsis at its line limit.
 */
export function previewPage(
  widgets: { title: string; layout: Layout }[],
  mode: Mode,
  script: WidgetScript,
): string {
  const page = mode === 'dark' ? '#1c1c1e' : '#e5e5ea'
  const ink = mode === 'dark' ? '#f2f2f7' : '#1c1c1e'
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Leeway widget previews</title><style>
  body { margin: 0; padding: 24px; background: ${page}; color: ${ink}; font: 14px system-ui, sans-serif; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p { margin: 0 0 20px; opacity: .75; }
  main { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
  figure { margin: 0; }
  figcaption { margin-top: 8px; font-size: 12px; opacity: .75; }
  .widget { box-sizing: border-box; padding: ${PADDING}px; border-radius: 22px; overflow: hidden; display: flex; }
  .inner, .column { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .inner { overflow: hidden; }
  .columns { display: flex; gap: 12px; flex: 1; min-height: 0; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .row > .text:last-child { text-align: right; flex: none; }
  .grow { flex: 1; }
  .text { overflow: hidden; flex: none; }
  .text.one-line { white-space: nowrap; text-overflow: ellipsis; }
  .text.lines { display: -webkit-box; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
</style></head><body>
<h1>Leeway widget: previews</h1>
<p>Drawn in a browser from the script's own layouts, ${mode}. Not a screenshot from a device.</p>
<main>${widgets.map((w) => widgetHtml(w.layout, mode, w.title, script)).join('\n')}</main>
<script>
  // Shrink a one-line text that is too wide, as minimumScaleFactor lets iOS.
  for (const text of document.querySelectorAll('.text.one-line')) {
    const size = Number(text.dataset.size)
    let current = size
    while (text.scrollWidth > text.clientWidth && current > size * Number(text.dataset.scale)) {
      current -= 0.5
      text.style.fontSize = current + 'px'
    }
  }
</script>
</body></html>`
}
