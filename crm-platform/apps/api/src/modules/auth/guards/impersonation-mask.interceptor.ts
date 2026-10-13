import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { RequestContextStore } from '../../../common/context/request-context';
import {
  isSecretKey,
  maskEmail,
  maskName,
  maskPhone,
  piiKindOfKey,
} from '../../audit-log/audit-pii';

const MAX_DEPTH = 24;

const MASKERS = {
  phone: maskPhone,
  email: maskEmail,
  name: maskName,
  address: () => '[hidden address]',
  text: () => '[hidden text]',
} as const;

/** Keys that identify the session itself; masking them would break the act-as banner and the handoff. */
const KEEP = new Set(['operatorname', 'reason']);

/**
 * Masks personal data in a JSON body: a key that names a phone, e-mail, address, free text or a person's name has its value
 * replaced (`+91 ******210`, `a***@x.com`). Secrets are not touched here, auth already keeps them out of responses and the
 * act-as session still needs its own token. Pure, no truncation (unlike the audit renderer), so the response keeps its shape.
 */
export function maskPersonalData(value: unknown, key = '', depth = 0): unknown {
  if (value === null || value === undefined || depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    const kind = piiKindOfKey(key, '');
    return value.map((v) =>
      typeof v === 'string' && kind ? MASKERS[kind](v) : maskPersonalData(v, key, depth + 1),
    );
  }
  if (typeof value === 'object') {
    if (value instanceof Date || Buffer.isBuffer(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = maskPersonalData(v, k, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    if (KEEP.has(key.toLowerCase()) || isSecretKey(key)) return value;
    const kind = piiKindOfKey(key, 'contacts');
    const text = String(value);
    if (kind && text !== '') return MASKERS[kind](text);
  }
  return value;
}

/** Global. Only an act-as request is touched; every other response passes straight through. */
@Injectable()
export class ImpersonationMaskInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http' || !RequestContextStore.peek()?.impersonation) {
      return next.handle();
    }
    return next.handle().pipe(
      map((body) => (body instanceof StreamableFile ? body : maskPersonalData(body))),
    );
  }
}
