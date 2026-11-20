// A stand-in for push services: records each message and answers as told,
// so no test ever reaches a real push service.

import type { PushMessage, PushOutcome, PushSender, PushTarget } from '../src/push/sender.js'

export class FakePushSender implements PushSender {
  readonly sent: { endpoint: string; message: PushMessage }[] = []
  /** The answer for each endpoint, or an error to throw; 'sent' when not set. */
  readonly answers = new Map<string, PushOutcome | Error>()

  async send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    const outcome = this.answers.get(target.endpoint) ?? 'sent'
    if (outcome instanceof Error) throw outcome
    if (outcome === 'sent') this.sent.push({ endpoint: target.endpoint, message })
    return outcome
  }
}
