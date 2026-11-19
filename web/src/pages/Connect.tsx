// The consent screen an assistant like Claude sends the owner to when it asks to connect.
// The owner sees who is asking, picks what it may do, and approves or denies; either
// answer sends the browser back to the app with the result.

import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { call } from '../api/client'
import { useAction } from '../api/hooks'
import { AUTH_LOGO_SIZE, ErrorNote, Loading, Logo, Segmented } from '../components/ui'

type Scope = 'read' | 'write'

const SCOPE_OPTIONS = [
  { value: 'read', label: 'Look only' },
  { value: 'write', label: 'Look and change budgets' },
] as const

/**
 * Sentences for the fixed problem codes the server can send here. Only these codes are
 * shown, so a crafted link cannot put its own words on Leeway's page.
 */
export const PROBLEMS: Record<string, string> = {
  unknown_app:
    "Leeway couldn't tell which app was asking to connect, so nothing was shared. Try connecting again from your assistant.",
  bad_redirect:
    'The app asked to send you somewhere it did not register, so nothing was shared. Try connecting again from your assistant, and check that its connector address ends in /mcp.',
}
const UNKNOWN_PROBLEM = 'Something went wrong while connecting, so nothing was shared.'

/** Sends the browser to the app; a function so tests can watch it. */
export const navigate = { to: (url: string) => window.location.assign(url) }

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth">
      <div className="card stack">
        <div className="brand">
          <Logo size={AUTH_LOGO_SIZE} />
          leeway
        </div>
        {children}
      </div>
    </main>
  )
}

/** /connect?problem=...: a sign-in Leeway refused before asking the owner anything. */
export function ConnectProblem() {
  const [params] = useSearchParams()
  const problem = params.get('problem')
  // Own keys only: names every object has, like "constructor", are not problem codes.
  const sentence = problem && Object.hasOwn(PROBLEMS, problem) ? PROBLEMS[problem] : null
  return (
    <Frame>
      <h1>Couldn't connect</h1>
      <p className="notice error" role="alert">
        {sentence ?? UNKNOWN_PROBLEM}
      </p>
      <Link to="/" className="btn">
        Go to Leeway
      </Link>
    </Frame>
  )
}

/** /connect/:id: approve or deny one waiting sign-in. */
export function Connect() {
  const { id = '' } = useParams()
  // An answered or expired request is gone for good, so there is nothing to retry.
  const request = useAction('get_connect_request', { id }, { retry: false, staleTime: Infinity })
  const [scope, setScope] = useState<Scope | null>(null)
  const answer = useMutation({
    // Unless the owner picked less, they give what the app asked for (the server caps it too).
    mutationFn: (approve: boolean) =>
      call('answer_connect_request', {
        id,
        approve,
        scope: scope ?? request.data?.requestedScope ?? 'read',
      }),
    onSuccess: (result) => navigate.to(result.redirectTo),
  })

  if (answer.isSuccess) {
    return (
      <Frame>
        <Loading label={`Taking you back to ${request.data?.appName ?? 'the app'}`} />
      </Frame>
    )
  }
  if (request.isError) {
    return (
      <Frame>
        <h1>Couldn't connect</h1>
        <ErrorNote error={request.error} />
        <Link to="/" className="btn">
          Go to Leeway
        </Link>
      </Frame>
    )
  }
  if (!request.data) {
    return (
      <Frame>
        <Loading />
      </Frame>
    )
  }

  const app = request.data
  // The owner can give less than the app asked for, never more.
  const chosen = scope ?? app.requestedScope
  return (
    <Frame>
      <h1>Connect {app.appName} to Leeway?</h1>
      <p className="small muted">
        Asked by <b>{app.appHost}</b>. Approving sends you back to {app.redirectsTo}.
      </p>
      {app.local && (
        <p className="notice">
          This gives access to an app on this computer, like Claude Code. Approve only if you just
          started connecting from it.
        </p>
      )}
      {app.requestedScope === 'write' ? (
        <div className="stack-sm">
          <span className="small">What may {app.appName} do?</span>
          <Segmented
            label="What the app may do"
            value={chosen}
            options={SCOPE_OPTIONS}
            onChange={setScope}
          />
        </div>
      ) : (
        <p className="small">{app.appName} asks only to look at your budgets and spending.</p>
      )}
      <p className="small muted">
        {chosen === 'read'
          ? 'It can read your accounts, spending, budgets and goals.'
          : 'It can read everything and change budgets, categories, rules and goals.'}{' '}
        Either way, it can never move money. You can disconnect it any time in Settings, then AI
        assistant.
      </p>
      <ErrorNote error={answer.error} />
      <div className="row wrap">
        <button
          type="button"
          className="btn primary"
          disabled={answer.isPending}
          onClick={() => answer.mutate(true)}
        >
          Approve
        </button>
        <button
          type="button"
          className="btn"
          disabled={answer.isPending}
          onClick={() => answer.mutate(false)}
        >
          Deny
        </button>
      </div>
    </Frame>
  )
}
