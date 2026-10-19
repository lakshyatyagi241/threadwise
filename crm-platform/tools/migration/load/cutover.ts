import { createDecipheriv, createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { armedFlowUuids, flowState } from './flowstate';
import { connect, sql, withPrivileged, withTenant } from './db';

/**
 * cutover: the SEPARATE, explicit, per-client step that connects a migrated WhatsApp number to WaDesk. It is never part of `run`/`migrate`:
 * until it is applied the channel stays disconnected and no webhook of Meta reaches WaDesk, so the two systems never answer the same
 * customers. Three modes, one command:
 *
 *   (default)           DRY RUN: reads the state, prints a PASS/FAIL checklist and the Meta calls the apply would make. No write, no Meta call
 *                       (add --check-meta for the two READ-ONLY Graph GETs).
 *   --apply             needs --confirm-org-slug <slug>, --i-switched-waboo-off and --confirm-cutover "CUT OVER <slug>", and refuses while
 *                       any checklist item FAILs. Does what the app's connect service does, in order, each step idempotent and logged to
 *                       migration.run_log (collection _cutover): (1) verify the token with read-only Graph GETs, (2) subscribe the WABA with the
 *                       per-WABA callback override, (3) mark the connection and the channel connected, (4) flow-state, LAST.
 *   --rollback          dry run of the way back; with --apply (+ --confirm-org-slug, --confirm-cutover "ROLL BACK <slug>"): flows back to
 *                       draft, the override removed at Meta, the channel disconnected and unlinked, the connection pending again.
 *
 * The Meta token is only ever read from the sealed wa_provider_configs row, opened in memory with the app's key (CREDENTIALS_ENCRYPTION_KEY,
 * plus CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS), sent as an Authorization header and never printed, logged or stored.
 */
export interface CutoverOptions {
  dumpsDir: string;
  client: string;
  orgSlug: string;
  targetUrl: string;
  ownerUrl: string;
  mode: 'dry' | 'apply' | 'rollback-dry' | 'rollback';
  confirmOrgSlug?: string;
  confirmCutover?: string;
  /** --i-switched-waboo-off */
  wabooOff: boolean;
  /** dry run only: also make the read-only Graph GETs */
  checkMeta: boolean;
  /** --replace-existing-override: a different per-WABA callback is already set at Meta and may be replaced */
  replaceOverride: boolean;
  /** --webhook-base: the app's public base URL; default WABA_WEBHOOK_PUBLIC_URL, then APP_URL (the same order as the app) */
  webhookBase?: string;
  reconcilePath: string;
  maxReportAgeHours: number;
  /** the newest backup taken for the cutover, found by the caller (cycle.cjs) on the server; null = none seen */
  backup: { name: string; atMs: number } | null;
  log: (line: string) => void;
  env?: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export const CUTOVER_COLLECTION = '_cutover';
const BACKUP_MAX_AGE_HOURS = 24;
const WEBHOOK_PATH = '/v2/public/webhooks/whatsapp'; // waba-rules.ts WEBHOOK_PATH
const OVERRIDE_RETRIES = 3; // the app retries the override 3 x 1 s after a first plain subscribe (waba-admin.client.ts)
const GRAPH_TIMEOUT_MS = 15_000;
const PHONE_FIELDS = 'id,display_phone_number,verified_name,platform_type,code_verification_status,status';

// ---- nothing secret is ever printed -----------------------------------------------------------------------------------------------
const SECRETS = new Set<string>();
export const scrub = (s: string): string => {
  let t = String(s);
  for (const v of SECRETS) if (v.length >= 6) t = t.split(v).join('<redacted>');
  return t.replace(/\?k=[0-9a-f]{8,}/gi, '?k=<hidden>').replace(/Bearer\s+\S+/gi, 'Bearer <redacted>');
};

// ---- the app's callback URL and verify token (waba-rules.ts + waba-connect.service.ts callback()) ----------------------------------
type Env = Record<string, string | undefined>;
export interface Callback {
  url: string;
  verifyToken: string;
  verifyTokenFrom: string;
}
export function callbackFor(env: Env, baseFlag?: string): Callback | { error: string } {
  const keyB64 = (env.CREDENTIALS_ENCRYPTION_KEY ?? '').trim();
  if (!keyB64) return { error: 'CREDENTIALS_ENCRYPTION_KEY is not set in this process (the callback URL secret and the default verify token derive from it)' };
  const base = (baseFlag || env.WABA_WEBHOOK_PUBLIC_URL || env.APP_URL || '').trim();
  if (!base) return { error: 'no public URL of the app: pass --webhook-base https://<api host> (or set WABA_WEBHOOK_PUBLIC_URL / APP_URL)' };
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    return { error: 'the public URL of the app is not a URL' };
  }
  if (u.protocol !== 'https:') return { error: 'the public URL of the app must be https (Meta only calls https)' };
  if (/^(localhost|127\.|\[?::1)/i.test(u.hostname)) return { error: 'the public URL of the app is a local address: Meta cannot reach it' };
  const key = createHmac('sha256', Buffer.from(keyB64, 'base64')).update('waba-webhook-url-key').digest('hex').slice(0, 32);
  const url = `${base.replace(/\/+$/, '')}${WEBHOOK_PATH}?k=${key}`;
  const configured = (env.WABA_VERIFY_TOKEN ?? '').trim() || (env.WHATSAPP_VERIFY_TOKEN ?? '').trim();
  const from = (env.WABA_VERIFY_TOKEN ?? '').trim() ? 'WABA_VERIFY_TOKEN' : configured ? 'WHATSAPP_VERIFY_TOKEN' : 'derived from CREDENTIALS_ENCRYPTION_KEY';
  const verifyToken = configured || createHmac('sha256', Buffer.from(keyB64, 'base64')).update('waba-webhook-verify-token').digest('hex').slice(0, 40);
  SECRETS.add(key);
  SECRETS.add(verifyToken);
  return { url, verifyToken, verifyTokenFrom: from };
}
/** the URL without its secret, for the screen */
export const shownUrl = (url: string): string => url.replace(/\?k=.*/, '?k=<hidden>');

// ---- the sealed token (CryptoService format v1:<iv>:<tag>:<ct>[:<keyid>], AES-256-GCM; same code as import-whatsapp-credentials.cjs) ---
export function openSealed(blob: string, env: Env): { accessToken: string; providerHint: string[] } {
  const raw = (env.CREDENTIALS_ENCRYPTION_KEY ?? '').trim();
  if (!raw) throw new Error('CREDENTIALS_ENCRYPTION_KEY is not set in this process');
  const ring = [raw, ...String(env.CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS ?? '').split(',').map((k) => k.trim()).filter(Boolean)].map((b64) => {
    const key = Buffer.from(b64, 'base64');
    if (key.length !== 32) throw new Error('an encryption key is not 32 bytes (base64)');
    return { id: createHash('sha256').update(key).digest('hex').slice(0, 8), key };
  });
  const p = typeof blob === 'string' ? blob.split(':') : [];
  if (p[0] !== 'v1' || (p.length !== 4 && p.length !== 5) || !p[1] || !p[2] || !p[3]) throw new Error('the stored credential is not in the app format');
  const cands = p.length === 5 ? ring.filter((k) => k.id === p[4]) : ring;
  if (cands.length === 0) throw new Error('the stored credential was sealed with a key that is not in this process key ring');
  let plain: string | null = null;
  for (const k of cands) {
    try {
      const d = createDecipheriv('aes-256-gcm', k.key, Buffer.from(p[1]!, 'base64'));
      d.setAuthTag(Buffer.from(p[2]!, 'base64'));
      plain = Buffer.concat([d.update(Buffer.from(p[3]!, 'base64')), d.final()]).toString('utf8');
      break;
    } catch {
      /* try the next key */
    }
  }
  if (plain === null) throw new Error('the stored credential does not open with this key');
  let o: { access_token?: unknown };
  try {
    o = JSON.parse(plain) as { access_token?: unknown };
  } catch {
    throw new Error('the opened credential is not JSON');
  }
  if (typeof o.access_token !== 'string' || o.access_token.length < 20) throw new Error('the opened credential holds no access token');
  SECRETS.add(o.access_token);
  return { accessToken: o.access_token, providerHint: Object.keys(o).sort() };
}

// ---- the reconcile report -------------------------------------------------------------------------------------------------------------
export interface ReportFacts {
  ok: boolean;
  unaccounted: number;
  alarms: number;
  integrity: number;
  generatedAt: Date;
}
/** The header line toMarkdown() (reconcile/index.ts) writes: "Generated <iso>. **PASS**  (unaccounted N, alarms N, integrity N)". */
export function parseReconcile(md: string): ReportFacts | null {
  const g = /Generated (\S+?)\.?\s/.exec(md);
  const h = /\*\*(PASS|FAIL)\*\*\s+\(unaccounted (\d+), alarms (\d+), integrity (\d+)\)/.exec(md);
  if (!g || !h) return null;
  const at = new Date(g[1]!);
  if (Number.isNaN(at.getTime())) return null;
  return { ok: h[1] === 'PASS', unaccounted: Number(h[2]), alarms: Number(h[3]), integrity: Number(h[4]), generatedAt: at };
}

// ---- the checklist (pure) -------------------------------------------------------------------------------------------------------------
export type ItemStatus = 'PASS' | 'FAIL' | 'MANUAL' | 'SKIP';
export interface Item {
  id: string;
  status: ItemStatus;
  text: string;
}
export interface NumberFacts {
  ext: string;
  channel: { status: string; wabaConfigId: number | null } | null;
  cfg: { id: number; status: string; via: string | null; providerKey: string | null; wabaId: string | null; hasCredentials: boolean } | null;
  /** null = not tried (no config); a string = why the sealed token could not be opened; true = opened */
  tokenOpens: true | string | null;
}
export interface Facts {
  orgFound: boolean;
  numbers: NumberFacts[];
  report: ReportFacts | { error: string } | null;
  /** newest update of any run_log row of the client except _cutover/_flows (what the report must be newer than) */
  lastLoadAt: Date | null;
  flows: { live: number; stray: number; armed: number };
  backup: { name: string; atMs: number } | null;
  callback: Callback | { error: string };
  now: Date;
  wabooOff: boolean;
  maxReportAgeHours: number;
}
const tail = (ext: string): string => `...${ext.slice(-4)}`;
const isCallbackError = (c: Callback | { error: string }): c is { error: string } => 'error' in c;

export function buildChecklist(f: Facts): Item[] {
  const out: Item[] = [];
  const add = (id: string, ok: boolean, text: string): void => void out.push({ id, status: ok ? 'PASS' : 'FAIL', text });
  add('org', f.orgFound, f.orgFound ? 'the organization exists and was made by this tool for this client' : 'no organization with this slug made by this tool for this client');
  if (f.numbers.length === 0) add('channel', false, 'no WhatsApp channel made by this tool exists (run the inbox step with a channel map)');
  for (const n of f.numbers) {
    const t = tail(n.ext);
    add(`number-id:${n.ext}`, /^\d{5,32}$/.test(n.ext), `channel ${t} carries a real phone number id (digits)`);
    const chOk = !!n.channel && n.channel.status === 'disconnected' && n.channel.wabaConfigId === null;
    const chDone = !!n.channel && n.channel.status === 'connected' && !!n.cfg && n.channel.wabaConfigId === n.cfg.id && n.cfg.status === 'connected';
    add(`channel:${n.ext}`, chOk || chDone, !n.channel ? `channel ${t} does not exist` : chDone ? `channel ${t} is already connected and linked (apply will skip the database step)` : chOk ? `channel ${t} exists, is disconnected and unlinked` : `channel ${t} is ${n.channel.status}${n.channel.wabaConfigId !== null ? ' and linked' : ''}: not in the state the migration left it`);
    const c = n.cfg;
    add(`config:${n.ext}`, !!c && c.hasCredentials && c.via === 'migration' && ['pending', 'disconnected', 'connected'].includes(c.status), !c ? `no wa_provider_configs row for ${t} (run import-whatsapp-credentials.cjs)` : !c.hasCredentials ? `the wa_provider_configs row for ${t} holds no sealed credential` : c.via !== 'migration' ? `the wa_provider_configs row for ${t} was not made by the migration (connected_via ${c.via ?? 'none'})` : `wa_provider_configs row for ${t} exists, status ${c.status}, credential sealed`);
    // direct Meta, and Pinnacle: a number the Pinnacle partner program already onboarded at the source needs no partner call to go live. The
    // webhook subscription is a Meta call made with the client's own Meta token (as the app's connect service does) and the rest is the
    // database; sends keep going through Pinnacle with the number's channel token. Only the Interakt partner route is left to the app.
    const routeOk = !!c && (c.providerKey === 'meta' || c.providerKey === 'pinnacle') && !!c.wabaId && /^\d{5,32}$/.test(c.wabaId);
    add(`route:${n.ext}`, routeOk, !c ? `route of ${t} unknown` : c.providerKey === 'meta' ? `${t} is on the direct Meta route with WABA id ...${(c.wabaId ?? '').slice(-4)}` : c.providerKey === 'pinnacle' ? `${t} is on the Pinnacle partner route with WABA id ...${(c.wabaId ?? '').slice(-4)}: already onboarded there, so only the Meta webhook subscription and the database change are made` : `${t} is on the "${c.providerKey ?? 'unknown'}" route: this command does the direct Meta and the Pinnacle routes (the Interakt partner calls are not built; connect it in the app)`);
    out.push(
      n.tokenOpens === true
        ? { id: `token:${n.ext}`, status: 'PASS', text: `the sealed token of ${t} opens with this process's key (format and key id only; the value is never shown)` }
        : { id: `token:${n.ext}`, status: 'FAIL', text: `the sealed token of ${t} cannot be opened here: ${n.tokenOpens ?? 'no credential'}` },
    );
  }
  const r = f.report;
  if (!r || 'error' in r) add('verified', false, `migrated data is not shown verified: ${r ? r.error : 'no reconcile report'}`);
  else {
    const ageH = (f.now.getTime() - r.generatedAt.getTime()) / 3_600_000;
    const stale = f.lastLoadAt !== null && r.generatedAt.getTime() < f.lastLoadAt.getTime();
    add(
      'verified',
      r.integrity === 0 && r.unaccounted === 0 && ageH <= f.maxReportAgeHours && !stale,
      `reconcile report ${r.ok ? 'PASS' : 'FAIL'}: integrity ${r.integrity}, unaccounted ${r.unaccounted}, alarms ${r.alarms}; generated ${r.generatedAt.toISOString()} (${ageH.toFixed(1)} h old, limit ${f.maxReportAgeHours} h)${stale ? '; OLDER than the last load step: reconcile again' : ''}`,
    );
  }
  add('flows', f.flows.stray === 0, `flows: ${f.flows.live} live, ${f.flows.armed} recorded by flow-state, ${f.flows.stray} live but NOT recorded (must be 0)`);
  const bAge = f.backup ? (f.now.getTime() - f.backup.atMs) / 3_600_000 : null;
  add('backup', !!f.backup && bAge !== null && bAge <= BACKUP_MAX_AGE_HOURS, f.backup ? `backup ${f.backup.name} is ${bAge!.toFixed(1)} h old (limit ${BACKUP_MAX_AGE_HOURS} h)` : 'no backup taken for the cutover was found (cycle.cjs takes one before --apply)');
  add('webhook', !isCallbackError(f.callback), isCallbackError(f.callback) ? `callback URL: ${f.callback.error}` : `callback URL ${shownUrl(f.callback.url)}; verify token from ${f.callback.verifyTokenFrom}`);
  out.push({
    id: 'waboo-off',
    status: f.wabooOff ? 'PASS' : 'MANUAL',
    text: f.wabooOff ? 'operator confirmed (--i-switched-waboo-off): the Waboo bots/flows for this number are switched off' : 'MANUAL: this tool cannot see Waboo. Switch off its bots/flows for this number, then pass --i-switched-waboo-off',
  });
  out.push({ id: 'verify-token-same', status: 'MANUAL', text: `MANUAL: the API that serves the callback must use the same verify token (${isCallbackError(f.callback) ? 'unknown' : f.callback.verifyTokenFrom}); Meta checks it when the override is set` });
  out.push({ id: 'app-of-token', status: 'MANUAL', text: 'MANUAL: the subscription is made with the client token, i.e. for the Meta app that token belongs to; that app must be the one whose webhook is overridden (plan: Waboo\'s app). The tool cannot read this without --check-meta' });
  return out;
}

export interface Gate {
  refusals: string[];
}
/** What --apply requires. Pure: the CLI and the tests use the same function. */
export function applyGate(o: Pick<CutoverOptions, 'mode' | 'orgSlug' | 'confirmOrgSlug' | 'confirmCutover' | 'wabooOff'>, items: Item[]): Gate {
  const refusals: string[] = [];
  const rolling = o.mode === 'rollback';
  if (o.confirmOrgSlug !== o.orgSlug) refusals.push('--confirm-org-slug must equal the organization slug');
  const phrase = `${rolling ? 'ROLL BACK' : 'CUT OVER'} ${o.orgSlug}`;
  if (o.confirmCutover !== phrase) refusals.push(`--confirm-cutover must be exactly "${phrase}"`);
  if (!rolling) {
    if (!o.wabooOff) refusals.push('--i-switched-waboo-off is required: switch the Waboo side off first');
    for (const i of items) if (i.status === 'FAIL') refusals.push(`checklist FAIL (${i.id}): ${i.text}`);
  }
  return { refusals };
}

// ---- the Meta calls (listed in the dry run; made in the apply) ------------------------------------------------------------------------
export interface PlannedCall {
  step: string;
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  fields: string;
}
export function metaPlan(ext: string, wabaId: string, rolling: boolean): PlannedCall[] {
  const sub = `/${wabaId}/subscribed_apps`;
  if (rolling)
    return [
      { step: 'read the subscription', method: 'GET', path: sub, fields: '(none)' },
      { step: 'remove the subscription (this clears the override)', method: 'DELETE', path: sub, fields: '(none)' },
      { step: 'subscribe again, no override: Meta falls back to the app-level callback', method: 'POST', path: sub, fields: '(none)' },
      { step: 'confirm the override is gone', method: 'GET', path: sub, fields: '(none)' },
    ];
  return [
    { step: '1 verify the token (read-only)', method: 'GET', path: `/${ext}`, fields: `query fields=${PHONE_FIELDS}` },
    { step: '2a read the current subscription (read-only)', method: 'GET', path: sub, fields: '(none)' },
    { step: '2b subscribe with the per-WABA callback override', method: 'POST', path: sub, fields: 'json {override_callback_uri: <app webhook URL>, verify_token: <verify token>}' },
    { step: '2c on refusal only: plain subscribe, then the override again up to 3 times, 1 s apart (as the app does)', method: 'POST', path: sub, fields: '(none), then the same json as 2b' },
    { step: '2d confirm the override is now ours (read-only)', method: 'GET', path: sub, fields: '(none)' },
  ];
}

// ---- the Graph layer (small fetch, timeout, token only in a header) -----------------------------------------------------------------
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export class GraphError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(scrub(message));
  }
}
export interface GraphDeps {
  fetchImpl: FetchLike;
  base: string;
  version: string;
  sleep: (ms: number) => Promise<void>;
}
export function graphDeps(env: Env, o: Pick<CutoverOptions, 'fetchImpl' | 'sleep'>): GraphDeps {
  return {
    fetchImpl: o.fetchImpl ?? ((i, init) => fetch(i, init)),
    base: (env.META_API_ENDPOINT?.trim() || 'https://graph.facebook.com').replace(/\/+$/, ''),
    version: env.META_API_VERSION?.trim() || 'v25.0',
    sleep: o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
  };
}
export async function graph<T = Record<string, unknown>>(
  d: GraphDeps,
  token: string,
  req: { method: 'GET' | 'POST' | 'DELETE'; path: string; query?: Record<string, string>; json?: unknown },
): Promise<T> {
  if (!d.base.startsWith('https://')) throw new GraphError(0, 'the Graph endpoint must be https');
  const url = new URL(`${d.base}/${d.version}${req.path}`);
  for (const [k, v] of Object.entries(req.query ?? {})) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await d.fetchImpl(url.toString(), {
      method: req.method,
      headers: { Authorization: `Bearer ${token}`, ...(req.json !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: req.json !== undefined ? JSON.stringify(req.json) : undefined,
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
    });
  } catch (e) {
    throw new GraphError(0, `${req.method} ${req.path}: no answer from Meta (${(e as Error).name})`);
  }
  const text = await res.text();
  let body: { error?: { message?: string; code?: number; error_subcode?: number } } & Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    /* not JSON */
  }
  if (!res.ok)
    throw new GraphError(res.status, `${req.method} ${req.path}: HTTP ${res.status}${body.error ? ` code ${body.error.code ?? '?'}: ${body.error.message ?? ''}` : ''}`);
  return body as T;
}

interface SubEntry {
  whatsapp_business_api_data?: { id?: string; override_callback_uri?: string };
}
const norm = (u: string): string => u.replace(/\/+$/, '');
/** The override URLs set on the WABA's subscribed apps (read-only). */
export async function readOverrides(d: GraphDeps, token: string, wabaId: string): Promise<string[]> {
  const r = await graph<{ data?: SubEntry[] }>(d, token, { method: 'GET', path: `/${wabaId}/subscribed_apps` });
  return (r.data ?? []).map((e) => e.whatsapp_business_api_data?.override_callback_uri).filter((x): x is string => !!x);
}

export interface VerifyResult {
  ok: boolean;
  text: string;
}
/** Step 1: a read-only phone read. Proves the token, the phone number id and that the number is on the Cloud API. */
export async function verifyToken(d: GraphDeps, token: string, ext: string, displayAddress: string | null): Promise<VerifyResult> {
  try {
    const p = await graph<{ id?: string; display_phone_number?: string; platform_type?: string; code_verification_status?: string; status?: string }>(d, token, {
      method: 'GET',
      path: `/${ext}`,
      query: { fields: PHONE_FIELDS },
    });
    if (p.id !== undefined && p.id !== ext) return { ok: false, text: `Meta answered for another phone number id (${tail(String(p.id))})` };
    if ((p.platform_type ?? '').toUpperCase() === 'ON_PREMISE') return { ok: false, text: 'the number is still on the On-Premises API: register it on the Cloud API first' };
    const digits = (s: string | null | undefined): string => (s ?? '').replace(/\D/g, '');
    if (displayAddress && p.display_phone_number && digits(displayAddress) !== digits(p.display_phone_number) && !digits(p.display_phone_number).endsWith(digits(displayAddress)) && !digits(displayAddress).endsWith(digits(p.display_phone_number)))
      return { ok: false, text: `the number Meta shows (...${digits(p.display_phone_number).slice(-4)}) is not the channel's (...${digits(displayAddress).slice(-4)})` };
    return { ok: true, text: `token accepted; number ...${digits(p.display_phone_number).slice(-4)}, platform ${p.platform_type ?? '?'}, status ${p.status ?? '?'}` };
  } catch (e) {
    return { ok: false, text: (e as Error).message };
  }
}

export interface SubscribeResult {
  ok: boolean;
  skipped?: boolean;
  text: string;
  /** a different override was there before (host only; the URL may hold a secret) */
  previousOverrideHost?: string | null;
}
const hostOf = (u: string): string => {
  try {
    return new URL(u).host;
  } catch {
    return '?';
  }
};
/** Step 2, the app's subscribeDirect() plus a read before and after. Idempotent: an override that is already ours is not set again. */
export async function subscribeWaba(d: GraphDeps, token: string, wabaId: string, cb: Callback, replaceOverride: boolean): Promise<SubscribeResult> {
  const path = `/${wabaId}/subscribed_apps`;
  const body = { override_callback_uri: cb.url, verify_token: cb.verifyToken };
  try {
    const before = await readOverrides(d, token, wabaId);
    if (before.some((u) => norm(u) === norm(cb.url))) return { ok: true, skipped: true, text: 'the override already points at this app: nothing to set' };
    const foreign = before.find((u) => norm(u) !== norm(cb.url));
    if (foreign && !replaceOverride)
      return { ok: false, text: `a different per-WABA callback is already set (host ${hostOf(foreign)}): pass --replace-existing-override to replace it`, previousOverrideHost: hostOf(foreign) };
    let set = false;
    try {
      await graph(d, token, { method: 'POST', path, json: body });
      set = true;
    } catch (e) {
      if (e instanceof GraphError && (e.status === 401 || e.status === 403)) throw e;
    }
    if (!set) {
      await graph(d, token, { method: 'POST', path });
      for (let i = 0; i < OVERRIDE_RETRIES && !set; i++) {
        await d.sleep(1000);
        try {
          await graph(d, token, { method: 'POST', path, json: body });
          set = true;
        } catch {
          /* retry */
        }
      }
    }
    const after = await readOverrides(d, token, wabaId);
    const wired = after.some((u) => norm(u) === norm(cb.url));
    return wired
      ? { ok: true, text: 'subscribed; the override points at this app (confirmed by a read)', previousOverrideHost: foreign ? hostOf(foreign) : null }
      : { ok: false, text: 'subscribed, but Meta did not confirm the override (inbound would not reach this app): not marked connected; check the verify token and the public URL, or roll back' };
  } catch (e) {
    return { ok: false, text: (e as Error).message };
  }
}

/** Rollback at Meta: remove the subscription (this drops the override), subscribe again without one, confirm. UNVERIFIED against live Meta. */
export async function removeOverride(d: GraphDeps, token: string, wabaId: string, cb: Callback): Promise<SubscribeResult> {
  const path = `/${wabaId}/subscribed_apps`;
  try {
    const before = await readOverrides(d, token, wabaId);
    if (!before.some((u) => norm(u) === norm(cb.url))) return { ok: true, skipped: true, text: 'the override of this app is not set: nothing to remove' };
    await graph(d, token, { method: 'DELETE', path });
    await graph(d, token, { method: 'POST', path });
    const after = await readOverrides(d, token, wabaId);
    return after.some((u) => norm(u) === norm(cb.url))
      ? { ok: false, text: 'the override is still set after remove + subscribe: remove it in the Meta app (WhatsApp > Configuration) by hand' }
      : { ok: true, text: 'override removed; the WABA is subscribed without one (Meta uses the app-level callback)' };
  } catch (e) {
    return { ok: false, text: (e as Error).message };
  }
}

// ---- the command --------------------------------------------------------------------------------------------------------------------
const AUTOMATION_CATEGORY = 'Waboo automation';
const CHATBOT_CATEGORY = 'Waboo chatbot';
type Tx = { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> };

async function logStep(db: Tx, client: string, step: string, state: string, counts: Record<string, unknown>): Promise<void> {
  await db.execute(sql`
    INSERT INTO migration.run_log (source_client, collection, step, run_id, last_key, state, counts)
    VALUES (${client}, ${CUTOVER_COLLECTION}, ${step}, 'cutover', 0, ${state}, ${JSON.stringify({ ...counts, at: new Date().toISOString() })}::jsonb)
    ON CONFLICT (source_client, collection, step) DO UPDATE SET state = EXCLUDED.state, counts = EXCLUDED.counts, run_id = EXCLUDED.run_id, updated_at = now()`);
}

interface ChanRow {
  id: number | string;
  status: string;
  external_id: string | null;
  display_address: string | null;
  waba_config_id: number | string | null;
  client: string | null;
}
interface CfgRow {
  id: number | string;
  status: string;
  credentials_json: string | null;
  waba_id: string | null;
  pid: string | null;
  provider_key: string | null;
  via: string | null;
}

export async function cutover(o: CutoverOptions): Promise<number> {
  const env = o.env ?? (process.env as Env);
  const now = (o.now ?? (() => new Date()))();
  const say = (s: string): void => o.log(scrub(s));
  const owner = connect(o.ownerUrl, 'owner');
  const worker = connect(o.targetUrl, 'worker');
  const rolling = o.mode === 'rollback' || o.mode === 'rollback-dry';
  const applying = o.mode === 'apply' || o.mode === 'rollback';
  try {
    const org = (
      await withPrivileged(owner.db, (tx) =>
        tx.execute(sql`SELECT id FROM organizations WHERE slug = ${o.orgSlug} AND settings #>> '{legacy,waboo,client}' = ${o.client}`),
      )
    ).rows[0] as { id: number | string } | undefined;
    if (!org) {
      say(`  FAIL  org: no organization "${o.orgSlug}" made by this tool for ${o.client}`);
      return 1;
    }
    const orgId = Number(org.id);

    const chans = (
      await withTenant(worker.db, { orgId }, (tx) =>
        tx.execute(sql`SELECT id, status, external_id, display_address, waba_config_id, settings #>> '{legacy,waboo,client}' AS client
                       FROM channels WHERE org_id = ${orgId} AND kind = 'whatsapp_cloud' ORDER BY id`),
      )
    ).rows as unknown as ChanRow[];
    const cfgs = (
      await withTenant(worker.db, { orgId }, (tx) =>
        tx.execute(sql`SELECT id, status, credentials_json, meta_json->>'waba_id' AS waba_id, meta_json->>'phone_number_id' AS pid,
                              meta_json->>'provider_key' AS provider_key, meta_json->>'connected_via' AS via
                       FROM wa_provider_configs WHERE org_id = ${orgId} AND provider = 'waba' ORDER BY id`),
      )
    ).rows as unknown as CfgRow[];
    const mine = chans.filter((c) => c.client === o.client);

    // the tokens live only in this map, only in memory
    const tokens = new Map<string, string>();
    const numbers: NumberFacts[] = mine.map((c) => {
      const ext = String(c.external_id ?? '');
      const cfg = cfgs.find((x) => x.pid === ext) ?? null;
      let tokenOpens: NumberFacts['tokenOpens'] = null;
      if (cfg?.credentials_json) {
        try {
          tokens.set(ext, openSealed(cfg.credentials_json, env).accessToken);
          tokenOpens = true;
        } catch (e) {
          tokenOpens = (e as Error).message;
        }
      }
      return {
        ext,
        channel: { status: c.status, wabaConfigId: c.waba_config_id === null ? null : Number(c.waba_config_id) },
        cfg: cfg ? { id: Number(cfg.id), status: cfg.status, via: cfg.via, providerKey: cfg.provider_key, wabaId: cfg.waba_id, hasCredentials: !!cfg.credentials_json } : null,
        tokenOpens,
      };
    });

    let report: Facts['report'];
    try {
      report = parseReconcile(readFileSync(o.reconcilePath, 'utf8')) ?? { error: 'the report has no result line in the format this command reads' };
    } catch {
      report = { error: `cannot read ${o.reconcilePath}` };
    }
    const lastLoad = (
      await worker.db.execute(
        sql`SELECT max(updated_at) AS t FROM migration.run_log WHERE source_client = ${o.client} AND collection NOT IN (${CUTOVER_COLLECTION}, '_flows')`,
      )
    ).rows[0] as { t: Date | string | null };
    const flowRows = (
      await withTenant(worker.db, { orgId }, (tx) =>
        tx.execute(sql`SELECT uuid::text AS uuid, is_published, is_active FROM flows WHERE org_id = ${orgId} AND category IN (${AUTOMATION_CATEGORY}, ${CHATBOT_CATEGORY})`),
      )
    ).rows as unknown as Array<{ uuid: string; is_published: boolean; is_active: boolean }>;
    const armed = await armedFlowUuids(worker.db, o.client);
    const liveFlows = flowRows.filter((f) => f.is_active);

    const callback = callbackFor(env, o.webhookBase);
    const facts: Facts = {
      orgFound: true,
      numbers,
      report,
      lastLoadAt: lastLoad?.t ? new Date(lastLoad.t) : null,
      flows: { live: liveFlows.length, armed: armed.size, stray: liveFlows.filter((f) => !armed.has(f.uuid)).length },
      backup: o.backup,
      callback,
      now,
      wabooOff: o.wabooOff,
      maxReportAgeHours: o.maxReportAgeHours,
    };
    const items = buildChecklist(facts);

    say(`cutover ${rolling ? 'ROLLBACK' : ''} ${applying ? 'APPLY' : 'DRY RUN'} for ${o.client} / ${o.orgSlug}`);
    if (!rolling) {
      say('checklist');
      for (const i of items) say(`  ${i.status.padEnd(6)} ${i.text}`);
    }
    const d = graphDeps(env, o);
    const cb = isCallbackError(callback) ? null : callback;

    say('Meta calls ' + (applying ? 'this run makes' : 'an apply would make (none made now)') + ' (Authorization: Bearer <token of the number>, never shown):');
    for (const n of numbers)
      for (const c of metaPlan(n.ext, n.cfg?.wabaId ?? '<waba id>', rolling)) say(`  ${tail(n.ext)}  ${c.method.padEnd(6)} ${c.path}  ${c.step}; ${c.fields}`);

    // ---- dry runs -----------------------------------------------------------------------------------------------------------------
    if (!applying) {
      if (!rolling && o.checkMeta && cb)
        for (const n of numbers) {
          const tok = tokens.get(n.ext);
          if (!tok || !n.cfg?.wabaId) continue;
          const v = await verifyToken(d, tok, n.ext, mine.find((c) => c.external_id === n.ext)?.display_address ?? null);
          say(`  ${v.ok ? 'PASS' : 'FAIL'}   Meta read ${tail(n.ext)}: ${v.text}`);
          try {
            const ov = await readOverrides(d, tok, n.cfg.wabaId);
            const ours = ov.filter((u) => norm(u) === norm(cb.url)).length;
            say(`  ${ov.length - ours > 0 ? 'WARN' : 'PASS'}   Meta subscription of the WABA of ${tail(n.ext)}: ${ov.length} override(s), ${ours} ours${ov.length - ours > 0 ? '; apply needs --replace-existing-override' : ''}`);
          } catch (e) {
            say(`  FAIL   Meta subscription read ${tail(n.ext)}: ${(e as Error).message}`);
          }
        }
      else if (!rolling) say('  SKIP   Meta token and subscription were NOT read (add --check-meta for the two read-only GETs; apply always does them)');
      const fails = items.filter((i) => i.status === 'FAIL').length;
      say(rolling ? 'rollback DRY RUN: nothing was written (add --rollback --apply --confirm-org-slug <slug> --confirm-cutover "ROLL BACK <slug>")' : `DRY RUN: nothing was written. ${fails} FAIL, ${items.filter((i) => i.status === 'MANUAL').length} MANUAL. Apply: --apply --confirm-org-slug ${o.orgSlug} --i-switched-waboo-off --confirm-cutover "CUT OVER ${o.orgSlug}"`);
      return rolling || fails === 0 ? 0 : 1;
    }

    // ---- the gate -----------------------------------------------------------------------------------------------------------------
    const gate = applyGate(o, items);
    if (gate.refusals.length > 0) {
      for (const r of gate.refusals) say(`  REFUSED  ${r}`);
      say('Nothing was changed.');
      return 3;
    }
    if (!cb) {
      say('  REFUSED  no callback URL');
      return 3;
    }

    if (rolling) return await doRollback();
    return await doApply();

    // ---- apply ---------------------------------------------------------------------------------------------------------------------
    async function doApply(): Promise<number> {
      const cbk = cb!;
      // 1. verify every token before anything is subscribed
      for (const n of numbers) {
        const v = await verifyToken(d, tokens.get(n.ext)!, n.ext, mine.find((c) => c.external_id === n.ext)?.display_address ?? null);
        say(`  ${v.ok ? 'DONE' : 'FAIL'}  1 verify ${tail(n.ext)}: ${v.text}`);
        await logStep(worker.db, o.client, `verify:${n.ext}`, v.ok ? 'done' : 'failed', { ok: v.ok, detail: v.text });
        if (!v.ok) return fail('nothing was subscribed or changed');
      }
      // 2. subscribe with the override
      for (const n of numbers) {
        await logStep(worker.db, o.client, `subscribe:${n.ext}`, 'started', {});
        const s = await subscribeWaba(d, tokens.get(n.ext)!, n.cfg!.wabaId!, cbk, o.replaceOverride);
        say(`  ${s.ok ? 'DONE' : 'FAIL'}  2 subscribe ${tail(n.ext)}: ${s.text}`);
        await logStep(worker.db, o.client, `subscribe:${n.ext}`, s.ok ? 'done' : 'failed', { ok: s.ok, skipped: !!s.skipped, previousOverrideHost: s.previousOverrideHost ?? null });
        if (!s.ok) return fail('the database was not changed; run --rollback --apply to undo any subscription already made');
      }
      // 3. mark connected, exactly as the app's persist() + the channel link do
      for (const n of numbers) {
        const stamp = new Date().toISOString();
        await withTenant(worker.db, { orgId }, async (tx) => {
          await tx.execute(sql`
            UPDATE wa_provider_configs SET status = 'connected', connected_at = coalesce(connected_at, now()), last_health_at = now(),
              meta_json = coalesce(meta_json, '{}'::jsonb) || ${JSON.stringify({ inbound_wired: true, inbound_checked_at: stamp, last_error: null })}::jsonb
            WHERE org_id = ${orgId} AND provider = 'waba' AND id = ${n.cfg!.id}`);
          await tx.execute(sql`
            UPDATE channels SET waba_config_id = ${n.cfg!.id}, status = 'connected', last_error = NULL,
              display_address = coalesce(display_address, (SELECT phone_number FROM wa_provider_configs WHERE org_id = ${orgId} AND id = ${n.cfg!.id})),
              business_account_id = coalesce(${n.cfg!.wabaId}, business_account_id)
            WHERE org_id = ${orgId} AND kind = 'whatsapp_cloud' AND external_id = ${n.ext}`);
        });
        say(`  DONE  3 connected ${tail(n.ext)}: connection and channel`);
      }
      await logStep(worker.db, o.client, 'mark_connected', 'done', { numbers: numbers.length });
      // 4. flows, LAST (flow-state refuses while a channel is connected unless told it is the cutover)
      await flowState({ dumpsDir: o.dumpsDir, client: o.client, orgSlug: o.orgSlug, targetUrl: o.targetUrl, ownerUrl: o.ownerUrl, apply: true, allowConnected: true, log: say });
      await logStep(worker.db, o.client, 'flow_state', 'done', { armed: (await armedFlowUuids(worker.db, o.client)).size });
      say('cutover DONE. Watch the first inbound message in the WaDesk inbox; to undo: cutover --rollback --apply ...');
      return 0;
    }

    // ---- rollback ------------------------------------------------------------------------------------------------------------------
    async function doRollback(): Promise<number> {
      const cbk = cb!;
      let failed = false;
      const ids = [...armed];
      if (ids.length > 0)
        await withTenant(worker.db, { orgId }, (tx) =>
          tx.execute(sql`UPDATE flows SET is_published = false, is_active = false, published_at = NULL, row_version = row_version + 1
                         WHERE org_id = ${orgId} AND uuid::text IN (${sql.join(ids.map((u) => sql`${u}`), sql`, `)}) AND (is_published OR is_active)`),
        );
      await worker.db.execute(sql`
        UPDATE migration.run_log SET counts = jsonb_set(counts, '{armed}', '[]'::jsonb) || ${JSON.stringify({ rolledBackAt: new Date().toISOString() })}::jsonb, updated_at = now()
        WHERE source_client = ${o.client} AND collection = '_flows' AND step = 'flow_state'`);
      say(`  DONE  flows back to draft (${ids.length} that flow-state had armed)`);
      for (const n of numbers) {
        const tok = tokens.get(n.ext);
        if (!tok || !n.cfg?.wabaId) {
          say(`  FAIL  override of ${tail(n.ext)} NOT removed: no token/WABA id; remove it in the Meta app by hand`);
          failed = true;
          continue;
        }
        const r = await removeOverride(d, tok, n.cfg.wabaId, cbk);
        say(`  ${r.ok ? 'DONE' : 'FAIL'}  Meta ${tail(n.ext)}: ${r.text}`);
        if (!r.ok) failed = true;
        await withTenant(worker.db, { orgId }, async (tx) => {
          await tx.execute(sql`UPDATE channels SET status = 'disconnected', waba_config_id = NULL WHERE org_id = ${orgId} AND kind = 'whatsapp_cloud' AND external_id = ${n.ext}`);
          await tx.execute(sql`
            UPDATE wa_provider_configs SET status = 'pending', connected_at = NULL,
              meta_json = coalesce(meta_json, '{}'::jsonb) || '{"inbound_wired": false, "inbound_checked_at": null}'::jsonb
            WHERE org_id = ${orgId} AND provider = 'waba' AND id = ${n.cfg!.id}`);
        });
        say(`  DONE  ${tail(n.ext)}: channel disconnected and unlinked, connection pending again`);
      }
      await logStep(worker.db, o.client, 'mark_connected', 'rolled_back', {});
      await logStep(worker.db, o.client, 'rollback', failed ? 'failed' : 'done', { failed });
      say(failed ? 'ROLLBACK finished with a FAILED Meta step (see above): remove the override by hand' : 'ROLLBACK done. Switch the Waboo side back on.');
      return failed ? 1 : 0;
    }

    function fail(msg: string): number {
      say(`cutover STOPPED: ${msg}`);
      return 1;
    }
  } finally {
    await worker.close();
    await owner.close();
  }
}
