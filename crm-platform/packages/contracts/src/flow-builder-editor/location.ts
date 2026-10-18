import { z } from 'zod';

/**
 * The Location step's input (TW-FLB-LOC): a Google Maps link or a latitude and longitude. Pure functions shared by the builder
 * (inline errors as you type), `flbValidateGraph` (Save / Publish), the link resolver endpoint and the runtime sender, so all
 * four agree on what a usable location is.
 *
 * WhatsApp's location message (Cloud API `type: "location"`) needs `latitude` (-90..90) and `longitude` (-180..180); `name` and
 * `address` are optional. 0,0 ("Null Island") is what an empty field turns into, so it is refused as a placeholder.
 *
 * A node's data: `locMode` ('link' | 'coords'; absent on a step saved before the modes existed, which reads as 'coords'),
 * `mapsUrl` (the pasted link), `lat` / `lng` (always the resolved coordinates, as text), and the optional `title` / `address`.
 */
/** The WHATWG URL class: a global in Node and every browser; this package carries no DOM or Node typings, so the slice used is declared here. */
declare const URL: new (input: string) => {
  protocol: string;
  hostname: string;
  username: string;
  password: string;
  pathname: string;
  search: string;
  hash: string;
  searchParams: { get(name: string): string | null };
  toString(): string;
};
type MapsUrl = InstanceType<typeof URL>;

export const FLB_LOCATION_MODES = ['link', 'coords'] as const;
export type FlbLocationMode = (typeof FLB_LOCATION_MODES)[number];

export type FlbLocationProblem =
  | 'empty' // nothing entered yet
  | 'lat_missing'
  | 'lng_missing'
  | 'lat_nan'
  | 'lng_nan'
  | 'lat_range'
  | 'lng_range'
  | 'zero' // 0,0
  | 'not_url' // the link is not a web address
  | 'not_maps' // a web address, but not a Google Maps one
  | 'no_coords' // a Maps link with no pin in it (a text search, a business page)
  | 'unresolved' // a short link that has not been looked up yet
  | 'resolve_failed';

const NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

/** A coordinate typed by a person: a plain decimal, a decimal comma (`18,5204`) allowed. `null` when it is not one. */
export function flbParseCoordinate(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.trim().replace(/−/g, '-'); // a typographic minus pasted from a document
  if (/^[+-]?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  if (!NUMBER.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** The first reason these two values are not a sendable location, or `null` when they are. */
export function flbCoordinateProblem(lat: unknown, lng: unknown): FlbLocationProblem | null {
  const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === '';
  if (blank(lat) && blank(lng)) return 'empty';
  if (blank(lat)) return 'lat_missing';
  if (blank(lng)) return 'lng_missing';
  const la = flbParseCoordinate(lat);
  const ln = flbParseCoordinate(lng);
  if (la === null) return 'lat_nan';
  if (ln === null) return 'lng_nan';
  if (la < -90 || la > 90) return 'lat_range';
  if (ln < -180 || ln > 180) return 'lng_range';
  if (la === 0 && ln === 0) return 'zero';
  return null;
}

export type FlbMapsParse =
  | { kind: 'coords'; lat: number; lng: number }
  | { kind: 'short'; url: string }
  | { kind: 'invalid'; problem: FlbLocationProblem };

const COORD = '(-?\\d{1,3}(?:\\.\\d+)?)';
const PAIR = new RegExp(`^\\s*${COORD}\\s*[,;\\s]\\s*${COORD}\\s*$`);
const PIN = new RegExp(`!3d${COORD}!4d${COORD}`);
const VIEWPORT = new RegExp(`@${COORD},${COORD}`);
const PARAM_PAIR = new RegExp(`^\\s*${COORD}\\s*,\\s*${COORD}\\s*$`);
/** Query parameters Google Maps uses for a coordinate pair, most specific first. */
const PARAMS = ['q', 'query', 'll', 'destination', 'center', 'daddr'] as const;

const GOOGLE_HOST = /^(?:[a-z0-9-]+\.)*google\.(?:com|[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/;
const SHORT_HOSTS = new Set(['goo.gl', 'maps.app.goo.gl', 'g.co']);

/** True for a host a Maps link can legitimately live on (Google's own domains and its short-link hosts). */
export function flbIsMapsHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return SHORT_HOSTS.has(h) || GOOGLE_HOST.test(h);
}

/** A short link that has to be followed (server-side) to learn its coordinates. */
export function flbIsShortMapsUrl(url: MapsUrl): boolean {
  const h = url.hostname.toLowerCase();
  if (h === 'maps.app.goo.gl') return true;
  if (h === 'goo.gl') return url.pathname.startsWith('/maps');
  return false;
}

/** Coordinates from the text of an (already decoded) long Maps URL, or `null`. */
export function flbCoordsFromMapsUrl(url: MapsUrl): { lat: number; lng: number } | null {
  const take = (m: RegExpExecArray | null) => (m ? { lat: Number(m[1]), lng: Number(m[2]) } : null);
  let text = url.pathname + url.hash;
  try {
    text = decodeURIComponent(text);
  } catch {
    // a malformed escape: the raw text still matches the patterns
  }
  // `!3d..!4d..` is the pin itself; `@lat,lng` is only where the map was centred, so the pin wins.
  const pin = take(PIN.exec(text)) ?? take(PIN.exec(url.search));
  if (pin) return pin;
  for (const key of PARAMS) {
    const v = url.searchParams.get(key);
    const m = v ? PARAM_PAIR.exec(v.replace(/\+/g, ' ')) : null;
    if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  }
  return take(VIEWPORT.exec(text));
}

/**
 * What a pasted value is: a `lat, lng` pair, a long Google Maps link (coordinates read out of it), a short link (to resolve on the
 * server), or something that is not usable (with the reason). Coordinates that come out are range-checked here too.
 */
export function flbParseMapsInput(input: unknown): FlbMapsParse {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return { kind: 'invalid', problem: 'empty' };

  const pair = PAIR.exec(raw);
  if (pair) return checked(Number(pair[1]), Number(pair[2]));

  // People paste `maps.google.com/...` or `maps.app.goo.gl/...` without the scheme.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: MapsUrl;
  try {
    url = new URL(withScheme);
  } catch {
    return { kind: 'invalid', problem: 'not_url' };
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname.includes('.'))
    return { kind: 'invalid', problem: 'not_url' };
  if (url.username || url.password) return { kind: 'invalid', problem: 'not_maps' };
  if (!flbIsMapsHost(url.hostname)) return { kind: 'invalid', problem: 'not_maps' };
  if (flbIsShortMapsUrl(url)) return { kind: 'short', url: url.toString() };
  // Only the Maps part of google.com: a search page or a doc is not a location.
  const onMaps =
    url.hostname.toLowerCase().startsWith('maps.') ||
    url.pathname.startsWith('/maps') ||
    url.hostname.toLowerCase().includes('goo.gl') ||
    url.hostname.toLowerCase() === 'g.co';
  if (!onMaps) return { kind: 'invalid', problem: 'not_maps' };
  const found = flbCoordsFromMapsUrl(url);
  return found ? checked(found.lat, found.lng) : { kind: 'invalid', problem: 'no_coords' };
}

function checked(lat: number, lng: number): FlbMapsParse {
  const problem = flbCoordinateProblem(lat, lng);
  return problem ? { kind: 'invalid', problem } : { kind: 'coords', lat, lng };
}

/** The decimal text a coordinate is stored and shown as: at most 7 places (about a centimetre), no trailing zeros. */
export const flbFormatCoordinate = (n: number): string => String(Number(n.toFixed(7)));

/** `https://www.google.com/maps?q=lat,lng` (what "Open in Google Maps" and a non-WhatsApp fallback text link to). */
export const flbMapsLink = (lat: number, lng: number): string =>
  `https://www.google.com/maps?q=${lat},${lng}`;

export type FlbLocationRead =
  { ok: true; lat: number; lng: number } | { ok: false; problem: FlbLocationProblem };

/**
 * The location a Location node's data stands for. Reads the new keys and the ones every step saved before them has (`lat` / `lng`
 * as typed, or the runtime names `latitude` / `longitude`), so an existing step with real coordinates stays valid untouched.
 */
export function flbReadLocation(data: Record<string, unknown> | null | undefined): FlbLocationRead {
  const d = data ?? {};
  const lat = d.lat ?? d.latitude;
  const lng = d.lng ?? d.longitude;
  const problem = flbCoordinateProblem(lat, lng);
  if (!problem) return { ok: true, lat: flbParseCoordinate(lat)!, lng: flbParseCoordinate(lng)! };
  if (d.locMode === 'link' && typeof d.mapsUrl === 'string' && d.mapsUrl.trim()) {
    const parsed = flbParseMapsInput(d.mapsUrl);
    if (parsed.kind === 'coords') return { ok: true, lat: parsed.lat, lng: parsed.lng };
    if (parsed.kind === 'short') return { ok: false, problem: 'unresolved' };
    return { ok: false, problem: parsed.problem };
  }
  return { ok: false, problem };
}

// --- link resolver endpoint (POST /flows/location/resolve) ---------------------------------------------------------------

export const flbResolveMapsRequestSchema = z.object({
  url: z.string().trim().min(1).max(2048),
});
export type FlbResolveMapsRequest = z.infer<typeof flbResolveMapsRequestSchema>;

/** A refusal is 200 `{ok:false, problem}` so the form can show it inline, like the webhook test. */
export const flbResolveMapsResponseSchema = z.union([
  z.object({ ok: z.literal(true), lat: z.number(), lng: z.number() }),
  z.object({ ok: z.literal(false), problem: z.string() }),
]);
export type FlbResolveMapsResponse = z.infer<typeof flbResolveMapsResponseSchema>;
