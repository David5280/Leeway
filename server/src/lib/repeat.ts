// Background work on a timer, like syncing banks or sending the weekly email.

/**
 * Runs `task` every `intervalMs`, and once right away when `runNow` is set.
 * A run still going when the next is due is not doubled up: that tick is
 * skipped. A failure goes to `onError` and the timer keeps going. The timer
 * does not keep the process alive. Returns a function that stops it.
 */
export function repeatEvery(
  intervalMs: number,
  task: () => Promise<unknown>,
  onError: (error: unknown) => void,
  options: { runNow?: boolean } = {},
): () => void {
  let running = false
  const tick = () => {
    if (running) return
    running = true
    task()
      .catch(onError)
      .finally(() => {
        running = false
      })
  }
  const timer = setInterval(tick, intervalMs)
  timer.unref()
  if (options.runNow) tick()
  return () => clearInterval(timer)
}
