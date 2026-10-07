import { createHmac, timingSafeEqual } from 'node:crypto';

/** `sha256=<hex>` over `<timestamp>.<body>`: binding the timestamp lets a receiver refuse a replayed old delivery. */
export function sign(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

/** For tests and for the docs' example receiver. */
export function verify(secret: string, timestamp: string, body: string, header: string): boolean {
  const want = Buffer.from(sign(secret, timestamp, body));
  const got = Buffer.from(header);
  return want.length === got.length && timingSafeEqual(want, got);
}
