import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { FormLookupService } from './form-lookup.service';

const PUBLIC_FORM_PATH = /^\/(?:v\d+\/)?public\/forms\/([A-Za-z0-9]{22})(?:\/|$)/;

/**
 * Answers the CORS preflight of the public form routes (docs/specs/forms-builder-app.md 7.3). A browser on a customer's own page sends an
 * `OPTIONS` before a JSON `POST`; the API-wide CORS policy only knows the web app's origins and would refuse it, so the form's own
 * allow-list has to answer first. `main.ts` mounts this ahead of the global policy, and the module mounts it too (so a test app, which
 * has no `main.ts`, behaves the same).
 *
 * The answer is always 204: an allowed origin gets the CORS headers, any other gets none (the browser then blocks the real request).
 * Nothing here reveals whether a key exists: an unknown key and a refused origin look the same.
 */
@Injectable()
export class FormsPreflightMiddleware implements NestMiddleware {
  private readonly logger = new Logger(FormsPreflightMiddleware.name);

  constructor(private readonly lookup: FormLookupService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (req.method !== 'OPTIONS') return next();
    const match = PUBLIC_FORM_PATH.exec(req.originalUrl.split('?')[0] ?? '');
    if (!match) return next();
    let allow: string | null = null;
    try {
      allow = await this.lookup.preflightOrigin(
        match[1]!,
        typeof req.headers.origin === 'string' ? req.headers.origin : undefined,
      );
    } catch (err) {
      this.logger.warn({ err }, 'form preflight lookup failed; answering without CORS headers');
    }
    res.setHeader('Vary', 'Origin');
    if (allow) {
      res.setHeader('Access-Control-Allow-Origin', allow);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '3600');
    }
    res.status(204).end();
  }
}
