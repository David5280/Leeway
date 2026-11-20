// The server's VAPID key pair, made on first start and kept in the database
// with the private half encrypted by ENCRYPTION_KEY. Nothing to configure.

import type pg from 'pg'
import { withTransaction } from '../db/pool.js'
import { decrypt, encrypt } from '../lib/crypto.js'
import { generateVapidKeys, vapidKeysFromJwk, type VapidKeys } from './vapid.js'

interface KeyRow {
  privateKeyEncrypted: string
}

async function readRow(db: pg.Pool): Promise<KeyRow | undefined> {
  const { rows } = await db.query<KeyRow>(
    'SELECT private_key_encrypted AS "privateKeyEncrypted" FROM push_keys',
  )
  return rows[0]
}

function sealed(encryptionKey: Buffer): [string, string] {
  const { publicKey, privateJwk } = generateVapidKeys()
  return [publicKey, encrypt(JSON.stringify(privateJwk), encryptionKey)]
}

/** Told how many devices lost push when the key pair had to be replaced. */
export type OnKeysReplaced = (removedDevices: number) => void

/** What the server log says when the key pair was replaced: a count, never key material. */
export function keysReplacedLine(removedDevices: number): string {
  const devices = removedDevices === 1 ? '1 device' : `${removedDevices} devices`
  return `ENCRYPTION_KEY changed, so push has a new key pair. Push was turned off on ${devices}; turn it on again on each.`
}

/**
 * The key pair, made and stored the first time it is asked for. Two servers
 * starting at once both try to store one; the first wins and both use it.
 */
export async function loadVapidKeys(
  db: pg.Pool,
  encryptionKey: Buffer,
  onReplaced?: OnKeysReplaced,
): Promise<VapidKeys> {
  const row = await readRow(db)
  if (!row) {
    await db.query(
      `INSERT INTO push_keys (public_key, private_key_encrypted) VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING`,
      sealed(encryptionKey),
    )
    return loadVapidKeys(db, encryptionKey, onReplaced)
  }
  try {
    return vapidKeysFromJwk(JSON.parse(decrypt(row.privateKeyEncrypted, encryptionKey)))
  } catch {
    const { keys, removedDevices } = await replaceVapidKeys(db, encryptionKey)
    onReplaced?.(removedDevices)
    return keys
  }
}

/**
 * A new key pair, for when ENCRYPTION_KEY changed and the stored one can no
 * longer be read. Every device subscribed with the old public key, so push
 * services would refuse messages signed with the new one: those
 * subscriptions are removed, and each device turns push on again.
 */
async function replaceVapidKeys(
  db: pg.Pool,
  encryptionKey: Buffer,
): Promise<{ keys: VapidKeys; removedDevices: number }> {
  const [publicKey, privateKeyEncrypted] = sealed(encryptionKey)
  const removedDevices = await withTransaction(db, async (client) => {
    const { rowCount } = await client.query('DELETE FROM push_subscriptions')
    await client.query(
      'UPDATE push_keys SET public_key = $1, private_key_encrypted = $2, created_at = now()',
      [publicKey, privateKeyEncrypted],
    )
    return Number(rowCount)
  })
  const keys = vapidKeysFromJwk(JSON.parse(decrypt(privateKeyEncrypted, encryptionKey)))
  return { keys, removedDevices }
}
