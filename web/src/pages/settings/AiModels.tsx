// The owner's AI choices: the model for each job, the monthly spending
// limit, and this month's usage against it. An assistant can't change any of
// it, and sees only the chosen models and the limit, in get_settings.

import { useAction } from '../../api/hooks'
import { AiSpendAlert } from '../../components/AiSpendAlert'
import { LoadingOrError } from '../../components/ui'
import { useApp } from '../../lib/app'
import type { AiUsage } from './ai/aiText'
import { LimitField } from './ai/LimitField'
import { ModelPicker } from './ai/ModelPicker'
import { UsageSummary } from './ai/UsageSummary'
import { Section } from './Section'

export function AiModelsSection() {
  const usage = useAction('get_ai_usage')
  return (
    <Section id="ai-models" title="AI models">
      {usage.data ? (
        <AiModels usage={usage.data} />
      ) : (
        <LoadingOrError error={usage.error} label="Loading AI usage" />
      )}
    </Section>
  )
}

/** The jobs to choose a model for. Chat only exists with a key, so its row waits for one. */
function jobsShown(usage: AiUsage): AiUsage['jobs'] {
  return usage.keySet ? usage.jobs : usage.jobs.filter((job) => job.job !== 'chat')
}

function AiModels({ usage }: { usage: AiUsage }) {
  const { locale } = useApp().settings
  return (
    <div className="ai-models stack">
      {!usage.keySet && <KeyNotice />}
      {usage.alert && <AiSpendAlert alert={usage.alert} />}
      <h3>This month</h3>
      <UsageSummary usage={usage} locale={locale} />
      <LimitField capCents={usage.monthlyCapCents} />
      <h3>Models</h3>
      {jobsShown(usage).map((job) => (
        <ModelPicker key={job.job} job={job} models={usage.models} locale={locale} />
      ))}
      <span className="small muted">
        Costs are worked out from Anthropic&apos;s list prices as each call is made, so your
        Anthropic bill is the final word. Leeway keeps only the token counts and the cost of each
        call, never what was asked or answered.
      </span>
    </div>
  )
}

/** Without a key no AI job runs, so nothing is spent; the choices still save. */
function KeyNotice() {
  return (
    <p className="notice">
      AI needs an Anthropic API key, and none is set. Add <code>ANTHROPIC_API_KEY</code> to your
      server&apos;s variables (on Railway: the Leeway service, then Variables). You can make a key
      at console.anthropic.com. Until then nothing is spent, and Leeway writes the summary itself.
    </p>
  )
}
