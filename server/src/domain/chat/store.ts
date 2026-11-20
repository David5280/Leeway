// What Chat keeps: the conversation's words and the facts the owner told it
// to remember. One conversation per install, since an install has one owner.

import type pg from 'pg'
import { AppError, notFound } from '../../errors.js'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: string
}

/** Something the owner said that still matters later, like a plan or how they are paid. */
export interface CoachFact {
  id: string
  text: string
  createdAt: string
}

/** The most messages shown when Chat opens; older ones stay until the owner starts over. */
export const SHOWN_MESSAGES = 200

/** The most facts kept, so what is sent with every question stays short. */
export const MAX_FACTS = 50

/** The longest fact, in characters: one sentence. */
export const FACT_MAX_LENGTH = 300

type Db = pg.Pool | pg.PoolClient

const MESSAGE_COLUMNS = `id::text, role, text, created_at AS "createdAt"`

/** The latest messages, oldest first. */
export async function listMessages(db: Db, limit = SHOWN_MESSAGES): Promise<ChatMessage[]> {
  const { rows } = await db.query<ChatMessage>(
    `SELECT ${MESSAGE_COLUMNS} FROM (
       SELECT * FROM chat_messages ORDER BY id DESC LIMIT $1
     ) latest ORDER BY latest.id`,
    [limit],
  )
  return rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() }))
}

/**
 * Keeps a question with its answer, both or neither, so the conversation
 * never holds a question whose answer failed: the owner just asks again.
 */
export async function saveExchange(
  db: pg.Pool,
  question: string,
  answer: string,
  at: Date,
): Promise<{ question: ChatMessage; answer: ChatMessage }> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const insert = (role: ChatMessage['role'], text: string) =>
      client.query<ChatMessage>(
        `INSERT INTO chat_messages (role, text, created_at) VALUES ($1, $2, $3)
         RETURNING ${MESSAGE_COLUMNS}`,
        [role, text, at],
      )
    const asked = (await insert('user', question)).rows[0]!
    const answered = (await insert('assistant', answer)).rows[0]!
    await client.query('COMMIT')
    const iso = (message: ChatMessage) => ({ ...message, createdAt: at.toISOString() })
    return { question: iso(asked), answer: iso(answered) }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/** Starts the conversation over. The remembered facts stay. */
export async function clearMessages(db: Db): Promise<void> {
  await db.query('DELETE FROM chat_messages')
}

export async function listFacts(db: Db): Promise<CoachFact[]> {
  const { rows } = await db.query<CoachFact>(
    `SELECT id, text, created_at AS "createdAt" FROM coach_facts ORDER BY created_at, id`,
  )
  return rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() }))
}

/**
 * Remembers a fact, or returns the same one already kept (compared without
 * case or extra spaces), so asking twice keeps one.
 */
export async function saveFact(db: Db, text: string, at: Date): Promise<CoachFact> {
  const clean = text.trim().replace(/\s+/g, ' ')
  if (!clean) throw new AppError('invalid_input', 'Say what to remember.')
  if (clean.length > FACT_MAX_LENGTH) {
    throw new AppError('invalid_input', `Keep a fact to ${FACT_MAX_LENGTH} characters.`)
  }
  const facts = await listFacts(db)
  const same = facts.find((fact) => fact.text.toLowerCase() === clean.toLowerCase())
  if (same) return same
  if (facts.length >= MAX_FACTS) {
    throw new AppError(
      'conflict',
      `Leeway already remembers ${MAX_FACTS} things. The owner can delete some in Chat first.`,
    )
  }
  const { rows } = await db.query<CoachFact>(
    `INSERT INTO coach_facts (text, created_at) VALUES ($1, $2)
     RETURNING id, text, created_at AS "createdAt"`,
    [clean, at],
  )
  return { ...rows[0]!, createdAt: at.toISOString() }
}

export async function deleteFact(db: Db, id: string): Promise<void> {
  const { rowCount } = await db.query('DELETE FROM coach_facts WHERE id = $1', [id])
  if (!rowCount) throw notFound('That fact')
}
