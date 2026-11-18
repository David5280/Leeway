// Sending email, kept behind an interface like the bank provider and the
// summary writer, so tests use a fake and another provider could be added
// without touching the rest of the app.

/** One email, with an HTML part and a plain text part. */
export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
}

export interface EmailSender {
  /** The provider's name, for messages like "Resend refused the email". */
  name: string
  /** Sends the email, or throws a MailError that says why in plain words. */
  send(message: EmailMessage): Promise<void>
}

/** A failed send, with a message fit to show the owner. Never holds the key. */
export class MailError extends Error {
  override readonly name = 'MailError'
}
