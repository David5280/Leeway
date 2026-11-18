// Plain-words help for bank sync: what Plaid is, where its keys come from,
// where they go, and what it takes to reach real banks. Shared by setup and
// Customize. Plaid's terms (Sandbox, Trial plan, Production) follow its own
// docs, so what someone reads here matches what they see in Plaid's dashboard.

import type { Status } from '../api/client'

type Platform = Status['platform']

/** Plaid's page with the client ID and secrets. */
const KEYS_PAGE = 'https://dashboard.plaid.com/developers/keys'

/** The one sentence on what Plaid is, for someone who has never heard of it. */
export const WHAT_IS_PLAID =
  'Plaid is the service many budgeting apps use to connect to banks. Leeway uses it only to read balances and transactions; nothing can move money.'

/** Where the keys go on each platform. They are settings for the server, never typed into a page. */
function whereKeysGo(platform: Platform) {
  const names = (
    <>
      <code>PLAID_CLIENT_ID</code> and <code>PLAID_SECRET</code>
    </>
  )
  if (platform === 'railway') {
    return (
      <>
        In Railway, open the Leeway service&apos;s <strong>Variables</strong>, set {names}, and
        deploy the change.
      </>
    )
  }
  if (platform === 'docker') {
    return (
      <>
        Put them in your <code>.env</code> file as {names}, then run{' '}
        <code>docker compose up -d</code>.
      </>
    )
  }
  return <>Set {names} where Leeway reads its settings, then restart Leeway.</>
}

/** Numbered steps from no Plaid account to bank sync turned on. */
export function PlaidKeySteps({ platform }: { platform: Platform }) {
  return (
    <ol className="how-to">
      <li>
        Make a free account at{' '}
        <a href="https://dashboard.plaid.com" target="_blank" rel="noreferrer">
          dashboard.plaid.com
        </a>
        .
      </li>
      <li>
        Open{' '}
        <a href={KEYS_PAGE} target="_blank" rel="noreferrer">
          Developers, then Keys
        </a>
        , and copy your <strong>client_id</strong> and your <strong>Sandbox</strong> secret.
      </li>
      <li>{whereKeysGo(platform)} They are server settings, so this page never asks for them.</li>
      <li>
        Reload Leeway, then connect a bank in <strong>Customize</strong>, under{' '}
        <strong>Banks</strong>.
      </li>
    </ol>
  )
}

/** Why Sandbox shows only test banks, and what Plaid asks before real ones. */
export function RealBanks() {
  return (
    <div className="stack-sm small">
      <strong>Test banks or your real bank?</strong>
      <span>
        Sandbox keys work right away but show only Plaid&apos;s pretend banks. To try one, sign in
        with <code>user_good</code> and <code>pass_good</code>. Your real bank needs Production
        access from Plaid:
      </span>
      <ul className="how-to">
        <li>
          <strong>In the US and Canada</strong>, a new Plaid account can use the free Trial plan,
          for up to 10 bank logins. Plaid approves most right after an identity check, and answers
          the rest by email within 2 to 3 business days.
        </li>
        <li>
          <strong>Elsewhere, or for more banks</strong>, choose Get production access in the Plaid
          dashboard. Plaid says approval takes a couple of business days.
        </li>
      </ul>
      <span>
        Once approved, set <code>PLAID_ENV</code> to <code>production</code> and{' '}
        <code>PLAID_SECRET</code> to your Production secret, the same way as the keys.
      </span>
    </div>
  )
}

/** Shown when the server has no Plaid keys: what bank sync needs, and that it can wait. */
export function BankKeysMissing({ platform }: { platform: Platform }) {
  return (
    <div className="notice stack-sm">
      <strong>Bank sync is off on this Leeway.</strong>
      <span>You can turn it on any time, and use Leeway without it meanwhile. {WHAT_IS_PLAID}</span>
      <details className="more">
        <summary>How to turn on bank sync</summary>
        <div className="stack-sm">
          <PlaidKeySteps platform={platform} />
          <RealBanks />
        </div>
      </details>
    </div>
  )
}

/** Shown beside the Connect button while Plaid is in Sandbox, so test banks are no surprise. */
export function SandboxNote() {
  return (
    <div className="notice stack-sm">
      <strong>Plaid is in Sandbox, so it lists only test banks.</strong>
      <details className="more">
        <summary>How to connect your real bank</summary>
        <RealBanks />
      </details>
    </div>
  )
}
