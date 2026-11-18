// Reading CSV text into a table of cells, the way banks and budgeting apps
// actually write it: quoted fields with commas, quotes and line breaks inside,
// a byte order mark, Windows or old Mac line endings, semicolon or tab
// separators, summary lines above the real header, and files with no header.
//
// Hand-written rather than a dependency: the format is small, every rule
// here has a test, and an app that holds bank data keeps its supply chain short.

export const DELIMITERS = [',', ';', '\t', '|'] as const
export type Delimiter = (typeof DELIMITERS)[number]

/** A file read into columns and rows; every row has one cell per column. */
export interface CsvTable {
  /** Column names from the header row, or "Column 1", "Column 2" without one. */
  columns: string[]
  rows: string[][]
  hasHeader: boolean
  delimiter: Delimiter
}

const QUOTE = '"'
/** How many lines are enough to tell which separator a file uses. */
const SNIFF_LINES = 10

/** Counts each separator outside quotes on one line. */
function countOutsideQuotes(line: string, delimiter: Delimiter): number {
  let count = 0
  let quoted = false
  for (const char of line) {
    if (char === QUOTE) quoted = !quoted
    else if (char === delimiter && !quoted) count += 1
  }
  return count
}

/**
 * Picks the separator that splits the first lines most evenly: the one whose
 * smallest count across those lines is largest. A semicolon file whose
 * amounts use decimal commas ("12,50") has more semicolons than commas on
 * every line, so it is read by semicolon. A tie goes to the comma.
 */
export function detectDelimiter(text: string): Delimiter {
  const lines = text
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim() !== '')
    .slice(0, SNIFF_LINES)
  if (lines.length === 0) return ','
  let best: Delimiter = ','
  let bestScore = 0
  for (const delimiter of DELIMITERS) {
    const score = Math.min(...lines.map((line) => countOutsideQuotes(line, delimiter)))
    if (score > bestScore) {
      best = delimiter
      bestScore = score
    }
  }
  return best
}

/**
 * Splits CSV text into records of fields (RFC 4180, read leniently). A quote
 * opens a quoted field only at the start of a field; inside one, "" is a
 * literal quote and separators and line breaks are kept. Text after a closing
 * quote is kept too, and an unclosed quote runs to the end of the file, so a
 * slightly broken export still reads. Blank lines are dropped.
 */
export function parseRecords(text: string, delimiter: Delimiter): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  // True once anything (even an empty quoted field) started the current field.
  let started = false

  const endField = () => {
    record.push(field)
    field = ''
    started = false
  }
  const endRecord = () => {
    endField()
    if (record.some((cell) => cell.trim() !== '')) records.push(record)
    record = []
  }

  const body = text.startsWith('\uFEFF') ? text.slice(1) : text
  for (let i = 0; i < body.length; i++) {
    const char = body[i]!
    if (quoted) {
      if (char !== QUOTE) field += char
      else if (body[i + 1] === QUOTE) {
        field += QUOTE
        i += 1
      } else quoted = false
    } else if (char === QUOTE && !started) {
      quoted = true
      started = true
    } else if (char === delimiter) {
      endField()
    } else if (char === '\n' || char === '\r') {
      // \r\n is one line break.
      if (char === '\r' && body[i + 1] === '\n') i += 1
      endRecord()
    } else {
      field += char
      started = true
    }
  }
  if (started || record.length > 0) endRecord()
  return records
}

/** The record length most rows share; summary lines above a table are usually shorter. */
function commonWidth(records: string[][]): number {
  const counts = new Map<number, number>()
  for (const record of records) counts.set(record.length, (counts.get(record.length) ?? 0) + 1)
  let width = 0
  let most = 0
  for (const [length, count] of counts) {
    // Ties go to the wider table, which is the one with the data.
    if (count > most || (count === most && length > width)) {
      width = length
      most = count
    }
  }
  return width
}

/** A cell that looks like a value (a date or an amount) rather than a column name. */
function looksLikeValue(cell: string): boolean {
  return /\d/.test(cell) && /^[\s\d$€£¥.,:/()+-]+$/.test(cell.trim())
}

/**
 * Reads a whole CSV file. The table starts at the first record as wide as
 * most records, which skips account summaries some banks put above it. That
 * record is the header unless it holds values; `hasHeader` overrides the guess.
 */
export function parseCsv(text: string, hasHeader?: boolean): CsvTable {
  const delimiter = detectDelimiter(text)
  const records = parseRecords(text, delimiter)
  const width = commonWidth(records)
  const start = Math.max(
    0,
    records.findIndex((record) => record.length === width),
  )
  const table = records.slice(start)
  const first = table[0] ?? []
  const header = hasHeader ?? !first.some(looksLikeValue)
  const pad = (record: string[]) =>
    Array.from({ length: width }, (_, column) => (record[column] ?? '').trim())
  return {
    columns: header
      ? pad(first).map((name, column) => name || `Column ${column + 1}`)
      : Array.from({ length: width }, (_, column) => `Column ${column + 1}`),
    rows: (header ? table.slice(1) : table).map(pad),
    hasHeader: header,
    delimiter,
  }
}
