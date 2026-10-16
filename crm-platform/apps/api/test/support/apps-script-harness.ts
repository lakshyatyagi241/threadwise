/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * An emulator of the Google Apps Script runtime, good enough to run the add-on's `Code.gs` UNCHANGED, with its dialogs, without Google.
 *
 * It exists because the add-on has never run in a real Google Sheet and we have no Google credentials. What it gives us: the add-on's
 * own source is loaded in a `node:vm` context that has ONLY the globals Apps Script gives a script (no `process`, `require`, `fetch`,
 * `setTimeout`, `URL`), and every Google service the source touches is a mock written from Google's documented behaviour, including the
 * documented limits and the documented ways each call fails. When Code.gs calls something this file does not model, the call throws a
 * TypeError ("x is not a function") instead of silently passing, so new API use is a conscious decision here.
 *
 * What it does NOT prove is listed in docs/runbooks/google-sheets-addon-real-sheet-test.md: Google's real runtime, the authorization
 * flow and consent screen, trigger delivery timing, real quota enforcement, and the real execution limit are not exercised.
 *
 * Use it directly (synchronous, in the test's thread) with a fake server as `fetch`, or through `apps-script-remote.ts`, which runs the
 * same harness in a worker thread so `UrlFetchApp.fetch` can reach a real HTTP server living in the test's own thread.
 *
 * This file imports only Node built-ins on purpose: the remote runner transpiles it and loads it inside a worker.
 */
import * as crypto from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as vm from 'node:vm';

// --- public types ------------------------------------------------------------------------------------------------------------------

export interface HarnessRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** The payload as text (Code.gs sends JSON text). */
  body: string | undefined;
  contentType: string | undefined;
  muteHttpExceptions: boolean;
  followRedirects: boolean;
}

export interface HarnessResponse {
  status: number;
  body?: string;
  /** A header name with one value, or with several (repeated headers). */
  headers?: Record<string, string | string[]>;
  /** Virtual milliseconds the server took (counts against the execution limit). */
  delayMs?: number;
}

/** A synchronous stand-in for the network: what Apps Script's `UrlFetchApp.fetch` talks to. Throw `NetworkFailure` for a DNS or socket error. */
export type FetchHandler = (request: HarnessRequest) => HarnessResponse;

/** What a fetch handler throws to simulate a failure that never produces a response (DNS, refused connection, TLS, timeout). */
export class NetworkFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkFailure';
  }
}

export type ExecKind = 'menu' | 'client' | 'simple' | 'edit' | 'timer' | 'direct';
export type AuthModeName = 'FULL' | 'LIMITED' | 'NONE';

export interface ExecutionRecord {
  fn: string;
  kind: ExecKind;
  ok: boolean;
  error: string | null;
  killed: boolean;
  /** Virtual milliseconds from start to finish. */
  elapsedMs: number;
  /** The scopes this execution actually used (a scope is "used" the first time a service that needs it is called). */
  scopesUsed: string[];
}

export interface RunResult<T = unknown> {
  ok: boolean;
  value: T | undefined;
  error: string | null;
  killed: boolean;
  elapsedMs: number;
}

export interface HarnessFetchRecord {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  status: number | null;
  failed: string | null;
}
export interface MenuItemRecord {
  caption: string | null;
  fn: string | null;
  separator?: true;
  submenu?: MenuRecord;
}
export interface MenuRecord {
  title: string;
  /** `addon` for createAddonMenu(), `custom` for createMenu(). */
  kind: 'addon' | 'custom';
  items: MenuItemRecord[];
}
export interface DialogRecord {
  kind: 'modal' | 'modeless' | 'sidebar';
  title: string;
  width: number | null;
  height: number | null;
  html: string;
}
export interface AlertRecord {
  title: string;
  message: string;
  buttons: string;
  kind: 'alert' | 'prompt';
}

export interface HarnessLimits {
  /** Execution limit of a normal script (Google: 6 minutes). */
  executionMs: number;
  /** Execution limit of a simple trigger such as onOpen (Google: 30 seconds). */
  simpleTriggerMs: number;
  /** One property value (Google: 9 KB). */
  propertyValueBytes: number;
  /** One property store (Google: 500 KB). */
  propertiesTotalBytes: number;
  /** Installable triggers per user per script (Google: 20). */
  triggersPerUser: number;
  /** UrlFetchApp calls per day (Google: 20,000 consumer / 100,000 Workspace). */
  urlFetchCallsPerDay: number;
  /** Payload of one request (Google: 50 MB). */
  fetchPayloadBytes: number;
  /** One cell (Google: 50,000 characters). */
  cellChars: number;
  /** Cells in a spreadsheet (Google: 10,000,000). */
  workbookCells: number;
}

export interface HarnessLatency {
  /** Virtual cost of one spreadsheet call. */
  sheetCallMs: number;
  /** Extra virtual cost per cell read or written. */
  perCellMs: number;
  /** Virtual cost of one UrlFetchApp call (plus the handler's own delay). */
  fetchMs: number;
  uiMs: number;
}

export interface HarnessOptions {
  /** The folder with Code.gs, the .html files and appsscript.json. */
  assetsDir?: string;
  /** `bound`: the script is bound to one spreadsheet (the way a downloaded copy is used). `addon`: an editor add-on shared by every sheet of the user. */
  mode?: 'bound' | 'addon';
  /** The network. Without one every fetch fails like a DNS error. */
  fetch?: FetchHandler;
  /** `unavailable` makes `createAddonMenu()` throw, as it does outside an installed add-on. */
  addonMenu?: 'available' | 'unavailable';
  userEmail?: string;
  limits?: Partial<HarnessLimits>;
  latency?: Partial<HarnessLatency>;
  /** Overrides the scopes in appsscript.json. */
  scopes?: string[];
  /** The address the download writes into `const CRM_BASE = '...'` (the CRM does this rewrite when it serves the file). */
  crmBase?: string;
  /** Source of Code.gs when a test wants a mutated copy. */
  codeSource?: string;
  /** Virtual start time (ms since epoch). */
  startTime?: number;
  /** Wall-clock guard against an endless loop in the script. */
  realTimeoutMs?: number;
}

export const SCOPE = {
  containerUi: 'https://www.googleapis.com/auth/script.container.ui',
  externalRequest: 'https://www.googleapis.com/auth/script.external_request',
  scriptApp: 'https://www.googleapis.com/auth/script.scriptapp',
  spreadsheetsCurrentOnly: 'https://www.googleapis.com/auth/spreadsheets.currentonly',
  spreadsheets: 'https://www.googleapis.com/auth/spreadsheets',
  userEmail: 'https://www.googleapis.com/auth/userinfo.email',
} as const;

const DEFAULT_LIMITS: HarnessLimits = {
  executionMs: 6 * 60 * 1000,
  simpleTriggerMs: 30 * 1000,
  propertyValueBytes: 9 * 1024,
  propertiesTotalBytes: 500 * 1024,
  triggersPerUser: 20,
  urlFetchCallsPerDay: 20_000,
  fetchPayloadBytes: 50 * 1024 * 1024,
  cellChars: 50_000,
  workbookCells: 10_000_000,
};
const DEFAULT_LATENCY: HarnessLatency = {
  sheetCallMs: 40,
  perCellMs: 0.02,
  fetchMs: 350,
  uiMs: 10,
};

/** Thrown by every service call after the execution limit was passed: Google ends the script, and nothing it does afterwards has an effect. */
export class ExecutionKilled extends Error {
  constructor() {
    super('Exceeded maximum execution time');
    this.name = 'ExecutionKilled';
  }
}

const exception = (message: string): Error => {
  const e = new Error(message);
  e.name = 'Exception';
  return e;
};

// --- the grid ---------------------------------------------------------------------------------------------------------------------

interface CellData {
  /** The value (for a formula, its result). */
  v: unknown;
  f?: string;
}
const emptyCell = (c: CellData | undefined): boolean =>
  !c || (c.f === undefined && (c.v === undefined || c.v === ''));

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z)?$/;

function evalFormula(formula: string): unknown {
  const body = formula.slice(1).trim();
  if (/^NA\(\)$/i.test(body)) return '#N/A';
  if (/^[-+*/\d.() ]+$/.test(body)) {
    try {
      const value = Function(`"use strict"; return (${body});`)();
      if (typeof value === 'number') return Number.isFinite(value) ? value : '#DIV/0!';
    } catch {
      return '#ERROR!';
    }
  }
  return '#NAME?';
}

/**
 * What the Sheets UI does with text typed into a cell (and `setValues` does the same for strings): "1e5" becomes the number 100000,
 * "+919876543210" the number 919876543210, "TRUE" a boolean, "2026-10-07" a date and "=..." a formula, unless the cell's number
 * format is plain text ("@"). This is the behaviour that silently damages data, so it is modelled.
 */
function typed(raw: unknown, format: string | undefined, maxChars: number): CellData | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') {
    if (raw.length > maxChars) {
      throw exception(
        `Your input contains more than the maximum of ${maxChars} characters in a single cell.`,
      );
    }
    if (raw === '') return undefined;
    if (format === '@') return { v: raw };
    if (raw.startsWith('=')) return { v: evalFormula(raw), f: raw };
    if (NUMBER_RE.test(raw.trim())) return { v: Number(raw.trim()) };
    if (/^(true|false)$/i.test(raw.trim())) return { v: raw.trim().toLowerCase() === 'true' };
    const t = raw.trim();
    if (ISO_DATE_RE.test(t) || ISO_DATETIME_RE.test(t)) {
      const d = new Date(t.replace(' ', 'T'));
      if (!Number.isNaN(d.getTime())) return { v: d };
    }
    return { v: raw };
  }
  if (raw instanceof Date) return { v: new Date(raw.getTime()) };
  if (typeof raw === 'number' || typeof raw === 'boolean') return { v: raw };
  return { v: String(raw) };
}

class SheetModel {
  data: Array<Array<CellData | undefined> | undefined> = [];
  formats = new Map<string, string>();
  merges: Array<[number, number, number, number]> = [];
  hidden = false;
  frozen = 0;
  maxRows = 1000;
  maxCols = 26;
  private bounds: { row: number; col: number } | null = null;

  constructor(
    public name: string,
    readonly id: number,
  ) {}

  get(row: number, col: number): CellData | undefined {
    return this.data[row - 1]?.[col - 1];
  }

  set(row: number, col: number, cell: CellData | undefined): void {
    const line = this.data[row - 1] ?? (this.data[row - 1] = []);
    line[col - 1] = cell;
    this.bounds = null;
  }

  wipe(): void {
    this.data = [];
    this.formats.clear();
    this.merges = [];
    this.bounds = null;
  }

  lastBounds(): { row: number; col: number } {
    if (this.bounds) return this.bounds;
    let row = 0;
    let col = 0;
    for (let i = 0; i < this.data.length; i++) {
      const line = this.data[i];
      if (!line) continue;
      for (let j = line.length - 1; j >= 0; j--) {
        if (!emptyCell(line[j])) {
          row = i + 1;
          if (j + 1 > col) col = j + 1;
          break;
        }
      }
    }
    this.bounds = { row, col };
    return this.bounds;
  }

  /** The cell as `getValues` returns it: merged cells other than the top-left one are blank. */
  value(row: number, col: number): unknown {
    for (const [r, c, nr, nc] of this.merges) {
      if (row >= r && row < r + nr && col >= c && col < c + nc && !(row === r && col === c))
        return '';
    }
    const cell = this.get(row, col);
    if (!cell || cell.v === undefined) return '';
    return cell.v instanceof Date ? new Date(cell.v.getTime()) : cell.v;
  }
}

class BookModel {
  sheets: SheetModel[] = [];
  active: SheetModel;
  private nextSheetId = 0;
  constructor(
    readonly id: string,
    public name: string,
    firstSheet = 'Sheet1',
  ) {
    this.active = this.add(firstSheet);
  }
  add(name: string): SheetModel {
    const sheet = new SheetModel(name, this.nextSheetId++);
    this.sheets.push(sheet);
    return sheet;
  }
  byName(name: string): SheetModel | undefined {
    return this.sheets.find((s) => s.name === name);
  }
  cellCount(): number {
    return this.sheets.reduce((n, s) => n + s.maxRows * s.maxCols, 0);
  }
}

// --- helpers ----------------------------------------------------------------------------------------------------------------------

const colLetters = (col: number): string => {
  let n = col;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};
const colNumber = (letters: string): number =>
  letters
    .toUpperCase()
    .split('')
    .reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);

/** `A1`, `A1:C3`, `B:B` (whole column limited to the sheet) as [row, col, numRows, numCols]. */
function parseA1(a1: string, sheet: SheetModel): [number, number, number, number] {
  const text = a1.includes('!') ? a1.slice(a1.indexOf('!') + 1) : a1;
  const m = /^([A-Za-z]+)(\d+)?(?::([A-Za-z]+)(\d+)?)?$/.exec(text.trim());
  if (!m) throw exception(`The range "${a1}" could not be found.`);
  const c1 = colNumber(m[1]!);
  const r1 = m[2] ? Number(m[2]) : 1;
  const c2 = m[3] ? colNumber(m[3]) : c1;
  const r2 = m[4] ? Number(m[4]) : m[3] || !m[2] ? sheet.maxRows : r1;
  return [r1, c1, r2 - r1 + 1, c2 - c1 + 1];
}

const display = (v: unknown): string => {
  if (v instanceof Date) return `${v.getUTCMonth() + 1}/${v.getUTCDate()}/${v.getUTCFullYear()}`;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return v === undefined || v === null ? '' : String(v);
};

const signed = (buf: Buffer): number[] => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const unsignedBuffer = (bytes: number[]): Buffer => Buffer.from(bytes.map((b) => b & 255));

/** Google's `formatDate` tokens that the add-on or its likely edits could use. */
function formatDate(date: Date, tz: string, pattern: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, p) => ((acc[p.type] = p.value), acc), {});
  const offsetMin = (() => {
    const local = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    return Math.round((local - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  })();
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  const tokens: Record<string, string> = {
    yyyy: parts.year!,
    yy: parts.year!.slice(2),
    MM: parts.month!,
    M: String(Number(parts.month)),
    dd: parts.day!,
    d: String(Number(parts.day)),
    HH: parts.hour!,
    H: String(Number(parts.hour)),
    hh: String(((Number(parts.hour) + 11) % 12) + 1).padStart(2, '0'),
    h: String(((Number(parts.hour) + 11) % 12) + 1),
    mm: parts.minute!,
    ss: parts.second!,
    SSS: String(date.getUTCMilliseconds()).padStart(3, '0'),
    a: Number(parts.hour) < 12 ? 'AM' : 'PM',
    EEE: parts.weekday!,
    XXX: offsetMin === 0 ? 'Z' : `${sign}${hh}:${mm}`,
    Z: `${sign}${hh}${mm}`,
    z: tz,
  };
  return pattern.replace(
    /'([^']*)'|yyyy|yy|MM|M|dd|d|HH|H|hh|h|mm|ss|SSS|a|EEE|XXX|Z|z/g,
    (match: string, literal: string | undefined) =>
      literal !== undefined ? literal : (tokens[match] ?? match),
  );
}

// --- scriptlets -------------------------------------------------------------------------------------------------------------------

/** Compiles an Apps Script HTML template (`<? ?>`, `<?= ?>`, `<?!= ?>`, `<?# ?>`) to JavaScript source that returns the page. */
function compileTemplate(source: string): string {
  let code = 'var __out = [];\n';
  const re = /<\?(=|!=|#)?([\s\S]*?)\?>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const text = (chunk: string) => {
    if (chunk) code += `__out.push(${JSON.stringify(chunk)});\n`;
  };
  while ((m = re.exec(source))) {
    const before = source.slice(last, m.index);
    text(before);
    const upTo = source.slice(0, m.index);
    const insideScript = upTo.split(/<script\b/i).length > upTo.split(/<\/script>/i).length;
    const kind = m[1];
    const expr = m[2]!;
    if (kind === '=') code += `__out.push(__escape(${expr.trim() || "''"}, ${insideScript}));\n`;
    else if (kind === '!=') code += `__out.push(String(${expr.trim() || "''"}));\n`;
    else if (kind === '#') {
      /* comment */
    } else code += `${expr}\n`;
    last = m.index + m[0].length;
  }
  text(source.slice(last));
  return `${code}return __out.join('');`;
}

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const escapeJsString = (value: unknown): string =>
  String(value ?? '').replace(/[\\'"<>&\r\n\u2028\u2029]/g, (ch) => {
    const code = ch.charCodeAt(0).toString(16).padStart(4, '0');
    return `\\u${code}`;
  });

// --- the harness ------------------------------------------------------------------------------------------------------------------

interface Frame {
  id: number;
  fn: string;
  kind: ExecKind;
  authMode: AuthModeName;
  startMs: number;
  budgetMs: number;
  killed: boolean;
  book: BookModel | null;
  scopes: Set<string>;
}

interface TriggerModel {
  id: string;
  fn: string;
  event: 'ON_EDIT' | 'ON_OPEN' | 'ON_CHANGE' | 'ON_FORM_SUBMIT' | 'CLOCK';
  source: 'SPREADSHEETS' | 'CLOCK';
  sourceId: string;
  everyHours?: number;
}

interface LockModel {
  owner: number | 'external' | null;
}

export class AppsScriptHarness {
  readonly limits: HarnessLimits;
  readonly latency: HarnessLatency;
  readonly assetsDir: string;
  readonly mode: 'bound' | 'addon';
  readonly scopes: string[];
  readonly manifest: Record<string, any>;
  readonly source: string;
  /** Everything Logger.log and console.* printed. */
  readonly logs: string[] = [];
  readonly executions: ExecutionRecord[] = [];
  readonly fetchLog: HarnessFetchRecord[] = [];
  readonly menuHistory: MenuRecord[] = [];
  readonly dialogs: DialogRecord[] = [];
  readonly alerts: AlertRecord[] = [];
  /** Answers handed to the next alert or prompt, in order (default: the OK button / an empty answer). */
  readonly nextAnswers: string[] = [];
  fetchHandler: FetchHandler | undefined;
  /** Called with each fetch before it is answered, so a test can start another execution in the middle of one. */
  onFetch: ((request: HarnessRequest) => void) | undefined;

  private nowMs: number;
  private readonly ctx: vm.Context;
  private readonly files = new Map<string, string>();
  private readonly books: BookModel[] = [];
  private current: BookModel;
  private readonly frames: Frame[] = [];
  private frameSeq = 0;
  private triggers: TriggerModel[] = [];
  private triggerSeq = 0;
  private readonly props = {
    user: new Map<string, string>(),
    script: new Map<string, string>(),
    document: new WeakMap<BookModel, Map<string, string>>(),
  };
  private readonly caches = new Map<string, Map<string, { v: string; exp: number }>>();
  private readonly locks = new Map<string, LockModel>();
  private fetchCount = 0;
  private readonly realTimeoutMs: number;
  private readonly scopesEverUsed = new Set<string>();
  private readonly userEmail: string;
  /** Google's enums are single objects: a button set taken from one `getUi()` is the same as one from another. */
  private readonly uiEnums = (() => {
    const enumOf = (names: string[]) =>
      Object.fromEntries(names.map((n) => [n, { name: () => n, toString: () => n }]));
    return {
      buttons: enumOf(['OK', 'CANCEL', 'YES', 'NO', 'CLOSE']),
      buttonSets: enumOf(['OK', 'OK_CANCEL', 'YES_NO', 'YES_NO_CANCEL']),
    };
  })();
  private readonly addonMenu: 'available' | 'unavailable';

  constructor(options: HarnessOptions = {}) {
    this.assetsDir =
      options.assetsDir ?? join(__dirname, '..', '..', 'assets', 'google-sheets-addon');
    this.mode = options.mode ?? 'bound';
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.latency = { ...DEFAULT_LATENCY, ...options.latency };
    this.fetchHandler = options.fetch;
    this.addonMenu = options.addonMenu ?? 'available';
    this.userEmail = options.userEmail ?? 'member@example.test';
    this.nowMs = options.startTime ?? Date.UTC(2026, 9, 15, 9, 0, 0);
    this.realTimeoutMs = options.realTimeoutMs ?? 20_000;

    for (const name of readdirSync(this.assetsDir)) {
      if (name.endsWith('.html')) {
        this.files.set(
          name.slice(0, -'.html'.length),
          readFileSync(join(this.assetsDir, name), 'utf8'),
        );
      }
    }
    this.manifest = JSON.parse(readFileSync(join(this.assetsDir, 'appsscript.json'), 'utf8'));
    this.scopes = options.scopes ?? (this.manifest.oauthScopes as string[]) ?? [];
    let code = options.codeSource ?? readFileSync(join(this.assetsDir, 'Code.gs'), 'utf8');
    if (options.crmBase) {
      code = code.replace(
        /const\s+CRM_BASE\s*=\s*'[^']*';/,
        `const CRM_BASE = '${options.crmBase}';`,
      );
    }
    this.source = code;

    const book = new BookModel(`book-${crypto.randomBytes(4).toString('hex')}`, 'Test sheet');
    this.books.push(book);
    this.current = book;

    this.ctx = vm.createContext(this.buildGlobals(), { name: 'apps-script' });
    // Apps Script's Date: `new Date()` and `Date.now()` follow the harness clock, so a deadline written with Date works under the budget.
    vm.runInContext(
      `(function (now) {
        var Native = Date;
        function D() {
          var a = Array.prototype.slice.call(arguments);
          if (!new.target) return new Native(now()).toString();
          if (a.length === 0) return new Native(now());
          return new (Function.prototype.bind.apply(Native, [null].concat(a)))();
        }
        D.prototype = Native.prototype;
        D.now = now; D.parse = Native.parse; D.UTC = Native.UTC;
        globalThis.Date = D;
      })`,
      this.ctx,
    )(() => this.nowMs);
    new vm.Script(this.source, { filename: 'Code.gs' }).runInContext(this.ctx);
  }

  // ----- clock and executions -----

  /** Virtual time, ms since the epoch. */
  now(): number {
    return this.nowMs;
  }
  advance(ms: number): void {
    this.nowMs += ms;
  }

  private frame(): Frame | undefined {
    return this.frames[this.frames.length - 1];
  }

  /** The cost of a service call: moves the clock, and ends the script once the limit is passed. */
  private spend(ms: number): void {
    const f = this.frame();
    if (!f) {
      this.nowMs += ms;
      return;
    }
    if (f.killed) throw new ExecutionKilled();
    this.nowMs += ms;
    if (this.nowMs - f.startMs > f.budgetMs) {
      f.killed = true;
      throw new ExecutionKilled();
    }
  }
  private sheetCost(cells = 0): void {
    this.spend(this.latency.sheetCallMs + cells * this.latency.perCellMs);
  }

  /** A scope check the way Google makes it: the manifest must list it, and the add-on must be authorized for this kind of call. */
  private need(scope: string | string[], api: string): void {
    const wanted = Array.isArray(scope) ? scope : [scope];
    const granted = wanted.find((s) => this.scopes.includes(s));
    if (!granted) {
      throw exception(
        `You do not have permission to call ${api}. Required permissions: ${wanted.join(' or ')}`,
      );
    }
    this.frame()?.scopes.add(granted);
    this.scopesEverUsed.add(granted);
  }
  private needAuthorized(api: string): void {
    const f = this.frame();
    if (f && f.authMode !== 'FULL') {
      throw exception(
        `You do not have permission to call ${api}. This code ran in AuthMode.${f.authMode}, before the member authorized the add-on.`,
      );
    }
  }
  /** Scopes any execution has used so far: lets a test assert that every scope in the manifest is exercised. */
  scopesUsed(): string[] {
    return [...this.scopesEverUsed].sort();
  }

  private uiAvailable(): boolean {
    const f = this.frame();
    return (
      !f || f.kind === 'menu' || f.kind === 'client' || f.kind === 'simple' || f.kind === 'direct'
    );
  }

  private currentBook(api: string): BookModel {
    const f = this.frame();
    const book = f ? f.book : this.current;
    if (!book) {
      throw exception(
        `${api} has no spreadsheet in this context (a time-driven add-on trigger has none).`,
      );
    }
    return book;
  }

  private lookupFunction(name: string): ((...a: unknown[]) => unknown) | undefined {
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) return undefined;
    const fn = vm.runInContext(
      `typeof ${name} === 'function' ? ${name} : undefined`,
      this.ctx,
    ) as unknown;
    return typeof fn === 'function' ? (fn as (...a: unknown[]) => unknown) : undefined;
  }
  /** Evaluates an expression in the script's own scope: lets a test read a constant or call a private helper (`rowHash_`). */
  evaluate<T = unknown>(expression: string): T {
    return vm.runInContext(expression, this.ctx, { timeout: this.realTimeoutMs }) as T;
  }
  hasFunction(name: string): boolean {
    return this.lookupFunction(name) !== undefined;
  }

  /** One execution, the way Google starts one: its own clock budget, auth mode and (for add-ons) document context. */
  private execute(
    fn: string,
    args: unknown[],
    kind: ExecKind,
    options: { authMode?: AuthModeName; book?: BookModel | null; budgetMs?: number } = {},
  ): RunResult {
    const target = this.lookupFunction(fn);
    const outerClock = this.nowMs;
    const nested = this.frames.length > 0;
    const frame: Frame = {
      id: ++this.frameSeq,
      fn,
      kind,
      authMode: options.authMode ?? 'FULL',
      startMs: this.nowMs,
      budgetMs: options.budgetMs ?? this.limits.executionMs,
      killed: false,
      book: options.book === undefined ? this.current : options.book,
      scopes: new Set(),
    };
    const record = (ok: boolean, error: string | null): void => {
      this.executions.push({
        fn,
        kind,
        ok,
        error,
        killed: frame.killed,
        elapsedMs: this.nowMs - frame.startMs,
        scopesUsed: [...frame.scopes].sort(),
      });
    };
    if (!target) {
      const error = `Script function not found: ${fn}`;
      record(false, error);
      return { ok: false, value: undefined, error, killed: false, elapsedMs: 0 };
    }
    this.frames.push(frame);
    let result: RunResult;
    try {
      (this.ctx as any).__invoke = () => target(...args);
      const value = vm.runInContext('__invoke()', this.ctx, {
        timeout: this.realTimeoutMs,
      }) as unknown;
      delete (this.ctx as any).__invoke;
      const elapsed = this.nowMs - frame.startMs;
      record(!frame.killed, frame.killed ? 'Exceeded maximum execution time' : null);
      result = {
        ok: !frame.killed,
        value: value === undefined ? undefined : JSON.parse(JSON.stringify(value) ?? 'null'),
        error: frame.killed ? 'Exceeded maximum execution time' : null,
        killed: frame.killed,
        elapsedMs: elapsed,
      };
    } catch (err) {
      delete (this.ctx as any).__invoke;
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : String(err);
      record(false, message);
      result = {
        ok: false,
        value: undefined,
        error: message,
        killed: frame.killed,
        elapsedMs: this.nowMs - frame.startMs,
      };
    } finally {
      this.frames.pop();
      for (const lock of this.locks.values()) if (lock.owner === frame.id) lock.owner = null;
      // Another execution that ran in the middle of this one ran alongside it: its time is not this one's.
      if (nested) this.nowMs = outerClock;
    }
    return result;
  }

  // ----- the ways Google starts the script -----

  /** `onOpen`, the simple trigger. `authMode` is what Google passes: an installed add-on that is not authorized yet runs it as NONE. */
  fireOpen(options: { authMode?: AuthModeName } = {}): RunResult {
    const authMode = options.authMode ?? 'FULL';
    return this.execute('onOpen', [{ authMode, source: this.bookFacade(this.current) }], 'simple', {
      authMode,
      budgetMs: this.limits.simpleTriggerMs,
    });
  }
  fireInstall(options: { authMode?: AuthModeName } = {}): RunResult {
    const authMode = options.authMode ?? 'FULL';
    return this.execute('onInstall', [{ authMode }], 'simple', {
      authMode,
      budgetMs: this.limits.simpleTriggerMs,
    });
  }

  /** A click on a menu item: finds the item by its caption and runs its function. */
  clickMenu(caption: string): RunResult {
    for (let i = this.menuHistory.length - 1; i >= 0; i--) {
      const hit = this.findItem(this.menuHistory[i]!.items, caption);
      if (hit?.fn) return this.execute(hit.fn, [], 'menu');
    }
    throw new Error(`No menu item "${caption}" is shown.`);
  }
  private findItem(items: MenuItemRecord[], caption: string): MenuItemRecord | undefined {
    for (const item of items) {
      if (item.caption === caption) return item;
      if (item.submenu) {
        const inner = this.findItem(item.submenu.items, caption);
        if (inner) return inner;
      }
    }
    return undefined;
  }
  /** The menu as the member sees it now: the last one shown for each title. */
  menus(): MenuRecord[] {
    const latest = new Map<string, MenuRecord>();
    for (const menu of this.menuHistory) latest.set(menu.title, menu);
    return [...latest.values()];
  }
  menuCaptions(title?: string): string[] {
    const menu = title ? this.menus().find((m) => m.title === title) : this.menus()[0];
    return (menu?.items ?? []).map((i) => (i.separator ? '---' : (i.caption ?? '')));
  }

  /**
   * `google.script.run.<fn>(...args)` from a dialog. Google refuses private functions (a trailing underscore), refuses arguments it
   * cannot carry, and drops what it cannot carry from the answer: a Date or a function in the result is a failure for the page.
   */
  callFromClient(fn: string, ...args: unknown[]): RunResult {
    if (fn.endsWith('_')) {
      return {
        ok: false,
        value: undefined,
        error: `${fn} is private and cannot be called from a page.`,
        killed: false,
        elapsedMs: 0,
      };
    }
    const check = (value: unknown, where: string): string | null => {
      if (value === undefined || value === null) return null;
      const t = typeof value;
      if (t === 'function' || t === 'symbol' || t === 'bigint') return `${where} holds a ${t}`;
      if (Object.prototype.toString.call(value) === '[object Date]') return `${where} holds a Date`;
      if (t === 'object') {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          const bad = check(v, `${where}.${k}`);
          if (bad) return bad;
        }
      }
      return null;
    };
    for (let i = 0; i < args.length; i++) {
      const bad = check(args[i], `argument ${i}`);
      if (bad)
        return {
          ok: false,
          value: undefined,
          error: `Illegal value: ${bad}`,
          killed: false,
          elapsedMs: 0,
        };
    }
    const rawLog = this.executions.length;
    const target = this.lookupFunction(fn);
    if (!target) {
      return {
        ok: false,
        value: undefined,
        error: `Script function not found: ${fn}`,
        killed: false,
        elapsedMs: 0,
      };
    }
    // Run it, then judge the raw (not JSON-cloned) answer the way the client library does.
    const frameValue: { raw: unknown } = { raw: undefined };
    const original = target;
    (this.ctx as any).__clientCall = (...a: unknown[]) => {
      frameValue.raw = original(...a);
      return frameValue.raw;
    };
    const result = this.execute('__clientCall', args, 'client');
    delete (this.ctx as any).__clientCall;
    // execute() recorded the wrapper's name; make the Executions page say what the page called.
    const last = this.executions[this.executions.length - 1];
    if (last && this.executions.length > rawLog) last.fn = fn;
    if (result.ok) {
      const bad = check(frameValue.raw, 'the answer');
      if (bad) return { ...result, ok: false, value: undefined, error: `Illegal value: ${bad}` };
    }
    return result;
  }

  /** Runs any global function as a plain direct call (a "Run" in the editor). */
  run(fn: string, ...args: unknown[]): RunResult {
    return this.execute(fn, args, 'direct');
  }
  /** Same, but throws when it fails, and returns the value. */
  call<T = unknown>(fn: string, ...args: unknown[]): T {
    const r = this.run(fn, ...args);
    if (!r.ok) throw new Error(r.error ?? `${fn} failed`);
    return r.value as T;
  }

  /**
   * The member edits cells (the grid changes as the UI would change it), and Google delivers the edit to every installed onEdit
   * trigger of that spreadsheet. No installed trigger, nothing runs. An edit the script makes itself never calls this.
   */
  fireEdit(edit: {
    sheet: string;
    row: number;
    col: number;
    /** The new content (one cell: a value; several: a 2D array). Omit to deliver an edit without changing the grid. */
    values?: unknown;
    numRows?: number;
    numCols?: number;
    book?: string;
  }): { delivered: number; results: RunResult[] } {
    const book = edit.book ? this.books.find((b) => b.id === edit.book)! : this.current;
    const sheet = book.byName(edit.sheet);
    if (!sheet) throw new Error(`No sheet "${edit.sheet}".`);
    const grid = Array.isArray(edit.values) ? (edit.values as unknown[][]) : null;
    const numRows = edit.numRows ?? grid?.length ?? 1;
    const numCols = edit.numCols ?? grid?.[0]?.length ?? 1;
    let oldValue: string | undefined;
    if (edit.values !== undefined) {
      if (numRows === 1 && numCols === 1) {
        const before = sheet.get(edit.row, edit.col);
        oldValue = before && !emptyCell(before) ? display(before.v) : undefined;
      }
      this.userSet(sheet, edit.row, edit.col, grid ?? [[edit.values]]);
    }
    const value =
      numRows === 1 && numCols === 1 ? display(sheet.value(edit.row, edit.col)) : undefined;
    const matching = this.triggers.filter((t) => t.event === 'ON_EDIT' && t.sourceId === book.id);
    const results = matching.map((t) => {
      const event: Record<string, unknown> = {
        authMode: 'FULL',
        range: this.rangeFacade(sheet, edit.row, edit.col, numRows, numCols),
        source: this.bookFacade(book),
        triggerUid: t.id,
        user: { getEmail: () => this.userEmail },
      };
      if (value !== undefined) event.value = value;
      if (oldValue !== undefined) event.oldValue = oldValue;
      return this.execute(t.fn, [event], 'edit', { book });
    });
    return { delivered: matching.length, results };
  }

  /** The clock fires every installed time-driven trigger once. (Real delivery timing is Google's and is not modelled.) */
  fireTimer(): RunResult[] {
    const d = new Date(this.nowMs);
    const event = {
      authMode: 'FULL',
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      'day-of-month': d.getUTCDate(),
      'day-of-week': d.getUTCDay() || 7,
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
      timezone: this.manifest.timeZone ?? 'UTC',
      'week-of-year': 1,
    };
    return this.triggers
      .filter((t) => t.event === 'CLOCK')
      .map((t) =>
        this.execute(t.fn, [{ ...event, triggerUid: t.id }], 'timer', {
          // A time-driven trigger of an editor add-on is not tied to any open spreadsheet.
          book: this.mode === 'addon' ? null : this.current,
        }),
      );
  }

  // ----- test-facing state (all of it serializable, so a remote worker can offer the same calls) -----

  addSpreadsheet(name: string): string {
    const book = new BookModel(`book-${crypto.randomBytes(4).toString('hex')}`, name);
    this.books.push(book);
    return book.id;
  }
  useSpreadsheet(id: string): void {
    this.current = this.books.find((b) => b.id === id)!;
  }
  spreadsheetId(): string {
    return this.current.id;
  }

  /** Puts rows into a sheet (created when missing) exactly as typed: strings are parsed like the UI parses them. Returns the sheet name. */
  loadSheet(
    name: string,
    rows: unknown[][],
    options: { activate?: boolean; at?: [number, number] } = {},
  ): string {
    const book = this.current;
    const sheet = book.byName(name) ?? book.add(name);
    if (options.activate) book.active = sheet;
    this.userSet(sheet, options.at?.[0] ?? 1, options.at?.[1] ?? 1, rows);
    return sheet.name;
  }
  private userSet(sheet: SheetModel, row: number, col: number, grid: unknown[][]): void {
    const needRows = row + grid.length - 1;
    const needCols = col + Math.max(0, ...grid.map((r) => r.length)) - 1;
    if (needRows > sheet.maxRows) sheet.maxRows = needRows;
    if (needCols > sheet.maxCols) sheet.maxCols = needCols;
    for (let i = 0; i < grid.length; i++) {
      for (let j = 0; j < (grid[i]?.length ?? 0); j++) {
        const raw = grid[i]![j];
        const format = sheet.formats.get(`${row + i},${col + j}`);
        sheet.set(row + i, col + j, typed(raw, format, this.limits.cellChars));
      }
    }
  }
  /** Sets a cell to a formula and the value it evaluates to (the harness has no formula engine). */
  setFormulaCell(sheet: string, row: number, col: number, formula: string, result: unknown): void {
    this.current.byName(sheet)!.set(row, col, { f: formula, v: result });
  }
  /** Merges cells: the value stays in the top-left one and the others read as blank, like Sheets. */
  mergeCells(sheet: string, row: number, col: number, numRows: number, numCols: number): void {
    const s = this.current.byName(sheet)!;
    s.merges.push([row, col, numRows, numCols]);
  }
  setActiveSheet(name: string): void {
    this.current.active = this.current.byName(name)!;
  }
  activeSheetName(): string {
    return this.current.active.name;
  }
  sheetNames(): string[] {
    return this.current.sheets.map((s) => s.name);
  }
  sheetInfo(
    name: string,
  ): { hidden: boolean; maxRows: number; maxCols: number; frozenRows: number } | null {
    const s = this.current.byName(name);
    return s
      ? { hidden: s.hidden, maxRows: s.maxRows, maxCols: s.maxCols, frozenRows: s.frozen }
      : null;
  }
  /** The sheet's values as `getValues` would return them for its used range (Dates as ISO text). */
  grid(name: string): unknown[][] {
    const s = this.current.byName(name);
    if (!s) return [];
    const { row, col } = s.lastBounds();
    const out: unknown[][] = [];
    for (let r = 1; r <= row; r++) {
      const line: unknown[] = [];
      for (let c = 1; c <= col; c++) {
        const v = s.value(r, c);
        line.push(v instanceof Date ? v.toISOString() : v);
      }
      out.push(line);
    }
    return out;
  }
  cell(name: string, row: number, col: number): unknown {
    const v = this.current.byName(name)?.value(row, col);
    return v instanceof Date ? v.toISOString() : v;
  }
  /** The number format of one cell ('' when none). */
  numberFormat(name: string, row: number, col: number): string {
    return this.current.byName(name)?.formats.get(`${row},${col}`) ?? '';
  }
  properties(store: 'user' | 'document' | 'script'): Record<string, string> {
    return Object.fromEntries(this.propsOf(store, this.current) ?? []);
  }
  setProperty(store: 'user' | 'document' | 'script', key: string, value: string): void {
    this.propsOf(store, this.current)!.set(key, value);
  }
  private propsOf(
    store: 'user' | 'document' | 'script',
    book: BookModel | null,
  ): Map<string, string> | null {
    if (store === 'user') return this.props.user;
    if (store === 'script') return this.props.script;
    if (!book) return null;
    let map = this.props.document.get(book);
    if (!map) this.props.document.set(book, (map = new Map()));
    return map;
  }
  triggerList(): Array<{
    id: string;
    fn: string;
    event: string;
    source: string;
    sourceId: string;
  }> {
    return this.triggers.map((t) => ({
      id: t.id,
      fn: t.fn,
      event: t.event,
      source: t.source,
      sourceId: t.sourceId,
    }));
  }
  /** Makes another process hold a lock, so tryLock/waitLock fail. */
  holdLock(kind: 'document' | 'script' | 'user', held = true): void {
    const key = kind === 'document' ? `document:${this.current.id}` : kind;
    const lock = this.locks.get(key) ?? { owner: null };
    lock.owner = held ? 'external' : null;
    this.locks.set(key, lock);
  }
  setUrlFetchCalls(n: number): void {
    this.fetchCount = n;
  }
  /** What the Executions page of the Apps Script editor would list. */
  executionLog(): ExecutionRecord[] {
    return this.executions.map((e) => ({ ...e }));
  }
  fetchRecords(): HarnessFetchRecord[] {
    return this.fetchLog.map((f) => ({ ...f }));
  }
  alertRecords(): AlertRecord[] {
    return this.alerts.map((a) => ({ ...a }));
  }
  /** What the member answers to the next alert or prompt. */
  queueAnswer(answer: string): void {
    this.nextAnswers.push(answer);
  }
  clearRecords(): void {
    this.executions.length = 0;
    this.fetchLog.length = 0;
    this.dialogs.length = 0;
    this.alerts.length = 0;
    this.logs.length = 0;
    this.menuHistory.length = 0;
  }
  menuHistoryRecords(): MenuRecord[] {
    return this.menuHistory.map((m) => JSON.parse(JSON.stringify(m)) as MenuRecord);
  }
  /** Everything the dialogs were given, in order. */
  dialogHtml(): DialogRecord[] {
    return this.dialogs;
  }
  logText(): string {
    return this.logs.join('\n');
  }
  /** Every byte the script has put in any property store, the sheet, a dialog or a log: for "the key is nowhere" assertions. */
  everythingVisible(): string {
    const parts: string[] = [
      this.logText(),
      JSON.stringify(this.dialogs),
      JSON.stringify(this.alerts),
    ];
    for (const store of ['document', 'script'] as const)
      parts.push(JSON.stringify(this.properties(store)));
    for (const book of this.books) {
      const prev = this.current;
      this.current = book;
      for (const name of this.sheetNames()) parts.push(JSON.stringify(this.grid(name)));
      this.current = prev;
    }
    return parts.join('\n');
  }

  // ----- the Google services the script sees -----

  private buildGlobals(): Record<string, unknown> {
    const log = (...args: unknown[]) => {
      this.logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
    return {
      SpreadsheetApp: this.spreadsheetApp(),
      HtmlService: this.htmlService(),
      PropertiesService: this.propertiesService(),
      CacheService: this.cacheService(),
      LockService: this.lockService(),
      ScriptApp: this.scriptApp(),
      UrlFetchApp: this.urlFetchApp(),
      Utilities: this.utilities(),
      Session: this.session(),
      Logger: { log, getLog: () => this.logs.join('\n') },
      console: { log, info: log, warn: log, error: log, debug: log },
    };
  }

  // SpreadsheetApp ---------------------------------------------------------------------------------------------------------------

  private spreadsheetApp(): Record<string, unknown> {
    const requireData = (api: string) => {
      this.need([SCOPE.spreadsheetsCurrentOnly, SCOPE.spreadsheets], api);
      const f = this.frame();
      if (f && f.authMode === 'NONE') {
        throw exception(
          `You do not have permission to call ${api}. The add-on is not authorized yet (AuthMode.NONE).`,
        );
      }
    };
    const active = (api: string) => {
      requireData(api);
      const f = this.frame();
      const book = f ? f.book : this.current;
      return book ? this.bookFacade(book) : null;
    };
    return {
      getActiveSpreadsheet: () => {
        this.sheetCost();
        return active('SpreadsheetApp.getActiveSpreadsheet');
      },
      getActive: () => {
        this.sheetCost();
        return active('SpreadsheetApp.getActive');
      },
      getActiveSheet: () => {
        this.sheetCost();
        requireData('SpreadsheetApp.getActiveSheet');
        const book = this.currentBook('SpreadsheetApp.getActiveSheet');
        return this.sheetFacade(book, book.active);
      },
      flush: () => this.spend(this.latency.sheetCallMs),
      getUi: () => {
        this.need(SCOPE.containerUi, 'SpreadsheetApp.getUi');
        if (!this.uiAvailable())
          throw exception('Cannot call SpreadsheetApp.getUi() from this context.');
        return this.uiFacade();
      },
    };
  }

  private bookFacade(book: BookModel): Record<string, unknown> {
    const facade: Record<string, unknown> = {
      getId: () => book.id,
      getName: () => book.name,
      getSpreadsheetTimeZone: () => this.manifest.timeZone ?? 'Etc/UTC',
      getSheets: () => {
        this.sheetCost();
        return book.sheets.map((s) => this.sheetFacade(book, s));
      },
      getNumSheets: () => book.sheets.length,
      getSheetByName: (name: string) => {
        this.sheetCost();
        if (typeof name !== 'string')
          throw exception(
            "The parameters don't match the method signature for SpreadsheetApp.Spreadsheet.getSheetByName.",
          );
        const s = book.byName(name);
        return s ? this.sheetFacade(book, s) : null;
      },
      getActiveSheet: () => {
        this.sheetCost();
        return this.sheetFacade(book, book.active);
      },
      setActiveSheet: (sheet: { getName(): string }) => {
        this.sheetCost();
        const s = book.byName(sheet.getName());
        if (!s) throw exception('Sheet not found.');
        book.active = s;
        return this.sheetFacade(book, s);
      },
      insertSheet: (name?: string) => {
        this.sheetCost();
        if (typeof name === 'string' && book.byName(name)) {
          throw exception(
            `A sheet with the name "${name}" already exists. Please enter another name.`,
          );
        }
        if (book.cellCount() + 26_000 > this.limits.workbookCells) {
          throw exception(
            'This action would increase the number of cells in the workbook above the limit of 10000000 cells.',
          );
        }
        const s = book.add(typeof name === 'string' ? name : `Sheet${book.sheets.length + 1}`);
        // Google: "The new sheet becomes the active sheet."
        book.active = s;
        return this.sheetFacade(book, s);
      },
      deleteSheet: (sheet: { getName(): string }) => {
        this.sheetCost();
        if (book.sheets.length === 1)
          throw exception("You can't delete the only sheet in a spreadsheet.");
        const s = book.byName(sheet.getName())!;
        book.sheets.splice(book.sheets.indexOf(s), 1);
        if (book.active === s) book.active = book.sheets.find((x) => !x.hidden) ?? book.sheets[0]!;
      },
    };
    return facade;
  }

  private sheetFacade(book: BookModel, s: SheetModel): Record<string, any> {
    const range = (row: number, col: number, nr = 1, nc = 1) =>
      this.rangeFacade(s, row, col, nr, nc);
    const grow = (rows: number, cols: number) => {
      s.maxRows += rows;
      s.maxCols += cols;
      if (book.cellCount() > this.limits.workbookCells) {
        s.maxRows -= rows;
        s.maxCols -= cols;
        throw exception(
          'This action would increase the number of cells in the workbook above the limit of 10000000 cells.',
        );
      }
    };
    return {
      getName: () => s.name,
      setName: (name: string) => {
        this.sheetCost();
        if (book.byName(name) && book.byName(name) !== s) {
          throw exception(
            `A sheet with the name "${name}" already exists. Please enter another name.`,
          );
        }
        s.name = name;
      },
      getSheetId: () => s.id,
      getParent: () => this.bookFacade(book),
      getLastRow: () => {
        this.sheetCost();
        return s.lastBounds().row;
      },
      getLastColumn: () => {
        this.sheetCost();
        return s.lastBounds().col;
      },
      getMaxRows: () => s.maxRows,
      getMaxColumns: () => s.maxCols,
      insertRowsAfter: (after: number, howMany: number) => {
        this.sheetCost();
        grow(howMany, 0);
      },
      insertColumnsAfter: (after: number, howMany: number) => {
        this.sheetCost();
        grow(0, howMany);
      },
      getRange: (...a: unknown[]) => {
        this.sheetCost();
        if (typeof a[0] === 'string') {
          const [r, c, nr, nc] = parseA1(a[0], s);
          return range(r, c, nr, nc);
        }
        const [row, col, nr, nc] = a as [number, number, number | undefined, number | undefined];
        return range(row, col, nr ?? 1, nc ?? 1);
      },
      getDataRange: () => {
        this.sheetCost();
        const { row, col } = s.lastBounds();
        return range(1, 1, Math.max(row, 1), Math.max(col, 1));
      },
      clear: () => {
        this.sheetCost();
        s.wipe();
      },
      clearContents: () => {
        this.sheetCost();
        s.data = [];
        s.merges = [];
        s.lastBounds();
      },
      hideSheet: () => {
        this.sheetCost();
        const visible = book.sheets.filter((x) => !x.hidden);
        if (!s.hidden && visible.length === 1 && visible[0] === s) {
          throw exception("You can't hide the only visible sheet.");
        }
        s.hidden = true;
        if (book.active === s) book.active = book.sheets.find((x) => !x.hidden) ?? s;
      },
      showSheet: () => {
        this.sheetCost();
        s.hidden = false;
      },
      isSheetHidden: () => s.hidden,
      setFrozenRows: (n: number) => {
        this.sheetCost();
        s.frozen = n;
      },
      getFrozenRows: () => s.frozen,
      activate: () => {
        this.sheetCost();
        book.active = s;
      },
    };
  }

  private rangeFacade(
    s: SheetModel,
    row: number,
    col: number,
    nr: number,
    nc: number,
  ): Record<string, any> {
    const ints = [row, col, nr, nc];
    if (!ints.every((n) => typeof n === 'number' && Number.isInteger(n))) {
      throw exception(
        "The parameters (number,number,number) don't match the method signature for SpreadsheetApp.Sheet.getRange.",
      );
    }
    if (row < 1 || col < 1)
      throw exception('The row or column index in the range must be at least 1.');
    if (nr < 1) throw exception('The number of rows in the range must be at least one.');
    if (nc < 1) throw exception('The number of columns in the range must be at least one.');
    if (row + nr - 1 > s.maxRows || col + nc - 1 > s.maxCols) {
      throw exception('The coordinates of the range are outside the dimensions of the sheet.');
    }
    const each = (fn: (r: number, c: number, i: number, j: number) => void) => {
      for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) fn(row + i, col + j, i, j);
    };
    const read = (map: (v: unknown) => unknown) => {
      this.sheetCost(nr * nc);
      const out: unknown[][] = [];
      for (let i = 0; i < nr; i++) {
        const line: unknown[] = [];
        for (let j = 0; j < nc; j++) line.push(map(s.value(row + i, col + j)));
        out.push(line);
      }
      return out;
    };
    const write = (grid: unknown[][]) => {
      if (!Array.isArray(grid) || !grid.every(Array.isArray)) {
        throw exception(
          "The parameters (class) don't match the method signature for SpreadsheetApp.Range.setValues.",
        );
      }
      if (grid.length !== nr) {
        throw exception(
          `The number of rows in the data does not match the number of rows in the range. The data has ${grid.length} but the range has ${nr}.`,
        );
      }
      for (const line of grid) {
        if (line.length !== nc) {
          throw exception(
            `The number of columns in the data does not match the number of columns in the range. The data has ${line.length} but the range has ${nc}.`,
          );
        }
      }
      this.sheetCost(nr * nc);
      // Validate first so a bad cell changes nothing.
      const cells = grid.map((line, i) =>
        line.map((raw, j) =>
          typed(raw, s.formats.get(`${row + i},${col + j}`), this.limits.cellChars),
        ),
      );
      each((r, c, i, j) => s.set(r, c, cells[i]![j]));
    };
    const facade: Record<string, any> = {
      getRow: () => row,
      getColumn: () => col,
      getLastRow: () => row + nr - 1,
      getLastColumn: () => col + nc - 1,
      getNumRows: () => nr,
      getNumColumns: () => nc,
      getSheet: () => this.sheetFacade(this.bookOf(s), s),
      getA1Notation: () =>
        nr === 1 && nc === 1
          ? `${colLetters(col)}${row}`
          : `${colLetters(col)}${row}:${colLetters(col + nc - 1)}${row + nr - 1}`,
      getValues: () => read((v) => v),
      getValue: () => read((v) => v)[0]![0],
      getDisplayValues: () => read(display),
      getDisplayValue: () => read(display)[0]![0],
      getFormulas: () => {
        this.sheetCost(nr * nc);
        const out: string[][] = [];
        for (let i = 0; i < nr; i++) {
          out.push(Array.from({ length: nc }, (_, j) => s.get(row + i, col + j)?.f ?? ''));
        }
        return out;
      },
      setValues: (grid: unknown[][]) => {
        write(grid);
        return facade;
      },
      setValue: (value: unknown) => {
        // setValue writes the same value into every cell of the range.
        write(Array.from({ length: nr }, () => Array.from({ length: nc }, () => value)));
        return facade;
      },
      clear: () => {
        this.sheetCost(nr * nc);
        each((r, c) => {
          s.set(r, c, undefined);
          s.formats.delete(`${r},${c}`);
        });
        return facade;
      },
      clearContent: () => {
        this.sheetCost(nr * nc);
        each((r, c) => s.set(r, c, undefined));
        return facade;
      },
      setNumberFormat: (format: string) => {
        this.sheetCost(nr * nc);
        each((r, c) => {
          if (format === 'General' || format === '') s.formats.delete(`${r},${c}`);
          else s.formats.set(`${r},${c}`, format);
        });
        return facade;
      },
      getNumberFormat: () => s.formats.get(`${row},${col}`) ?? 'General',
      merge: () => {
        this.sheetCost();
        s.merges.push([row, col, nr, nc]);
        // Merging keeps the upper-left value and discards the rest.
        each((r, c) => {
          if (r !== row || c !== col) s.set(r, c, undefined);
        });
        return facade;
      },
      isBlank: () => {
        this.sheetCost(nr * nc);
        let blank = true;
        each((r, c) => {
          if (!emptyCell(s.get(r, c))) blank = false;
        });
        return blank;
      },
    };
    return facade;
  }
  private bookOf(s: SheetModel): BookModel {
    return this.books.find((b) => b.sheets.includes(s))!;
  }

  // Ui, menus, dialogs ----------------------------------------------------------------------------------------------------------

  private uiFacade(): Record<string, unknown> {
    const { buttons, buttonSets } = this.uiEnums;
    const isSet = (x: unknown) => Object.values(buttonSets).includes(x as never);
    const makeMenu = (title: string, kind: 'addon' | 'custom') => {
      const record: MenuRecord = { title, kind, items: [] };
      const menu: Record<string, unknown> = {
        addItem: (caption: string, fn: string) => {
          if (
            typeof caption !== 'string' ||
            typeof fn !== 'string' ||
            caption === '' ||
            fn === ''
          ) {
            throw exception("The parameters don't match the method signature for Ui.Menu.addItem.");
          }
          record.items.push({ caption, fn });
          return menu;
        },
        addSeparator: () => {
          record.items.push({ caption: null, fn: null, separator: true });
          return menu;
        },
        addSubMenu: (sub: { __record?: MenuRecord }) => {
          record.items.push({
            caption: sub.__record?.title ?? null,
            fn: null,
            submenu: sub.__record,
          });
          return menu;
        },
        addToUi: () => {
          this.spend(this.latency.uiMs);
          // Real Google shows nothing for a menu whose items name a function that does not exist until it is clicked; we check now.
          this.menuHistory.push(JSON.parse(JSON.stringify(record)) as MenuRecord);
        },
        __record: record,
      };
      return menu;
    };
    const answer = (fallback: string) => this.nextAnswers.shift() ?? fallback;
    const html = (ui: unknown, title: string, kind: DialogRecord['kind']) => {
      const out = ui as {
        __html?: { content: string; width: number | null; height: number | null };
      };
      if (!out || !out.__html) {
        throw exception(
          `The parameters (${typeof ui},String) don't match the method signature for Ui.${kind === 'sidebar' ? 'showSidebar' : 'showModalDialog'}.`,
        );
      }
      this.spend(this.latency.uiMs);
      this.dialogs.push({
        kind,
        title: kind === 'sidebar' ? '' : String(title),
        width: out.__html.width,
        height: out.__html.height,
        html: out.__html.content,
      });
    };
    const ui: Record<string, unknown> = {
      Button: buttons,
      ButtonSet: buttonSets,
      createMenu: (title: string) => {
        if (typeof title !== 'string')
          throw exception("The parameters don't match the method signature for Ui.createMenu.");
        return makeMenu(title, 'custom');
      },
      createAddonMenu: () => {
        if (this.addonMenu === 'unavailable') {
          throw exception(
            'createAddonMenu() can only be called from a script running as an installed add-on.',
          );
        }
        return makeMenu('Extensions > add-on', 'addon');
      },
      showModalDialog: (u: unknown, title: string) => html(u, title, 'modal'),
      showModelessDialog: (u: unknown, title: string) => html(u, title, 'modeless'),
      showSidebar: (u: unknown) => html(u, '', 'sidebar'),
      alert: (...a: unknown[]) => {
        const str = (x: unknown) => typeof x === 'string';
        const ok =
          (a.length === 1 && str(a[0])) ||
          (a.length === 2 && str(a[0]) && isSet(a[1])) ||
          (a.length === 3 && str(a[0]) && str(a[1]) && isSet(a[2]));
        if (!ok) {
          throw exception(
            `The parameters (${a.map((x) => typeof x).join(',')}) don't match the method signature for Ui.alert.`,
          );
        }
        this.spend(this.latency.uiMs);
        const hasTitle = a.length === 3;
        this.alerts.push({
          kind: 'alert',
          title: hasTitle ? (a[0] as string) : '',
          message: hasTitle ? (a[1] as string) : (a[0] as string),
          buttons: String(isSet(a[a.length - 1]) ? a[a.length - 1] : 'OK'),
        });
        return buttons[answer('OK') as keyof typeof buttons] ?? buttons.OK;
      },
      prompt: (...a: unknown[]) => {
        this.spend(this.latency.uiMs);
        this.alerts.push({
          kind: 'prompt',
          title: a.length >= 2 ? String(a[0]) : '',
          message: String(a.length >= 2 ? a[1] : a[0]),
          buttons: 'OK',
        });
        const text = answer('');
        return { getSelectedButton: () => 'OK', getResponseText: () => text };
      },
    };
    return ui;
  }

  // HtmlService -----------------------------------------------------------------------------------------------------------------

  private htmlService(): Record<string, unknown> {
    const read = (name: string): string => {
      if (typeof name !== 'string' || !this.files.has(name)) {
        throw exception(`No HTML file named ${String(name)} was found.`);
      }
      return this.files.get(name)!;
    };
    const output = (content: string): Record<string, unknown> => {
      const state = { content, width: null as number | null, height: null as number | null };
      const out: Record<string, unknown> = {
        __html: state,
        getContent: () => state.content,
        setWidth: (n: number) => {
          if (typeof n !== 'number')
            throw exception(
              "The parameters don't match the method signature for HtmlService.HtmlOutput.setWidth.",
            );
          state.width = n;
          return out;
        },
        setHeight: (n: number) => {
          if (typeof n !== 'number')
            throw exception(
              "The parameters don't match the method signature for HtmlService.HtmlOutput.setHeight.",
            );
          state.height = n;
          return out;
        },
        setTitle: () => out,
        setSandboxMode: () => out,
        addMetaTag: () => out,
        append: (s: string) => {
          state.content += s;
          return out;
        },
      };
      return out;
    };
    const template = (source: string): Record<string, unknown> => {
      const vars: Record<string, unknown> = {};
      const tpl = new Proxy(
        {
          evaluate: () => {
            // The template runs in the script's own scope, so its helper functions are visible; variables are what the script assigned.
            const body = compileTemplate(source);
            (this.ctx as any).__tpl = vars;
            (this.ctx as any).__escape = (v: unknown, inScript: boolean) =>
              inScript ? escapeJsString(v) : escapeHtml(v);
            try {
              const html = vm.runInContext(
                `(function () { with (__tpl) { return (function () { ${body} })(); } })()`,
                this.ctx,
                { timeout: this.realTimeoutMs },
              ) as string;
              return output(html);
            } finally {
              delete (this.ctx as any).__tpl;
              delete (this.ctx as any).__escape;
            }
          },
          getCode: () => compileTemplate(source),
          getRawContent: () => source,
        } as Record<string, unknown>,
        {
          set: (_t, key: string, value: unknown) => {
            vars[key] = value;
            return true;
          },
          get: (target, key: string) => (key in target ? target[key] : vars[key]),
        },
      );
      return tpl as Record<string, unknown>;
    };
    return {
      createTemplateFromFile: (name: string) => template(read(name)),
      createTemplate: (source: string) => template(String(source)),
      createHtmlOutputFromFile: (name: string) => output(read(name)),
      createHtmlOutput: (source?: string) => output(source === undefined ? '' : String(source)),
    };
  }

  // PropertiesService, CacheService, LockService ----------------------------------------------------------------------------------

  private propertiesService(): Record<string, unknown> {
    const store = (kind: 'user' | 'document' | 'script'): Record<string, unknown> | null => {
      const f = this.frame();
      const book = f ? f.book : this.current;
      const map = this.propsOf(kind, book);
      if (!map) return null;
      const bytes = (v: string) => Buffer.byteLength(v, 'utf8');
      const total = () => [...map].reduce((n, [k, v]) => n + bytes(k) + bytes(v), 0);
      const put = (key: unknown, value: unknown) => {
        if (typeof key !== 'string' || key === '') throw exception('Argument cannot be null: key');
        const text = String(value);
        if (bytes(text) > this.limits.propertyValueBytes)
          throw exception('Argument too large: value');
        const next =
          total() -
          (map.has(key) ? bytes(key) + bytes(map.get(key)!) : 0) +
          bytes(key) +
          bytes(text);
        if (next > this.limits.propertiesTotalBytes) throw exception('Storage limit exceeded.');
        map.set(key, text);
      };
      const self: Record<string, unknown> = {
        getProperty: (key: string) => {
          this.spend(5);
          return map.has(key) ? map.get(key)! : null;
        },
        setProperty: (key: string, value: unknown) => {
          this.spend(5);
          put(key, value);
          return self;
        },
        setProperties: (obj: Record<string, unknown>, deleteAllOthers?: boolean) => {
          this.spend(5);
          if (deleteAllOthers) map.clear();
          for (const [k, v] of Object.entries(obj)) put(k, v);
          return self;
        },
        getProperties: () => {
          this.spend(5);
          return Object.fromEntries(map);
        },
        getKeys: () => [...map.keys()],
        deleteProperty: (key: string) => {
          this.spend(5);
          map.delete(key);
          return self;
        },
        deleteAllProperties: () => {
          map.clear();
          return self;
        },
      };
      return self;
    };
    return {
      getUserProperties: () => store('user'),
      getScriptProperties: () => store('script'),
      // Google: null when the script runs outside a document (a time-driven trigger of an editor add-on).
      getDocumentProperties: () => store('document'),
    };
  }

  private cacheService(): Record<string, unknown> {
    const cache = (kind: string): Record<string, unknown> => {
      const map = this.caches.get(kind) ?? new Map<string, { v: string; exp: number }>();
      this.caches.set(kind, map);
      const live = (key: string) => {
        const e = map.get(key);
        if (e && e.exp > this.nowMs) return e.v;
        map.delete(key);
        return null;
      };
      const self: Record<string, unknown> = {
        get: (key: string) => live(key),
        put: (key: string, value: string, ttlSeconds = 600) => {
          if (key.length > 250) throw exception('Argument too large: key');
          if (Buffer.byteLength(value, 'utf8') > 100 * 1024)
            throw exception('Argument too large: value');
          map.set(key, { v: String(value), exp: this.nowMs + Math.min(ttlSeconds, 21_600) * 1000 });
        },
        remove: (key: string) => void map.delete(key),
        getAll: (keys: string[]) =>
          Object.fromEntries(keys.flatMap((k) => (live(k) === null ? [] : [[k, live(k)]]))),
        putAll: (obj: Record<string, string>, ttl?: number) => {
          for (const [k, v] of Object.entries(obj)) (self.put as any)(k, v, ttl);
        },
        removeAll: (keys: string[]) => keys.forEach((k) => map.delete(k)),
      };
      return self;
    };
    return {
      getUserCache: () => cache('user'),
      getScriptCache: () => cache('script'),
      getDocumentCache: () => {
        const f = this.frame();
        const book = f ? f.book : this.current;
        return book ? cache(`document:${book.id}`) : null;
      },
    };
  }

  private lockService(): Record<string, unknown> {
    const lock = (key: string): Record<string, unknown> => {
      const state = this.locks.get(key) ?? { owner: null };
      this.locks.set(key, state);
      const me = () => this.frame()?.id ?? 0;
      const free = () => state.owner === null || state.owner === me();
      return {
        tryLock: (ms: number) => {
          this.spend(5);
          if (free()) {
            state.owner = me();
            return true;
          }
          this.spend(Math.min(ms, 30_000));
          return false;
        },
        waitLock: (ms: number) => {
          this.spend(5);
          if (free()) {
            state.owner = me();
            return;
          }
          this.spend(Math.min(ms, 30_000));
          throw exception('Lock timeout: another process was holding the lock for too long.');
        },
        hasLock: () => state.owner === me() && state.owner !== null,
        releaseLock: () => {
          if (state.owner === me()) state.owner = null;
        },
      };
    };
    return {
      getScriptLock: () => lock('script'),
      getUserLock: () => lock('user'),
      // Google: null outside a document.
      getDocumentLock: () => {
        const f = this.frame();
        const book = f ? f.book : this.current;
        return book ? lock(`document:${book.id}`) : null;
      },
    };
  }

  // ScriptApp -------------------------------------------------------------------------------------------------------------------

  private scriptApp(): Record<string, unknown> {
    const wrap = (t: TriggerModel) => ({
      getHandlerFunction: () => t.fn,
      getEventType: () => eventTypes[t.event],
      getTriggerSource: () => triggerSources[t.source],
      getTriggerSourceId: () => t.sourceId,
      getUniqueId: () => t.id,
    });
    const enumOf = (names: string[]) =>
      Object.fromEntries(names.map((n) => [n, { toString: () => n, name: () => n }]));
    const eventTypes = enumOf([
      'ON_EDIT',
      'ON_OPEN',
      'ON_CHANGE',
      'ON_FORM_SUBMIT',
      'CLOCK',
    ]) as Record<string, unknown>;
    const triggerSources = enumOf(['SPREADSHEETS', 'CLOCK']) as Record<string, unknown>;
    const create = (t: Omit<TriggerModel, 'id'>) => {
      this.need(SCOPE.scriptApp, 'ScriptApp.newTrigger');
      this.needAuthorized('ScriptApp.newTrigger');
      this.spend(60);
      if (!this.lookupFunction(t.fn)) throw exception(`Script function not found: ${t.fn}`);
      if (this.triggers.length >= this.limits.triggersPerUser) {
        throw exception(
          'This script has too many triggers. Triggers must be deleted from the script before more can be added.',
        );
      }
      const model: TriggerModel = { ...t, id: String(++this.triggerSeq * 1000003) };
      this.triggers.push(model);
      return wrap(model);
    };
    return {
      EventType: eventTypes,
      TriggerSource: triggerSources,
      AuthMode: enumOf(['FULL', 'LIMITED', 'NONE', 'CUSTOM_FUNCTION']),
      getProjectTriggers: () => {
        this.need(SCOPE.scriptApp, 'ScriptApp.getProjectTriggers');
        this.needAuthorized('ScriptApp.getProjectTriggers');
        this.spend(60);
        return this.triggers.map(wrap);
      },
      deleteTrigger: (trigger: { getUniqueId(): string }) => {
        this.need(SCOPE.scriptApp, 'ScriptApp.deleteTrigger');
        this.needAuthorized('ScriptApp.deleteTrigger');
        this.spend(60);
        this.triggers = this.triggers.filter((t) => t.id !== trigger.getUniqueId());
      },
      newTrigger: (fn: string) => {
        this.need(SCOPE.scriptApp, 'ScriptApp.newTrigger');
        if (typeof fn !== 'string')
          throw exception(
            "The parameters don't match the method signature for ScriptApp.newTrigger.",
          );
        return {
          forSpreadsheet: (target: { getId?: () => string } | string) => {
            const id = typeof target === 'string' ? target : target.getId!();
            const builder = (event: TriggerModel['event']) => () => ({
              create: () => create({ fn, event, source: 'SPREADSHEETS', sourceId: id }),
            });
            return {
              onEdit: builder('ON_EDIT'),
              onOpen: builder('ON_OPEN'),
              onChange: builder('ON_CHANGE'),
              onFormSubmit: builder('ON_FORM_SUBMIT'),
            };
          },
          timeBased: () => {
            const clock = (every: number | undefined) => ({
              create: () =>
                create({ fn, event: 'CLOCK', source: 'CLOCK', sourceId: '', everyHours: every }),
            });
            return {
              everyHours: (n: number) => {
                if (![1, 2, 4, 6, 8, 12].includes(n))
                  throw exception('Invalid number of hours: must be 1, 2, 4, 6, 8 or 12.');
                return clock(n);
              },
              everyMinutes: (n: number) => {
                if (![1, 5, 10, 15, 30].includes(n))
                  throw exception('Invalid number of minutes: must be 1, 5, 10, 15 or 30.');
                if (this.mode === 'addon') {
                  throw exception(
                    'Add-ons can only create time-driven triggers that run once an hour at most.',
                  );
                }
                return clock(undefined);
              },
              everyDays: () => clock(24),
            };
          },
        };
      },
    };
  }

  // UrlFetchApp -----------------------------------------------------------------------------------------------------------------

  private urlFetchApp(): Record<string, unknown> {
    const canonical = (name: string) =>
      name.replace(/(^|-)([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
    const response = (res: HarnessResponse) => {
      const raw = Object.entries(res.headers ?? {}).map(
        ([k, v]) => [canonical(k.toLowerCase()), v] as const,
      );
      const body = res.body ?? '';
      return {
        getResponseCode: () => res.status,
        getContentText: (_charset?: string) => body,
        getContent: () => Array.from(Buffer.from(body, 'utf8'), (b) => (b > 127 ? b - 256 : b)),
        getHeaders: () =>
          Object.fromEntries(raw.map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v])),
        getAllHeaders: () => Object.fromEntries(raw.map(([k, v]) => [k, v])),
        getBlob: () => ({ getDataAsString: () => body }),
      };
    };
    return {
      fetch: (url: unknown, params?: Record<string, any>) => {
        this.need(SCOPE.externalRequest, 'UrlFetchApp.fetch');
        this.needAuthorized('UrlFetchApp.fetch');
        if (typeof url !== 'string' || !/^https?:\/\/[^\s/]+/i.test(url)) {
          throw exception(`Invalid argument: ${String(url)}`);
        }
        if (url.length > 2048) throw exception('Invalid argument: url (URL is too long)');
        const method = String(params?.method ?? 'get').toLowerCase();
        if (!['get', 'delete', 'patch', 'post', 'put'].includes(method)) {
          throw exception(`Invalid argument: method`);
        }
        const payload = params?.payload;
        const body =
          payload === undefined || payload === null
            ? undefined
            : typeof payload === 'string'
              ? payload
              : new URLSearchParams(payload as Record<string, string>).toString();
        if (body !== undefined && Buffer.byteLength(body, 'utf8') > this.limits.fetchPayloadBytes) {
          throw exception('Exceeded maximum request size.');
        }
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries((params?.headers as Record<string, string>) ?? {}))
          headers[k] = String(v);
        let contentType: string | undefined = params?.contentType;
        if (body !== undefined && contentType === undefined)
          contentType = 'application/x-www-form-urlencoded';
        if (contentType) headers['Content-Type'] = contentType;
        const follow = params?.followRedirects !== false;
        const mute = params?.muteHttpExceptions === true;
        if (++this.fetchCount > this.limits.urlFetchCallsPerDay) {
          throw exception('Service invoked too many times for one day: urlfetch.');
        }
        let target = url;
        let redirects = 0;
        for (;;) {
          this.spend(this.latency.fetchMs);
          const request: HarnessRequest = {
            url: target,
            method,
            headers: { ...headers },
            body,
            contentType,
            muteHttpExceptions: mute,
            followRedirects: follow,
          };
          this.onFetch?.(request);
          const log = {
            url: target,
            method,
            headers: { ...headers },
            body,
            status: null as number | null,
            failed: null as string | null,
          };
          this.fetchLog.push(log);
          if (!this.fetchHandler) {
            log.failed = `DNS error: ${target}`;
            throw exception(`DNS error: ${target}`);
          }
          let res: HarnessResponse;
          try {
            res = this.fetchHandler(request);
          } catch (err) {
            if (err instanceof ExecutionKilled) throw err;
            const message = err instanceof Error ? err.message : String(err);
            log.failed = message;
            throw exception(message);
          }
          if (res.delayMs) this.spend(res.delayMs);
          log.status = res.status;
          const location = Object.entries(res.headers ?? {}).find(
            ([k]) => k.toLowerCase() === 'location',
          )?.[1];
          if (follow && res.status >= 301 && res.status <= 308 && location && res.status !== 304) {
            if (++redirects > 20) throw exception('Too many redirects.');
            target = new URL(
              String(Array.isArray(location) ? location[0] : location),
              target,
            ).toString();
            continue;
          }
          if (!mute && res.status >= 400) {
            throw exception(
              `Request failed for ${new URL(target).origin} returned code ${res.status}. Truncated server response: ${(res.body ?? '').slice(0, 500)} (use muteHttpExceptions option to examine full response)`,
            );
          }
          return response(res);
        }
      },
    };
  }

  // Utilities and Session -------------------------------------------------------------------------------------------------------

  private utilities(): Record<string, unknown> {
    const bytesOf = (v: unknown): Buffer =>
      Array.isArray(v) ? unsignedBuffer(v as number[]) : Buffer.from(String(v), 'utf8');
    const algorithms: Record<string, string> = {
      MD5: 'md5',
      SHA_1: 'sha1',
      SHA_256: 'sha256',
      SHA_384: 'sha384',
      SHA_512: 'sha512',
    };
    const DigestAlgorithm = Object.fromEntries(
      ['MD2', 'MD5', 'SHA_1', 'SHA_256', 'SHA_384', 'SHA_512'].map((n) => [n, n]),
    );
    const blob = (data: unknown, contentType?: string, name?: string): Record<string, unknown> => {
      const self: Record<string, unknown> = {
        getBytes: () => signed(bytesOf(data)),
        getDataAsString: () => bytesOf(data).toString('utf8'),
        getContentType: () => contentType ?? null,
        getName: () => name ?? null,
        setName: (n: string) => ((name = n), self),
        setContentType: (c: string) => ((contentType = c), self),
      };
      return self;
    };
    return {
      DigestAlgorithm,
      Charset: { UTF_8: 'UTF_8', US_ASCII: 'US_ASCII' },
      sleep: (ms: number) => {
        if (typeof ms !== 'number' || ms < 0 || ms > 300_000)
          throw exception('Invalid argument: milliseconds');
        this.spend(ms);
      },
      getUuid: () => crypto.randomUUID(),
      base64Encode: (data: unknown) => bytesOf(data).toString('base64'),
      base64EncodeWebSafe: (data: unknown) => bytesOf(data).toString('base64url'),
      base64Decode: (text: string) => signed(Buffer.from(text, 'base64')),
      computeDigest: (algorithm: string, value: unknown) => {
        const name = algorithms[algorithm];
        if (!name) throw exception(`Unsupported digest algorithm: ${algorithm}`);
        return signed(crypto.createHash(name).update(bytesOf(value)).digest());
      },
      computeHmacSha256Signature: (value: unknown, key: unknown) =>
        signed(crypto.createHmac('sha256', bytesOf(key)).update(bytesOf(value)).digest()),
      newBlob: blob,
      formatDate: (date: Date, tz: string, pattern: string) => {
        if (Object.prototype.toString.call(date) !== '[object Date]')
          throw exception(
            "The parameters don't match the method signature for Utilities.formatDate.",
          );
        return formatDate(date, tz, pattern);
      },
    };
  }

  private session(): Record<string, unknown> {
    const user = () => {
      const allowed = this.scopes.includes(SCOPE.userEmail);
      return { getEmail: () => (allowed ? this.userEmail : '') };
    };
    return {
      getActiveUser: () => {
        this.needAuthorized('Session.getActiveUser');
        return user();
      },
      getEffectiveUser: () => {
        this.needAuthorized('Session.getEffectiveUser');
        return user();
      },
      getScriptTimeZone: () => this.manifest.timeZone ?? 'Etc/UTC',
      getActiveUserLocale: () => 'en',
    };
  }
}
