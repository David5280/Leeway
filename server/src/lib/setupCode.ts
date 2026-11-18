// The one-time code that proves whoever creates the owner account runs this server.

import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import type { Platform } from '../config.js'

/**
 * Where the code came from: the SETUP_CODE variable, or made up at startup and
 * printed in the log. Only this is ever shown to the browser, never the code.
 */
export type SetupCodeSource = 'variable' | 'log'

/** The code that may create the owner account, and where its owner can find it. */
export interface SetupCode {
  code: string
  from: SetupCodeSource
}

/** The start of the log line that carries the code; the setup screen quotes it. */
export const REMINDER_START = 'No account yet'

/** Letters and digits that cannot be mistaken for each other (no 0/O, 1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const GROUPS = 3
const GROUP_LENGTH = 4

/**
 * A fresh code like "K7QM-2XRA-9PVD": twelve characters from 31, about 59
 * bits, far beyond guessing at a few tries a minute. Leeway prints it in the
 * server log at startup until the owner account exists.
 */
export function generateSetupCode(): string {
  const groups = Array.from({ length: GROUPS }, () =>
    Array.from({ length: GROUP_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''),
  )
  return groups.join('-')
}

/** Spaces, dashes and case do not matter, so a code typed from a log still counts. */
function normalize(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase()
}

/** Whether a typed code is the setup code, compared in constant time. */
export function setupCodeMatches(typed: string, expected: string): boolean {
  // Hashing first gives both sides one length, so the comparison leaks nothing.
  const digest = (code: string) => createHash('sha256').update(normalize(code)).digest()
  return timingSafeEqual(digest(typed), digest(expected))
}

/** Where to find the code, to end a sentence like "Copy it again from ...". */
export function whereSetupCodeIs(from: SetupCodeSource, platform: Platform): string {
  if (from === 'log') return `the newest line in Leeway's log that starts "${REMINDER_START}"`
  if (platform === 'railway') return "SETUP_CODE in your Leeway service's Variables on Railway"
  if (platform === 'docker') return 'SETUP_CODE in your .env file'
  return "SETUP_CODE in Leeway's settings"
}

/**
 * The log line printed at startup until the owner account exists. A code from
 * the log is printed in full, since the log is where its owner looks for it.
 */
export function setupReminder(setup: SetupCode, publicUrl: string | null): string {
  const open = publicUrl ? `Open ${publicUrl}` : 'Open Leeway in your browser'
  if (setup.from === 'variable') {
    return `${REMINDER_START}. ${open} and enter your SETUP_CODE to create your account.`
  }
  return `${REMINDER_START}. ${open} and enter this setup code to create your account: ${setup.code} (a new code is made each time Leeway starts, so use the newest one).`
}
