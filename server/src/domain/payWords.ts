// Words for a paycheck, as banks write one in a line with no category code.
// Pure, so the web app can import what reads it.

/** "PAYROLL", "DIR DEP", "Direct Deposit", "SALARY", "PAYCHECK", "WAGES". */
export const PAYCHECK_WORDS =
  /\b(payroll|dir\.?\s?dep|direct\s+dep(osit)?|salary|paycheck|wages?)\b/i

/** "PAYMENT THANK YOU" as card issuers write it, "PAYMENT - THANK YOU" too (transfer pairing reads it as well). */
export const PAYMENT_THANK_YOU = String.raw`payment\W*thank you`
