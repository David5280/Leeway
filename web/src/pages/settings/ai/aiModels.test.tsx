// Settings > AI models: this month's usage against the limit, the limit
// itself, the model for each job, and the key and spending notices.

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { MODEL_CHOICES } from '../../../../../server/src/ai/models'
import { ProgressRing } from '../../../components/ProgressRing'
import { failing, fakeServer, holdRequest, renderSignedIn } from '../../../test/fake'
import { AiModelsSection } from '../AiModels'
import type { AiUsage, JobReport } from './aiText'

function job(fields: Partial<JobReport> & Pick<JobReport, 'job'>): JobReport {
  const paystub = fields.job === 'paystub'
  return {
    title: paystub ? 'Paystub reader' : 'Dashboard summary',
    description: paystub ? 'Reads a paystub you import.' : 'A few sentences on the period.',
    model: 'claude-haiku-5-5',
    source: 'default',
    envVar: paystub ? 'PAYSTUB_MODEL' : 'SUMMARY_MODEL',
    defaultModel: 'claude-haiku-5-5',
    priced: true,
    unavailable: false,
    retiresOn: null,
    spend: { calls: 0, costMicros: 0 },
    ...fields,
  }
}

function usage(fields: Partial<AiUsage> = {}): AiUsage {
  return {
    keySet: true,
    provider: 'Claude',
    models: MODEL_CHOICES,
    jobs: [
      job({ job: 'summary', spend: { calls: 12, costMicros: 4_000 } }),
      job({ job: 'paystub', spend: { calls: 1, costMicros: 1_050_000 } }),
    ],
    monthlyCapCents: 500,
    spentMicros: 1_054_000,
    calls: 13,
    month: { start: '2026-11-01', resetsOn: '2026-12-01' },
    alert: null,
    ...fields,
  }
}

/** A server whose AI usage changes as the owner picks models and sets the limit. */
function serve(initial: AiUsage = usage()) {
  let current = initial
  return fakeServer({
    get_ai_usage: () => current,
    set_ai_model: ({ job: name, model }) => {
      const jobs = current.jobs.map((each) =>
        each.job === name
          ? {
              ...each,
              model: (model as string) ?? each.defaultModel,
              source: model ? 'owner' : 'default',
            }
          : each,
      )
      current = { ...current, jobs: jobs as JobReport[] }
      return current
    },
    set_ai_limit: ({ monthlyCapCents }) => {
      current = { ...current, monthlyCapCents: monthlyCapCents as number, alert: null }
      return current
    },
    dismiss_ai_alert: () => {
      current = { ...current, alert: null }
      return { dismissed: true }
    },
  })
}

const picker = (title: string) => screen.getByRole('group', { name: title })
const limitInput = () => screen.getByRole('textbox', { name: 'Monthly limit in US dollars' })
/** This month's spend against the limit, as the line under the ring reads. */
const total = () =>
  screen.getByText((_, element) => element?.classList.contains('ai-usage-total') ?? false)

describe('Settings > AI models', () => {
  it("shows this month's spending against the limit, in all and by job", async () => {
    serve()
    renderSignedIn(<AiModelsSection />)
    const ring = await screen.findByRole('progressbar', { name: 'AI spending against the limit' })
    // $1.06 of $5.00, rounded up to the cent.
    expect(ring).toHaveAttribute('aria-valuenow', '21')
    expect(ring).toHaveTextContent('21%')
    expect(total()).toHaveTextContent('$1.06 of $5.00')
    // Each amount is drawn as money.
    expect(within(total()).getByText('$1.06')).toHaveClass('money')
    expect(screen.getByText('13 calls this month. Resets on Dec 1.')).toBeInTheDocument()
    const byJob = within(screen.getByRole('list', { name: 'Spending by job' }))
    expect(byJob.getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      'Dashboard summaryUnder $0.01, 12 calls',
      'Paystub reader$1.05, 1 call',
    ])
    expect(screen.queryByText(/ANTHROPIC_API_KEY/)).not.toBeInTheDocument()
  })

  it('says plainly that a key is needed when the server has none', async () => {
    serve(usage({ keySet: false, provider: null }))
    renderSignedIn(<AiModelsSection />)
    expect(await screen.findByText('ANTHROPIC_API_KEY')).toBeInTheDocument()
    expect(screen.getByText(/AI needs an Anthropic API key, and none is set/)).toBeInTheDocument()
  })

  it('offers each model with what it is for and its price, the default marked', async () => {
    serve()
    renderSignedIn(<AiModelsSection />)
    await screen.findByRole('group', { name: 'Paystub reader' })
    const options = within(picker('Paystub reader')).getAllByRole('radio')
    expect(options).toHaveLength(3)
    expect(options[0]).toBeChecked()
    const haiku = options[0]!.closest('label')!
    expect(haiku).toHaveTextContent('Claude Haiku 5.5Default')
    expect(haiku).toHaveTextContent('Fastest and cheapest')
    expect(haiku).toHaveTextContent('$0.10 in, $0.50 out per million tokens')
    expect(options[2]!.closest('label')).toHaveTextContent('$4.00 in, $20.00 out')
  })

  it("picks a job's model, and goes back to following the default by picking it", async () => {
    const server = serve()
    renderSignedIn(<AiModelsSection />)
    await screen.findByRole('group', { name: 'Paystub reader' })
    await userEvent.click(within(picker('Paystub reader')).getByRole('radio', { name: /Sonnet/ }))
    await waitFor(() =>
      expect(server.actions('set_ai_model')).toEqual([
        { job: 'paystub', model: 'claude-sonnet-5-5' },
      ]),
    )
    await waitFor(() =>
      expect(within(picker('Paystub reader')).getByRole('radio', { name: /Sonnet/ })).toBeChecked(),
    )
    // The summary keeps its own model.
    expect(
      within(picker('Dashboard summary')).getByRole('radio', { name: /^Claude Haiku/ }),
    ).toBeChecked()

    await userEvent.click(
      within(picker('Paystub reader')).getByRole('radio', { name: /^Claude Haiku/ }),
    )
    await waitFor(() =>
      expect(server.actions('set_ai_model').at(-1)).toEqual({ job: 'paystub', model: null }),
    )
  })

  it('shows a pick at once, and holds the list until it is saved', async () => {
    serve()
    const release = holdRequest('/api/actions/set_ai_model')
    renderSignedIn(<AiModelsSection />)
    await screen.findByRole('group', { name: 'Dashboard summary' })
    const opus = () => within(picker('Dashboard summary')).getByRole('radio', { name: /Opus/ })
    await userEvent.click(opus())
    expect(opus()).toBeChecked()
    expect(opus()).toBeDisabled()
    release()
    await waitFor(() => expect(opus()).toBeEnabled())
  })

  it('shows a pick of the default at once too, before the server answers', async () => {
    serve(
      usage({
        jobs: [
          job({ job: 'summary', model: 'claude-opus-5-5', source: 'owner' }),
          job({ job: 'paystub' }),
        ],
      }),
    )
    const release = holdRequest('/api/actions/set_ai_model')
    renderSignedIn(<AiModelsSection />)
    await screen.findByRole('group', { name: 'Dashboard summary' })
    const haiku = () =>
      within(picker('Dashboard summary')).getByRole('radio', { name: /^Claude Haiku/ })
    expect(haiku()).not.toBeChecked()
    await userEvent.click(haiku())
    expect(haiku()).toBeChecked()
    release()
    await waitFor(() => expect(haiku()).toBeEnabled())
  })

  it('locks a job whose model is fixed on the server, and names the variable', async () => {
    serve(
      usage({
        jobs: [
          job({ job: 'summary' }),
          job({ job: 'paystub', model: 'claude-something-9', source: 'server', priced: false }),
        ],
      }),
    )
    renderSignedIn(<AiModelsSection />)
    await screen.findByRole('group', { name: 'Paystub reader' })
    const paystub = within(picker('Paystub reader'))
    expect(paystub.getByText('PAYSTUB_MODEL')).toBeInTheDocument()
    expect(paystub.getByText(/Remove that variable to choose here/)).toBeInTheDocument()
    expect(paystub.getByText(/no prices for/)).toBeInTheDocument()
    for (const option of paystub.getAllByRole('radio')) {
      expect(option).toBeDisabled()
      expect(option).not.toBeChecked()
    }
    expect(within(picker('Dashboard summary')).getAllByRole('radio')[0]).toBeEnabled()
  })

  it("says when Anthropic doesn't have a job's model, and where to change it", async () => {
    serve(
      usage({
        jobs: [
          job({ job: 'summary', model: 'claude-haiku-5-5', unavailable: true }),
          job({ job: 'paystub', model: 'claude-typo-1', source: 'server', unavailable: true }),
        ],
      }),
    )
    renderSignedIn(<AiModelsSection />)
    await screen.findByRole('group', { name: 'Paystub reader' })
    const summary = within(picker('Dashboard summary')).getByRole('alert')
    expect(summary).toHaveTextContent(
      "Anthropic doesn't have claude-haiku-5-5; it may be retired or mistyped, so this job can't run. Pick another below.",
    )
    const paystub = within(picker('Paystub reader')).getByRole('alert')
    expect(paystub).toHaveTextContent(
      'Change PAYSTUB_MODEL on your server, or remove it to choose here.',
    )
  })

  it('warns of a model Anthropic is retiring, with the day', async () => {
    serve(
      usage({
        jobs: [
          job({ job: 'summary', retiresOn: '2027-03-01' }),
          job({
            job: 'paystub',
            model: 'claude-sonnet-4-5',
            source: 'server',
            retiresOn: '2026-11-30',
          }),
        ],
      }),
    )
    renderSignedIn(<AiModelsSection />)
    await screen.findByRole('group', { name: 'Paystub reader' })
    expect(within(picker('Dashboard summary')).getByText(/retires/)).toHaveTextContent(
      'Anthropic retires claude-haiku-5-5 on Mar 1, and this job stops working then. Pick another below.',
    )
    expect(within(picker('Paystub reader')).getByText(/retires/)).toHaveTextContent(
      'Anthropic retires claude-sonnet-4-5 on Nov 30, and this job stops working then. Change PAYSTUB_MODEL on your server',
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows why a pick could not be saved', async () => {
    fakeServer(
      { get_ai_usage: () => usage() },
      { '/api/actions/set_ai_model': failing('Could not save') },
    )
    renderSignedIn(<AiModelsSection />)
    await screen.findByRole('group', { name: 'Paystub reader' })
    await userEvent.click(within(picker('Paystub reader')).getByRole('radio', { name: /Opus/ }))
    expect(await screen.findByText('Could not save')).toBeInTheDocument()
  })
})

describe('the monthly limit', () => {
  it('shows the limit in dollars and saves a new one in cents', async () => {
    const server = serve()
    renderSignedIn(<AiModelsSection />)
    expect(await screen.findByDisplayValue('$5.00')).toBe(limitInput())
    await userEvent.clear(limitInput())
    await userEvent.type(limitInput(), '12.5')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(server.actions('set_ai_limit')).toEqual([{ monthlyCapCents: 1_250 }]),
    )
    expect(await screen.findByText('Limit saved.')).toBeInTheDocument()
    expect(limitInput()).toHaveValue('$12.50')
    expect(total()).toHaveTextContent('$1.06 of $12.50')
    // Typing again clears the note.
    await userEvent.type(limitInput(), '0')
    expect(screen.queryByText('Limit saved.')).not.toBeInTheDocument()
  })

  it('turns away a limit it cannot take, saying why, and sends nothing', async () => {
    const server = serve()
    renderSignedIn(<AiModelsSection />)
    await screen.findByDisplayValue('$5.00')
    await userEvent.clear(limitInput())
    await userEvent.type(limitInput(), '2000')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Use $1,000.00 or less.')
    expect(limitInput()).toHaveAttribute('aria-invalid', 'true')
    expect(server.actions('set_ai_limit')).toEqual([])
  })

  it("shows the server's reason when the limit could not be saved", async () => {
    fakeServer(
      { get_ai_usage: () => usage() },
      { '/api/actions/set_ai_limit': failing('Use $1,000 or less') },
    )
    renderSignedIn(<AiModelsSection />)
    await screen.findByDisplayValue('$5.00')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Use $1,000 or less')).toBeInTheDocument()
  })
})

describe('the spending alert in Settings', () => {
  it('shows the alert, with no link to the page it is on, and dismisses it', async () => {
    const server = serve(
      usage({
        alert: { level: 'warning', message: "AI has spent $4.10 of this month's $5.00 limit." },
      }),
    )
    renderSignedIn(<AiModelsSection />)
    expect(await screen.findByText(/AI has spent \$4.10/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'AI models' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss the AI spending alert' }))
    await waitFor(() => expect(server.actions('dismiss_ai_alert')).toEqual([{}]))
    await waitFor(() => expect(screen.queryByText(/AI has spent/)).not.toBeInTheDocument())
  })
})

describe('loading', () => {
  it('shows loading, then why usage could not be read', async () => {
    fakeServer({}, { '/api/actions/get_ai_usage': failing('Database is down', 500) })
    const release = holdRequest('/api/actions/get_ai_usage')
    renderSignedIn(<AiModelsSection />)
    expect(await screen.findByText('Loading AI usage')).toBeInTheDocument()
    release()
    expect(await screen.findByText('Database is down')).toBeInTheDocument()
  })
})

describe('ProgressRing', () => {
  it('fills to the share used, held between 0 and 100, read out as a progress bar', () => {
    render(<ProgressRing percent={140} label="Used" />)
    const ring = screen.getByRole('progressbar', { name: 'Used' })
    expect(ring).toHaveAttribute('aria-valuenow', '100')
    expect(ring.querySelector('.ring-fill')).toHaveAttribute('stroke-dashoffset', '0')
    expect(ring.querySelector('.ring-text')).toBeNull()
  })

  it('draws nothing of the fill when nothing is used', () => {
    render(<ProgressRing percent={-5} label="Used" size={40} color="red" />)
    const fill = screen.getByRole('progressbar').querySelector('.ring-fill')!
    expect(fill).toHaveAttribute('stroke-linecap', 'butt')
    expect(Number(fill.getAttribute('stroke-dashoffset'))).toBeCloseTo(
      Number(fill.getAttribute('stroke-dasharray')),
    )
    expect(fill).toHaveAttribute('stroke', 'red')
  })
})
