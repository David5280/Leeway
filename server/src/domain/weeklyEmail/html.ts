// The weekly email as HTML that mail apps show well: tables for layout,
// inline styles, no images, fonts or scripts from anywhere, and colors that
// stay readable when the mail app is in dark mode. Pure.

import type { EmailItem, EmailSection, WeeklyEmailContent } from './content.js'

/** Light colors inline; the <style> block swaps in dark ones where mail apps allow. */
const COLOR = {
  page: '#f3f4f6',
  card: '#ffffff',
  text: '#1f2328',
  muted: '#59636e',
  line: '#e3e6ea',
  accent: '#2f6fde',
  onAccent: '#ffffff',
}

const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`

/** Apple Mail and some others honor this; Gmail darkens on its own and the colors hold up. */
const DARK_MODE_CSS = `
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .page { background: #111418 !important; }
    .card { background: #1b1f24 !important; border-color: #2d333b !important; }
    .text { color: #e6e8eb !important; }
    .muted { color: #9aa4af !important; }
    .line { border-color: #2d333b !important; }
  }`

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Text made safe for HTML. Every name here (bills, goals, banks) is data, never markup. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]!)
}

/** Only plain web addresses become a link. */
function safeUrl(url: string | null): string | null {
  return url && /^https?:\/\/[^\s"'<>]+$/i.test(url) ? url : null
}

/** One line of a list: its words on the left, its amount on the right. */
function row(item: EmailItem, strong = false): string {
  const cell = `class="text line" style="padding:8px 0;color:${COLOR.text};border-bottom:1px solid ${COLOR.line};`
  const weight = strong ? 'font-weight:600;' : ''
  return `<tr><td ${cell}padding-right:12px;">${escapeHtml(item.text)}</td><td ${cell}${weight}white-space:nowrap;" align="right">${escapeHtml(item.detail ?? '')}</td></tr>`
}

function heading(title: string): string {
  return `<h2 class="text" style="margin:28px 0 8px;font-size:16px;line-height:22px;color:${COLOR.text};">${escapeHtml(title)}</h2>`
}

function section({ title, items, empty }: EmailSection): string {
  const body =
    items.length === 0
      ? `<p class="muted" style="margin:0;color:${COLOR.muted};">${escapeHtml(empty)}</p>`
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${items.map((item) => row(item)).join('')}</table>`
  return heading(title) + body
}

function points(list: string[]): string {
  if (list.length === 0) return ''
  const items = list
    .map((point) => `<li style="margin:0 0 6px;">${escapeHtml(point)}</li>`)
    .join('')
  return `<ul class="text" style="margin:12px 0 0;padding-left:20px;color:${COLOR.text};">${items}</ul>`
}

function button(url: string | null): string {
  const href = safeUrl(url)
  if (!href) return ''
  return `<p style="margin:28px 0 0;"><a href="${escapeHtml(href)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:${COLOR.accent};color:${COLOR.onAccent};font-weight:600;text-decoration:none;">Open Leeway</a></p>`
}

/** The email as one HTML document. */
export function weeklyEmailHtml(content: WeeklyEmailContent): string {
  const figures = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${content.figures.map((item) => row(item, true)).join('')}</table>`

  return `<!doctype html>
<html lang="${escapeHtml(content.locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(content.subject)}</title>
<style>${DARK_MODE_CSS}</style>
</head>
<body class="page" style="margin:0;padding:0;background:${COLOR.page};">
<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(content.preview)}</div>
<table role="presentation" class="page" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.page};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="card" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${COLOR.card};border:1px solid ${COLOR.line};border-radius:12px;">
<tr><td style="padding:28px 24px;font-family:${FONT};font-size:15px;line-height:22px;">
<p class="muted" style="margin:0 0 8px;color:${COLOR.muted};font-size:13px;">Your week in Leeway</p>
<h1 class="text" style="margin:0;font-size:20px;line-height:28px;color:${COLOR.text};">${escapeHtml(content.headline)}</h1>
${points(content.points)}
${heading(content.figuresTitle)}
${figures}
${content.sections.map(section).join('\n')}
${button(content.appUrl)}
<p class="muted" style="margin:28px 0 0;color:${COLOR.muted};font-size:13px;line-height:19px;">${escapeHtml(content.footer)}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}
