import type { TranslationProviderSlug } from '@crm/contracts';
import { endpointProblem } from './endpoint-guard';
import {
  NO_DETECTION,
  type Credentials,
  type CredentialSpec,
  type DetectedTranslation,
  type DriverDeps,
  type TranslationDriver,
} from './translation-driver.port';

/**
 * The five translation backends (TW-I18N-024..028), written from their public API contracts.
 *
 * Deliberate differences from Reference, each of them a fix:
 *   - a result equal to the input is a SUCCESS (a brand name or a loanword legitimately does not change); Reference
 *     treated it as a failure and cached the failure for a day;
 *   - the Google Cloud key travels in a header, not the query string;
 *   - the self-hosted endpoint is validated (no link-local or metadata addresses);
 *   - DeepL regional variants are mapped to the codes the API accepts.
 */

const clean = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
};

/** `pt-BR` and `zh-CN` become `pt` and `zh`: providers want the base language. */
export const baseLanguage = (code: string): string => code.toLowerCase().split('-')[0] ?? code;

async function json(deps: DriverDeps, url: string, init: RequestInit = {}): Promise<unknown> {
  try {
    const res = await deps.fetch(url, { ...init, signal: AbortSignal.timeout(deps.timeoutMs) });
    if (!res.ok) return { __status: res.status };
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

const asObject = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** MyMemory ------------------------------------------------------------------------------------------------------- */

const MYMEMORY_BREAKER = 'translate:mymemory:breaker';
const MYMEMORY_BREAKER_TTL = 3600;

class MyMemoryDriver implements TranslationDriver {
  readonly slug = 'mymemory' as const;
  constructor(
    private readonly creds: Credentials,
    private readonly deps: DriverDeps,
  ) {}

  private async call(
    text: string,
    langpair: string,
  ): Promise<{ text: string | null; source: string | null }> {
    if (await this.deps.breaker.isOpen(MYMEMORY_BREAKER)) return { text: null, source: null };

    const params = new URLSearchParams({ q: text, langpair });
    const email = clean(this.creds.admin_email);
    if (email) params.set('de', email);
    const body = asObject(
      await json(this.deps, `https://api.mymemory.translated.net/get?${params.toString()}`),
    );
    if (!body) return { text: null, source: null };

    // MyMemory reports an exhausted quota as HTTP 200 with a warning in place of the translation, or as 429.
    const translated = clean(asObject(body.responseData)?.translatedText);
    if (
      body.__status === 429 ||
      body.responseStatus === 429 ||
      translated?.startsWith('MYMEMORY WARNING')
    ) {
      await this.deps.breaker.open(MYMEMORY_BREAKER, MYMEMORY_BREAKER_TTL);
      return { text: null, source: null };
    }
    if (body.__status) return { text: null, source: null };

    // `matches` is an array of candidates, but the API returns a string when there are none.
    const matches = Array.isArray(body.matches) ? body.matches : [];
    const source = clean(asObject(matches[0])?.source);
    return { text: translated, source: source ? baseLanguage(source) : null };
  }

  async translate(text: string, from: string, to: string) {
    return (await this.call(text, `${from}|${to}`)).text;
  }

  async detectAndTranslate(text: string, target: string): Promise<DetectedTranslation> {
    const r = await this.call(text, `Autodetect|${target}`);
    return r.text ? { language: r.source, text: r.text } : NO_DETECTION;
  }
}

/** Google (free, unofficial) -------------------------------------------------------------------------------------- */

class GoogleGtxDriver implements TranslationDriver {
  readonly slug = 'google_gtx' as const;
  constructor(private readonly deps: DriverDeps) {}

  private async call(
    text: string,
    sl: string,
    tl: string,
  ): Promise<{ text: string | null; detected: string | null }> {
    const params = new URLSearchParams({ client: 'gtx', sl, tl, dt: 't', q: text });
    const body = await json(
      this.deps,
      `https://translate.googleapis.com/translate_a/single?${params.toString()}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } },
    );
    if (!Array.isArray(body) || !Array.isArray(body[0])) return { text: null, detected: null };
    const joined = body[0]
      .map((seg: unknown) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
      .join('');
    const detected = typeof body[2] === 'string' ? body[2].toLowerCase() : null;
    return { text: clean(joined), detected };
  }

  async translate(text: string, from: string, to: string) {
    return (await this.call(text, from, to)).text;
  }

  async detectAndTranslate(text: string, target: string): Promise<DetectedTranslation> {
    const r = await this.call(text, 'auto', target);
    return r.text ? { language: r.detected, text: r.text } : NO_DETECTION;
  }
}

/** LibreTranslate ------------------------------------------------------------------------------------------------- */

class LibreTranslateDriver implements TranslationDriver {
  readonly slug = 'libretranslate' as const;
  constructor(
    private readonly creds: Credentials,
    private readonly deps: DriverDeps,
  ) {}

  private async call(
    text: string,
    source: string,
    target: string,
  ): Promise<{ text: string | null; detected: string | null }> {
    const endpoint = clean(this.creds.endpoint)?.replace(/\/+$/, '');
    if (!endpoint || endpointProblem(endpoint)) return { text: null, detected: null };
    const payload: Record<string, string> = { q: text, source, target, format: 'text' };
    const key = clean(this.creds.api_key);
    if (key) payload.api_key = key;

    const body = asObject(
      await json(this.deps, `${endpoint}/translate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    );
    if (!body || body.__status) return { text: null, detected: null };
    const detected = clean(asObject(body.detectedLanguage)?.language);
    return { text: clean(body.translatedText), detected: detected?.toLowerCase() ?? null };
  }

  async translate(text: string, from: string, to: string) {
    return (await this.call(text, from, to)).text;
  }

  async detectAndTranslate(text: string, target: string): Promise<DetectedTranslation> {
    const r = await this.call(text, 'auto', target);
    return r.text ? { language: r.detected, text: r.text } : NO_DETECTION;
  }
}

/** DeepL ---------------------------------------------------------------------------------------------------------- */

/** DeepL wants a regional variant for some targets; the plain code is rejected. */
const DEEPL_TARGET: Record<string, string> = { en: 'EN-US', pt: 'PT-BR', zh: 'ZH' };
/** And only the base code for sources. */
const deeplSource = (code: string) => baseLanguage(code).toUpperCase();
const deeplTarget = (code: string) =>
  DEEPL_TARGET[baseLanguage(code)] ?? baseLanguage(code).toUpperCase();

class DeepLDriver implements TranslationDriver {
  readonly slug = 'deepl' as const;
  constructor(
    private readonly creds: Credentials,
    private readonly deps: DriverDeps,
  ) {}

  private async call(
    text: string,
    source: string | null,
    target: string,
  ): Promise<{ text: string | null; detected: string | null }> {
    const key = clean(this.creds.api_key);
    if (!key) return { text: null, detected: null };
    // Free-plan keys end in `:fx` and are served from a different host.
    const host = key.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
    const payload: Record<string, unknown> = { text: [text], target_lang: deeplTarget(target) };
    if (source) payload.source_lang = deeplSource(source);

    const body = asObject(
      await json(this.deps, `https://${host}/v2/translate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `DeepL-Auth-Key ${key}` },
        body: JSON.stringify(payload),
      }),
    );
    if (!body || body.__status) return { text: null, detected: null };
    const first = Array.isArray(body.translations) ? asObject(body.translations[0]) : null;
    const detected = clean(first?.detected_source_language);
    return { text: clean(first?.text), detected: detected?.toLowerCase() ?? null };
  }

  async translate(text: string, from: string, to: string) {
    return (await this.call(text, from, to)).text;
  }

  async detectAndTranslate(text: string, target: string): Promise<DetectedTranslation> {
    const r = await this.call(text, null, target);
    return r.text ? { language: r.detected, text: r.text } : NO_DETECTION;
  }
}

/** Google Cloud Translation v2 ----------------------------------------------------------------------------------- */

class GoogleCloudDriver implements TranslationDriver {
  readonly slug = 'google_cloud' as const;
  constructor(
    private readonly creds: Credentials,
    private readonly deps: DriverDeps,
  ) {}

  private async call(
    text: string,
    source: string | null,
    target: string,
  ): Promise<{ text: string | null; detected: string | null }> {
    const key = clean(this.creds.api_key);
    if (!key) return { text: null, detected: null };
    const payload: Record<string, string> = { q: text, target, format: 'text' };
    if (source) payload.source = source;

    const body = asObject(
      await json(this.deps, 'https://translation.googleapis.com/language/translate/v2', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(payload),
      }),
    );
    const data = asObject(body?.data);
    if (!body || body.__status || !data) return { text: null, detected: null };
    const first = Array.isArray(data.translations) ? asObject(data.translations[0]) : null;
    const detected = clean(first?.detectedSourceLanguage);
    return { text: clean(first?.translatedText), detected: detected?.toLowerCase() ?? null };
  }

  async translate(text: string, from: string, to: string) {
    return (await this.call(text, from, to)).text;
  }

  async detectAndTranslate(text: string, target: string): Promise<DetectedTranslation> {
    const r = await this.call(text, null, target);
    return r.text ? { language: r.detected, text: r.text } : NO_DETECTION;
  }
}

/** Registry ------------------------------------------------------------------------------------------------------- */

interface DriverDefinition {
  official: boolean;
  credentialFields: CredentialSpec[];
  create(creds: Credentials, deps: DriverDeps): TranslationDriver;
}

export const DRIVERS: Record<TranslationProviderSlug, DriverDefinition> = {
  mymemory: {
    official: false,
    credentialFields: [
      {
        key: 'admin_email',
        label: 'Admin email (optional)',
        type: 'text',
        required: false,
        hint: 'Optional. Raises the daily quota from 5k to 50k requests per IP.',
        placeholder: 'you@example.com',
      },
    ],
    create: (c, d) => new MyMemoryDriver(c, d),
  },
  google_gtx: {
    official: false,
    credentialFields: [],
    create: (_c, d) => new GoogleGtxDriver(d),
  },
  libretranslate: {
    official: false,
    credentialFields: [
      {
        key: 'endpoint',
        label: 'Endpoint URL',
        type: 'text',
        required: true,
        hint: 'URL of your LibreTranslate server. For self-hosted Docker, usually http://localhost:5000.',
        placeholder: 'http://localhost:5000',
      },
      {
        key: 'api_key',
        label: 'API key (optional)',
        type: 'password',
        required: false,
        hint: 'Required only for the hosted libretranslate.com tier. Leave blank for self-hosted.',
        placeholder: null,
      },
    ],
    create: (c, d) => new LibreTranslateDriver(c, d),
  },
  deepl: {
    official: true,
    credentialFields: [
      {
        key: 'api_key',
        label: 'DeepL API key',
        type: 'password',
        required: true,
        hint: 'Free tier: 500k chars/month. Keys ending in :fx are free-tier, others Pro. Get one at deepl.com/pro-api.',
        placeholder: null,
      },
    ],
    create: (c, d) => new DeepLDriver(c, d),
  },
  google_cloud: {
    official: true,
    credentialFields: [
      {
        key: 'api_key',
        label: 'Google Cloud API key',
        type: 'password',
        required: true,
        hint: 'Enable "Cloud Translation API" in Google Cloud Console, then create an API key. ~$20 per 1M chars.',
        placeholder: null,
      },
    ],
    create: (c, d) => new GoogleCloudDriver(c, d),
  },
};

export const isKnownProvider = (slug: string): slug is TranslationProviderSlug => slug in DRIVERS;
