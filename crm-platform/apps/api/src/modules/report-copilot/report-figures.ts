/**
 * Deterministic figures out of a document's stored text, so the numbers in a report are read by code and not recalled by a model.
 *
 * It finds two things, and nothing else: TABLES (CSV, TSV, semicolon-separated, Markdown or pipe tables, as consecutive lines with the same
 * number of cells) and `label: number` LINES outside any table. Every number keeps the exact text it had in the document (`text`) next to
 * the value read from it (`value`), its unit when it carries one, and the line it came from. Nothing is converted, scaled or rounded:
 * `1.2M` is value 1.2 with unit `M`, and a cell that could be read two ways (`1,5`) has no value rather than a guess.
 *
 * Not handled, and said so in the tool's own description: numbers written in sentences, tables split across blank lines, quoted fields
 * that span lines, and spreadsheets (the extractor does not read XLSX). For those the model reads the text with `read_document`.
 */

export const FIGURE_LIMITS = {
  tables: 12,
  rowsPerTable: 200,
  columns: 30,
  pairs: 150,
  cellChars: 120,
  /** Characters of cell text in one answer; past it rows are dropped and the table says so. */
  budgetChars: 60_000,
} as const;

export interface ParsedNumber {
  value: number;
  unit?: string;
}

const CURRENCY = '[$€£₹¥]';
const NUM = '(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?|\\.\\d+)';
const NUMBER_RE = new RegExp(
  `^(?<open>\\()?(?:(?<neg1>[-−])\\s*)?(?:(?<code>[A-Z]{3})\\s+)?(?<cur>${CURRENCY})?\\s*(?:(?<neg2>[-−])\\s*)?(?<num>${NUM})\\s*(?<suf>%|[A-Za-z]{1,12})?(?<close>\\))?$`,
);

/**
 * Reads one number from a cell or a line value, or null when the text is not a number we can read without guessing. The unit is the
 * currency symbol or code, the percent sign, or a short word after the number (`USD`, `messages`, `M`); a sign in front or a pair of
 * brackets makes it negative. A comma used as a decimal mark (`12,5`) is not read.
 */
export function parseNumber(raw: string): ParsedNumber | null {
  const text = raw
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
  if (text === '' || text.length > 40) return null;
  const m = NUMBER_RE.exec(text);
  const g = m?.groups;
  if (!g) return null;
  if ((g.open && !g.close) || (!g.open && g.close)) return null;
  if (g.neg1 && g.neg2) return null;
  const value = Number((g.num as string).replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  const negative = !!g.neg1 || !!g.neg2 || !!g.open;
  const unit = [g.code, g.cur, g.suf].filter(Boolean).join(' ') || undefined;
  return { value: negative ? -value : value, ...(unit ? { unit } : {}) };
}

// --- splitting lines into cells ---------------------------------------------------------------------------------------------------------

type Delimiter = 'tab' | 'pipe' | 'semicolon' | 'comma';
const DELIMITERS: Delimiter[] = ['tab', 'pipe', 'semicolon', 'comma'];
const CHAR: Record<Delimiter, string> = { tab: '\t', pipe: '|', semicolon: ';', comma: ',' };

/** Quote-aware split of one line (`"a, b",c` is two cells). A pipe table's outer bars are dropped. */
export function splitLine(line: string, delimiter: Delimiter): string[] {
  const d = CHAR[delimiter];
  const cells: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"' && cur.trim() === '' && delimiter !== 'pipe') {
      quoted = true;
      cur = '';
    } else if (c === d) {
      cells.push(cur);
      cur = '';
    } else cur += c;
  }
  cells.push(cur);
  if (delimiter === 'pipe') {
    if (cells.length > 1 && cells[0]!.trim() === '') cells.shift();
    if (cells.length > 1 && cells[cells.length - 1]!.trim() === '') cells.pop();
  }
  return cells.map((c) => c.trim());
}

const isSeparatorRow = (cells: string[]): boolean =>
  cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));

// --- output shapes --------------------------------------------------------------------------------------------------------------------------

export type FigureCell = string | { text: string; value: number; unit?: string };

export interface FigureColumn {
  name: string;
  type: 'number' | 'text';
  /** The unit every number in the column carries; absent when they differ or there is none (each cell then names its own). */
  unit?: string;
  /** Sum of the numbers listed in the column (count of them in `numbers`); absent when the units differ. Includes any total row. */
  sum?: number;
  numbers?: number;
}

export interface FigureRow {
  /** Line in the stored text (1-based) the row was read from. */
  line: number;
  cells: FigureCell[];
}

export interface FigureTable {
  table: number;
  delimiter: Delimiter;
  /** Line and character offset of the header row in the stored text: `read_document` with this offset shows the source. */
  startLine: number;
  startOffset: number;
  columns: FigureColumn[];
  rows: FigureRow[];
  totalRows: number;
  rowsCut: boolean;
}

export interface FigureLine {
  line: number;
  offset: number;
  label: string;
  text: string;
  value: number;
  unit?: string;
}

export interface Figures {
  tables: FigureTable[];
  lines: FigureLine[];
  tablesFound: number;
  linesFound: number;
  /** Something was left out to keep the answer small: more tables, rows, columns or lines than the limits. */
  cut: boolean;
}

const clip = (s: string): string =>
  s.length > FIGURE_LIMITS.cellChars ? `${s.slice(0, FIGURE_LIMITS.cellChars - 1)}…` : s;

/** A label from the document, made safe to repeat to a model: markup characters and control characters out, one line, clipped. */
const clean = (s: string): string =>
  clip(
    Array.from(s)
      .filter((c) => c >= ' ' && c !== '\u007f' && c !== '<' && c !== '>')
      .join('')
      .replace(/\s+/g, ' ')
      .trim(),
  );

// --- tables ---------------------------------------------------------------------------------------------------------------------------------

interface Block {
  delimiter: Delimiter;
  /** Index into `lines` of the header row. */
  start: number;
  /** Rows as split cells, with the line index each came from (separator rows already removed). */
  rows: Array<{ at: number; cells: string[] }>;
  end: number;
}

function findBlock(lines: string[], start: number, delimiter: Delimiter): Block | null {
  const first = lines[start]!;
  if (!first.includes(CHAR[delimiter])) return null;
  const head = splitLine(first, delimiter);
  const width = head.length;
  if (width < 2 || width > FIGURE_LIMITS.columns) return null;
  const rows = [{ at: start, cells: head }];
  let end = start;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') break;
    const cells = splitLine(line, delimiter);
    if (cells.length !== width) break;
    end = i;
    if (!isSeparatorRow(cells)) rows.push({ at: i, cells });
  }
  return rows.length >= 2 ? { delimiter, start, rows, end } : null;
}

const numericShare = (cells: string[]): number => {
  const filled = cells.filter((c) => c !== '');
  if (filled.length === 0) return 0;
  return filled.filter((c) => parseNumber(c) !== null).length / filled.length;
};

function buildTable(
  block: Block,
  offsets: number[],
  table: number,
  budget: { left: number },
): FigureTable | null {
  const width = block.rows[0]!.cells.length;
  // A first row that is mostly numbers is data, not a header (a table pasted without its header line).
  const headerIsData = numericShare(block.rows[0]!.cells) >= 0.5;
  const header = headerIsData
    ? Array.from({ length: width }, (_, i) => `column ${i + 1}`)
    : block.rows[0]!.cells.map((c, i) => clean(c) || `column ${i + 1}`);
  const data = headerIsData ? block.rows : block.rows.slice(1);
  if (data.length === 0) return null;

  const columns: FigureColumn[] = header.map((name, ci) => {
    const col = data.map((r) => r.cells[ci]!);
    const isNumber = numericShare(col) >= 0.8;
    if (!isNumber) return { name, type: 'text' };
    const parsed = col.map((c) => parseNumber(c)).filter((p): p is ParsedNumber => p !== null);
    const units = new Set(parsed.map((p) => p.unit ?? ''));
    const unit = units.size === 1 ? [...units][0] : undefined;
    const sum =
      units.size === 1 ? Number(parsed.reduce((a, p) => a + p.value, 0).toFixed(8)) : undefined;
    return {
      name,
      type: 'number',
      ...(unit ? { unit } : {}),
      ...(sum !== undefined ? { sum } : {}),
      numbers: parsed.length,
    };
  });
  if (!columns.some((c) => c.type === 'number')) return null;

  const rows: FigureRow[] = [];
  let cut = false;
  for (const r of data) {
    const cells: FigureCell[] = r.cells.map((raw, ci) => {
      const text = clip(raw);
      if (columns[ci]!.type !== 'number') return text;
      const p = parseNumber(raw);
      if (!p) return text;
      return columns[ci]!.unit !== undefined || p.unit === undefined
        ? { text, value: p.value }
        : { text, value: p.value, unit: p.unit };
    });
    const size = cells.reduce<number>(
      (a, c) => a + (typeof c === 'string' ? c.length : c.text.length + 8),
      0,
    );
    if (rows.length >= FIGURE_LIMITS.rowsPerTable || budget.left - size < 0) {
      cut = true;
      break;
    }
    budget.left -= size;
    rows.push({ line: r.at + 1, cells });
  }
  return {
    table,
    delimiter: block.delimiter,
    startLine: block.start + 1,
    startOffset: offsets[block.start]!,
    columns,
    rows,
    totalRows: data.length,
    rowsCut: cut,
  };
}

// --- label: number lines --------------------------------------------------------------------------------------------------------------------

const PAIR_RE = /^\s*(?:[-*•>]\s+|\d{1,3}[.)]\s+)?([^:=\n]{1,80}?)\s*[:=]\s*(\S.*?)\s*$/;

function readPair(raw: string, line: number, offset: number): FigureLine | null {
  const m = PAIR_RE.exec(raw.replace(/\*\*|__/g, ''));
  if (!m) return null;
  const label = clean(m[1]!);
  const text = m[2]!.trim();
  const p = parseNumber(text);
  if (!p || label === '') return null;
  return {
    line,
    offset,
    label,
    text: clip(text),
    value: p.value,
    ...(p.unit ? { unit: p.unit } : {}),
  };
}

// --- all of it ------------------------------------------------------------------------------------------------------------------------------

/** Finds the tables and the `label: number` lines of a stored text. Pure and deterministic; the same text gives the same answer. */
export function extractFigures(text: string): Figures {
  const lines = text.split('\n');
  const offsets: number[] = [];
  let at = 0;
  for (const l of lines) {
    offsets.push(at);
    at += l.length + 1;
  }

  const tables: FigureTable[] = [];
  const consumed = new Set<number>();
  const budget = { left: FIGURE_LIMITS.budgetChars };
  let tablesFound = 0;
  let cut = false;

  for (let i = 0; i < lines.length; i++) {
    if (consumed.has(i) || lines[i]!.trim() === '') continue;
    for (const d of DELIMITERS) {
      const block = findBlock(lines, i, d);
      if (!block) continue;
      // The numeric test needs the header split off, so build the table to decide; a prose block yields null.
      const built = buildTable(block, offsets, tablesFound + 1, { left: Infinity });
      if (!built) continue;
      tablesFound++;
      for (let k = block.start; k <= block.end; k++) consumed.add(k);
      if (tables.length >= FIGURE_LIMITS.tables) {
        cut = true;
      } else {
        const sized = buildTable(block, offsets, tablesFound, budget)!;
        if (sized.rowsCut) cut = true;
        tables.push(sized);
      }
      break;
    }
  }

  const found: FigureLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (consumed.has(i)) continue;
    const p = readPair(lines[i]!, i + 1, offsets[i]!);
    if (p) found.push(p);
  }
  if (found.length > FIGURE_LIMITS.pairs) cut = true;

  return {
    tables,
    lines: found.slice(0, FIGURE_LIMITS.pairs),
    tablesFound,
    linesFound: found.length,
    cut,
  };
}
