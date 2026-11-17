import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'
import { decrypt, encrypt, hashToken, randomToken } from '../src/lib/crypto.js'
import { formatCents, toCents, toCentsOrNull } from '../src/lib/money.js'
import { hashPassword, verifyPassword } from '../src/lib/password.js'

const key = Buffer.alloc(32, 7)

describe('encryption', () => {
  it('round-trips and never stores the plaintext', () => {
    const secret = 'access-sandbox-1234'
    const stored = encrypt(secret, key)
    expect(stored).not.toContain(secret)
    expect(decrypt(stored, key)).toBe(secret)
  })

  it('refuses a tampered value or a wrong key', () => {
    const stored = encrypt('secret', key)
    const [v, iv, tag, data] = stored.split(':')
    const flipped = Buffer.from(data!, 'base64')
    flipped[0]! ^= 1
    expect(() => decrypt([v, iv, tag, flipped.toString('base64')].join(':'), key)).toThrow()
    expect(() => decrypt(stored, Buffer.alloc(32, 8))).toThrow()
  })

  it('refuses a value that was not written by encrypt', () => {
    expect(() => decrypt('plain-access-token', key)).toThrow('Unrecognized encrypted value')
    expect(() => decrypt('v2:a:b:c', key)).toThrow('Unrecognized encrypted value')
    expect(() => decrypt('v1:a::c', key)).toThrow('Unrecognized encrypted value')
  })

  it('makes unique tokens and stable hashes', () => {
    expect(randomToken('lw_')).toMatch(/^lw_[\w-]{43}$/)
    expect(randomToken()).not.toBe(randomToken())
    expect(hashToken('a')).toBe(hashToken('a'))
  })
})

describe('passwords', () => {
  it('verifies the right password and rejects others', async () => {
    const stored = await hashPassword('correct horse battery')
    expect(stored.startsWith('scrypt:')).toBe(true)
    expect(await verifyPassword('correct horse battery', stored)).toBe(true)
    expect(await verifyPassword('wrong password', stored)).toBe(false)
    expect(await verifyPassword('anything', 'garbage')).toBe(false)
  })
})

describe('config', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost/db', ENCRYPTION_KEY: 'ab'.repeat(32) }

  it('applies defaults and leaves Plaid off until both keys are set', () => {
    const config = loadConfig(base)
    expect(config.port).toBe(3000)
    expect(config.plaid).toBeNull()
    expect(config.databaseSsl).toBe(false)
    expect(loadConfig({ ...base, PLAID_CLIENT_ID: 'id' }).plaid).toBeNull()
  })

  it('builds the public URL from Railway and uses TLS for hosted databases', () => {
    const config = loadConfig({
      ...base,
      DATABASE_URL: 'postgres://u:p@db.example.com/db',
      RAILWAY_PUBLIC_DOMAIN: 'leeway.up.railway.app',
      PLAID_CLIENT_ID: 'id',
      PLAID_SECRET: 'secret',
    })
    expect(config.publicUrl).toBe('https://leeway.up.railway.app')
    expect(config.databaseSsl).toBe(true)
    expect(config.plaid).toMatchObject({ env: 'sandbox', countryCodes: ['US'] })
  })

  it('lets an explicit setting decide TLS, and trims a trailing slash from the public URL', () => {
    const config = loadConfig({
      ...base,
      DATABASE_SSL: 'true',
      PUBLIC_URL: 'https://money.example.com//',
      PLAID_CLIENT_ID: 'id',
      PLAID_SECRET: 'secret',
      PLAID_COUNTRY_CODES: 'us, ca',
      PLAID_REDIRECT_URI: 'https://money.example.com/oauth',
    })
    expect(config.databaseSsl).toBe(true)
    expect(config.publicUrl).toBe('https://money.example.com')
    expect(config.plaid).toMatchObject({
      countryCodes: ['US', 'CA'],
      redirectUri: 'https://money.example.com/oauth',
    })
    expect(loadConfig({ ...base, DATABASE_SSL: 'false' }).databaseSsl).toBe(false)
  })

  it('treats a private network database as local', () => {
    const config = loadConfig({ ...base, DATABASE_URL: 'postgres://u:p@db.railway.internal/db' })
    expect(config.databaseSsl).toBe(false)
  })

  it('treats blank settings as unset, as a copied .env.example leaves them', () => {
    const config = loadConfig({
      ...base,
      PUBLIC_URL: '',
      PLAID_CLIENT_ID: '',
      PLAID_SECRET: ' ',
      PLAID_ENV: '',
      SYNC_INTERVAL_MINUTES: '',
    })
    expect(config).toMatchObject({ publicUrl: null, plaid: null, syncIntervalMinutes: 360 })
    expect(() => loadConfig({ ...base, ENCRYPTION_KEY: '' })).toThrow(/ENCRYPTION_KEY/)
  })

  it('explains a bad encryption key', () => {
    expect(() => loadConfig({ ...base, ENCRYPTION_KEY: 'short' })).toThrow(/openssl rand -hex 32/)
  })
})

describe('money', () => {
  it('turns bank decimals into whole cents without float noise', () => {
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(toCents(-2000.55)).toBe(-200055)
    expect(toCentsOrNull(12.34)).toBe(1234)
    expect(toCentsOrNull(null)).toBeNull()
    expect(toCentsOrNull(undefined)).toBeNull()
  })

  it('formats cents for people, dropping cents on whole amounts', () => {
    expect(formatCents(123456)).toBe('$1,234.56')
    expect(formatCents(60000)).toBe('$600')
    expect(formatCents(-1050)).toBe('-$10.50')
    expect(formatCents(99900, 'EUR', 'de-DE')).toBe('999\u00a0€')
  })
})
