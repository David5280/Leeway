// How to connect Claude, Claude Code or another assistant, step by step.

import { CopyField } from '../../../components/CopyField'

export function ConnectSteps({ address }: { address: string }) {
  // Claude's connectors run on Claude's servers, which can only reach a public https address.
  const reachable = address.startsWith('https://')
  return (
    <div className="stack-sm">
      <span className="small">Your connector address:</span>
      <CopyField value={address} label="Connector address" />
      {!reachable && (
        <p className="notice">
          Claude on the web and on your phone can only reach Leeway at a public https address.
          Deploy Leeway (for example to Railway) or set PUBLIC_URL, then come back here. Claude Code
          on this computer can still connect.
        </p>
      )}

      <h3>Claude on the web, desktop or phone</h3>
      <ol className="how-to">
        <li>
          In Claude, open <b>Customize</b>, then <b>Connectors</b>.
        </li>
        <li>
          Choose <b>Add custom connector</b>, name it Leeway, and paste the address above.
        </li>
        <li>
          Choose <b>Connect</b>. Leeway opens and asks you to approve; pick what Claude may do.
        </li>
        <li>That's it: Leeway is now available in every chat, on every device.</li>
      </ol>

      <h3>Claude Code</h3>
      <ol className="how-to">
        <li>Run this in a terminal:</li>
      </ol>
      <CopyField
        value={`claude mcp add --transport http leeway ${address}`}
        label="Claude Code command"
      />
      <ol className="how-to" start={2}>
        <li>
          In Claude Code, run <code className="num">/mcp</code>, pick leeway and sign in. Approve in
          the Leeway page that opens.
        </li>
      </ol>

      <h3>Other assistants</h3>
      <p className="small muted">
        Any assistant that speaks MCP over HTTP can connect: if it can sign in, give it the address
        above; if it needs a bearer token, make a key below.
      </p>
    </div>
  )
}
