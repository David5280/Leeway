// This month's AI spending: a ring against the limit, the total, and each
// job's share. Counts and costs only; Leeway keeps nothing that was asked.

import { ProgressRing } from '../../../components/ProgressRing'
import {
  callsText,
  dollars,
  percentUsed,
  resetText,
  spentText,
  usageTone,
  type AiUsage,
} from './aiText'

export function UsageSummary({ usage, locale }: { usage: AiUsage; locale: string }) {
  const used = percentUsed(usage.spentMicros, usage.monthlyCapCents)
  return (
    <div className="stack-sm">
      <div className="ai-usage">
        <ProgressRing percent={used} color={usageTone(used)} label="AI spending against the limit">
          {Math.floor(used)}%
        </ProgressRing>
        <div className="ai-usage-figures">
          <span className="ai-usage-total">
            {spentText(usage.spentMicros, locale)} of {dollars(usage.monthlyCapCents, locale)}
          </span>
          <span className="small muted">
            {callsText(usage.calls)} this month. {resetText(usage.month.resetsOn, locale)}
          </span>
        </div>
      </div>
      <ul className="plain-list small" aria-label="Spending by job">
        {usage.jobs.map((job) => (
          <li key={job.job} className="row-between">
            <span>{job.title}</span>
            <span className="figures">
              {spentText(job.spend.costMicros, locale)}
              <span className="muted">, {callsText(job.spend.calls)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
