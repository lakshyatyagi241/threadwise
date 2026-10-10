/* eslint-disable */
// Runtime probes of the product's OWN security functions with attack inputs. No database, no Redis, no network:
// it imports the real source files and calls them. Run by tools/auth-audit through the API package's `tsx`, which
// is why the imports are relative paths into apps/api/src and apps/web/src.
//
// Output: one JSON document after the marker line "@@AUDIT@@". Each assertion is { group, name, ok, detail }.
// A probe that cannot load its module reports ok:false with the load error: it never silently disappears.

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, '../../../apps/api');
const requireFromApi = createRequire(resolve(apiDir, 'package.json'));

type A = { group: string; name: string; ok: boolean; kind?: 'assert' | 'note'; detail?: string };
const fail = (detail: string): never => {
  throw new Error(detail);
};
const out: A[] = [];
const check = (
  group: string,
  name: string,
  ok: boolean,
  detail?: string,
  kind: 'assert' | 'note' = 'assert',
) => out.push({ group, name, ok, kind, detail });
const attempt = async (group: string, name: string, fn: () => unknown | Promise<unknown>) => {
  try {
    const r = await fn();
    if (r === false) check(group, name, false);
    else if (typeof r === 'string' && r.startsWith('note:'))
      check(group, name, true, r.slice(5).trim(), 'note');
    else check(group, name, true, typeof r === 'string' ? r : undefined);
  } catch (e) {
    check(group, name, false, (e as Error).message);
  }
};
const load = async (group: string, specifier: string) => {
  try {
    return await import(specifier);
  } catch (e) {
    check(
      group,
      `load ${specifier.split('/').slice(-2).join('/')}`,
      false,
      (e as Error).message.split('\n')[0],
    );
    return null;
  }
};

// --- TOTP (AUTH-047/048) ----------------------------------------------------------------------------------------
{
  const g = 'totp';
  const m = await load(g, '../../../apps/api/src/modules/auth/support/totp.ts');
  if (m) {
    const secret = Buffer.from('12345678901234567890', 'ascii'); // RFC 6238 appendix B, SHA-1
    const vectors: Array<[number, string]> = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
      [20000000000, '353130'],
    ];
    for (const [t, code] of vectors) {
      await attempt(g, `RFC 6238 vector T=${t}`, () => {
        const got = m.hotp(secret, Math.floor(t / 30), 6);
        return got === code || fail(`expected ${code}, got ${got}`);
      });
    }
    const b32 = m.base32Encode(secret);
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const step = m.totpStep(now);
    const codeAt = (s: number) => m.hotp(secret, s, 6);
    await attempt(
      g,
      'accepts the current code',
      () => m.verifyTotp(b32, codeAt(step), now) === step,
    );
    await attempt(
      g,
      'accepts ±1 step (clock drift)',
      () =>
        m.verifyTotp(b32, codeAt(step - 1), now) === step - 1 &&
        m.verifyTotp(b32, codeAt(step + 1), now) === step + 1,
    );
    await attempt(
      g,
      'rejects ±2 steps',
      () =>
        m.verifyTotp(b32, codeAt(step - 2), now) === null &&
        m.verifyTotp(b32, codeAt(step + 2), now) === null,
    );
    await attempt(
      g,
      'rejects replay of an accepted step',
      () => m.verifyTotp(b32, codeAt(step), now, step) === null,
    );
    await attempt(
      g,
      'rejects an OLDER step than the last accepted one',
      () => m.verifyTotp(b32, codeAt(step - 1), now, step) === null,
    );
    for (const bad of [
      '',
      ' 123456',
      '12345',
      '1234567',
      '12345a',
      '１２３４５６',
      '000000\n',
      '0x1234',
      'null',
    ]) {
      await attempt(
        g,
        `rejects malformed code ${JSON.stringify(bad)}`,
        () => m.verifyTotp(b32, bad, now) === null || codeAt(step) === bad,
      );
    }
    await attempt(g, 'generated secret is 160 bits, base32', () => {
      const s = m.generateTotpSecret();
      return /^[A-Z2-7]{32}$/.test(s);
    });
  }
}

// --- Recovery codes (AUTH-049) ----------------------------------------------------------------------------------
{
  const g = 'recovery-codes';
  const m = await load(g, '../../../apps/api/src/modules/auth/support/recovery-codes.ts');
  if (m) {
    await attempt(g, 'format XXXXX-XXXXX from a look-alike-free alphabet', () =>
      /^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/.test(m.generateRecoveryCode()),
    );
    await attempt(g, '5000 generated codes are all distinct', () => {
      const s = new Set(Array.from({ length: 5000 }, () => m.generateRecoveryCode()));
      return s.size === 5000 || fail(`${s.size} distinct of 5000`);
    });
    const { plain, hashes } = await m.createRecoveryCodes();
    await attempt(
      g,
      'creates 10 codes and 10 Argon2 hashes',
      () =>
        plain.length === 10 &&
        hashes.length === 10 &&
        hashes.every((h: string) => h.startsWith('$argon2')),
    );
    await attempt(g, 'a code verifies once and is then gone (single use)', async () => {
      const first = await m.consumeRecoveryCode(hashes, plain[0]);
      if (!first || first.length !== 9) fail('first use did not consume');
      const again = await m.consumeRecoveryCode(first, plain[0]);
      return again === null;
    });
    await attempt(
      g,
      'matches loosely (case, spaces, dash)',
      async () =>
        (await m.consumeRecoveryCode(
          hashes,
          ' ' + plain[1].toLowerCase().replace('-', ' ') + ' ',
        )) !== null,
    );
    for (const bad of ['', 'AAAAA-AAAAA', plain[2] + 'X', plain[2].slice(0, 9), '0'.repeat(1000)]) {
      await attempt(
        g,
        `rejects ${JSON.stringify(bad.length > 24 ? bad.slice(0, 12) + '…' : bad)}`,
        async () => (await m.consumeRecoveryCode(hashes, bad)) === null,
      );
    }
  }
}

// --- Password policy (AUTH-012/013/014/016/017) ----------------------------------------------------------------
{
  const g = 'password-policy';
  const m = await load(g, '../../../apps/api/src/modules/auth/support/password-policy.ts');
  if (m) {
    const policy = {
      passwordMinLength: 8,
      passwordRequireUpper: true,
      passwordRequireNumber: true,
      passwordRequireSymbol: false,
    };
    const rules = (pw: string, ctx = {}) =>
      m.evaluatePassword(pw, policy, ctx).map((v: { rule: string }) => v.rule);
    await attempt(
      g,
      'rejects "Password1" and "Passw0rd!" (common)',
      () => rules('Password1').includes('common') && rules('Passw0rd!').includes('common'),
    );
    await attempt(
      g,
      'does NOT reject "Summer2024!!" or "Welcome123!" (known-weak, not on the 14-entry list)',
      () => {
        // Documents the blocklist gap: these are on every public top-10k list.
        return rules('Welcome123!').length === 0 && rules('Summer2024!!').length === 0
          ? 'note: both accepted — the blocklist is only 14 entries'
          : 'note: both rejected';
      },
    );
    await attempt(g, 'rejects a password containing the email name', () =>
      rules('johnsmith-secret-9A', { email: 'johnsmith@x.test' }).includes('common'),
    );
    await attempt(
      g,
      'counts code points, not UTF-16 units (4 emoji = 4 characters, below the minimum of 8)',
      () =>
        m
          .evaluatePassword('😀😀😀😀', policy, {})
          .some((v: { rule: string }) => v.rule === 'min_length'),
    );
    await attempt(
      g,
      'accepts a 128-character passphrase',
      () => rules('Aa1' + 'x'.repeat(125)).length === 0,
    );
    await attempt(
      g,
      'Cyrillic mixed case counts as mixed case',
      () => !rules('Парольтест1').includes('upper_lower'),
    );
    await attempt(g, 'does not throw on lone surrogates / NUL / RTL override', () => {
      for (const s of ['\ud800abc1A', 'Aa1\u0000\u0000\u0000\u0000\u0000', '‮Aa1xxxxxx'])
        m.evaluatePassword(s, policy, {});
      return true;
    });
    await attempt(g, 'minimum is clamped to ≥ 6 even if the policy says 1', () =>
      m
        .evaluatePassword('Ab1xy', { ...policy, passwordMinLength: 1 }, {})
        .some((v: { rule: string }) => v.rule === 'min_length'),
    );
    await attempt(g, 'a policy minimum of 6 is honoured (below the ASVS minimum of 8)', () =>
      !m
        .evaluatePassword('Abc12x', { ...policy, passwordMinLength: 6 }, {})
        .some((v: { rule: string }) => v.rule === 'min_length')
        ? 'note: allowed — a 6-character password passes when an admin sets the minimum to 6'
        : 'note: rejected',
    );
  }
}

// --- IP allow-list (operator login restriction) ---------------------------------------------------------------
{
  const g = 'ip-allowlist';
  const m = await load(g, '../../../apps/api/src/modules/auth/support/ip.ts');
  if (m) {
    await attempt(
      g,
      'IPv4-mapped IPv6 is normalised',
      () => m.normalizeIp('::ffff:10.0.0.7') === '10.0.0.7',
    );
    await attempt(
      g,
      'garbage is not an IP',
      () => m.normalizeIp('10.0.0.7, 1.2.3.4') === null && m.normalizeIp('<script>') === null,
    );
    await attempt(
      g,
      'CIDR membership',
      () => m.ipAllowed('10.1.2.3', ['10.0.0.0/8']) && !m.ipAllowed('11.1.2.3', ['10.0.0.0/8']),
    );
    for (const evil of [
      '10.0.0.5/',
      '10.0.0.5/-1',
      '10.0.0.5/8/8',
      '10.0.0.5/abc',
      '/8',
      '',
      ' ',
    ]) {
      await attempt(
        g,
        `malformed entry ${JSON.stringify(evil)} never widens access`,
        () => !m.ipAllowed('203.0.113.9', [evil]),
      );
    }
    await attempt(g, 'v4 never matches a v6 range', () => !m.ipAllowed('10.0.0.1', ['::/0']));
  }
}

// --- Crypto helpers ---------------------------------------------------------------------------------------------
{
  const g = 'crypto-utils';
  const m = await load(g, '../../../apps/api/src/modules/auth/support/crypto-utils.ts');
  if (m) {
    await attempt(
      g,
      'safeEqual: equal / unequal / different length',
      () => m.safeEqual('abc', 'abc') && !m.safeEqual('abc', 'abd') && !m.safeEqual('abc', 'abcd'),
    );
    await attempt(g, 'randomToken(32) is 256 bits and unique', () => {
      const s = new Set(Array.from({ length: 2000 }, () => m.randomToken(32)));
      return s.size === 2000 && [...s].every((t) => Buffer.from(t, 'base64url').length === 32);
    });
    await attempt(g, 'randomNumericCode(6) is always 6 digits and not biased to low values', () => {
      const n = 20000;
      let low = 0;
      for (let i = 0; i < n; i++) {
        const c = m.randomNumericCode(6);
        if (!/^\d{6}$/.test(c)) fail(`bad code ${c}`);
        if (Number(c) < 500000) low++;
      }
      const frac = low / n;
      return (frac > 0.47 && frac < 0.53) || fail(`fraction below 500000 = ${frac}`);
    });
  }
}

// --- Open redirect (AUTH-077/088) -------------------------------------------------------------------------------
{
  const g = 'return-url';
  const m = await load(g, '../../../apps/web/src/lib/auth/next-path.ts');
  if (m) {
    const evil = [
      'https://evil.example/',
      '//evil.example',
      '///evil.example',
      '/\\evil.example',
      '\\\\evil.example',
      '/%2F%2Fevil.example',
      '/%5Cevil.example',
      'javascript:alert(1)',
      'data:text/html,x',
      '/\t/evil.example',
      '/\n/evil.example',
      ' //evil.example',
      '/api/auth/login',
      '/login',
      'http:evil.example',
      '/@evil.example',
      '/..;/evil',
      '/' + 'a'.repeat(3000),
    ];
    for (const e of evil) {
      await attempt(g, `blocks ${JSON.stringify(e.length > 40 ? e.slice(0, 40) + '…' : e)}`, () => {
        const r = m.safeNextPath(e);
        if (r === null) return true;
        // a returned value must still be a same-site relative path
        return (
          (r.startsWith('/') && !r.startsWith('//') && !r.includes('\\')) || fail(`returned ${r}`)
        );
      });
    }
    await attempt(
      g,
      'keeps a normal deep link with query',
      () => m.safeNextPath('/inbox/123?tab=notes') === '/inbox/123?tab=notes',
    );
  }
}

// --- JWT library behaviour with the product's settings (AUTH-037) ---------------------------------------------
{
  const g = 'jwt';
  try {
    const { JwtService } = requireFromApi('@nestjs/jwt');
    const jsonwebtoken = requireFromApi(
      requireFromApi.resolve('jsonwebtoken', {
        paths: [dirname(requireFromApi.resolve('@nestjs/jwt'))],
      }),
    );
    const jwt = new JwtService({});
    const access = 'a'.repeat(48);
    const refresh = 'r'.repeat(48);
    const claims = { sub: 1, org: 1, typ: 'user', uid: 'u', sid: 's' };
    const good = await jwt.signAsync(claims, { secret: access, expiresIn: 900 });
    const verify = (t: string, secret = access) =>
      jwt.verifyAsync(t, { secret }).then(
        () => true,
        () => false,
      );

    await attempt(g, 'accepts a valid token', async () => (await verify(good)) === true);
    await attempt(g, 'rejects alg=none (unsigned) token', async () => {
      const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const forged = `${b({ alg: 'none', typ: 'JWT' })}.${b({ ...claims, exp: 4102444800 })}.`;
      return (await verify(forged)) === false;
    });
    await attempt(g, 'rejects a payload-tampered token', async () => {
      const [h, , s] = good.split('.');
      const p = Buffer.from(
        JSON.stringify({ ...claims, sub: 2, org: 99, exp: 4102444800 }),
      ).toString('base64url');
      return (await verify(`${h}.${p}.${s}`)) === false;
    });
    await attempt(
      g,
      'rejects a token signed with another secret',
      async () =>
        (await verify(await jwt.signAsync(claims, { secret: 'x'.repeat(48), expiresIn: 900 }))) ===
        false,
    );
    await attempt(
      g,
      'rejects an access token presented to the refresh verifier (separate secrets)',
      async () => (await verify(good, refresh)) === false,
    );
    await attempt(
      g,
      'rejects an expired token',
      async () =>
        (await verify(
          jsonwebtoken.sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 10 }, access),
        )) === false,
    );
    await attempt(
      g,
      'rejects a not-yet-valid token (nbf)',
      async () =>
        (await verify(
          jsonwebtoken.sign({ ...claims, nbf: Math.floor(Date.now() / 1000) + 3600 }, access, {
            expiresIn: 7200,
          }),
        )) === false,
    );
    await attempt(
      g,
      'accepts HS384/HS512 tokens signed with the same secret (algorithm is not pinned)',
      async () => {
        const ok384 = await verify(
          jsonwebtoken.sign(claims, access, { algorithm: 'HS384', expiresIn: 900 }),
        );
        return ok384
          ? 'note: accepted — algorithms[] is not pinned (harmless with one shared secret, but not defence-in-depth)'
          : 'note: rejected';
      },
    );
    await attempt(g, 'accepts any issuer/audience (iss/aud are not checked)', async () => {
      const t = jsonwebtoken.sign({ ...claims, iss: 'someone-else', aud: 'other-api' }, access, {
        expiresIn: 900,
      });
      return (await verify(t)) ? 'note: accepted — iss/aud are not checked' : 'note: rejected';
    });
    await attempt(g, 'rejects the empty and malformed strings', async () => {
      for (const t of ['', 'abc', 'a.b', 'a.b.c', '....'])
        if (await verify(t)) fail(`accepted ${JSON.stringify(t)}`);
      return true;
    });
  } catch (e) {
    check(g, 'load @nestjs/jwt', false, (e as Error).message.split('\n')[0]);
  }
}

// --- Argon2 parameters and cost (AUTH-010) ----------------------------------------------------------------------
{
  const g = 'argon2';
  try {
    const argon2 = requireFromApi('@node-rs/argon2');
    const t0 = performance.now();
    const h: string = await argon2.hash('correct horse battery staple');
    const ms = performance.now() - t0;
    const m = /^\$argon2(id|i|d)\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(h);
    check(g, 'hash() default is a PHC string', !!m, h.slice(0, 40));
    if (m) {
      const [, alg, , mem, t, p] = m;
      check(g, 'algorithm is argon2id', alg === 'id', `argon2${alg}`);
      check(
        g,
        'memory ≥ 19 MiB, iterations ≥ 2, parallelism ≥ 1 (OWASP minimum profile)',
        Number(mem) >= 19456 && Number(t) >= 2 && Number(p) >= 1,
        `m=${mem} KiB, t=${t}, p=${p}`,
      );
      check(
        g,
        'verify accepts the right password and rejects a wrong one',
        (await argon2.verify(h, 'correct horse battery staple')) === true &&
          (await argon2.verify(h, 'wrong')) === false,
      );
      check(
        g,
        'hashing a 1000-character password does not throw or truncate',
        await (async () => {
          const long = 'x'.repeat(1000);
          const hh = await argon2.hash(long);
          return (await argon2.verify(hh, long)) && !(await argon2.verify(hh, long.slice(0, 72)));
        })(),
      );
      check(
        g,
        'hash time on this machine (informational)',
        true,
        `${ms.toFixed(0)} ms for one hash on this machine; tune m/t on production hardware (OWASP minimum profile is m=19 MiB, t=2, p=1)`,
        'note',
      );
      out.push({
        group: g,
        name: '__meta',
        ok: true,
        detail: JSON.stringify({
          alg,
          mem: Number(mem),
          t: Number(t),
          p: Number(p),
          ms: Math.round(ms),
        }),
      });
    }
  } catch (e) {
    check(g, 'load @node-rs/argon2', false, (e as Error).message.split('\n')[0]);
  }
}

// --- Audit redaction (AUTH-091) ---------------------------------------------------------------------------------
{
  const g = 'audit-redaction';
  const m = await load(g, '../../../apps/api/src/modules/auth/security/auth-audit.service.ts');
  if (m?.redact) {
    const sample = {
      password: 'hunter2',
      newPassword: 'hunter3',
      currentPassword: 'hunter4',
      accessToken: 'eyJ.x.y',
      refreshToken: 'eyJ.x.z',
      authorization: 'Bearer abc',
      cookie: 'sid=abc',
      apiKey: 'sk_live_abc',
      clientSecret: 's3cret',
      mfaSecret: 'JBSWY3DP',
      otp: '123456',
      recoveryCode: 'AAAAA-BBBBB',
      code: '123456',
      nested: { token: 'abc', list: [{ secret: 'x' }] },
      email: 'a@b.test',
      orgId: 7,
    };
    const red = m.redact(sample) as any;
    for (const k of [
      'password',
      'newPassword',
      'currentPassword',
      'accessToken',
      'refreshToken',
      'authorization',
      'cookie',
      'apiKey',
      'clientSecret',
      'mfaSecret',
      'otp',
      'recoveryCode',
      'code',
    ]) {
      check(g, `redacts "${k}"`, red[k] === '[REDACTED]', String(red[k]));
    }
    check(
      g,
      'redacts nested token and secret in arrays',
      red.nested.token === '[REDACTED]' && red.nested.list[0].secret === '[REDACTED]',
    );
    check(g, 'keeps non-secret fields (email, orgId)', red.email === 'a@b.test' && red.orgId === 7);
  } else if (m) {
    check(g, 'redact() export found', false, 'auth-audit.service.ts did not export redact');
  }
}

console.log('\n@@AUDIT@@' + JSON.stringify(out));
