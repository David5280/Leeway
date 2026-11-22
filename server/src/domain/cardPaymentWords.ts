// Whether a bank's words say a payment out of checking pays a credit card,
// for a line with no card payment code. Pure.
//
// Clear card words count anywhere. Payment words any biller uses ("T-MOBILE
// PMT", "XCEL ENERGY EPAYMENT", a bare "PAYMENT") count only right beside a
// card issuer's name, so "CITI AUTOPAY EPAYMENT" pays a card and "CHASE PLACE
// APTS EPAYMENT" pays rent.

/** Clear words for a credit card payment, wherever they sit. */
const CARD_PAYMENT_WORDS =
  /\b(credit\s+(card|crd)|crd\s+(pmt|payment|autopay|epay)|card\s+(payment|pmt))\b/i

/**
 * Card issuers as banks write them. Wells Fargo and Bank of America lend in
 * other ways too, so they count only with a card word: "WELLS FARGO CARD".
 */
const ISSUER = [
  String.raw`chase|amex|american\s+express|citi(card)?|capital\s+one|discover`,
  String.raw`barclay(s|card)?|synchrony(\s+bank)?|syncb|apple\s?card(\s+gs\s?bank)?`,
  String.raw`wells\s+fargo\s+card|(bk|bank)\s+of\s+amer(ica)?\s+(visa|card)`,
].join('|')

/** Payment words, from the plain ("PAYMENT", "PMT") to the coded ("CRCARDPMT"). */
const PAYMENT = String.raw`e-?pay(ment)?|(ach|mobile|online)\s+(payment|pmt|pymt)|crcardpmt|cc\s?pymt|payment|pymt|pmt`

/**
 * Card words that may sit between an issuer and its payment words, and Bank
 * of America's "DES:" label: "CITI CARD ONLINE PAYMENT", "AMEX DES:ACH PMT".
 * "AUTO PAY" here can't tell Capital One's card autopay from its auto loan's,
 * so both read as a card; an auto loan pairs only with an equal credit on a
 * hidden card.
 */
const FILLER = String.raw`(\s+(cards?|cc|credit|crd|us|auto\W?pay|online)|\s+des:)*`

/** What may follow an issuer named after the payment words: nothing, card words or an id. */
const ISSUER_END = String.raw`(?=(\s+(cards?|cc|credit|crd))*(\s*$|\s*[:#]?\s*x*\d|\s+(id|indn)\b))`

/** Issuer then payment words ("DISCOVER DES:E-PAYMENT"), or payment words then issuer ("ACH PMT TO AMEX"). */
const ISSUER_PAYMENT = new RegExp(
  String.raw`\b((${ISSUER})${FILLER}(\s+|(?<=:))(${PAYMENT})|(${PAYMENT})\s+(to\s+)?(${ISSUER})${ISSUER_END})\b`,
  'i',
)

/** An issuer's other debts, paid with the same words: "CHASE MORTGAGE ACH PMT", but not "AUTO PAY". */
const LOAN_WORDS = /\b(mortgage|loan|auto(?!\W*pay)|student|home\s+equity|heloc|lease|personal)\b/i

/**
 * Whether a line's words say it pays a credit card. The description and the
 * merchant name are each read on their own for an issuer's payment words, so
 * one can't end the other's issuer: "Synchrony Bank" as the merchant of
 * "SYNCHRONY EPAYMENT".
 */
export function saysCardPayment(name: string, merchantName: string | null): boolean {
  const words = `${name} ${merchantName ?? ''}`
  if (CARD_PAYMENT_WORDS.test(words)) return true
  const byIssuer = [name, merchantName ?? ''].some((text) => ISSUER_PAYMENT.test(text))
  return byIssuer && !LOAN_WORDS.test(words)
}
