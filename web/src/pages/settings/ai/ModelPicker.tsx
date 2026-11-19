// The model one AI job uses, picked from the list with what each model is
// for and what it costs. Picking the job's default goes back to following
// it, so a future default reaches this job too. A server variable such as
// PAYSTUB_MODEL wins over any pick, so the list is then shown but locked.

import { useActionMutation } from '../../../api/hooks'
import { ErrorNote } from '../../../components/ui'
import { priceText, type JobReport, type ModelChoice } from './aiText'

export function ModelPicker({
  job,
  models,
  locale,
}: {
  job: JobReport
  models: readonly ModelChoice[]
  locale: string
}) {
  const set = useActionMutation('set_ai_model')
  const fixed = job.source === 'server'
  // While a pick saves, show it already, as the other settings do.
  const chosen = set.isPending ? (set.variables.model ?? job.defaultModel) : job.model

  return (
    <fieldset className="ai-job stack-sm">
      <legend className="strong">{job.title}</legend>
      <span className="small muted">{job.description}</span>
      {fixed && (
        <p className="notice small">
          Set on the server to <code>{job.model}</code> by <code>{job.envVar}</code>. Remove that
          variable to choose here.
        </p>
      )}
      {!job.priced && (
        <p className="notice small">
          Leeway has no prices for <code>{job.model}</code>, so it counts each call at its dearest
          model&apos;s prices to keep within the limit.
        </p>
      )}
      <div className="choice-list">
        {models.map((model) => (
          <label key={model.id} className="choice">
            <input
              type="radio"
              name={`model-${job.job}`}
              value={model.id}
              checked={chosen === model.id}
              disabled={fixed || set.isPending}
              onChange={() =>
                set.mutate({ job: job.job, model: model.id === job.defaultModel ? null : model.id })
              }
            />
            <span className="choice-text">
              <span className="strong">
                {model.name}
                {model.id === job.defaultModel && <span className="badge">Default</span>}
              </span>
              <span className="small muted">{model.description}</span>
              <span className="small muted">{priceText(model, locale)}</span>
            </span>
          </label>
        ))}
      </div>
      <ErrorNote error={set.error} />
    </fieldset>
  )
}
