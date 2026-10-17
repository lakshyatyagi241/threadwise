import { afterEach, describe, expect, it } from 'vitest';
import { runUserCode } from '../../../src/infra/sandbox/code-sandbox';

/**
 * Attacks on the flow Code node's sandbox (SAST finding EVAL, QA task 26). `integrations-nodes.spec.ts` covers the basics (constructor
 * chain, endless loop, allocation bomb); this suite covers what that one does not: the intrinsics that were removed, the less obvious ways
 * out of a vm context, isolation between runs, hostile inputs, unserialisable results, and the cap on how many workers run at once.
 *
 * Rerun: pnpm --filter @crm/api exec vitest run test/unit/infra/code-sandbox.spec.ts
 */
const run = (code: string, inputs: Record<string, unknown> = {}, timeoutMs = 1000) =>
  runUserCode(code, inputs, { timeoutMs });

afterEach(() => {
  delete process.env.SANDBOX_MAX_CONCURRENT;
  delete process.env.SANDBOX_MAX_QUEUED;
});

describe('what the context does not contain', () => {
  it('has no host globals', async () => {
    const r = await run(
      'return [typeof process, typeof require, typeof module, typeof exports, typeof Buffer, typeof global, typeof setTimeout, typeof setImmediate, typeof queueMicrotask, typeof fetch, typeof structuredClone].join(",")',
    );
    expect(r).toMatchObject({ ok: true, result: Array(11).fill('undefined').join(',') });
  });

  it('has no SharedArrayBuffer, Atomics or WebAssembly (the building blocks of timing side channels)', async () => {
    const r = await run(
      'return [typeof SharedArrayBuffer, typeof Atomics, typeof WebAssembly].join(",")',
    );
    expect(r).toMatchObject({ ok: true, result: 'undefined,undefined,undefined' });
  });

  it('cannot block a worker with Atomics.wait', async () => {
    const r = await run('Atomics.wait(new Int32Array(8), 0, 0); return 1;');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Atomics is not defined/);
  });

  it('cannot compile WebAssembly', async () => {
    const r = await run('return new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0]));');
    expect(r.ok).toBe(false);
  });
});

describe('ways out of a vm context', () => {
  // Every probe asks "what is `process`?" through a different door. The answer must always be "not there": the context's own Function
  // and generators have the context's global, not the host's.
  const doors: Array<[string, string]> = [
    [
      'generator constructor',
      "var G = Object.getPrototypeOf(function*(){}).constructor; return G('return typeof process')().next().value;",
    ],
    ['Function constructor', "return Function('return typeof process')();"],
    ['arrow function constructor', "return (() => 1).constructor('return typeof process')();"],
    [
      'error object constructor',
      "try { null.x } catch (e) { return e.constructor.constructor('return typeof process')(); }",
    ],
    [
      'thrown RangeError constructor',
      "try { (function f(){ f() })() } catch (e) { return e.constructor.constructor('return typeof process')(); }",
    ],
    [
      'this and globalThis',
      "return this.constructor.constructor('return typeof process')() + typeof globalThis.process;",
    ],
    [
      'prepareStackTrace getThis',
      'Error.prepareStackTrace = function (e, s) { return s[0].getThis(); }; var t = new Error().stack; return typeof t.process + typeof t.require;',
    ],
    ['captureStackTrace', 'var o = {}; Error.captureStackTrace(o); return typeof o.stack;'],
    [
      'proto walk to Object',
      "return typeof Object.getPrototypeOf(Object.getPrototypeOf(function(){})).constructor('return typeof process')();",
    ],
  ];
  it.each(doors)('%s does not reach the host', async (_name, code) => {
    const r = await run(code);
    // Either the probe throws, or it reports that nothing host-side exists. It must never hand back a host object.
    if (r.ok) expect(String(r.result)).not.toMatch(/object|function|\[native|mainModule/);
    else expect(r.error).toBeTruthy();
    expect(String(r.result)).not.toContain('process');
  });

  it('cannot swallow the time limit: a timeout is not catchable from inside', async () => {
    const t = Date.now();
    const r = await runUserCode(
      'try { while (true) {} } catch (e) { return "swallowed"; }',
      {},
      { timeoutMs: 300 },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/timed out|time limit/i);
    expect(Date.now() - t).toBeLessThan(3000);
  });

  it('cannot swallow the time limit with a finally loop either', async () => {
    const r = await runUserCode(
      'try { while (true) {} } finally { while (true) {} }',
      {},
      { timeoutMs: 300 },
    );
    expect(r.ok).toBe(false);
  });
});

describe('isolation and inputs', () => {
  it('shares nothing between two runs', async () => {
    await run('globalThis.leak = "left behind"; Object.prototype.polluted = "yes"; return 1;');
    const r = await run('return typeof leak + ":" + String({}.polluted);');
    expect(r).toMatchObject({ ok: true, result: 'undefined:undefined' });
  });

  it('does not let a hostile input pollute prototypes', async () => {
    const hostile = JSON.parse(
      '{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted2":"yes"}}}',
    );
    const r = await run('return String({}.polluted) + ":" + String({}.polluted2);', {
      functionArgs: hostile,
    });
    expect(r).toMatchObject({ ok: true, result: 'undefined:undefined' });
  });

  it('passes inputs by value: changing them inside never reaches the caller', async () => {
    const original = { functionArgs: { a: { b: 1 } } };
    await run('functionArgs.a.b = 99; return functionArgs.a.b;', original);
    expect(original.functionArgs.a.b).toBe(1);
  });

  it('reports inputs that cannot be serialised without throwing', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const r = await run('return 1;', { functionArgs: circular });
    expect(r).toEqual({ ok: false, error: 'Inputs could not be serialised', result: null });
  });
});

describe('what comes back', () => {
  it('turns a function or undefined result into null', async () => {
    expect((await run('return function () {};')).result).toBeNull();
    expect((await run('return undefined;')).result).toBeNull();
  });

  it('reports a result that cannot be serialised instead of crashing', async () => {
    const big = await run('return 10n;');
    expect(big.ok).toBe(false);
    const cyc = await run('var o = {}; o.self = o; return o;');
    expect(cyc.ok).toBe(false);
  });

  it('survives an absurd string without taking the process down', async () => {
    const r = await run("var s = 'x'; for (var i = 0; i < 40; i++) s += s; return s.length;");
    expect(r.ok).toBe(false);
  });

  it('cuts a long error message', async () => {
    const r = await run(`throw new Error('${'e'.repeat(2000)}')`);
    expect(r.ok).toBe(false);
    expect((r.error ?? '').length).toBeLessThanOrEqual(300);
  });
});

describe('how many run at once', () => {
  const burn = (ms: number) => `var t = Date.now(); while (Date.now() - t < ${ms}) {} return 1;`;

  it('never runs more workers than the cap: 5 jobs of 250 ms at a cap of 2 take at least 3 rounds', async () => {
    process.env.SANDBOX_MAX_CONCURRENT = '2';
    const t = Date.now();
    const out = await Promise.all(Array.from({ length: 5 }, () => run(burn(250), {}, 3000)));
    expect(out.every((r) => r.ok)).toBe(true);
    // ceil(5 / 2) = 3 rounds of at least 250 ms. Unlimited, they would all finish in about one.
    expect(Date.now() - t).toBeGreaterThanOrEqual(700);
  }, 20_000);

  it('refuses a run that would queue past the limit, and the queued ones still finish', async () => {
    process.env.SANDBOX_MAX_CONCURRENT = '1';
    process.env.SANDBOX_MAX_QUEUED = '2';
    const jobs = Array.from({ length: 4 }, () => run(burn(150), {}, 3000));
    const out = await Promise.all(jobs);
    const refused = out.filter((r) => !r.ok);
    expect(refused).toHaveLength(1);
    expect(refused[0]!.error).toMatch(/busy/i);
    expect(out.filter((r) => r.ok)).toHaveLength(3);
  }, 20_000);

  it('gives the slot back after a timeout, a thrown error and an empty program', async () => {
    process.env.SANDBOX_MAX_CONCURRENT = '1';
    expect((await run('while (true) {}', {}, 200)).ok).toBe(false);
    expect((await run('throw new Error("x")')).ok).toBe(false);
    expect((await run('   ')).ok).toBe(true);
    expect(await run('return 42;')).toMatchObject({ ok: true, result: 42 });
  }, 20_000);
});
