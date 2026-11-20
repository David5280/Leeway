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

/**
 * A trigger for `task` that may be pulled many times in a row, like after
 * each bank's sync: the task runs once, `delayMs` after the first pull, for
 * every pull until then. A pull while it runs brings one more run after it,
 * so nothing that changed is missed and two runs never overlap. A failure
 * goes to `onError`. The timer does not keep the process alive.
 */
export function coalesced(
  task: () => Promise<unknown>,
  onError: (error: unknown) => void,
  delayMs: number,
): () => void {
  let timer: NodeJS.Timeout | null = null
  let running = false
  let again = false
  const schedule = () => {
    timer ??= setTimeout(run, delayMs)
    timer.unref()
  }
  const run = () => {
    timer = null
    running = true
    task()
      .catch(onError)
      .finally(() => {
        running = false
        if (again) {
          again = false
          schedule()
        }
      })
  }
  return () => {
    if (running) again = true
    else schedule()
  }
}
