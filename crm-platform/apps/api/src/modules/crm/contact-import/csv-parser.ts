/**
 * A small RFC 4180 CSV reader for the contact import.
 *
 * What WaDesk's `fgetcsv` defaults could not do and this does: a delimiter that is not a comma
 * (semicolon files from European spreadsheets, tab and pipe), a UTF-8 byte-order mark in front of
 * the first header, and quoted cells that hold line breaks. Everything is plain string work so the
 * same text parses the same way in the preview and in the job.
 */
export const DELIMITERS = [',', ';', '\t', '|'] as const;
export type Delimiter = (typeof DELIMITERS)[number];

export interface ParsedCsv {
  delimiter: Delimiter;
  /** Every non-blank record, header first. `line` is where it starts in the file (1-based). */
  records: Array<{ line: number; cells: string[] }>;
}

/** Strip a leading byte-order mark. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * The delimiter is the candidate that appears most often in the first line outside quotes; a
 * tie goes to the comma.
 */
export function detectDelimiter(text: string): Delimiter {
  const counts = new Map<Delimiter, number>(DELIMITERS.map((d) => [d, 0]));
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (ch === '\n' || ch === '\r') break;
      const d = ch as Delimiter;
      if (counts.has(d)) counts.set(d, counts.get(d)! + 1);
    }
  }
  let best: Delimiter = ',';
  let bestCount = counts.get(',')!;
  for (const d of DELIMITERS) {
    if (counts.get(d)! > bestCount) {
      best = d;
      bestCount = counts.get(d)!;
    }
  }
  return best;
}

export function parseCsv(raw: string, forced?: Delimiter): ParsedCsv {
  const text = stripBom(raw);
  const delimiter = forced ?? detectDelimiter(text);
  const records: ParsedCsv['records'] = [];

  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let touched = false; // anything (even an empty quoted cell) seen in this record

  const endCell = () => {
    cells.push(cell);
    cell = '';
  };
  const endRecord = () => {
    endCell();
    // A line with nothing on it is not a record (blank lines, a trailing newline).
    if (touched || cells.some((c) => c.length > 0)) {
      records.push({ line: recordLine, cells });
    }
    cells = [];
    touched = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line += 1;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.length === 0) {
      inQuotes = true;
      touched = true;
    } else if (ch === delimiter) {
      endCell();
      touched = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      endRecord();
      line += 1;
      recordLine = line;
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || cells.length > 0 || touched) endRecord();

  return { delimiter, records };
}
