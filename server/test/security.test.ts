import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'
import { decrypt, encrypt, hashToken, randomToken } from '../src/lib/crypto.js'
import { formatCents, formatWholeCents, toCents, toCentsOrNull } from '../src/lib/money.js'
import { hashPassword, needsRehash, verifyPassword } from '../src/lib/password.js'
import {
  generateSetupCode,
  setupCodeMatches,
  setupReminder,
  whereSetupCodeIs,
} from '../src/lib/setupCode.js'

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

  it("hashes with at least OWASP's scrypt cost, and asks to redo hashes made with less", async () => {
    const stored = await hashPassword('correct horse battery')
    expect(stored).toMatch(/^scrypt:32768:8:3:/)
    expect(needsRehash(stored)).toBe(false)
    expect(needsRehash('scrypt:32768:8:1:salt:hash')).toBe(true)
    expect(needsRehash('scrypt:16384:8:3:salt:hash')).toBe(true)
    expect(needsRehash('scrypt:32768:4:3:salt:hash')).toBe(true)
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

  it('turns the Claude summary writer on with a key, on the default model unless one is named', () => {
    expect(loadConfig(base).anthropic).toBeNull()
    // The small model is the default on purpose: it keeps the summary to cents a month.
    expect(loadConfig({ ...base, ANTHROPIC_API_KEY: 'key' }).anthropic).toEqual({
      apiKey: 'key',
      model: 'claude-haiku-5-5',
    })
    const named = loadConfig({
      ...base,
      ANTHROPIC_API_KEY: 'key',
      SUMMARY_MODEL: 'claude-sonnet-5-5',
    })
    expect(named.anthropic?.model).toBe('claude-sonnet-5-5')
  })

  it('turns email on only once both the Resend key and a sender are set', () => {
    expect(loadConfig(base).mail).toBeNull()
    expect(loadConfig({ ...base, RESEND_API_KEY: 're_key' }).mail).toBeNull()
    expect(loadConfig({ ...base, MAIL_FROM: 'leeway@example.com' }).mail).toBeNull()
    expect(
      loadConfig({ ...base, RESEND_API_KEY: 're_key', MAIL_FROM: 'Leeway <leeway@example.com>' })
        .mail,
    ).toEqual({ apiKey: 're_key', from: 'Leeway <leeway@example.com>' })
  })

  it('refuses a sender that is not one plain address', () => {
    for (const from of [
      'leeway',
      'Leeway leeway@example.com',
      'Leeway <leeway@example.com>\r\nBcc: someone@example.com',
      '"Leeway" <leeway@example.com>',
    ]) {
      expect(() => loadConfig({ ...base, MAIL_FROM: from })).toThrow(/MAIL_FROM must be/)
    }
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

  it('rounds to whole units for a summary', () => {
    expect(formatWholeCents(8470)).toBe('$85')
    expect(formatWholeCents(-1_620_596)).toBe('-$16,206')
    expect(formatWholeCents(149, 'EUR', 'de-DE')).toBe('1\u00a0€')
  })
})

describe('setup codes', () => {
  it('makes readable, unambiguous codes that differ every time', () => {
    const code = generateSetupCode()
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/)
    expect(generateSetupCode()).not.toBe(code)
  })

  it('matches ignoring case, spaces and dashes, and nothing else', () => {
    expect(setupCodeMatches('k7qm 2xra 9pvd', 'K7QM-2XRA-9PVD')).toBe(true)
    expect(setupCodeMatches('K7QM-2XRA-9PVE', 'K7QM-2XRA-9PVD')).toBe(false)
    expect(setupCodeMatches('', 'K7QM-2XRA-9PVD')).toBe(false)
  })

  it('only takes a configured code long enough to resist guessing', () => {
    const base = { DATABASE_URL: 'postgres://u:p@localhost/db', ENCRYPTION_KEY: 'ab'.repeat(32) }
    expect(loadConfig(base).setupCode).toBeNull()
    expect(loadConfig({ ...base, SETUP_CODE: 'ABCD-EFGH-JKLM' }).setupCode).toBe('ABCD-EFGH-JKLM')
    expect(() => loadConfig({ ...base, SETUP_CODE: 'ABCD-EFGH-JK' })).toThrow(/SETUP_CODE/)
  })

  it('says where the code is, for a code from the log or from SETUP_CODE on each platform', () => {
    expect(whereSetupCodeIs('log', 'railway')).toBe(
      'the newest line in Leeway\'s log that starts "No account yet"',
    )
    expect(whereSetupCodeIs('variable', 'railway')).toBe(
      "SETUP_CODE in your Leeway service's Variables on Railway",
    )
    expect(whereSetupCodeIs('variable', 'docker')).toBe('SETUP_CODE in your .env file')
    expect(whereSetupCodeIs('variable', 'other')).toBe("SETUP_CODE in Leeway's settings")
  })

  it('prints a code from the log in full at startup, and only names one from SETUP_CODE', () => {
    expect(
      setupReminder({ code: 'K7QM-2XRA-9PVD', from: 'log' }, 'https://money.example.com'),
    ).toBe(
      'No account yet. Open https://money.example.com and enter this setup code to create your account: K7QM-2XRA-9PVD (a new code is made each time Leeway starts, so use the newest one).',
    )
    const configured = setupReminder({ code: 'SECRET-CODE-1234', from: 'variable' }, null)
    expect(configured).toBe(
      'No account yet. Open Leeway in your browser and enter your SETUP_CODE to create your account.',
    )
    expect(configured).not.toContain('SECRET')
  })
})
