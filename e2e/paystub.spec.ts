// Importing a paystub, with the reader stood in for at the network: the file
// is chosen, only the file is sent, every figure is reviewed and edited, and
// saving updates the pension for real. With no key the feature stays hidden
// and the upload route says why.

import { expect, test } from '@playwright/test'
import {
  addPensionFromPaystub,
  deletePaystubs,
  importPaystub,
  mockReader,
  PAYSTUB_PDF,
} from './paystub'
import { addPension, PENSION, tearDownRetirement } from './retirement'

test.afterEach(async ({ page }) => {
  await deletePaystubs(page)
  await tearDownRetirement(page)
})

test('with no key, the import stays hidden and the upload route says why', async ({ page }) => {
  await addPension(page)
  await expect(page.getByRole('region', { name: 'Pensions' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Paystub' })).toHaveCount(0)
  await page
    .getByRole('group', { name: PENSION })
    .getByRole('button', { name: 'Edit figures' })
    .click()
  await expect(page.getByRole('form', { name: 'Pension figures' })).toBeVisible()
  await expect(page.getByText('Have a paystub?')).toHaveCount(0)

  const upload = await page.request.post('/api/paystubs/read', {
    headers: { 'Content-Type': PAYSTUB_PDF.mimeType },
    data: PAYSTUB_PDF.buffer,
  })
  expect(upload.status()).toBe(503)
  expect((await upload.json()).error).toBe('not_configured')
})

test('reads a paystub, lets each figure be checked, and saves it to the pension', async ({
  page,
}) => {
  await addPension(page)
  const uploads = await mockReader(page)
  await page.goto('/plan/retirement')
  const card = page.getByRole('region', { name: 'Paystub' })
  await expect(card.getByText(/Import a paystub to fill in/)).toBeVisible()
  await importPaystub(page)

  // Only the file went, once, as the request's whole body.
  expect(uploads).toHaveLength(1)
  expect(uploads[0]!.postDataBuffer()).toEqual(PAYSTUB_PDF.buffer)
  expect(uploads[0]!.headers()['content-type']).toBe('application/pdf')

  const review = page.getByRole('form', { name: 'Review the paystub' })
  const gross = review.getByRole('textbox', { name: 'This paycheck: Gross pay' })
  await expect(gross).toHaveValue('3845.00')
  await expect(gross).toHaveAccessibleDescription('From the line “Gross Pay 3,845.00”')
  await expect(review.getByText('Check closely')).toBeVisible()
  await expect(review.getByText('Check this')).toBeVisible()
  await expect(review.getByRole('combobox', { name: 'Paid' })).toHaveValue('semimonth')

  // The owner fixes a figure and adds one Claude did not find.
  await gross.fill('3900')
  await review.getByText('Add a figure Claude did not find (3)').click()
  await review.getByRole('textbox', { name: 'This paycheck: HSA' }).fill('75')
  await review.getByRole('combobox', { name: /Update a pension/ }).selectOption({ label: PENSION })
  await review.getByRole('button', { name: 'Save' }).click()

  await expect(card.getByRole('status')).toHaveText('Saved the paystub paid Nov 13, 2026.')
  await expect(review).toBeHidden()
  await expect(card.getByText('From City of Example, paid Nov 13, 2026')).toBeVisible()
  // Only take-home pay reads as money in; gross pay, which holds it, stands plain.
  const line = (label: string) => card.getByRole('listitem').filter({ hasText: label })
  await expect(line('Gross pay')).toHaveText('Gross pay$3,900.00')
  await expect(line('Take-home pay')).toContainText('+$')
  await expect(line('Pension, paid by your employer')).not.toContainText('+')
  await expect(card.getByRole('listitem').filter({ hasText: 'HSA' })).toContainText('$75.00')
  // The pension now takes its contribution from the paystub.
  await expect(page.getByRole('group', { name: PENSION })).toContainText('$423 a paycheck')

  await card.getByRole('button', { name: 'Delete this paystub' }).click()
  await expect(card.getByText(/Import a paystub to fill in/)).toBeVisible()
})

test("imports from a pension's own form, with that pension chosen", async ({ page }) => {
  await addPension(page)
  await mockReader(page)
  await page.goto('/plan/retirement')
  await page
    .getByRole('group', { name: PENSION })
    .getByRole('button', { name: 'Edit figures' })
    .click()
  const editor = page.getByRole('region', { name: PENSION })
  await editor.getByRole('button', { name: 'Import a paystub' }).click()
  await page
    .getByRole('region', { name: `Import a paystub for ${PENSION}` })
    .getByLabel('Choose a paystub')
    .setInputFiles(PAYSTUB_PDF)

  const review = page.getByRole('form', { name: 'Review the paystub' })
  await expect(review.getByRole('combobox', { name: /Update a pension/ })).toHaveValue(/.+/)
  await review.getByRole('button', { name: 'Save' }).click()
  await expect(review).toBeHidden()
  await expect(page.getByRole('group', { name: PENSION })).toContainText('$423 a paycheck')
})

test('adds a pension from a paystub, named by the owner, in one step', async ({ page }) => {
  await mockReader(page)
  await page.goto('/plan/retirement')
  await addPensionFromPaystub(page)

  const review = page.getByRole('form', { name: 'Review the paystub' })
  const name = review.getByRole('textbox', { name: 'Pension name' })
  // Offered from the paystub's pension line, for the owner to keep or change.
  await expect(name).toHaveValue('PERA')
  await name.fill(PENSION)
  await review.getByRole('button', { name: 'Add pension' }).click()

  await expect(review).toBeHidden()
  const pension = page.getByRole('group', { name: PENSION })
  await expect(pension).toContainText('$423 a paycheck')
  // The paystub was saved with it, in the same step.
  await expect(
    page
      .getByRole('region', { name: 'Paystub' })
      .getByText('From City of Example, paid Nov 13, 2026'),
  ).toBeVisible()
})

test('refuses an iPhone HEIC photo before sending it', async ({ page }) => {
  const uploads = await mockReader(page)
  await page.goto('/plan/retirement')
  await page
    .getByRole('region', { name: 'Paystub' })
    .getByRole('button', { name: 'Import a paystub' })
    .click()
  await page.getByLabel('Choose a paystub').setInputFiles({
    name: 'IMG_0001.HEIC',
    mimeType: 'image/heic',
    buffer: Buffer.from('....ftypheic'),
  })
  await expect(page.getByRole('alert')).toContainText('HEIC')
  expect(uploads).toHaveLength(0)
})
