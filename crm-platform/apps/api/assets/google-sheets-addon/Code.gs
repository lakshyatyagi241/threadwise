/**
 * CRM add-on for Google Sheets (server side).
 *
 * Initial Setup (paste the Webhook URL from the CRM, pick the trigger column, Send Test, Submit), then the sheet sends new or changed
 * rows to the CRM as contacts: on every edit of the trigger column ("Send on event") and/or in an hourly sweep for rows that were
 * changed from elsewhere ("Send on schedule"). The older actions stay: check the connection, pull contacts into a sheet, push contacts
 * from a sheet, and sync products to a storefront shop.
 *
 * Every call goes to the CRM's add-on API at <server>/api/v1/sheets-addon with `Authorization: Bearer <key>`. The server and the key both
 * come from the pasted Webhook URL (<server>/api/v1/sheets-addon/webhook/<key>), so one published add-on serves every CRM installation;
 * a copy downloaded from the CRM falls back to CRM_BASE when only a key is pasted.
 *
 * The key lives only in the member's own user properties. It is never written to the sheet, never to the document properties (a sheet
 * can be shared), never to a log, and it is never sent back to the dialogs: they only ever see a masked copy.
 */

// The download of this file rewrites the next line to this installation's address. Keep it on one line.
const CRM_BASE = 'https://api.example.com';

const API_PATH = '/api/v1/sheets-addon';
const MENU_TITLE = 'CRM';
const KEY_PREFIX = 'wsn_live_';
const KEY_PATTERN = /^wsn_live_[0-9a-f]{32}$/;
const PROP_KEY = 'CRM_SHEETS_KEY';
const PROP_CAN = 'CRM_SHEETS_CAN';
const PROP_SHOP_ID = 'CRM_SHOP_ID';
const PROP_SHOP_NAME = 'CRM_SHOP_NAME';
const PROP_BASE = 'CRM_SHEETS_BASE';
const PROP_HOOK_SHEET = 'CRM_HOOK_SHEET';
const PROP_HOOK_COLUMN = 'CRM_HOOK_COLUMN';
const PROP_HOOK_EVENT = 'CRM_HOOK_EVENT';
const PROP_HOOK_SCHEDULE = 'CRM_HOOK_SCHEDULE';
const HOOK_PATH_PATTERN =
  /^(https:\/\/[^\s\/?#]+(?:\/[^\s?#]*?)?)\/api\/v1\/sheets-addon\/webhook\/(wsn_live_[0-9a-f]{32})\/?$/;
const STATE_SHEET = 'CRM sync state';
const EVENT_HANDLER = 'crmOnEditSend';
const SCHEDULE_HANDLER = 'crmScheduledSend';
const MAX_EVENT_ROWS = 50;
const MAX_ROWS = 500;
const PULL_PAGE = 500;
const PULL_MAX_PAGES = 100;
const PULL_SHEET = 'CRM contacts';
const STATUS_HEADER = 'CRM status';
const MAX_AUTO_WAIT_SECONDS = 20;
const MAX_RETRIES = 2;

const CONTACT_FIELDS = {
  name: ['name', 'fullname', 'contactname'],
  first_name: ['firstname', 'first'],
  last_name: ['lastname', 'last', 'surname'],
  email: ['email', 'emailaddress', 'mail'],
  phone: ['phone', 'phonenumber', 'mobile', 'mobilenumber', 'whatsapp', 'whatsappnumber'],
  country_code: ['countrycode', 'dialcode'],
  source: ['source'],
  is_unsubscribed: ['isunsubscribed', 'unsubscribed', 'optedout'],
};

const PRODUCT_FIELDS = {
  name: ['name', 'productname', 'title'],
  category: ['category'],
  description: ['description'],
  image_url: ['imageurl', 'image', 'imageaddress'],
  price: ['price'],
  sku: ['sku'],
  stock: ['stock', 'quantity', 'inventory'],
  active: ['active', 'enabled', 'published'],
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Menu and dialogs
// ---------------------------------------------------------------------------------------------------------------------------------

function onOpen() {
  buildMenu_(readCan_());
}

function onInstall() {
  onOpen();
}

/** Builds the menu. `can` is what the last connection check said the key may do (null = not checked yet: show everything). */
function buildMenu_(can) {
  const ui = SpreadsheetApp.getUi();
  let menu;
  try {
    // Shown under Extensions when this runs as an installed add-on; a copied project has no add-on menu and gets its own.
    menu = ui.createAddonMenu();
  } catch (e) {
    menu = ui.createMenu(MENU_TITLE);
  }
  menu.addItem('Initial Setup', 'openSetup');
  menu.addItem('Send a test row', 'sendTestMenu');
  menu.addItem('Check connection', 'checkConnectionMenu');
  const allowed = function (flag) {
    return !can || can[flag] === true;
  };
  let groups = 0;
  if (allowed('read_contacts') || allowed('write_contacts')) {
    menu.addSeparator();
    if (allowed('read_contacts')) menu.addItem('Pull contacts into a sheet', 'openPull');
    if (allowed('write_contacts')) menu.addItem('Push contacts from this sheet', 'openPush');
    groups++;
  }
  if (allowed('write_catalog')) {
    menu.addSeparator();
    menu.addItem('Sync products to a shop', 'openProducts');
    groups++;
  }
  menu.addSeparator();
  menu.addItem('Help', 'openHelp');
  menu.addToUi();
  return groups;
}

function openSetup() {
  showDialog_('Settings', 'Initial Setup', 520, 640);
}

function openSettings() {
  openSetup();
}

function openHelp() {
  showDialog_('Help', 'Help', 520, 520);
}

function openPull() {
  showDialog_('Dialog', 'Pull contacts', 520, 440, 'pull');
}

function openPush() {
  showDialog_('Dialog', 'Push contacts', 520, 480, 'push');
}

function openProducts() {
  showDialog_('Dialog', 'Sync products to a shop', 520, 560, 'products');
}

function showDialog_(file, title, width, height, mode) {
  const template = HtmlService.createTemplateFromFile(file);
  template.mode = mode || '';
  const html = template.evaluate().setWidth(width).setHeight(height);
  SpreadsheetApp.getUi().showModalDialog(html, title);
}

function checkConnectionMenu() {
  const ui = SpreadsheetApp.getUi();
  const result = checkConnection();
  if (!result.ok) {
    ui.alert('CRM connection', result.message, ui.ButtonSet.OK);
    return;
  }
  ui.alert('CRM connection', describeConnection_(result), ui.ButtonSet.OK);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Key storage (the member's own user properties; nothing here ever logs or returns the secret)
// ---------------------------------------------------------------------------------------------------------------------------------

function userProps_() {
  return PropertiesService.getUserProperties();
}

function docProps_() {
  return PropertiesService.getDocumentProperties();
}

function readKey_() {
  return userProps_().getProperty(PROP_KEY) || '';
}

/** The server this member's CRM lives at: learned from the pasted Webhook URL, else the address written into a downloaded copy. */
function readBase_() {
  return (userProps_().getProperty(PROP_BASE) || CRM_BASE).replace(/\/+$/, '');
}

/**
 * Reads what the member pasted: the Webhook URL (<server>/api/v1/sheets-addon/webhook/<key>) or just a key. Returns { base, key } or
 * null. A bare key uses the address of this copy of the add-on.
 */
function parseConnection_(text) {
  const value = typeof text === 'string' ? text.trim() : '';
  const hook = HOOK_PATH_PATTERN.exec(value);
  if (hook) return { base: hook[1], key: hook[2] };
  if (isValidKey_(value)) return { base: '', key: value };
  return null;
}

/** A column given as a letter (F) or as the text of its heading in row 1 becomes a 0-based index; -1 when blank or not found. */
function columnIndex_(spec, headers) {
  const text = typeof spec === 'string' ? spec.trim() : '';
  if (text === '') return -1;
  if (/^[A-Za-z]{1,3}$/.test(text)) {
    let n = 0;
    const upper = text.toUpperCase();
    for (let i = 0; i < upper.length; i++) n = n * 26 + (upper.charCodeAt(i) - 64);
    return n - 1;
  }
  const wanted = normalizeHeader_(text);
  for (let i = 0; i < headers.length; i++) {
    if (normalizeHeader_(headers[i]) === wanted) return i;
  }
  return -1;
}

function readCan_() {
  try {
    const raw = userProps_().getProperty(PROP_CAN);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function isValidKey_(value) {
  return typeof value === 'string' && KEY_PATTERN.test(value.trim());
}

/** `wsn_live_••••••••89abcdef`: the prefix and the last 8 characters, nothing else. Empty text for no key. */
function maskKey_(value) {
  if (typeof value !== 'string' || value.length < KEY_PREFIX.length + 8) return '';
  return KEY_PREFIX + '••••••••' + value.slice(-8);
}

/** What Settings may show: whether a key is saved and its masked form. */
function getSettingsState() {
  const key = readKey_();
  const props = docProps_();
  const sheets = SpreadsheetApp.getActiveSpreadsheet()
    .getSheets()
    .map(function (s) {
      return s.getName();
    })
    .filter(function (name) {
      return name !== STATE_SHEET && name !== PULL_SHEET;
    });
  return {
    hasKey: key !== '',
    masked: maskKey_(key),
    can: readCan_(),
    base: readBase_(),
    sheets: sheets,
    sheet: props.getProperty(PROP_HOOK_SHEET) || SpreadsheetApp.getActiveSheet().getName(),
    column: props.getProperty(PROP_HOOK_COLUMN) || '',
    onEvent: props.getProperty(PROP_HOOK_EVENT) === 'on',
    onSchedule: props.getProperty(PROP_HOOK_SCHEDULE) === 'on',
  };
}

/** Saves the pasted key after a connection check proves it works. A key that fails is not kept. */
function saveKey(pasted) {
  const candidate = typeof pasted === 'string' ? pasted.trim() : '';
  if (candidate === '') {
    return failure_('EXT_KEY_MISSING', 0, 'Paste your Webhook URL first.');
  }
  const connection = parseConnection_(candidate);
  if (!connection) {
    return failure_(
      'EXT_KEY_INVALID',
      0,
      'This does not look like a Webhook URL. Copy it from the CRM (Settings > Google Sheets add-on). It ends with ' +
        KEY_PREFIX +
        ' and 32 more characters.',
    );
  }
  const props = userProps_();
  const previousKey = props.getProperty(PROP_KEY);
  const previousBase = props.getProperty(PROP_BASE);
  props.setProperty(PROP_KEY, connection.key);
  if (connection.base) props.setProperty(PROP_BASE, connection.base);
  const result = checkConnection();
  if (!result.ok) {
    if (previousKey) props.setProperty(PROP_KEY, previousKey);
    else props.deleteProperty(PROP_KEY);
    if (previousBase) props.setProperty(PROP_BASE, previousBase);
    else props.deleteProperty(PROP_BASE);
    return result;
  }
  return result;
}

/** Removes the key and what was learned with it from this member's properties. */
function clearKey() {
  const props = userProps_();
  props.deleteProperty(PROP_KEY);
  props.deleteProperty(PROP_CAN);
  props.deleteProperty(PROP_BASE);
  stopSending_();
  try {
    buildMenu_(null);
  } catch (e) {
    // the menu is rebuilt from the saved answer the next time the sheet opens
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// HTTP: one place that talks to the API, reads the JSON body of every answer and turns failures into readable messages
// ---------------------------------------------------------------------------------------------------------------------------------

function failure_(code, status, message, extra) {
  const out = { ok: false, code: code, status: status, message: message };
  if (extra) {
    for (const name in extra) out[name] = extra[name];
  }
  return out;
}

/** The sentence a member reads for a failed call. The server's own sentence wins; a hint is added where the member can act. */
function describeFailure_(status, code, serverMessage, retryAfter) {
  const base = serverMessage || 'The CRM could not complete the request.';
  switch (code) {
    case 'EXT_KEY_MISSING':
      return 'No Webhook URL is saved yet. Open Initial Setup and paste the Webhook URL from the CRM.';
    case 'EXT_KEY_INVALID':
      return 'The key in your Webhook URL is not valid any more. Create a new one in the CRM (Settings > Google Sheets add-on), then paste the new Webhook URL in Initial Setup.';
    case 'EXT_APP_NOT_INSTALLED':
      return 'The Google Sheets add-on is not installed in this workspace. Ask an admin to install it from the Marketplace.';
    case 'EXT_SCOPE_NOT_GRANTED':
      return base + ' Ask an admin to reinstall the add-on and accept its permissions.';
    case 'PAYLOAD_TOO_LARGE':
      return 'The request was too large. Send fewer rows at a time.';
    default:
      break;
  }
  if (status === 413) return 'The request was too large. Send fewer rows at a time.';
  if (status === 429 || code === 'RATE_LIMITED') {
    return retryAfter
      ? 'Too many requests. Wait ' + retryAfter + ' seconds and try again.'
      : 'Too many requests. Wait a minute and try again.';
  }
  return base;
}

/** Whole seconds from a Retry-After header value, or 0. */
function parseRetryAfter_(value) {
  const n = parseInt(String(value === undefined || value === null ? '' : value).trim(), 10);
  return isFinite(n) && n > 0 ? n : 0;
}

function headerValue_(headers, name) {
  if (!headers) return '';
  const wanted = name.toLowerCase();
  for (const h in headers) {
    if (h.toLowerCase() === wanted) return headers[h];
  }
  return '';
}

function buildQuery_(query) {
  if (!query) return '';
  const parts = [];
  for (const name in query) {
    const value = query[name];
    if (value === undefined || value === null || value === '') continue;
    parts.push(encodeURIComponent(name) + '=' + encodeURIComponent(String(value)));
  }
  return parts.length ? '?' + parts.join('&') : '';
}

/** Turns a raw answer (status, body text, headers) into { ok:true, data } or a failure. Pure: no network. */
function interpretResponse_(status, text, headers) {
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (e) {
    json = null;
  }
  if (status === 200 && json && json.ok === true) {
    return { ok: true, status: status, data: json };
  }
  const retryAfter = parseRetryAfter_(headerValue_(headers, 'Retry-After'));
  const code = json && typeof json.code === 'string' ? json.code : 'HTTP_' + status;
  const serverMessage = json && typeof json.error === 'string' ? json.error : '';
  return failure_(code, status, describeFailure_(status, code, serverMessage, retryAfter), {
    details: json && json.details ? json.details : null,
    requestId: json && json.requestId ? json.requestId : null,
    retryAfter: retryAfter,
  });
}

/** One API call with up to two short waits when the answer is 429 with a small Retry-After. */
function callApi_(method, path, query, body, creds) {
  const key = creds ? creds.key : readKey_();
  if (!key) return failure_('EXT_KEY_MISSING', 0, describeFailure_(0, 'EXT_KEY_MISSING', '', 0));
  const options = {
    method: method,
    muteHttpExceptions: true,
    followRedirects: false,
    headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
  };
  if (body !== undefined) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }
  const base = creds && creds.base ? creds.base.replace(/\/+$/, '') : readBase_();
  const url = base + API_PATH + path + buildQuery_(query);
  let attempt = 0;
  for (;;) {
    let result;
    try {
      const response = UrlFetchApp.fetch(url, options);
      result = interpretResponse_(
        response.getResponseCode(),
        response.getContentText(),
        response.getHeaders(),
      );
    } catch (e) {
      return failure_(
        'NETWORK',
        0,
        'Could not reach the CRM at ' + base + '. Check your connection and try again.',
      );
    }
    if (result.ok || result.status !== 429) return result;
    if (attempt >= MAX_RETRIES || !result.retryAfter || result.retryAfter > MAX_AUTO_WAIT_SECONDS) {
      return result;
    }
    attempt++;
    Utilities.sleep(result.retryAfter * 1000);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Check connection
// ---------------------------------------------------------------------------------------------------------------------------------

function checkConnection() {
  const result = callApi_('get', '/health');
  if (!result.ok) return result;
  const health = result.data;
  const can = health.can || {};
  userProps_().setProperty(PROP_CAN, JSON.stringify(can));
  try {
    buildMenu_(can);
  } catch (e) {
    // the menu cannot be rebuilt from every context; the next time the sheet opens it is built from the saved answer
  }
  return {
    ok: true,
    user: health.user || {},
    workspace: health.workspace || {},
    can: can,
    limits: health.limits || { max_rows: MAX_ROWS, max_pull: PULL_PAGE },
    masked: maskKey_(readKey_()),
  };
}

function describeConnection_(info) {
  const lines = [];
  lines.push(
    'Connected as ' + (info.user.name || 'a member') + ' (' + (info.user.email || '') + ').',
  );
  lines.push('Workspace: ' + (info.workspace.name || ''));
  lines.push('');
  lines.push('This key can:');
  lines.push((info.can.read_contacts ? '  [x] ' : '  [ ] ') + 'pull contacts');
  lines.push((info.can.write_contacts ? '  [x] ' : '  [ ] ') + 'push contacts');
  lines.push((info.can.read_catalog ? '  [x] ' : '  [ ] ') + 'see shops');
  lines.push((info.can.write_catalog ? '  [x] ' : '  [ ] ') + 'sync products');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Sheet helpers (pure where possible, so they can be tested without Google)
// ---------------------------------------------------------------------------------------------------------------------------------

/** "First name", "first_name" and "FIRST-NAME" all become "firstname". */
function normalizeHeader_(value) {
  return String(value === undefined || value === null ? '' : value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Maps the header row to fields. `fields` is { field: [aliases] }. Returns { columns: { field: index }, attributes: { key: index },
 * status: index or -1 }. The first column that matches a field wins. A header written `attr:city` or `attributes.city` is the custom
 * contact property `city`.
 */
function mapHeaders_(headers, fields, allowAttributes) {
  const columns = {};
  const attributes = {};
  let status = -1;
  for (let i = 0; i < headers.length; i++) {
    const raw = String(headers[i] === undefined || headers[i] === null ? '' : headers[i]).trim();
    if (raw === '') continue;
    const normal = normalizeHeader_(raw);
    if (normal === 'crmstatus') {
      if (status < 0) status = i;
      continue;
    }
    const attr = /^(?:attr:|attributes\.)\s*(.+)$/i.exec(raw);
    if (allowAttributes && attr) {
      const attrKey = attr[1].trim();
      if (attrKey !== '' && attributes[attrKey] === undefined) attributes[attrKey] = i;
      continue;
    }
    for (const field in fields) {
      if (columns[field] === undefined && fields[field].indexOf(normal) !== -1) {
        columns[field] = i;
        break;
      }
    }
  }
  return { columns: columns, attributes: attributes, status: status };
}

function isBlank_(value) {
  return (
    value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
  );
}

/** A cell as JSON: dates become ISO text, everything else is passed as it is. Blank cells are returned as ''. */
function cellValue_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]')
    return isNaN(value.getTime()) ? '' : value.toISOString();
  if (value === undefined || value === null) return '';
  return value;
}

/**
 * Turns the sheet's rows (2D values, row 1 = headers) into API rows. `kind` is 'contacts' or 'products'. Fully blank rows are skipped.
 * Returns { rows, mapping, problem }: `problem` is a sentence when the headers cannot work, else ''.
 */
function rowsFromValues_(values, kind) {
  if (!values || values.length < 1) {
    return {
      rows: [],
      mapping: null,
      problem: 'The sheet is empty. Put the column names in row 1.',
    };
  }
  const contacts = kind === 'contacts';
  const mapping = mapHeaders_(values[0], contacts ? CONTACT_FIELDS : PRODUCT_FIELDS, contacts);
  const columns = mapping.columns;
  if (contacts && columns.email === undefined && columns.phone === undefined) {
    return {
      rows: [],
      mapping: mapping,
      problem: 'Row 1 needs a column named email or phone.',
    };
  }
  if (!contacts && (columns.name === undefined || columns.price === undefined)) {
    return {
      rows: [],
      mapping: mapping,
      problem: 'Row 1 needs columns named name and price.',
    };
  }
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const line = values[r];
    let empty = true;
    for (let c = 0; c < line.length; c++) {
      if (!isBlank_(line[c])) {
        empty = false;
        break;
      }
    }
    if (empty) continue;
    const row = { ref: r + 1 };
    for (const field in columns) {
      const value = cellValue_(line[columns[field]]);
      // A blank contact cell means "not given" and is left out. A product's stock keeps its blank, which means unlimited.
      if (isBlank_(value) && !(kind === 'products' && field === 'stock')) continue;
      row[field] = value;
    }
    if (contacts) {
      const attrs = {};
      let any = false;
      for (const attrKey in mapping.attributes) {
        const value = cellValue_(line[mapping.attributes[attrKey]]);
        if (isBlank_(value)) continue;
        attrs[attrKey] = value;
        any = true;
      }
      if (any) row.attributes = attrs;
    }
    rows.push(row);
  }
  return { rows: rows, mapping: mapping, problem: '' };
}

function chunk_(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** The text written in the status column for one row result. */
function statusText_(result) {
  if (!result) return 'no result returned';
  if (result.status !== 'failed') return result.status;
  const error = result.error || {};
  const where = error.field ? error.field + ': ' : '';
  return 'failed: ' + where + (error.message || error.code || 'unknown error');
}

function emptyTotals_() {
  return { created: 0, updated: 0, unchanged: 0, failed: 0, notSent: 0 };
}

/**
 * Adds one answer's per-row results to the totals and returns the status text for every sent row, keyed by sheet row. The totals are
 * counted from the results (not from the summary) so that a row the server did not mention is not silently counted as done.
 */
function applyResults_(totals, sentRows, results) {
  const byIndex = {};
  const list = results || [];
  for (let i = 0; i < list.length; i++) byIndex[list[i].index] = list[i];
  const texts = {};
  const problems = [];
  for (let i = 0; i < sentRows.length; i++) {
    const result = byIndex[i];
    const row = sentRows[i].ref;
    texts[row] = statusText_(result);
    if (!result) {
      totals.failed++;
    } else if (result.status === 'created') totals.created++;
    else if (result.status === 'updated') totals.updated++;
    else if (result.status === 'unchanged') totals.unchanged++;
    else {
      totals.failed++;
      problems.push('Row ' + row + ': ' + texts[row].replace(/^failed: /, ''));
    }
  }
  return { texts: texts, problems: problems };
}

/** Finds the CRM status column, or adds one after the last used column. Returns the 0-based index. */
function ensureStatusColumn_(sheet, mapping) {
  if (mapping.status >= 0) return mapping.status;
  const index = Math.max(sheet.getLastColumn(), 1);
  sheet.getRange(1, index + 1).setValue(STATUS_HEADER);
  return index;
}

/** Writes a status text for each given sheet row number into the status column (0-based `statusIndex`), in one read and one write. */
function writeStatuses_(sheet, statusIndex, texts) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const range = sheet.getRange(2, statusIndex + 1, lastRow - 1, 1);
  const column = range.getValues();
  for (const row in texts) {
    const at = Number(row) - 2;
    if (at >= 0 && at < column.length) column[at][0] = texts[row];
  }
  range.setValues(column);
}

function writeStatusBlock_(sheet, statusIndex, rowNumbers, text) {
  const map = {};
  for (let i = 0; i < rowNumbers.length; i++) map[rowNumbers[i]] = text;
  writeStatuses_(sheet, statusIndex, map);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Pull contacts
// ---------------------------------------------------------------------------------------------------------------------------------

/** What a dialog needs to open: whether a key is saved and what it may do. */
function getDialogState() {
  const key = readKey_();
  const state = {
    hasKey: key !== '',
    can: readCan_(),
    masked: maskKey_(key),
    shopId: '',
    shopName: '',
  };
  const props = docProps_();
  state.shopId = props.getProperty(PROP_SHOP_ID) || '';
  state.shopName = props.getProperty(PROP_SHOP_NAME) || '';
  state.sheetName = SpreadsheetApp.getActiveSheet().getName();
  state.pullSheet = PULL_SHEET;
  return state;
}

function contactColumns_(contacts) {
  const attributeKeys = [];
  const seen = {};
  for (let i = 0; i < contacts.length; i++) {
    const attrs = contacts[i].attributes || {};
    for (const name in attrs) {
      if (!seen[name]) {
        seen[name] = true;
        attributeKeys.push(name);
      }
    }
  }
  attributeKeys.sort();
  return attributeKeys;
}

/** One contact as a sheet line: the fixed columns, then one `attr:<key>` column for each custom property. */
function contactLine_(contact, attributeKeys) {
  const line = [
    contact.id || '',
    contact.name || '',
    contact.first_name || '',
    contact.last_name || '',
    contact.email || '',
    contact.phone || '',
    contact.source || '',
    contact.is_unsubscribed === true ? 'yes' : 'no',
    contact.created_at || '',
    contact.updated_at || '',
  ];
  const attrs = contact.attributes || {};
  for (let i = 0; i < attributeKeys.length; i++) {
    const value = attrs[attributeKeys[i]];
    line.push(
      value === undefined || value === null
        ? ''
        : typeof value === 'object'
          ? JSON.stringify(value)
          : value,
    );
  }
  return line;
}

function runPull(options) {
  const search = options && typeof options.q === 'string' ? options.q.trim() : '';
  const contacts = [];
  let cursor = '';
  let pages = 0;
  let more = false;
  for (;;) {
    const result = callApi_('get', '/contacts', { limit: PULL_PAGE, cursor: cursor, q: search });
    if (!result.ok) {
      if (contacts.length === 0) return result;
      return failure_(
        result.code,
        result.status,
        'Stopped after ' + contacts.length + ' contacts. ' + result.message,
        {
          pulled: contacts.length,
        },
      );
    }
    const page = result.data;
    const list = page.contacts || [];
    for (let i = 0; i < list.length; i++) contacts.push(list[i]);
    pages++;
    more = page.has_more === true && !!page.next_cursor;
    if (!more) break;
    if (pages >= PULL_MAX_PAGES) break;
    cursor = page.next_cursor;
  }
  const attributeKeys = contactColumns_(contacts);
  const headers = [
    'id',
    'name',
    'first_name',
    'last_name',
    'email',
    'phone',
    'source',
    'is_unsubscribed',
    'created_at',
    'updated_at',
  ].concat(
    attributeKeys.map(function (k) {
      return 'attr:' + k;
    }),
  );
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(PULL_SHEET);
  if (!sheet) sheet = spreadsheet.insertSheet(PULL_SHEET);
  sheet.clear();
  const lines = [headers].concat(
    contacts.map(function (c) {
      return contactLine_(c, attributeKeys);
    }),
  );
  sheet.getRange(1, 1, lines.length, headers.length).setValues(lines);
  sheet.setFrozenRows(1);
  spreadsheet.setActiveSheet(sheet);
  return {
    ok: true,
    pulled: contacts.length,
    sheet: PULL_SHEET,
    truncated: more,
    message: contacts.length === 0 ? 'No contacts matched.' : '',
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Push contacts
// ---------------------------------------------------------------------------------------------------------------------------------

function runPush(options) {
  const sheet = SpreadsheetApp.getActiveSheet();
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) {
    return failure_(
      'EMPTY_SHEET',
      0,
      'There are no rows to send. Row 1 is the header row; the contacts start in row 2.',
    );
  }
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const read = rowsFromValues_(values, 'contacts');
  if (read.problem) return failure_('BAD_HEADERS', 0, read.problem);
  if (read.rows.length === 0) return failure_('EMPTY_SHEET', 0, 'There are no rows to send.');

  const countryCode =
    options && typeof options.countryCode === 'string' ? options.countryCode.trim() : '';
  const statusIndex = ensureStatusColumn_(sheet, read.mapping);
  const totals = emptyTotals_();
  const problems = [];
  let stopped = null;
  const chunks = chunk_(read.rows, MAX_ROWS);
  for (let c = 0; c < chunks.length; c++) {
    const sent = chunks[c];
    const body = { rows: sent };
    if (countryCode !== '') body.default_country_code = countryCode;
    const result = callApi_('post', '/contacts/sync', undefined, body);
    if (!result.ok) {
      stopped = result;
      const unsent = [];
      for (let k = c; k < chunks.length; k++) {
        for (let j = 0; j < chunks[k].length; j++) unsent.push(chunks[k][j].ref);
      }
      totals.notSent += unsent.length;
      writeStatusBlock_(sheet, statusIndex, unsent, 'not sent: ' + result.message);
      break;
    }
    const applied = applyResults_(totals, sent, result.data.results);
    writeStatuses_(sheet, statusIndex, applied.texts);
    for (let p = 0; p < applied.problems.length && problems.length < 10; p++)
      problems.push(applied.problems[p]);
    SpreadsheetApp.flush();
  }
  return summaryReply_(totals, problems, stopped, {
    rows: read.rows.length,
    statusColumn: STATUS_HEADER,
  });
}

function summaryReply_(totals, problems, stopped, extra) {
  const reply = {
    ok: stopped === null,
    created: totals.created,
    updated: totals.updated,
    unchanged: totals.unchanged,
    failed: totals.failed,
    notSent: totals.notSent,
    problems: problems,
    rows: extra.rows,
    statusColumn: extra.statusColumn,
  };
  if (stopped) {
    reply.code = stopped.code;
    reply.status = stopped.status;
    reply.message = stopped.message;
    reply.details = stopped.details || null;
    reply.requestId = stopped.requestId || null;
  }
  return reply;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Sync products to a shop
// ---------------------------------------------------------------------------------------------------------------------------------

/** The shops the member's workspace has, for the dialog's picker. */
function listShops() {
  const result = callApi_('get', '/shops');
  if (!result.ok) return result;
  const shops = (result.data.shops || []).map(function (shop) {
    return {
      id: shop.id,
      name: shop.shop_name || shop.slug,
      currency: shop.currency,
      url: shop.public_url,
    };
  });
  const props = docProps_();
  return {
    ok: true,
    shops: shops,
    shopId: props.getProperty(PROP_SHOP_ID) || '',
    shopName: props.getProperty(PROP_SHOP_NAME) || '',
  };
}

function validShopOptions_(options) {
  const name = options && typeof options.shopName === 'string' ? options.shopName.trim() : '';
  const currency = options && typeof options.currency === 'string' ? options.currency.trim() : '';
  const description =
    options && typeof options.description === 'string' ? options.description.trim() : '';
  const errors = {};
  if (name === '') errors.shopName = 'Give the shop a name.';
  else if (name.length > 191) errors.shopName = 'The shop name is at most 191 characters.';
  if (currency !== '' && !/^[A-Za-z]{3}$/.test(currency))
    errors.currency = 'Use a 3-letter currency code such as INR or USD.';
  if (description.length > 2000) errors.description = 'The description is at most 2000 characters.';
  return { errors: errors, name: name, currency: currency.toUpperCase(), description: description };
}

function runProductSync(options) {
  const valid = validShopOptions_(options);
  if (Object.keys(valid.errors).length > 0) {
    return failure_('VALIDATION_FAILED', 0, 'Check the form and try again.', {
      fieldErrors: valid.errors,
    });
  }
  const sheet = SpreadsheetApp.getActiveSheet();
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) {
    return failure_(
      'EMPTY_SHEET',
      0,
      'There are no products to send. Row 1 is the header row; the products start in row 2.',
    );
  }
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const read = rowsFromValues_(values, 'products');
  if (read.problem) return failure_('BAD_HEADERS', 0, read.problem);
  if (read.rows.length === 0) return failure_('EMPTY_SHEET', 0, 'There are no products to send.');

  const props = docProps_();
  let shopId =
    options && typeof options.shopId === 'string' && options.shopId !== '' ? options.shopId : '';
  if (options && options.newShop === true) shopId = '';
  const statusIndex = ensureStatusColumn_(sheet, read.mapping);
  const totals = emptyTotals_();
  const problems = [];
  let stopped = null;
  let shop = null;
  const chunks = chunk_(read.rows, MAX_ROWS);
  for (let c = 0; c < chunks.length; c++) {
    const sent = chunks[c];
    const body = { shop_name: valid.name, products: sent };
    if (shopId !== '') body.shop_id = shopId;
    if (valid.currency !== '') body.currency = valid.currency;
    if (valid.description !== '') body.description = valid.description;
    const result = callApi_('post', '/sync', undefined, body);
    if (!result.ok) {
      stopped = result;
      const unsent = [];
      for (let k = c; k < chunks.length; k++) {
        for (let j = 0; j < chunks[k].length; j++) unsent.push(chunks[k][j].ref);
      }
      totals.notSent += unsent.length;
      writeStatusBlock_(sheet, statusIndex, unsent, 'not sent: ' + result.message);
      break;
    }
    const answer = result.data;
    if (answer.shop && answer.shop.id) {
      // The shop is saved first and a failing batch does not undo it, so keep its id for every later sync (and later chunks).
      shopId = answer.shop.id;
      shop = answer.shop;
      props.setProperty(PROP_SHOP_ID, shopId);
      props.setProperty(PROP_SHOP_NAME, answer.shop.shop_name || valid.name);
    }
    const applied = applyResults_(totals, sent, answer.products ? answer.products.results : []);
    writeStatuses_(sheet, statusIndex, applied.texts);
    for (let p = 0; p < applied.problems.length && problems.length < 10; p++)
      problems.push(applied.problems[p]);
    SpreadsheetApp.flush();
  }
  const reply = summaryReply_(totals, problems, stopped, {
    rows: read.rows.length,
    statusColumn: STATUS_HEADER,
  });
  if (shop) {
    reply.shop = {
      id: shop.id,
      name: shop.shop_name || valid.name,
      url: shop.public_url || '',
      created: shop.created === true,
    };
  }
  return reply;
}

/** Forgets the shop this document syncs to, so the next sync can create or pick another. */
function forgetShop() {
  const props = docProps_();
  props.deleteProperty(PROP_SHOP_ID);
  props.deleteProperty(PROP_SHOP_NAME);
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Webhook trigger: Initial Setup, Send Test, send on event, send on schedule
// ---------------------------------------------------------------------------------------------------------------------------------

/** Small stable text hash (FNV-1a) of a row, used to tell a changed row from one that was already sent. */
function rowHash_(line) {
  const text = JSON.stringify(
    (line || []).map(function (c) {
      return cellValue_(c);
    }),
  );
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}

/**
 * Which data rows the hourly sweep must send. `lines` are the sheet's rows from row 2 down, `state` maps "sheet!row" to the hash last sent.
 * A row counts when it is not blank, its trigger cell (if a trigger column is set) is filled, and it is new or its hash changed.
 * Returns [{ row, hash }].
 */
function changedRows_(lines, sheetName, triggerIndex, state) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let empty = true;
    for (let c = 0; c < line.length; c++) {
      if (!isBlank_(line[c])) {
        empty = false;
        break;
      }
    }
    if (empty) continue;
    if (triggerIndex >= 0 && isBlank_(line[triggerIndex])) continue;
    const row = i + 2;
    const hash = rowHash_(line);
    if (state[sheetName + '!' + row] !== hash) out.push({ row: row, hash: hash });
  }
  return out;
}

/** The body of one webhook call. A test carries the raw cells by heading only; a data call also carries each row as a contact. */
function buildWebhookBody_(event, sheetName, headers, lines, rowNumbers, countryCode) {
  const grid = [headers].concat(lines);
  const contacts = rowsFromValues_(grid, 'contacts');
  const byRef = {};
  for (let i = 0; i < contacts.rows.length; i++) byRef[contacts.rows[i].ref] = contacts.rows[i];
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const values = {};
    for (let c = 0; c < headers.length; c++) {
      const heading = String(
        headers[c] === undefined || headers[c] === null ? '' : headers[c],
      ).trim();
      if (heading === '' || normalizeHeader_(heading) === 'crmstatus') continue;
      values[heading] = cellValue_(lines[i][c]);
    }
    const row = event === 'test' ? {} : byRef[i + 2] || null;
    if (row === null) continue;
    row.ref = rowNumbers[i];
    row.values = values;
    rows.push(row);
  }
  const body = { event: event, sheet_name: sheetName, rows: rows };
  if (countryCode) body.default_country_code = countryCode;
  return { body: body, problem: event === 'test' ? '' : contacts.problem };
}

function hookSheet_() {
  const name = docProps_().getProperty(PROP_HOOK_SHEET) || '';
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  return (name && spreadsheet.getSheetByName(name)) || spreadsheet.getActiveSheet();
}

function readState_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STATE_SHEET);
  const state = {};
  if (!sheet || sheet.getLastRow() < 1) return state;
  const values = sheet.getRange(1, 1, sheet.getLastRow(), 2).getValues();
  for (let i = 0; i < values.length; i++) state[values[i][0]] = String(values[i][1]);
  return state;
}

function writeState_(state) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(STATE_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(STATE_SHEET);
    sheet.hideSheet();
  }
  const lines = [];
  for (const key in state) lines.push([key, state[key]]);
  sheet.clear();
  if (lines.length) sheet.getRange(1, 1, lines.length, 2).setValues(lines);
}

/**
 * Sends the given rows of the configured sheet to the CRM. `event` is 'edit', 'schedule' or 'test'. Writes each row's result to the
 * CRM status column and remembers what was sent, so the hourly sweep does not send it again.
 */
function sendRows_(event, sheet, rowNumbers) {
  const lastColumn = sheet.getLastColumn();
  if (rowNumbers.length === 0 || lastColumn < 1) return { ok: true, sent: 0 };
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const lines = rowNumbers.map(function (r) {
    return sheet.getRange(r, 1, 1, lastColumn).getValues()[0];
  });
  const built = buildWebhookBody_(event, sheet.getName(), headers, lines, rowNumbers, '');
  if (built.problem) return failure_('BAD_HEADERS', 0, built.problem);
  if (built.body.rows.length === 0) return { ok: true, sent: 0 };
  const result = callApi_('post', '/webhook', undefined, built.body);
  if (!result.ok || event === 'test') return result;
  const mapping = mapHeaders_(headers, CONTACT_FIELDS, true);
  const totals = emptyTotals_();
  const applied = applyResults_(totals, built.body.rows, result.data.results);
  const statusIndex = ensureStatusColumn_(sheet, mapping);
  writeStatuses_(sheet, statusIndex, applied.texts);
  const state = readState_();
  for (let i = 0; i < built.body.rows.length; i++) {
    const line = lines[rowNumbers.indexOf(built.body.rows[i].ref)];
    state[sheet.getName() + '!' + built.body.rows[i].ref] = rowHash_(line);
  }
  writeState_(state);
  return { ok: true, sent: built.body.rows.length, totals: totals, problems: applied.problems };
}

/** Initial Setup: Send Test. Checks the pasted URL without saving it, then sends the first data row (or the headers alone). */
function testWebhook(url, column, sheetName) {
  const connection = parseConnection_(url);
  if (!connection) return saveKey(url);
  const creds = {
    base: connection.base || readBase_(),
    key: connection.key,
  };
  const health = callApi_('get', '/health', undefined, undefined, creds);
  if (!health.ok) return health;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName) || hookSheet_();
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const hasRow = sheet.getLastRow() >= 2;
  const line = hasRow
    ? sheet.getRange(2, 1, 1, lastColumn).getValues()[0]
    : headers.map(function () {
        return '';
      });
  const built = buildWebhookBody_('test', sheet.getName(), headers, [line], [2], '');
  const sent = callApi_('post', '/webhook', undefined, built.body, creds);
  if (!sent.ok) return sent;
  const index = columnIndex_(column, headers);
  return {
    ok: true,
    user: health.data.user || {},
    workspace: health.data.workspace || {},
    fields: sent.data.fields || [],
    sheet: sheet.getName(),
    sampleRow: hasRow,
    triggerFound: column === '' || index >= 0,
  };
}

/** Initial Setup: Submit. Saves the connection and the trigger settings and turns the event and schedule senders on or off. */
function submitSetup(settings) {
  const input = settings || {};
  const saved = saveKey(input.url);
  if (!saved.ok) return saved;
  const column = typeof input.column === 'string' ? input.column.trim() : '';
  const sheetName = typeof input.sheet === 'string' ? input.sheet : '';
  const props = docProps_();
  props.setProperty(PROP_HOOK_SHEET, sheetName);
  props.setProperty(PROP_HOOK_COLUMN, column);
  props.setProperty(PROP_HOOK_EVENT, input.onEvent === true ? 'on' : 'off');
  props.setProperty(PROP_HOOK_SCHEDULE, input.onSchedule === true ? 'on' : 'off');
  try {
    syncTriggers_(input.onEvent === true, input.onSchedule === true);
  } catch (e) {
    return failure_(
      'TRIGGERS',
      0,
      'Saved, but Google did not let the add-on create its triggers: ' +
        (e && e.message ? e.message : 'unknown error') +
        '. Allow the add-on and submit again.',
    );
  }
  saved.triggers = { onEvent: input.onEvent === true, onSchedule: input.onSchedule === true };
  return saved;
}

function syncTriggers_(wantEvent, wantSchedule) {
  const existing = ScriptApp.getProjectTriggers();
  let hasEvent = false;
  let hasSchedule = false;
  for (let i = 0; i < existing.length; i++) {
    const handler = existing[i].getHandlerFunction();
    if (handler === EVENT_HANDLER) {
      if (wantEvent && !hasEvent) hasEvent = true;
      else ScriptApp.deleteTrigger(existing[i]);
    } else if (handler === SCHEDULE_HANDLER) {
      if (wantSchedule && !hasSchedule) hasSchedule = true;
      else ScriptApp.deleteTrigger(existing[i]);
    }
  }
  if (wantEvent && !hasEvent) {
    ScriptApp.newTrigger(EVENT_HANDLER)
      .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
      .onEdit()
      .create();
  }
  if (wantSchedule && !hasSchedule) {
    ScriptApp.newTrigger(SCHEDULE_HANDLER).timeBased().everyHours(1).create();
  }
}

function stopSending_() {
  try {
    syncTriggers_(false, false);
    const props = docProps_();
    props.setProperty(PROP_HOOK_EVENT, 'off');
    props.setProperty(PROP_HOOK_SCHEDULE, 'off');
  } catch (e) {
    // nothing to stop, or Google refused; the next Submit sets it right
  }
}

function sendTestMenu() {
  const ui = SpreadsheetApp.getUi();
  const state = getSettingsState();
  const key = readKey_();
  if (!key) {
    ui.alert('Send a test row', describeFailure_(0, 'EXT_KEY_MISSING', '', 0), ui.ButtonSet.OK);
    return;
  }
  const url = readBase_() + API_PATH + '/webhook/' + key;
  const result = testWebhook(url, state.column, state.sheet);
  ui.alert(
    'Send a test row',
    result.ok
      ? 'The CRM received the test and saw these columns: ' + (result.fields.join(', ') || '(none)')
      : result.message,
    ui.ButtonSet.OK,
  );
}

/** Installable edit trigger ("Send on event"): sends the rows just edited when the trigger column was among the edited cells. */
function crmOnEditSend(e) {
  try {
    const props = docProps_();
    if (props.getProperty(PROP_HOOK_EVENT) !== 'on' || !e || !e.range) return;
    const sheet = e.range.getSheet();
    const configured = props.getProperty(PROP_HOOK_SHEET) || '';
    if (sheet.getName() === STATE_SHEET || (configured && sheet.getName() !== configured)) return;
    const first = e.range.getRow();
    const last = Math.min(e.range.getLastRow(), first + MAX_EVENT_ROWS - 1);
    if (last < 2) return;
    const lastColumn = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
    const trigger = columnIndex_(props.getProperty(PROP_HOOK_COLUMN) || '', headers);
    if (
      trigger >= 0 &&
      (trigger + 1 < e.range.getColumn() || trigger + 1 > e.range.getLastColumn())
    )
      return;
    const rows = [];
    for (let r = Math.max(first, 2); r <= last; r++) {
      const line = sheet.getRange(r, 1, 1, lastColumn).getValues()[0];
      if (trigger >= 0 && isBlank_(line[trigger])) continue;
      rows.push(r);
    }
    sendRows_('edit', sheet, rows);
  } catch (err) {
    // a trigger has nobody to show an error to; the CRM status column carries the per-row outcome
  }
}

/** Installable hourly trigger ("Send on schedule"): sends rows that are new or changed since they were last sent, wherever the change came from. */
function crmScheduledSend() {
  try {
    const props = docProps_();
    if (props.getProperty(PROP_HOOK_SCHEDULE) !== 'on') return;
    const sheet = hookSheet_();
    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();
    if (lastRow < 2 || lastColumn < 1) return;
    const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
    const trigger = columnIndex_(props.getProperty(PROP_HOOK_COLUMN) || '', headers);
    const lines = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
    const changed = changedRows_(lines, sheet.getName(), trigger, readState_());
    const rows = changed.map(function (c) {
      return c.row;
    });
    const chunks = chunk_(rows, MAX_ROWS);
    for (let i = 0; i < chunks.length; i++) {
      const result = sendRows_('schedule', sheet, chunks[i]);
      if (!result.ok) break;
    }
  } catch (err) {
    // retried at the next hour
  }
}
