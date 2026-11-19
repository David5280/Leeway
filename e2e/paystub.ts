// Helpers for paystub import. The browser tests run with no Anthropic key, so
// nothing can reach a model: the reader is stood in for at the network, by a
// route that answers the upload with a reading, and get_paystub is told the
// server can read. Everything after the reading (saving, the pension it
// updates, deleting) runs for real.

import { expect, type Page, type Request } from '@playwright/test'

/** A one-page PDF as far as the server's type check goes; its bytes never leave the browser test. */
export const PAYSTUB_PDF = {
  name: 'paystub.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.7\nA city paystub, paid twice a month.\n%%EOF\n'),
}

/** One figure ready for review, as the server sends it. */
const figure = (cents: number | null, source: string | null, confidence = 'high') => ({
  cents,
  confidence,
  source,
})
const notShown = figure(null, null)

/**
 * What the server answers for a city employee's paystub, paid twice a month,
 * with a pension and a 457; the employer's pension share was hard to read.
 */
const CITY_READ = {
  readerName: 'Claude',
  extraction: {
    employerName: 'City of Example',
    payDate: '2026-11-13',
    periodStart: '2026-10-26',
    periodEnd: '2026-11-08',
    payCadence: { value: 'semimonth', confidence: 'high', source: 'Pay Frequency: Semi-Monthly' },
    current: {
      grossPay: figure(384_500, 'Gross Pay 3,845.00'),
      netPay: figure(261_142, 'Net Pay 2,611.42'),
      pension: figure(42_295, 'PERA Member 11.00% 422.95'),
      pensionEmployer: figure(82_283, 'PERA Employer 822.83', 'low'),
      plan401k: notShown,
      plan457: figure(20_000, 'Deferred Comp 457 150.00 / Roth 457 50.00', 'medium'),
      plan403b: notShown,
      hsa: notShown,
    },
    yearToDate: {
      grossPay: figure(8_074_500, 'YTD Gross 80,745.00'),
      netPay: notShown,
      pension: figure(888_195, 'YTD PERA 8,881.95'),
      plan401k: notShown,
      plan457: notShown,
      plan403b: notShown,
      hsa: notShown,
    },
  },
}

/**
 * Stands in for the reader: get_paystub says the server can read, and the
 * upload is answered with the city paystub. Returns the uploads seen, so a
 * test can check only the file was sent.
 */
export async function mockReader(page: Page): Promise<Request[]> {
  const uploads: Request[] = []
  await page.route('**/api/actions/get_paystub', async (route) => {
    // The newest paystub saved comes from the real server; only the reader is pretend.
    const response = await route.fetch()
    const { result } = await response.json()
    await route.fulfill({
      response,
      json: { result: { ...result, available: true, readerName: 'Claude' } },
    })
  })
  await page.route('**/api/paystubs/read', async (route) => {
    uploads.push(route.request())
    await route.fulfill({ json: { result: CITY_READ } })
  })
  return uploads
}

/** Opens the import from the Paystub card and chooses the PDF, waiting for the review. */
export async function importPaystub(page: Page): Promise<void> {
  await page
    .getByRole('region', { name: 'Paystub' })
    .getByRole('button', { name: 'Import a paystub' })
    .click()
  await page.getByLabel('Choose a paystub').setInputFiles(PAYSTUB_PDF)
  await expect(page.getByRole('form', { name: 'Review the paystub' })).toBeVisible()
}

/** Deletes every saved paystub through the API, since later specs share the install. */
export async function deletePaystubs(page: Page): Promise<void> {
  for (;;) {
    const status = await page.request.post('/api/actions/get_paystub', { data: {} })
    const { result } = await status.json()
    if (!result.latest) return
    const deleted = await page.request.post('/api/actions/delete_paystub', {
      data: { id: result.latest.id },
    })
    expect(deleted.ok()).toBe(true)
  }
}
