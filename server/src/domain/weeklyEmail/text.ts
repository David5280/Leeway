// The weekly email as plain text, for mail apps that show no HTML and for
// spam filters, which trust an email more when it has both. Pure.

import type { EmailItem, EmailSection, WeeklyEmailContent } from './content.js'

const line = ({ text, detail }: EmailItem) => (detail ? `- ${text}: ${detail}` : `- ${text}`)

function section({ title, items, empty }: EmailSection): string {
  return [title, ...(items.length === 0 ? [empty] : items.map(line))].join('\n')
}

/** The email as plain text: the same words as the HTML, in the same order. */
export function weeklyEmailText(content: WeeklyEmailContent): string {
  const blocks = [
    content.headline,
    content.points.map((point) => `- ${point}`).join('\n'),
    section({ title: content.figuresTitle, items: content.figures, empty: '' }),
    ...content.sections.map(section),
    content.appUrl ? `Open Leeway: ${content.appUrl}` : '',
    content.footer,
  ]
  // Blocks with nothing to say (no points, no address) leave no gap.
  return `${blocks.filter((block) => block !== '').join('\n\n')}\n`
}
