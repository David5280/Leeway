// Where to find the setup code, in steps that fit where Leeway runs and where
// the code came from. The server only says which case applies, never the code.

import type { ReactNode } from 'react'
import type { Status } from '../../api/client'

type Platform = Status['platform']
type CodeFrom = NonNullable<Status['setupCodeFrom']>

/** The start of the log line that carries the code (REMINDER_START on the server). */
const LOG_LINE = 'No account yet'

const OPEN_RAILWAY = (
  <>
    Open your project at{' '}
    <a href="https://railway.com/dashboard" target="_blank" rel="noreferrer">
      railway.com
    </a>{' '}
    and click the <strong>Leeway</strong> service.
  </>
)

const FIND_LOG_LINE = (
  <>
    Find the line that starts <strong>{LOG_LINE}</strong>. The code is at the end of it.
  </>
)

/** The numbered steps for each case. */
export function codeSteps(platform: Platform, from: CodeFrom): ReactNode[] {
  if (platform === 'railway' && from === 'variable') {
    return [
      OPEN_RAILWAY,
      <>
        Open the <strong>Variables</strong> tab.
      </>,
      <>
        Copy the value of <code>SETUP_CODE</code>.
      </>,
    ]
  }
  if (platform === 'railway') {
    return [OPEN_RAILWAY, 'Click its latest deployment, then open Deploy Logs.', FIND_LOG_LINE]
  }
  if (from === 'variable') {
    return [
      platform === 'docker' ? (
        <>
          Open the <code>.env</code> file in your Leeway folder.
        </>
      ) : (
        "Open the settings Leeway runs with: your .env file or the server's environment."
      ),
      <>
        Copy the value of <code>SETUP_CODE</code>.
      </>,
    ]
  }
  return [
    platform === 'docker' ? (
      <>
        In a terminal, in your Leeway folder, run <code>docker compose logs leeway</code>.
      </>
    ) : (
      'Open the terminal or log where Leeway is running.'
    ),
    FIND_LOG_LINE,
  ]
}

/** The box under the code field that says where to find the code. */
export function WhereIsTheCode({
  id,
  platform,
  from,
}: {
  id: string
  platform: Platform
  from: CodeFrom
}) {
  return (
    <div className="notice stack-sm" id={id}>
      <strong>Where to find it</strong>
      <ol className="how-to">
        {codeSteps(platform, from).map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      {/* A code from the log changes on every restart, which is easy to trip over. */}
      {from === 'log' && (
        <span className="small muted">
          Leeway makes a new code each time it restarts, so use the newest one.
        </span>
      )}
    </div>
  )
}
