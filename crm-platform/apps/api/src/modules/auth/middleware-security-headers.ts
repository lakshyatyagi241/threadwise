import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/** Paths that must be embeddable cross-origin (the chat widget); everything else refuses framing. */
const FRAMEABLE = /^\/(?:v\d+\/)?widget(?:\/|$)/;
/** Responses that carry credentials, tokens or personal data must never sit in a shared cache. */
const NO_STORE = /^\/v\d+\/(?:auth|account|platform|onboarding)(?:\/|$)/;

/**
 * Response hardening for every route (TW-AUTH-045): MIME sniffing off, a
 * strict referrer policy, no framing (with a path exemption for the widget),
 * HSTS on secure connections, and `no-store` on auth, account and platform
 * responses so a stale token or personal page cannot be replayed from a cache.
 */
@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // originalUrl, not path: Express makes `path` relative to wherever the middleware is mounted.
    const path = req.originalUrl.split('?')[0] ?? '';
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    if (!FRAMEABLE.test(path)) {
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      // The API serves JSON and one image; nothing here may load active content.
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'");
    }
    if (req.secure) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    if (NO_STORE.test(path)) {
      // `private` as well, so a shared cache that ignores no-store still may not keep it.
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private, max-age=0');
      res.setHeader('Pragma', 'no-cache');
    }
    next();
  }
}
