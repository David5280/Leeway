// The owner every browser test signs in as, and where their session is saved.

export const OWNER = {
  name: 'Dana',
  email: 'dana@example.com',
  password: 'correct horse battery',
}

/** The code the test server takes for creating the owner (SETUP_CODE in playwright.config.ts). */
export const SETUP_CODE = 'E2E-SETUP-CODE-0001'

/** Written by setup.spec.ts, read by every other test through playwright.config.ts. */
export const OWNER_STATE = 'e2e/.auth/owner.json'
