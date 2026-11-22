// The year's tax-ready export, downloaded from Settings.

import { z } from 'zod'
import { taxExport } from '../domain/tax/export.js'
import { defineAction } from './action.js'

export const exportTaxYearAction = defineAction({
  name: 'export_tax_year',
  title: 'Export a year for taxes',
  description:
    'A year of transactions from every account, hidden ones included, as a CSV grouped by category with totals, and a summary: category totals with possibly deductible ones flagged, pay by source, interest, dividends and money in not categorized yet. Transfers between own accounts are left out. Not tax advice.',
  input: z.object({ year: z.number().int().min(2000).max(2100) }),
  scope: 'read',
  surface: 'app',
  run: (ctx, { year }) => taxExport(ctx.db, year),
})
