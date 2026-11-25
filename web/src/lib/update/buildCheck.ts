// Notices a deploy while the app stays open. An installed app resumed from the
// background never reloads by itself, so it would keep running the build it
// started with. This reads the server's build id at load, again whenever the
// page is shown (at most once every few minutes), and reloads once when it
// changed. A reload never interrupts the owner: while they are busy
// (pageBusy.ts) it waits for the next moment the page is shown or changes screen.

/** The least time between two asks, so flipping between apps costs nothing. */
export const CHECK_GAP_MS = 5 * 60_000

export interface BuildCheckDeps {
  /** The server's build id; null when it gives none (no built app) or cannot be reached. */
  fetchBuild: () => Promise<string | null>
  /** Whether a reload now would lose something the owner is doing. */
  isBusy: () => boolean
  reload: () => void
  now: () => number
}

export interface BuildCheck {
  /** At load: remembers the build this page started with. */
  start: () => Promise<void>
  /** The page is shown again: asks for the build, or reloads if a newer one waits. */
  shown: () => Promise<void>
  /** The owner changed screen: a quiet moment for a reload that was put off. */
  navigated: () => void
}

export function createBuildCheck(deps: BuildCheckDeps): BuildCheck {
  let started: string | null = null
  let lastAsked = Number.NEGATIVE_INFINITY
  let newerWaiting = false
  let reloaded = false

  /** Reads the build id, noting when, and treating any failure as unknown. */
  async function ask(): Promise<string | null> {
    lastAsked = deps.now()
    return deps.fetchBuild().catch(() => null)
  }

  /** Reloads once a newer build waits and the owner is not in the middle of something. */
  function reloadIfQuiet(): void {
    if (!newerWaiting || reloaded || deps.isBusy()) return
    reloaded = true
    deps.reload()
  }

  return {
    async start() {
      started = await ask()
    },

    async shown() {
      if (newerWaiting) return reloadIfQuiet()
      if (deps.now() - lastAsked < CHECK_GAP_MS) return
      const build = await ask()
      if (build === null) return
      // The first ask failed (offline at load): this build is the one to compare with.
      if (started === null) {
        started = build
        return
      }
      if (build === started) return
      newerWaiting = true
      reloadIfQuiet()
    },

    navigated: reloadIfQuiet,
  }
}
