// Sends email through Resend's HTTP API. Many hosts, Railway among them,
// block outgoing SMTP, so an HTTPS API is what works everywhere.
// Only used when the owner sets RESEND_API_KEY and MAIL_FROM themselves.

import type { MailConfig } from '../config.js'
import { messageOf } from '../errors.js'
import { MailError, type EmailMessage, type EmailSender } from './sender.js'

export const RESEND_URL = 'https://api.resend.com/emails'
/** A send is a small request; past this the scheduler tries again later. */
const TIMEOUT_MS = 15_000
/** Provider messages are shown in the app, so long ones are cut. */
const MAX_DETAIL_LENGTH = 200

export class ResendSender implements EmailSender {
  readonly name = 'Resend'

  constructor(
    private readonly config: MailConfig,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = TIMEOUT_MS,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    let response: Response
    try {
      response = await this.fetchFn(RESEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.config.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw this.unreachable(error)
    }
    if (!response.ok) throw await this.refused(response)
  }

  private unreachable(error: unknown): MailError {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return new MailError(
        `Resend did not answer within ${this.timeoutMs / 1000} seconds. Leeway will try again.`,
      )
    }
    return new MailError(`Leeway could not reach Resend: ${this.clean(messageOf(error))}`)
  }

  private async refused(response: Response): Promise<MailError> {
    if (response.status === 429) {
      return new MailError('Resend is limiting how fast emails go out. Try again in a minute.')
    }
    if (response.status >= 500) {
      return new MailError(
        `Resend had a problem on its side (${response.status}). Try again later.`,
      )
    }
    // Resend explains a refusal in a JSON body's "message", like an unverified domain.
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null
    const detail = typeof body?.message === 'string' ? `: ${this.clean(body.message)}` : ''
    return new MailError(`Resend refused the email (${response.status})${detail}`)
  }

  /** One short line, with the key blanked out in case a message ever repeats it. */
  private clean(text: string): string {
    return text
      .replaceAll(this.config.apiKey, '[key]')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_DETAIL_LENGTH)
  }
}
