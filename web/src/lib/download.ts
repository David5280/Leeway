// Saving text the app made as a file the browser downloads.

/** How long a file's address stays usable after the click, so every browser has started saving it. */
export const KEEP_URL_MS = 10_000

/**
 * The UTF-8 byte order mark. Excel reads a CSV without one in the system's
 * old code page, which garbles accented names like "Café".
 */
const UTF8_BOM = '\uFEFF'

/** Saves text as a file named `filename`. */
export function downloadText(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // Freeing the address in the same tick can cancel the download in some
  // browsers, so it is freed a little later.
  window.setTimeout(() => URL.revokeObjectURL(url), KEEP_URL_MS)
}

/** Saves CSV text, marked as UTF-8 so spreadsheets show every character as written. */
export function downloadCsv(text: string, filename: string) {
  downloadText(UTF8_BOM + text, filename, 'text/csv')
}
