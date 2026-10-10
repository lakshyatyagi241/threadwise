import * as Crypto from 'expo-crypto';
import type { z } from 'zod';
import { env } from '@/config/env';
import { getAccessToken, refreshTokens } from '@/lib/auth/session-manager';
import { log } from '@/lib/observability/logger';
import { clientHeaders } from './client-headers';
import { ApiError, CLIENT_ERROR_CODES, toApiError } from './errors';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const MUTATING: ReadonlySet<Method> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** A phone on a bad connection should fail in a way the screen can show, not hang. */
const DEFAULT_TIMEOUT_MS = 30_000;

export interface ApiRequest<T> {
  method?: Method;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Parsed at the boundary: the server can be older or newer than this build. Omit for 204 responses. */
  schema?: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** Reuse one key across the retries of the same user action; a fresh one is made when omitted. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** false for the public doors (sign-in, MFA, workspace pick): no bearer token, no refresh-and-retry on 401. */
  auth?: boolean;
}

function qs(query: ApiRequest<unknown>['query']): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Calls the CRM API: `/v2/...` paths, bearer token attached and rotated when needed, problem+json turned into `ApiError`,
 * the answer parsed with the contract schema. Every call to the API from the app goes through here (lint-enforced).
 *
 * A 401 on an authenticated call rotates the refresh token once and repeats the request with the same Idempotency-Key.
 */
export async function apiFetch<T = void>(path: string, req: ApiRequest<T> = {}): Promise<T> {
  const method = req.method ?? 'GET';
  const idempotencyKey = MUTATING.has(method)
    ? (req.idempotencyKey ?? Crypto.randomUUID())
    : undefined;
  return send<T>(path, { ...req, method, idempotencyKey }, true);
}

async function send<T>(
  path: string,
  req: ApiRequest<T> & { method: Method; idempotencyKey?: string },
  mayRefresh: boolean,
): Promise<T> {
  const authenticated = req.auth !== false;
  const token = authenticated ? await getAccessToken() : null;

  const headers: Record<string, string> = clientHeaders();
  if (req.body !== undefined) headers['Content-Type'] = 'application/json';
  if (req.idempotencyKey) headers['Idempotency-Key'] = req.idempotencyKey;
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error('timeout')),
    req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const onCallerAbort = () => controller.abort(req.signal?.reason);
  req.signal?.addEventListener('abort', onCallerAbort);

  let res: Response;
  let text: string;
  try {
    res = await fetch(`${env.apiUrl}${path}${qs(req.query)}`, {
      method: req.method,
      headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: controller.signal,
    });
    text = await res.text();
  } catch (e) {
    if (req.signal?.aborted) throw new ApiError(0, CLIENT_ERROR_CODES.ABORTED, 'Request cancelled');
    if (controller.signal.aborted)
      throw new ApiError(0, CLIENT_ERROR_CODES.TIMEOUT, 'The server took too long to answer');
    log.warn('api.network', {
      path,
      method: req.method,
      error: e instanceof Error ? e.message : 'unknown',
    });
    throw new ApiError(0, CLIENT_ERROR_CODES.NETWORK, 'Could not reach the server');
  } finally {
    clearTimeout(timeout);
    req.signal?.removeEventListener('abort', onCallerAbort);
  }

  const json = parseJson(text);

  if (res.status === 401 && authenticated && token && mayRefresh) {
    // The token we sent may already have been rotated by another request that hit 401 first; refreshTokens() shares one rotation.
    // An offline phone makes the rotation throw a connectivity ApiError, which is the honest answer for this request too.
    const rotated = await refreshTokens();
    if (rotated) return send<T>(path, req, false);
  }

  if (!res.ok) {
    throw toApiError(
      res.status,
      json,
      res.headers.get('x-request-id'),
      res.headers.get('retry-after'),
    );
  }
  if (!req.schema) return undefined as T;
  const parsed = req.schema.safeParse(json);
  if (!parsed.success) {
    log.error('api.contract_mismatch', {
      path,
      issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join('.')),
    });
    throw new ApiError(
      res.status,
      CLIENT_ERROR_CODES.CONTRACT_MISMATCH,
      'The server answered in a shape this version of the app does not understand',
      res.headers.get('x-request-id') ?? undefined,
    );
  }
  return parsed.data;
}
