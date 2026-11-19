// Reading documents the owner uploads, kept behind an interface like the bank
// provider and the summary writer, so tests use a fake and another provider,
// or a model run on the owner's own machine, can plug in without touching the
// rest of the app.

import type { PaystubFile } from '../domain/paystubs/files.js'
import type { PaystubReading } from '../domain/paystubs/reading.js'

/** Tokens one read used: logged as counts only, never with anything the file said. */
export interface ReaderUsage {
  model: string
  inputTokens: number
  outputTokens: number
}

export interface DocumentReader {
  /** Shown in the app as who read the file, like "Claude". */
  readonly name: string
  /**
   * Reads a paystub's figures in one request, sending the file and nothing
   * else of the owner's, or throws a ReaderError, or an AiLimitError when the
   * monthly AI limit stops it. inputTokens is the count already made, so the
   * file is not counted twice.
   */
  readPaystub(
    file: PaystubFile,
    inputTokens: number,
  ): Promise<{ reading: PaystubReading; usage: ReaderUsage }>
  /**
   * The input tokens readPaystub would send for this file, counted free of
   * charge with the same model, prompt and file, or throws a ReaderError.
   * Lets a file too long to be a paystub be turned away before it costs anything.
   */
  countPaystubTokens(file: PaystubFile): Promise<number>
}

/** A failed read, with a message the owner can act on. */
export class ReaderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReaderError'
  }
}
