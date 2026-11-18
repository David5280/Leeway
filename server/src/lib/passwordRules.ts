// What makes a password long enough, free of I/O so the web app checks it the same way.

export const MIN_PASSWORD_LENGTH = 10

/** Why a new password is refused, as a sentence, or null when it is fine. */
export function passwordProblem(password: string): string | null {
  if (password.length >= MIN_PASSWORD_LENGTH) return null
  return `Use a password of at least ${MIN_PASSWORD_LENGTH} characters`
}
