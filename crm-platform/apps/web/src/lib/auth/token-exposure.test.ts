import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Session/token security, source guards: the session tokens live in httpOnly cookies set by the server and nowhere else. These fail
 * when someone puts one into browser storage, reads it from `document.cookie`, or builds a URL with it.
 */
const SRC = resolve(__dirname, '../..');

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue;
      files(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\./.test(name)) out.push(p);
  }
  return out;
}
const ALL = files(SRC).map((p) => ({ p: p.slice(SRC.length + 1), s: readFileSync(p, 'utf8') }));

describe('where the session tokens can be found in the browser', () => {
  it('no code stores a token or session value in localStorage / sessionStorage', () => {
    const bad = ALL.filter(({ s }) =>
      /(local|session)Storage\s*\.\s*setItem\(\s*['"`][^'"`]*(token|jwt|refresh|access|auth|session)[^'"`]*['"`]/i.test(
        s,
      ),
    ).map((f) => f.p);
    expect(bad).toEqual([]);
  });

  it('no code reads the token cookies through document.cookie (they are httpOnly)', () => {
    const bad = ALL.filter(({ s }) =>
      /document\.cookie[^;\n]*(crm_at|crm_rt|crm_op_at|crm_op_rt|ACCESS_COOKIE|REFRESH_COOKIE)/.test(
        s,
      ),
    ).map((f) => f.p);
    expect(bad).toEqual([]);
  });

  it('no URL is built with an access or refresh token in its query string', () => {
    const bad = ALL.filter(({ s }) =>
      /[?&](access_?token|refresh_?token|accessToken|refreshToken|jwt)=\$\{|[?&](access_?token|refresh_?token|jwt)=['"`]\s*\+/.test(
        s,
      ),
    ).map((f) => f.p);
    expect(bad).toEqual([]);
  });
});
