// The year's tax-ready export, downloaded from Settings.

import { z } from 'zod'
import { taxExport } from '../domain/tax/export.js'
import { defineAction } from './action.js'

export const exportTaxYearAction = defineAction({
  name: 'export_tax_year',
  title: 'Export a year for taxes',
  description:
    'A year of transactions from every account, hidden ones included, as a CSV grouped by category with totals, and a summary: category totals with possibly deductible ones flagged, pay by source, interest, dividends, unemployment, Social Security, pensions, tax refunds, card rewards and money in not categorized yet (payments from people left out, since they are never pay). Child support, alimony and veterans benefits stay in their category total with a note, on no summed line. Transfers between own accounts are left out. Not tax advice.',
  input: z.object({ year: z.number().int().min(2000).max(2100) }),
  scope: 'read',
  surface: 'app',
  run: (ctx, { year }) => taxExport(ctx.db, year),
})
