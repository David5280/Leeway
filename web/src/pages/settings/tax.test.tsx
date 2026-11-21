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
        name: 'Health',
        group: null,
        kind: 'expense',
        totalCents: 12000,
        count: 1,
        mayBeDeductible: true,
      },
      {
        name: 'Groceries',
        group: null,
        kind: 'expense',
        totalCents: 8000,
        count: 1,
        mayBeDeductible: false,
      },
    ],
    income: [{ source: 'Acme Corp', cents: 600000 }],
    payCents: 600000,
    interestCents: 1500,
    dividendsCents: 0,
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
    expect(screen.getByText('May be deductible, check with a tax pro:')).toBeVisible()
    expect(screen.getByText('Health')).toBeVisible()
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument()
    expect(screen.getByText(/not tax advice/)).toBeVisible()
  })

  it('exports another year, clearing the summary of the last', async () => {
    const server = fakeServer({
      export_tax_year: () => ({
        ...exported,
        summary: { ...exported.summary, income: [], categories: [] },
      }),
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

  it('says why an export failed', async () => {
    fakeServer({}, { '/api/actions/export_tax_year': failing('Export is broken', 500) })
    renderSignedIn(<TaxSection />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Download 2025 CSV' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Export is broken')
    expect(downloads).toEqual([])
  })
})
