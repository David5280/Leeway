// The owner every browser test signs in as, and where their session is saved.

export const OWNER = {
  name: 'Dana',
  email: 'dana@example.com',
  password: 'correct horse battery',
}

/** Written by setup.spec.ts, read by every other test through playwright.config.ts. */
export const OWNER_STATE = 'e2e/.auth/owner.json'
