// Counts attempts at something costly or guessable across every address:
// wrong passwords and setup codes, or paystubs sent to be read.

/**
 * A sliding window of recent attempts. Per-address rate limits stop one
 * address from guessing quickly, but an attacker with many addresses gets a
 * fresh limit on each; this caps attempts at the account itself, wherever they
 * come from. It lives in memory: a restart clears it, which an attacker cannot
 * cause, and Leeway runs as one process.
 */
export class AttemptLimiter {
  private attempts: number[] = []

  constructor(
    private readonly options: {
      /** Attempts allowed inside the window before more are refused. */
      maxAttempts: number
      windowMs: number
      now?: () => number
    },
  ) {}

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  /** Milliseconds until another attempt is allowed: 0 when one is allowed now. */
  waitMs(): number {
    const now = this.now()
    this.attempts = this.attempts.filter((at) => now - at < this.options.windowMs)
    if (this.attempts.length < this.options.maxAttempts) return 0
    // The oldest attempt in the window is the next to fall out of it.
    return this.attempts[0]! + this.options.windowMs - now
  }

  /** Counts one attempt: a wrong guess, or one paid request. */
  record(): void {
    this.attempts.push(this.now())
  }
}
