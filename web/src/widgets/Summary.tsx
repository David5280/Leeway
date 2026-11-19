// The summary at the top of the dashboard: how the period is going and what
// needs the owner, in a sentence and a few points. Leeway writes it from the
// numbers, or Claude does when the owner turns that on in Settings.

import { Link } from 'react-router-dom'
import type { Output } from '../api/client'
import { useAction } from '../api/hooks'
import { Card, ErrorNote, Loading } from '../components/ui'
import { useApp } from '../lib/app'
import { shortDate, timeAgo } from '../lib/format'
import { settingsPath } from '../pages/settings/paths'

type Summary = Output<'get_summary'>

export function SummaryWidget() {
  return (
    <Card label="Summary" className="summary stack-sm">
      <p className="eyebrow">Summary</p>
      <SummaryBody />
    </Card>
  )
}

function SummaryBody() {
  const { locale } = useApp().settings
  const summary = useAction('get_summary')
  if (summary.isPending) return <Loading label="Reading your numbers" />
  if (summary.isError) return <ErrorNote error={summary.error} />
  const { headline, points } = summary.data
  return (
    <>
      <p className="summary-headline">{headline}</p>
      {points.length > 0 && (
        <ul className="summary-points">
          {points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      )}
      <Byline summary={summary.data} locale={locale} />
    </>
  )
}

/** Who wrote it and when, or how to have Claude write it. */
export function Byline({
  summary,
  now,
  locale = 'en-US',
}: {
  summary: Summary
  now?: number
  locale?: string
}) {
  const settings = <Link to={settingsPath('assistant')}>Settings, then AI assistant</Link>
  switch (summary.ai) {
    case 'on':
      return (
        <p className="small muted">
          Written by {summary.writtenBy} {timeAgo(summary.writtenAt, now)}.
        </p>
      )
    case 'unavailable':
      return (
        <p className="small muted">
          Claude couldn&apos;t write it just now, so this is Leeway&apos;s own summary.
        </p>
      )
    case 'no_key':
      return (
        <p className="small muted">
          Claude needs an Anthropic key on your server first. See {settings}.
        </p>
      )
    case 'off':
      return <p className="small muted">Want Claude to write this? Turn it on in {settings}.</p>
    case 'limit':
      return (
        <p className="small muted">
          This month&apos;s AI limit is reached, so this is Leeway&apos;s own summary
          {summary.limitResetsOn ? ` until ${shortDate(summary.limitResetsOn, locale)}` : ''}. See{' '}
          <Link to={settingsPath('ai')}>Settings, then AI models</Link>.
        </p>
      )
  }
}
