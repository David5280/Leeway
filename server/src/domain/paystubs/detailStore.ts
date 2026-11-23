// Saving and reading a paystub confirmed on the full review. Saving keeps
// the paystub record the pension and retirement import reads (paystubs.ts)
// and every line beside it, linked, in one step. Nothing is applied to
// pensions, contributions or budgets here; that comes later, from these rows.

import type pg from 'pg'
import { withTransaction, type Db } from '../../db/pool.js'
import { paystubFromDetail, type ConfirmedDetail } from './confirmed.js'
import { insertPaystub, type SavedPaystub } from './paystubs.js'

/** A confirmed paystub as saved: its lines, and the paystub record they belong to. */
export interface SavedDetail extends ConfirmedDetail {
  /** The paystub record's id; deleting it deletes these lines too. */
  paystubId: string
  savedAt: string
}

/** What saving a full review keeps. */
export interface DetailSaved {
  paystub: SavedPaystub
  detail: SavedDetail
}

interface DetailRow {
  paystubId: string
  employerName: string | null
  payDate: string | null
  periodStart: string | null
  periodEnd: string | null
  payCadence: ConfirmedDetail['payCadence']
  pay: ConfirmedDetail['pay']
  earnings: ConfirmedDetail['earnings']
  taxes: ConfirmedDetail['taxes']
  preTax: ConfirmedDetail['preTax']
  postTax: ConfirmedDetail['postTax']
  employer: ConfirmedDetail['employer']
  savedAt: Date
}

/** The lines with the paystub record's own details: who paid, when and how often. */
const SELECT_DETAIL = `SELECT d.paystub_id AS "paystubId", p.employer_name AS "employerName",
    p.pay_date AS "payDate", p.period_start AS "periodStart", p.period_end AS "periodEnd",
    p.pay_cadence AS "payCadence", d.pay, d.earnings, d.taxes, d.pre_tax AS "preTax",
    d.post_tax AS "postTax", d.employer, d.created_at AS "savedAt"
  FROM paystub_details d JOIN paystubs p ON p.id = d.paystub_id`

function detailFromRow(row: DetailRow): SavedDetail {
  const { savedAt, ...detail } = row
  return { ...detail, savedAt: savedAt.toISOString() }
}

/**
 * Saves a paystub the owner confirmed in full: the paystub record, worked out
 * from its lines, and the lines themselves, all or nothing.
 */
export async function saveDetail(pool: pg.Pool, detail: ConfirmedDetail): Promise<DetailSaved> {
  return withTransaction(pool, async (db) => {
    // The employer's name and dates live on the paystub record, once.
    const paystub = await insertPaystub(db, paystubFromDetail(detail), null)
    await db.query(
      `INSERT INTO paystub_details (paystub_id, pay, earnings, taxes, pre_tax, post_tax, employer)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        paystub.id,
        JSON.stringify(detail.pay),
        JSON.stringify(detail.earnings),
        JSON.stringify(detail.taxes),
        JSON.stringify(detail.preTax),
        JSON.stringify(detail.postTax),
        JSON.stringify(detail.employer),
      ],
    )
    const saved = await detailOf(db, paystub.id)
    return { paystub, detail: saved! }
  })
}

/** The lines saved with a paystub record, or null when it was not reviewed in full. */
export async function detailOf(db: Db, paystubId: string): Promise<SavedDetail | null> {
  const { rows } = await db.query<DetailRow>(`${SELECT_DETAIL} WHERE d.paystub_id = $1`, [
    paystubId,
  ])
  return rows[0] ? detailFromRow(rows[0]) : null
}

/** The newest paystub reviewed in full, by the day it was paid, or null when there is none. */
export async function latestDetail(db: Db): Promise<SavedDetail | null> {
  const { rows } = await db.query<DetailRow>(
    `${SELECT_DETAIL} ORDER BY p.pay_date DESC NULLS LAST, p.created_at DESC LIMIT 1`,
  )
  return rows[0] ? detailFromRow(rows[0]) : null
}
