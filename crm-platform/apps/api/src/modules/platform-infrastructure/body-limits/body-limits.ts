import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  json,
  urlencoded,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import {
  FORM_SUBMIT_MAX_BODY_BYTES,
  HELP_AGENT_MAX_BODY_BYTES,
  LEAD_HOOK_MAX_BODY_BYTES,
  MARKET_HOOK_MAX_BYTES,
} from '@crm/contracts';
import { readInfraEnv, type InfraEnv } from '../../../config/domains/platform-infrastructure.env';

const KIB = 1024;

export interface BodyLimitClass {
  name: string;
  /** Matched against the path with any `/v<n>` version prefix ignored. */
  pattern: RegExp;
  bytes: number;
}

/** `^/(?:v\d+/)?<path>(?:/|$)`: the API is versioned in the URL and some callbacks are version-neutral. */
const under = (path: string): RegExp => new RegExp(`^/(?:v\\d+/)?${path}(?:/|$)`);

/**
 * Body-size classes, most specific first; a request takes the first that matches, and any other route gets the default.
 *
 * Why classes at all: the JSON parser runs before routing, authentication and any controller code, so a route cannot raise or
 * lower its own cap. Until now every route shared Express's built-in 100 KiB, which made the caps some domains declare
 * unreachable (a lead hook promises 1 MiB, the marketplace relay 256 KiB) and would refuse the larger callbacks providers send.
 * Raising a cap is only done for unauthenticated machine callbacks that need it, and each is bounded by a number someone can read.
 */
export function bodyLimitClasses(env: InfraEnv): BodyLimitClass[] {
  return [
    {
      name: 'whatsapp-webhook',
      pattern: under('public/webhooks/whatsapp'),
      bytes: env.INFRA_BODY_LIMIT_WHATSAPP_WEBHOOK_KB * KIB,
    },
    // These two domains enforce their own contract caps; the parser must allow exactly that much, no more.
    { name: 'lead-hook', pattern: under('public/lead-hooks'), bytes: LEAD_HOOK_MAX_BODY_BYTES },
    // The Forms add-on's public door: a submission is a few answers, so the class is bounded by its own contract number, not the
    // webhook class (an anonymous caller must not be able to make the parser buffer a megabyte).
    { name: 'public-form', pattern: under('public/forms'), bytes: FORM_SUBMIT_MAX_BODY_BYTES },
    // The Help assistant's model call carries the visible text of a page. Authenticated and throttled; bounded by the contract's number.
    {
      name: 'help-agent',
      pattern: under('help-agent/chat/completions'),
      bytes: HELP_AGENT_MAX_BODY_BYTES,
    },
    {
      name: 'marketplace-hook',
      pattern: under('public/marketplace'),
      bytes: MARKET_HOOK_MAX_BYTES,
    },
    {
      name: 'webhook',
      pattern: new RegExp(
        '^/(?:v\\d+/)?(?:' +
          [
            'public/webhooks',
            'webhooks/channels',
            'store-public/webhooks',
            'facebook',
            'instaflow',
            'telegram/inbound',
            '(?:line|viber|wechat)/inbound',
            'shopify/(?:webhook|compliance)',
            'woocommerce/webhook',
            'campaigns/node',
          ].join('|') +
          ')(?:/|$)',
      ),
      bytes: env.INFRA_BODY_LIMIT_WEBHOOK_KB * KIB,
    },
  ];
}

export function defaultBodyLimitBytes(env: InfraEnv): number {
  return env.INFRA_BODY_LIMIT_KB * KIB;
}

/** The class a path falls in, or undefined for the default. */
export function bodyLimitFor(path: string, env: InfraEnv): BodyLimitClass | undefined {
  return bodyLimitClasses(env).find((c) => c.pattern.test(path));
}

type WithRawBody = Request & { rawBody?: Buffer };
/** Signature checks (HMAC over the bytes as sent) need them; re-serialising parsed JSON changes key order and spacing. */
const keepRawBody = (req: unknown, _res: unknown, buf: Buffer): void => {
  (req as WithRawBody).rawBody = buf;
};

/**
 * Sets the JSON and form body limits for the whole API (TW-INFRA-020). Call once from `main.ts`, after `NestFactory.create` with
 * `rawBody: true` and before `listen`.
 *
 * Each class gets its own parser, mounted ahead of the application-wide one; a request a class parser has read is skipped by
 * the later parser (body-parser leaves a request alone once its body is set). Over the cap the parser answers 413 before the
 * rest of the body is buffered, and the exception filter turns that into `PAYLOAD_TOO_LARGE` problem+json.
 *
 * Multipart uploads are not affected: each upload route sets its own file-size limit with multer.
 */
export function installBodyLimits(
  app: NestExpressApplication,
  env: InfraEnv = readInfraEnv(process.env),
): void {
  for (const c of bodyLimitClasses(env)) {
    const parsers: RequestHandler[] = [
      json({ limit: c.bytes, verify: keepRawBody }),
      urlencoded({ limit: c.bytes, extended: true, verify: keepRawBody }),
    ];
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (!c.pattern.test(req.path)) return next();
      const [first, second] = parsers as [RequestHandler, RequestHandler];
      first(req, res, (err?: unknown) => (err ? next(err) : second(req, res, next)));
    });
  }
  const limit = defaultBodyLimitBytes(env);
  app.useBodyParser('json', { limit });
  app.useBodyParser('urlencoded', { limit, extended: true });
}
