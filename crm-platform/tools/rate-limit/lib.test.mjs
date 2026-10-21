import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build, deployChecks } from './audit.mjs';
import { classify, enrich, parsePolicies, parseThrottle, scanController } from './lib.mjs';

const ctl = (body, head = "@Controller({ path: 'auth', version: '2' })") =>
  `import x from 'y';\n\n${head}\nexport class AuthController {\n${body}\n}\n`;
const routeOf = (src, handler) =>
  scanController(src, 'x.controller.ts').find((r) => r.handler === handler);

test('a public route with no limiter is read as unlimited', () => {
  const r = routeOf(ctl("  @Public()\n  @Post('login')\n  async signIn() {}"), 'signIn');
  assert.equal(r.path, '/v2/auth/login');
  assert.equal(r.public, true);
  assert.equal(r.limiter, 'none');
});

test('a named policy and an explicit spec are both read, including over several lines', () => {
  assert.deepEqual(parseThrottle("@Throttle('auth')"), { policy: 'auth' });
  const multi = `@Throttle({\n  limit: 5,\n  windowSeconds: 3600,\n  by: 'ip',\n})`;
  assert.deepEqual(parseThrottle(multi), { limit: 5, windowSeconds: 3600, by: 'ip' });
  const r = routeOf(
    ctl(
      "  @Public()\n  @Throttle({ limit: 5, windowSeconds: 3600, by: 'ip' })\n  @Post('forgot-password')\n  async forgot() {}",
    ),
    'forgot',
  );
  assert.equal(r.limiter, 'throttle');
  assert.equal(r.throttle.limit, 5);
});

test('a class-level Public and Throttle apply to every route, and a handler decorator wins', () => {
  const src = ctl(
    "  @Get('a')\n  a() {}\n  @Throttle('webhook')\n  @Post('b')\n  b() {}",
    "@Public()\n@Throttle('public-form')\n@Controller({ path: 'forms', version: '2' })",
  );
  assert.equal(routeOf(src, 'a').public, true);
  assert.deepEqual(routeOf(src, 'a').throttle, { policy: 'public-form' });
  assert.deepEqual(routeOf(src, 'b').throttle, { policy: 'webhook' });
});

test('SkipThrottle is recorded, and a V1 controller is public and skipped by design (its per-key limit applies)', () => {
  const r = routeOf(ctl("  @SkipThrottle()\n  @Get('health')\n  h() {}"), 'h');
  assert.equal(r.limiter, 'skipped');
  const v1 = `@V1Controller('contacts')\nexport class V1Contacts {\n  @Get()\n  list() {}\n}\n`;
  const v = routeOf(v1, 'list');
  assert.equal(v.path, '/api/v1/contacts');
  assert.equal(v.public, true);
  assert.equal(v.limiter, 'skipped');
});

test('a handler with a verb decorator and a multi-line decorator above it is still found', () => {
  const src = ctl(
    "  @ApiOperation({\n    summary: 'x',\n  })\n  @Public()\n  @Post(':token/verify')\n  verify() {}",
  );
  assert.equal(routeOf(src, 'verify').path, '/v2/auth/:token/verify');
});

test('classification: credential first, then webhook, then public write or read; costly only when signed in', () => {
  const base = { method: 'POST', handler: 'h' };
  assert.equal(classify({ ...base, path: '/v2/auth/login', public: true }), 'credential');
  assert.equal(classify({ ...base, path: '/v2/auth/otp/verify', public: true }), 'credential');
  assert.equal(classify({ ...base, path: '/webhooks/stripe', public: true }), 'webhook');
  assert.equal(classify({ ...base, path: '/v2/forms/submit', public: true }), 'public-write');
  assert.equal(
    classify({ method: 'GET', handler: 'h', path: '/v2/blog', public: true }),
    'public-read',
  );
  assert.equal(classify({ ...base, path: '/v2/contacts/export', public: false }), 'costly');
  assert.equal(
    classify({ method: 'GET', handler: 'h', path: '/v2/contacts/export', public: false }),
    'other',
  );
});

test('severity of an unlimited route follows the class, and a policy resolves to its numbers', () => {
  const policies = parsePolicies(
    "export const RATE_POLICIES = {\n  auth: { limit: 10, windowSeconds: 60, by: 'ip' },\n  'public-form': { limit: 20, windowSeconds: 60, by: 'ip' },\n} as const satisfies x",
  );
  assert.deepEqual(policies.auth, { limit: 10, windowSeconds: 60, by: 'ip' });
  const login = enrich(
    routeOf(ctl("  @Public()\n  @Post('login')\n  signIn() {}"), 'signIn'),
    policies,
  );
  assert.equal(login.severityIfUnlimited, 'Critical');
  const limited = enrich(
    routeOf(ctl("  @Public()\n  @Throttle('auth')\n  @Post('login')\n  signIn() {}"), 'signIn'),
    policies,
  );
  assert.deepEqual(limited.effective, { limit: 10, windowSeconds: 60, by: 'ip' });
});

test('deploy files: a trust-all proxy, an empty one and a switched-off limiter are reported; the shipped values are not', () => {
  const bad = deployChecks([
    { file: 'a.yml', text: 'TRUST_PROXY: true\nINFRA_RATE_LIMIT_ENABLED: "false"\n' },
    { file: 'b.env', text: 'TRUST_PROXY=\n' },
  ]);
  assert.equal(bad.problems.length, 3);
  for (const range of ['0.0.0.0/0', '::/0'])
    assert.equal(
      deployChecks([{ file: 'd.yml', text: `TRUST_PROXY: ${range}\n` }]).problems.length,
      1,
      range,
    );
  const ok = deployChecks([
    { file: 'c.yml', text: '  TRUST_PROXY: loopback,linklocal,uniquelocal\n' },
  ]);
  assert.deepEqual(ok.problems, []);
});

test('the inventory keeps abuse-prone routes and drops the rest', () => {
  const inv = build({
    controllers: [
      {
        file: 'c.controller.ts',
        text: ctl("  @Public()\n  @Post('login')\n  a() {}\n  @Get('list')\n  b() {}"),
      },
    ],
    policiesSrc: 'export const RATE_POLICIES = {} as const',
    deploy: [],
  });
  assert.equal(inv.summary.routes, 2);
  assert.deepEqual(
    inv.routes.map((r) => r.key),
    ['POST /v2/auth/login'],
  );
  assert.equal(inv.summary.byClass.credential.undeclared, 1);
});
