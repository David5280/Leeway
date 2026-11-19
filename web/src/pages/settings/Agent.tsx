// Connecting an AI assistant: the connector address and steps, connected apps and keys.

import { useApp } from '../../lib/app'
import { AgentKeys } from './agent/AgentKeys'
import { ConnectedApps } from './agent/ConnectedApps'
import { ConnectSteps } from './agent/ConnectSteps'
import { SummarySetting } from './agent/SummarySetting'
import { Section } from './Section'

export function AgentSection() {
  const { status } = useApp()
  const address = `${status.publicUrl ?? window.location.origin}/mcp`

  return (
    <Section id="agent" title="AI assistant">
      <ConnectSteps address={address} />
      <ConnectedApps />
      <AgentKeys />
      <SummarySetting />
      <span className="small muted">
        Nothing connected here can ever move money, pay a bill or see your bank sign-in. Once
        connected, ask for a money check-in, or whether you can afford something. Many assistants
        also list Leeway&apos;s ready-made prompts, like reviewing subscriptions or planning debt
        payoff.
      </span>
    </Section>
  )
}
