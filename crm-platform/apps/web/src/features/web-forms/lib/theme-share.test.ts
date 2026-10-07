import { formThemeSchema } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { DARK_NEUTRALS, FORM_CSS } from './form-css';
import {
  cleanAncestors,
  formKeyOf,
  frameAncestorsFor,
  frameHeaders,
  resetFrameCache,
} from './frame-headers';
import { matchPublicPath } from './public-paths';
import { plainText, safeHtml } from './rich-text';
import { checkOrigin, qrTarget, resizeMessage, safeRedirect } from './share';
import {
  applyPreset,
  contrastRatio,
  contrastWarnings,
  DEFAULT_THEME,
  fontStylesheet,
  presetOf,
  safeImageUrl,
  THEME_PRESET_KEYS,
  THEME_PRESETS,
  tokensToCssVars,
} from './theme';

describe('theme tokens', () => {
  it('every preset is a theme the contract accepts', () => {
    for (const key of THEME_PRESET_KEYS) {
      const t = applyPreset(DEFAULT_THEME, key);
      expect(formThemeSchema.safeParse(t).success, key).toBe(true);
    }
  });

  it('recognises the preset a theme still equals and says custom after a change', () => {
    expect(presetOf(DEFAULT_THEME)).toBe('classic');
    expect(presetOf(applyPreset(DEFAULT_THEME, 'ocean'))).toBe('ocean');
    expect(presetOf({ ...applyPreset(DEFAULT_THEME, 'ocean'), primary: '#123456' })).toBeNull();
  });

  it('keeps layout and images when a preset is applied', () => {
    const base = {
      ...DEFAULT_THEME,
      layout: 'split' as const,
      logo: 'https://cdn.example.com/l.png',
    };
    const next = applyPreset(base, 'forest');
    expect(next.layout).toBe('split');
    expect(next.logo).toBe('https://cdn.example.com/l.png');
    expect(next.primary).toBe(THEME_PRESETS.forest.primary);
  });

  it('turns tokens into custom properties and nothing else', () => {
    const vars = tokensToCssVars({
      ...DEFAULT_THEME,
      radius: 'pill',
      density: 'spacious',
      fontScale: 1.2,
      maxWidth: 700,
      shadow: 'none',
    });
    expect(vars['--f-radius']).toBe('999px');
    expect(vars['--f-gap']).toBe('26px');
    expect(vars['--f-scale']).toBe('1.2');
    expect(vars['--f-max']).toBe('700px');
    expect(vars['--f-shadow']).toBe('none');
    expect(Object.keys(vars).every((k) => k.startsWith('--f-'))).toBe(true);
  });

  it('a value that is not a token never reaches the page', () => {
    const vars = tokensToCssVars({
      ...DEFAULT_THEME,
      primary: 'red; background:url(x)',
      text: 'expression(alert(1))',
      fontScale: 99,
      maxWidth: 99999,
      backgroundImage: 'javascript:alert(1)',
    });
    expect(vars['--f-primary']).toBe(DEFAULT_THEME.primary);
    expect(vars['--f-l-text']).toBe(DEFAULT_THEME.text);
    expect(vars['--f-scale']).toBe('1.4');
    expect(vars['--f-max']).toBe('960px');
    expect(vars['--f-bg-image']).toBeUndefined();
  });

  it('accepts only https images without characters that could break out of url()', () => {
    expect(safeImageUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
    expect(safeImageUrl('http://cdn.example.com/a.png')).toBeNull();
    expect(safeImageUrl('data:image/png;base64,AAAA')).toBeNull();
    // A quote in the address is percent-encoded by the URL parser, so it cannot close `url("...")`.
    expect(safeImageUrl('https://cdn.example.com/a".png')).toBe('https://cdn.example.com/a%22.png');
    expect(safeImageUrl(null)).toBeNull();
    expect(safeImageUrl('not a url')).toBeNull();
  });

  it('loads a web font only when one is chosen', () => {
    expect(fontStylesheet('system')).toBeNull();
    expect(fontStylesheet('serif')).toBeNull();
    expect(fontStylesheet('inter')).toContain('fonts.googleapis.com/css2?family=Inter');
  });

  it('measures contrast as WCAG does and warns under 4.5', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
    expect(contrastRatio('nope', '#ffffff')).toBeNull();
    expect(contrastWarnings(DEFAULT_THEME)).toEqual([]);
    const poor = contrastWarnings({ ...DEFAULT_THEME, text: '#bbbbbb', primary: '#ffee00' });
    expect(poor.map((w) => w.pair)).toEqual(expect.arrayContaining(['text', 'button']));
  });

  it('keeps the stylesheet free of values from a form', () => {
    expect(FORM_CSS).not.toMatch(/\$\{/);
    expect(FORM_CSS).toContain(DARK_NEUTRALS.surface);
  });
});

describe('allowed origins', () => {
  it('normalises what the API normalises', () => {
    expect(checkOrigin('HTTPS://Example.com/')).toEqual({ ok: true, value: 'https://example.com' });
    expect(checkOrigin('https://*.example.com')).toEqual({
      ok: true,
      value: 'https://*.example.com',
    });
    expect(checkOrigin('http://localhost:3000')).toEqual({
      ok: true,
      value: 'http://localhost:3000',
    });
  });

  it('refuses a bare wildcard, a path, plain http and a duplicate', () => {
    expect(checkOrigin('')).toEqual({ ok: false, issue: 'empty' });
    expect(checkOrigin('*')).toEqual({ ok: false, issue: 'invalid' });
    expect(checkOrigin('https://example.com/path')).toEqual({ ok: false, issue: 'invalid' });
    expect(checkOrigin('http://example.com')).toEqual({ ok: false, issue: 'invalid' });
    expect(checkOrigin('example.com')).toEqual({ ok: false, issue: 'invalid' });
    expect(checkOrigin('https://example.com', ['https://example.com'])).toEqual({
      ok: false,
      issue: 'duplicate',
    });
  });
});

describe('redirects, QR and frame messages', () => {
  it('sends a visitor only to an https address', () => {
    expect(safeRedirect('https://example.com/thanks')).toBe('https://example.com/thanks');
    expect(safeRedirect('javascript:alert(1)')).toBeNull();
    expect(safeRedirect('http://example.com')).toBeNull();
    expect(safeRedirect(undefined)).toBeNull();
  });

  it('tags the QR address so scans can be told apart', () => {
    expect(qrTarget('https://app.example.com/f/K')).toBe(
      'https://app.example.com/f/K?utm_source=qr',
    );
    expect(qrTarget('broken')).toBe('broken');
  });

  it('measures the frame as a whole number of pixels', () => {
    expect(resizeMessage('K', 412.2)).toEqual({
      source: 'forms',
      type: 'resize',
      key: 'K',
      height: 413,
    });
    expect((resizeMessage('K', -5) as { height: number }).height).toBe(0);
  });
});

describe('who may frame a form', () => {
  it('finds the key of a form page and ignores everything else', () => {
    expect(formKeyOf('/f/AbCdEfGhIjKlMnOpQrStUv')).toBe('AbCdEfGhIjKlMnOpQrStUv');
    expect(formKeyOf('/f/AbCdEfGhIjKlMnOpQrStUv/thanks')).toBe('AbCdEfGhIjKlMnOpQrStUv');
    expect(formKeyOf('/f/short')).toBeNull();
    expect(formKeyOf('/forms/AbCdEfGhIjKlMnOpQrStUv')).toBeNull();
    expect(formKeyOf('/contacts')).toBeNull();
  });

  it('keeps the hosted page unframeable whatever the API says', () => {
    const h = frameHeaders(false, { hosted: 'https://evil.example', embed: 'https://ok.example' });
    expect(h).toEqual({
      'Content-Security-Policy': "frame-ancestors 'none'",
      'X-Frame-Options': 'DENY',
    });
  });

  it('lets the embed be framed by exactly the allowed origins', () => {
    const h = frameHeaders(true, {
      hosted: "'none'",
      embed: "'self' https://example.com https://*.shop.example.com",
    });
    expect(h['Content-Security-Policy']).toBe(
      "frame-ancestors 'self' https://example.com https://*.shop.example.com",
    );
    expect(h['X-Frame-Options']).toBeUndefined();
  });

  it('fails closed on a missing, empty or malformed policy', () => {
    expect(frameHeaders(true, null)['X-Frame-Options']).toBe('DENY');
    expect(cleanAncestors('')).toBe("'none'");
    expect(cleanAncestors('https://a.example; script-src *')).toBe("'none'");
    expect(cleanAncestors("'none' https://a.example")).toBe("'none'");
    expect(cleanAncestors('https://a.example/path')).toBe("'none'");
    expect(cleanAncestors('*')).toBe("'none'");
    expect(cleanAncestors('https://a.example https://a.example')).toBe('https://a.example');
  });

  it('reads the policy from the public form, caches it, and fails closed when the API is down', async () => {
    resetFrameCache();
    let calls = 0;
    const ok = (async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ frameAncestors: { hosted: "'none'", embed: 'https://ok.example' } }),
        { status: 200 },
      );
    }) as typeof fetch;
    let now = 0;
    expect(await frameAncestorsFor('K'.repeat(22), 'http://api', ok, () => now)).toEqual({
      hosted: "'none'",
      embed: 'https://ok.example',
    });
    await frameAncestorsFor('K'.repeat(22), 'http://api', ok, () => now);
    expect(calls).toBe(1);
    now = 31_000;
    await frameAncestorsFor('K'.repeat(22), 'http://api', ok, () => now);
    expect(calls).toBe(2);
    resetFrameCache();
    const down = (async () => {
      throw new Error('down');
    }) as typeof fetch;
    expect(await frameAncestorsFor('J'.repeat(22), 'http://api', down)).toBeNull();
    const notFound = (async () => new Response('{}', { status: 404 })) as typeof fetch;
    expect(await frameAncestorsFor('H'.repeat(22), 'http://api', notFound)).toBeNull();
  });
});

describe('the visitor relay allowlist', () => {
  const KEY = 'AbCdEfGhIjKlMnOpQrStUv';
  it('forwards the four public routes', () => {
    expect(matchPublicPath('GET', [KEY])).toMatchObject({ ok: true, method: 'GET', path: KEY });
    expect(matchPublicPath('POST', [KEY, 'submit'])).toMatchObject({
      ok: true,
      method: 'POST',
      hasBody: true,
    });
    expect(matchPublicPath('POST', [KEY, 'events'])).toMatchObject({ ok: true, method: 'POST' });
    expect(matchPublicPath('GET', [KEY, 'submissions', 'T'.repeat(24)])).toMatchObject({
      ok: true,
      method: 'GET',
    });
    expect(matchPublicPath('HEAD', [KEY])).toMatchObject({ ok: true, method: 'GET' });
  });

  it('refuses everything else', () => {
    expect(matchPublicPath('GET', [KEY, 'submit'])).toEqual({ ok: false, status: 405 });
    expect(matchPublicPath('POST', [KEY])).toEqual({ ok: false, status: 405 });
    expect(matchPublicPath('GET', ['..', 'admin'])).toEqual({ ok: false, status: 404 });
    expect(matchPublicPath('GET', [KEY, 'other'])).toEqual({ ok: false, status: 404 });
    expect(matchPublicPath('GET', ['x y'])).toEqual({ ok: false, status: 404 });
    expect(matchPublicPath('GET', [])).toEqual({ ok: false, status: 404 });
    expect(matchPublicPath('DELETE', [KEY])).toEqual({ ok: false, status: 405 });
  });
});

describe('rich text is rebuilt from an allowlist', () => {
  it('keeps the simple tags and links', () => {
    expect(safeHtml('<p>Hello <b>you</b> and <em>me</em></p>')).toBe(
      '<p>Hello <b>you</b> and <em>me</em></p>',
    );
    expect(safeHtml('<a href="https://example.com/x">link</a>')).toBe(
      '<a href="https://example.com/x" target="_blank" rel="noopener noreferrer nofollow">link</a>',
    );
  });

  it('drops scripts, handlers, images, styles and unsafe links', () => {
    expect(safeHtml('<script>alert(1)</script>hi')).toBe('alert(1)hi');
    expect(safeHtml('<img src=x onerror=alert(1)>ok')).toBe('ok');
    expect(safeHtml('<b onclick="x()">b</b>')).toBe('<b>b</b>');
    expect(safeHtml('<a href="javascript:alert(1)">x</a>')).toBe('x');
    expect(safeHtml('<a href="data:text/html,x">x</a>')).toBe('x');
    expect(safeHtml('<a href="http://example.com">x</a>')).toBe('x');
    expect(safeHtml('<style>body{display:none}</style>')).toBe('body{display:none}');
    expect(safeHtml('<iframe src="https://evil.example"></iframe>')).toBe('');
  });

  it('escapes text and closes what was left open', () => {
    expect(safeHtml('1 < 2 & "3"')).toBe('1 &lt; 2 &amp; &quot;3&quot;');
    expect(safeHtml('<b>open')).toBe('<b>open</b>');
    expect(safeHtml('</b>stray')).toBe('stray');
    expect(safeHtml('&lt;script&gt;')).toBe('&lt;script&gt;');
  });

  it('keeps line breaks of plain text and gives a plain version', () => {
    expect(safeHtml('one\ntwo')).toBe('one<br>two');
    expect(plainText('<p>Hi <b>there</b></p>')).toBe('Hi there');
  });
});
