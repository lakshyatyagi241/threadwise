import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { overloadGuard } from '../../../src/common/http/overload-guard';

const req = (url: string) => ({ url, originalUrl: url }) as Request;
function res() {
  const e = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const out: { status?: number; headers: Record<string, string>; body?: unknown } = { headers: {} };
  e.status = (n: number) => ((out.status = n), e);
  e.setHeader = (k: string, v: string) => ((out.headers[k] = v), e);
  e.type = () => e;
  e.send = (b: unknown) => ((out.body = b), e);
  return { r: e as unknown as Response, e, out };
}

describe('overloadGuard', () => {
  it('lets max requests in and refuses the next with 503 and Retry-After, without calling the handler', () => {
    const guard = overloadGuard(2);
    const next = vi.fn();
    const a = res();
    const b = res();
    const c = res();
    guard(req('/v2/contacts'), a.r, next);
    guard(req('/v2/contacts'), b.r, next);
    guard(req('/v2/contacts'), c.r, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(c.out.status).toBe(503);
    expect(c.out.headers['Retry-After']).toBe('1');
    expect(c.out.body).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
  });

  it('frees the slot when a response closes (finished or aborted), once, so the next request gets in', () => {
    const guard = overloadGuard(1);
    const next = vi.fn();
    const a = res();
    guard(req('/x'), a.r, next);
    a.e.emit('close');
    a.e.emit('close'); // a second close must not free a slot it does not hold
    const b = res();
    const c = res();
    guard(req('/x'), b.r, next);
    guard(req('/x'), c.r, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(c.out.status).toBe(503);
  });

  it('never sheds the probes, even when full, and 0 turns the guard off', () => {
    const guard = overloadGuard(1);
    const next = vi.fn();
    guard(req('/v2/x'), res().r, next);
    for (const p of ['/health', '/ready', '/metrics', '/health?x=1']) {
      const r = res();
      guard(req(p), r.r, next);
      expect(r.out.status).toBeUndefined();
    }
    const off = overloadGuard(0);
    const n2 = vi.fn();
    for (let i = 0; i < 5; i++) off(req('/v2/x'), res().r, n2);
    expect(n2).toHaveBeenCalledTimes(5);
  });
});
