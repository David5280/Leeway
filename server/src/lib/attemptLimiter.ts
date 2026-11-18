// Counts failed attempts at a secret (a password, a setup code) across every address.

/**
 * A sliding window of recent failures. Per-address rate limits stop one
 * address from guessing quickly, but an attacker with many addresses gets a
 * fresh limit on each; this caps guesses at the account itself, wherever they
 * come from. It lives in memory: a restart clears it, which an attacker cannot
 * cause, and Leeway runs as one process.
 */
export class AttemptLimiter {
  private failures: number[] = []

  constructor(
    private readonly options: {
      /** Failures allowed inside the window before attempts are refused. */
      maxFailures: number
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
    this.failures = this.failures.filter((at) => now - at < this.options.windowMs)
    if (this.failures.length < this.options.maxFailures) return 0
    // The oldest failure in the window is the next to fall out of it.
    return this.failures[0]! + this.options.windowMs - now
  }

  recordFailure(): void {
    this.failures.push(this.now())
  }
}
