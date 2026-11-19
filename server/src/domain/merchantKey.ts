// A merchant's name reduced to what stays the same between charges, so repeat
// charges group together and a bill's pattern finds the payments. Pure.

/**
 * The merchant name reduced to its words: "NETFLIX.COM 8473 CA" and
 * "Netflix.com 1192 CA" both become "netflix com ca". The bank's merchant
 * name is read where it gave one, else its description. The SQL function
 * merchant_key() (migration 003) does the same for bills that read bank text.
 */
export function merchantKey(tx: { merchantName: string | null; name: string }): string {
  return textKey(tx.merchantName ?? tx.name)
}

/** Any text reduced the same way: lower case, letters only, words split by single spaces. */
export function textKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0-9#*]+/g, ' ')
    .replace(/[^a-z]+/g, ' ')
    .trim()
}
