import { describe, expect, it } from 'vitest';
import { DRIVERS } from '../../../src/infra/providers/localization-translation/drivers';
import { endpointProblem } from '../../../src/infra/providers/localization-translation/endpoint-guard';
import { MemoryTranslationStores } from '../../../src/infra/providers/localization-translation/redis-stores';

interface Call {
  url: string;
  init?: RequestInit;
}

/** A fetch that records every call and answers with a canned body (or status). */
function fakeFetch(
  reply: unknown,
  status = 200,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return { ok: status >= 200 && status < 300, status, json: async () => reply } as Response;
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

const deps = (f: typeof fetch, breaker = new MemoryTranslationStores()) => ({
  fetch: f,
  breaker,
  timeoutMs: 1000,
});

const body = (c: Call) => JSON.parse(String(c.init?.body)) as Record<string, unknown>;

/** TW-I18N-024 */
describe('MyMemory driver', () => {
  const ok = { responseStatus: 200, responseData: { translatedText: 'hola' }, matches: [{ source: 'en-US' }] };

  it('translates with a langpair and sends the contact email as `de`', async () => {
    const { fetch, calls } = fakeFetch(ok);
    const d = DRIVERS.mymemory.create({ admin_email: 'ops@example.com' }, deps(fetch));
    expect(await d.translate('hello there', 'en', 'es')).toBe('hola');
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get('langpair')).toBe('en|es');
    expect(url.searchParams.get('de')).toBe('ops@example.com');
    expect(url.searchParams.get('q')).toBe('hello there');
  });

  it('detects through Autodetect and folds the source to its base language', async () => {
    const { fetch, calls } = fakeFetch(ok);
    const d = DRIVERS.mymemory.create({}, deps(fetch));
    expect(await d.detectAndTranslate('hello there', 'es')).toEqual({ language: 'en', text: 'hola' });
    expect(new URL(calls[0]!.url).searchParams.get('langpair')).toBe('Autodetect|es');
  });

  it('copes with `matches` arriving as a string', async () => {
    const { fetch } = fakeFetch({ responseStatus: 200, responseData: { translatedText: 'hola' }, matches: '' });
    const d = DRIVERS.mymemory.create({}, deps(fetch));
    expect(await d.detectAndTranslate('hello', 'es')).toEqual({ language: null, text: 'hola' });
  });

  it('opens the breaker on a quota warning and then fails without any request', async () => {
    const breaker = new MemoryTranslationStores();
    const warn = fakeFetch({ responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS' } });
    const d = DRIVERS.mymemory.create({}, deps(warn.fetch, breaker));
    expect(await d.translate('hello', 'en', 'es')).toBeNull();
    expect(await breaker.isOpen('translate:mymemory:breaker')).toBe(true);

    const later = fakeFetch(ok);
    const d2 = DRIVERS.mymemory.create({}, deps(later.fetch, breaker));
    expect(await d2.translate('hello', 'en', 'es')).toBeNull();
    expect(later.calls).toHaveLength(0);
  });

  it('opens the breaker on HTTP 429 and on a 429 status in the body', async () => {
    for (const reply of [fakeFetch({}, 429), fakeFetch({ responseStatus: 429, responseData: {} })]) {
      const breaker = new MemoryTranslationStores();
      const d = DRIVERS.mymemory.create({}, deps(reply.fetch, breaker));
      expect(await d.translate('hello', 'en', 'es')).toBeNull();
      expect(await breaker.isOpen('translate:mymemory:breaker')).toBe(true);
    }
  });

  it('treats a result equal to the input as success (Reference called it a failure)', async () => {
    const { fetch } = fakeFetch({ responseStatus: 200, responseData: { translatedText: 'Nike' } });
    const d = DRIVERS.mymemory.create({}, deps(fetch));
    expect(await d.translate('Nike', 'en', 'es')).toBe('Nike');
  });

  it('returns null on a transport error', async () => {
    const boom = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    expect(await DRIVERS.mymemory.create({}, deps(boom)).translate('hi', 'en', 'es')).toBeNull();
  });
});

/** TW-I18N-025 */
describe('Google GTX driver', () => {
  const reply = [[['Hello ', 'Hola ', null], ['world', 'mundo', null]], null, 'es'];

  it('concatenates the segments and sends the browser User-Agent', async () => {
    const { fetch, calls } = fakeFetch(reply);
    const d = DRIVERS.google_gtx.create({}, deps(fetch));
    expect(await d.translate('Hola mundo', 'es', 'en')).toBe('Hello world');
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get('client')).toBe('gtx');
    expect(url.searchParams.get('sl')).toBe('es');
    expect((calls[0]!.init?.headers as Record<string, string>)['User-Agent']).toBe('Mozilla/5.0');
  });

  it('detects with sl=auto and lowercases the detected language', async () => {
    const { fetch, calls } = fakeFetch([[['Hello', 'Hola', null]], null, 'ES']);
    const d = DRIVERS.google_gtx.create({}, deps(fetch));
    expect(await d.detectAndTranslate('Hola', 'en')).toEqual({ language: 'es', text: 'Hello' });
    expect(new URL(calls[0]!.url).searchParams.get('sl')).toBe('auto');
  });

  it('fails on an unexpected shape', async () => {
    expect(await DRIVERS.google_gtx.create({}, deps(fakeFetch({ oops: 1 }).fetch)).translate('a', 'es', 'en')).toBeNull();
  });
});

/** TW-I18N-026 */
describe('LibreTranslate driver', () => {
  it('posts to <endpoint>/translate with the key in the body and trims a trailing slash', async () => {
    const { fetch, calls } = fakeFetch({ translatedText: 'hola' });
    const d = DRIVERS.libretranslate.create(
      { endpoint: 'http://localhost:5000/', api_key: 'k1' },
      deps(fetch),
    );
    expect(await d.translate('hello', 'en', 'es')).toBe('hola');
    expect(calls[0]!.url).toBe('http://localhost:5000/translate');
    expect(body(calls[0]!)).toMatchObject({ q: 'hello', source: 'en', target: 'es', format: 'text', api_key: 'k1' });
  });

  it('auto-detects through source=auto and reads detectedLanguage', async () => {
    const { fetch, calls } = fakeFetch({ translatedText: 'hello', detectedLanguage: { language: 'ES' } });
    const d = DRIVERS.libretranslate.create({ endpoint: 'http://lt:5000' }, deps(fetch));
    expect(await d.detectAndTranslate('hola', 'en')).toEqual({ language: 'es', text: 'hello' });
    expect(body(calls[0]!).source).toBe('auto');
  });

  it('fails closed without an endpoint, and never calls a link-local address', async () => {
    const none = fakeFetch({ translatedText: 'x' });
    expect(await DRIVERS.libretranslate.create({}, deps(none.fetch)).translate('a', 'en', 'es')).toBeNull();
    const meta = fakeFetch({ translatedText: 'x' });
    const d = DRIVERS.libretranslate.create({ endpoint: 'http://169.254.169.254/latest' }, deps(meta.fetch));
    expect(await d.translate('a', 'en', 'es')).toBeNull();
    expect(none.calls.length + meta.calls.length).toBe(0);
  });
});

/** TW-I18N-027 */
describe('DeepL driver', () => {
  const reply = { translations: [{ text: 'Hola', detected_source_language: 'EN' }] };

  it('uses the free host for a :fx key and the paid host otherwise', async () => {
    const free = fakeFetch(reply);
    await DRIVERS.deepl.create({ api_key: 'abc:fx' }, deps(free.fetch)).translate('Hello', 'en', 'es');
    expect(free.calls[0]!.url).toBe('https://api-free.deepl.com/v2/translate');

    const paid = fakeFetch(reply);
    await DRIVERS.deepl.create({ api_key: 'abc' }, deps(paid.fetch)).translate('Hello', 'en', 'es');
    expect(paid.calls[0]!.url).toBe('https://api.deepl.com/v2/translate');
    expect((paid.calls[0]!.init?.headers as Record<string, string>).authorization).toBe('DeepL-Auth-Key abc');
  });

  it('upper-cases the source and maps regional target variants', async () => {
    const { fetch, calls } = fakeFetch(reply);
    const d = DRIVERS.deepl.create({ api_key: 'k' }, deps(fetch));
    await d.translate('Hola', 'es', 'pt');
    expect(body(calls[0]!)).toMatchObject({ source_lang: 'ES', target_lang: 'PT-BR', text: ['Hola'] });
    await d.translate('Hola', 'es', 'en');
    expect(body(calls[1]!).target_lang).toBe('EN-US');
  });

  it('omits source_lang to auto-detect and returns the detected language lower-cased', async () => {
    const { fetch, calls } = fakeFetch(reply);
    const d = DRIVERS.deepl.create({ api_key: 'k' }, deps(fetch));
    expect(await d.detectAndTranslate('Hello', 'es')).toEqual({ language: 'en', text: 'Hola' });
    expect(body(calls[0]!)).not.toHaveProperty('source_lang');
  });

  it('fails without a key and without any request', async () => {
    const { fetch, calls } = fakeFetch(reply);
    expect(await DRIVERS.deepl.create({}, deps(fetch)).translate('a', 'en', 'es')).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

/** TW-I18N-028 */
describe('Google Cloud driver', () => {
  const reply = { data: { translations: [{ translatedText: 'Hola', detectedSourceLanguage: 'EN' }] } };

  it('sends the key in a header, not in the URL', async () => {
    const { fetch, calls } = fakeFetch(reply);
    const d = DRIVERS.google_cloud.create({ api_key: 'secret-key' }, deps(fetch));
    expect(await d.translate('Hello', 'en', 'es')).toBe('Hola');
    expect(calls[0]!.url).toBe('https://translation.googleapis.com/language/translate/v2');
    expect(calls[0]!.url).not.toContain('secret-key');
    expect((calls[0]!.init?.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key');
  });

  it('auto-detects by omitting source', async () => {
    const { fetch, calls } = fakeFetch(reply);
    const d = DRIVERS.google_cloud.create({ api_key: 'k' }, deps(fetch));
    expect(await d.detectAndTranslate('Hello', 'es')).toEqual({ language: 'en', text: 'Hola' });
    expect(body(calls[0]!)).not.toHaveProperty('source');
  });

  it('fails without a key', async () => {
    expect(await DRIVERS.google_cloud.create({}, deps(fakeFetch(reply).fetch)).translate('a', 'en', 'es')).toBeNull();
  });
});

describe('credential schemas', () => {
  it('require the keys Reference required', () => {
    const req = (slug: keyof typeof DRIVERS) =>
      DRIVERS[slug].credentialFields.filter((f) => f.required).map((f) => f.key);
    expect(req('deepl')).toEqual(['api_key']);
    expect(req('google_cloud')).toEqual(['api_key']);
    expect(req('libretranslate')).toEqual(['endpoint']);
    expect(req('mymemory')).toEqual([]);
    expect(req('google_gtx')).toEqual([]);
  });

  it('marks DeepL and Google Cloud official and the rest not', () => {
    expect(Object.entries(DRIVERS).filter(([, d]) => d.official).map(([s]) => s).sort()).toEqual([
      'deepl',
      'google_cloud',
    ]);
  });
});

describe('endpointProblem', () => {
  it('accepts a local or hosted server', () => {
    expect(endpointProblem('http://localhost:5000')).toBeNull();
    expect(endpointProblem('https://translate.example.com')).toBeNull();
    expect(endpointProblem('http://10.0.0.5:5000')).toBeNull();
  });
  it('refuses non-URLs, odd schemes, embedded credentials and metadata addresses', () => {
    expect(endpointProblem('not a url')).not.toBeNull();
    expect(endpointProblem('ftp://example.com')).not.toBeNull();
    expect(endpointProblem('http://user:pw@example.com')).not.toBeNull();
    expect(endpointProblem('http://169.254.169.254/latest/meta-data')).not.toBeNull();
    expect(endpointProblem('http://metadata.google.internal')).not.toBeNull();
    expect(endpointProblem('http://[fe80::1]:5000')).not.toBeNull();
  });
});
