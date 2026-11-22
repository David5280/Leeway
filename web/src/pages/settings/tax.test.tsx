// The tax export: a year's CSV to download, and a short summary after it.

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaxExport } from '../../api/client'
import { failing, fakeServer, renderSignedIn } from '../../test/fake'
import { TaxSection } from './Tax'

const exported: TaxExport = {
  filename: 'leeway-2025-tax-summary.csv',
  csv: 'Category,Group,Date,Name,Account,Amount,Note\r\n',
  summary: {
    year: 2025,
    categories: [
      {
        id: 'cat-health',
        name: 'Health',
        group: null,
        kind: 'expense',
        moneyIn: false,
        totalCents: 12000,
        count: 1,
        mayBeDeductible: true,
      },
      {
        id: 'cat-groceries',
        name: 'Groceries',
        group: null,
        kind: 'expense',
        moneyIn: false,
        totalCents: 8000,
        count: 1,
        mayBeDeductible: false,
      },
    ],
    income: [
      { key: 'acme corp', source: 'Acme Corp', cents: 600000 },
      { key: 'clawback co', source: 'Clawback Co', cents: -1000 },
    ],
    payCents: 599000,
    interestCents: 1500,
    dividendsCents: 0,
    unemploymentCents: 0,
    socialSecurityCents: 0,
    retirementCents: 0,
    taxRefundCents: 0,
    rewardsCents: 0,
    unfiledInCents: 0,
  },
}

let downloads: { name: string; blob: Blob }[]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-17T18:00:00Z'))
  downloads = []
  let blob: Blob | null = null
  URL.createObjectURL = (b: Blob | MediaSource) => {
    blob = b as Blob
    return 'blob:tax'
  }
  URL.revokeObjectURL = () => {}
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ name: this.download, blob: blob! })
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Tax export', () => {
  it('downloads last year by default, then sums it up', async () => {
    const server = fakeServer({ export_tax_year: () => exported })
    renderSignedIn(<TaxSection />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Download 2025 CSV' }))
    await waitFor(() => expect(downloads).toHaveLength(1))
    expect(downloads[0]!.name).toBe('leeway-2025-tax-summary.csv')
    expect(downloads[0]!.blob.type).toBe('text/csv')
    expect(server.actions('export_tax_year')).toEqual([{ year: 2025 }])
    expect(await screen.findByText('Acme Corp')).toBeVisible()
    // Every figure to the cent, and each source's net, so the sources add up to Pay.
    expect(screen.getByText('$5,990.00')).toBeVisible()
    expect(screen.getByText('$15.00')).toBeVisible()
    expect(screen.getByText('$0.00')).toBeVisible()
    expect(screen.getByText('−$10.00')).toBeVisible()
    expect(screen.queryByText('Money in to categorize')).not.toBeInTheDocument()
    expect(screen.queryByText('Tax refunds')).not.toBeInTheDocument()
    expect(screen.getByText('May be deductible, check with a tax pro:')).toBeVisible()
    expect(screen.getByText('Health')).toBeVisible()
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument()
    expect(screen.getByText(/not tax advice/)).toBeVisible()
  })

  it('exports another year, clearing the summary of the last', async () => {
    const server = fakeServer({
      export_tax_year: () => ({ ...exported, summary: { ...exported.summary, income: [] } }),
    })
    renderSignedIn(<TaxSection />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Download 2025 CSV' }))
    expect(await screen.findByText('Interest')).toBeVisible()
    expect(screen.queryByText('Pay by source:')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tax year' }), '2026')
    expect(screen.queryByText('Interest')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Download 2026 CSV' }))
    await waitFor(() =>
      expect(server.actions('export_tax_year')).toEqual([{ year: 2025 }, { year: 2026 }]),
    )
  })

  it('shows money in with no category, and how to make it count as pay', async () => {
    fakeServer({
      export_tax_year: () => ({
        ...exported,
        summary: { ...exported.summary, unfiledInCents: 300000 },
      }),
    })
    renderSignedIn(<TaxSection />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Download 2025 CSV' }))
    expect(await screen.findByText('Money in to categorize')).toBeVisible()
    expect(screen.getByText('$3,000.00')).toBeVisible()
    expect(screen.getByText(/could be pay, interest or a refund/)).toBeVisible()
  })

  it('shows benefits, refunds and rewards on their own lines when the year had some', async () => {
    fakeServer({
      export_tax_year: () => ({
        ...exported,
        summary: {
          ...exported.summary,
          unemploymentCents: 120000,
          socialSecurityCents: 98700,
          retirementCents: 45000,
          taxRefundCents: 2500,
          rewardsCents: 1234,
        },
      }),
    })
    renderSignedIn(<TaxSection />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Download 2025 CSV' }))
    expect(await screen.findByText('Unemployment benefits')).toBeVisible()
    expect(screen.getByText('$1,200.00')).toBeVisible()
    expect(screen.getByText('Social Security benefits')).toBeVisible()
    expect(screen.getByText('$987.00')).toBeVisible()
    expect(screen.getByText('Pension and retirement')).toBeVisible()
    expect(screen.getByText('$450.00')).toBeVisible()
    expect(screen.getByText('Tax refunds')).toBeVisible()
    expect(screen.getByText('$25.00')).toBeVisible()
    expect(screen.getByText('Card rewards and cash back')).toBeVisible()
    expect(screen.getByText('$12.34')).toBeVisible()
  })

  it('says a year with no transactions has none, rather than listing $0.00 lines', async () => {
    fakeServer({
      export_tax_year: () => ({
        ...exported,
        summary: { ...exported.summary, categories: [], income: [], payCents: 0, interestCents: 0 },
      }),
    })
    renderSignedIn(<TaxSection />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Download 2025 CSV' }))
    expect(await screen.findByText('No transactions in 2025.')).toBeVisible()
    expect(screen.queryByText('Interest')).not.toBeInTheDocument()
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  })

  it('reads "Preparing..." and stays disabled while the year builds', async () => {
    let answer: (response: Response) => void = () => {}
    const building = () => new Promise<Response>((resolve) => (answer = resolve)) as never
    fakeServer({}, { '/api/actions/export_tax_year': building })
    renderSignedIn(<TaxSection />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Download 2025 CSV' }))
    const preparing = await screen.findByRole('button', { name: 'Preparing...' })
    expect(preparing).toBeDisabled()
    answer(Response.json({ result: exported }))
    expect(await screen.findByRole('button', { name: 'Download 2025 CSV' })).toBeEnabled()
    expect(downloads).toHaveLength(1)
  })

  it('says why an export failed', async () => {
    fakeServer({}, { '/api/actions/export_tax_year': failing('Export is broken', 500) })
    renderSignedIn(<TaxSection />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Download 2025 CSV' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Export is broken')
    expect(downloads).toEqual([])
  })
})
