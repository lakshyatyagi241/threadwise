import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  ERROR_CODES,
  FORM_PUBLIC_KEY,
  publicFormEventSchema,
  publicFormSubmitSchema,
  type PublicFormEventInput,
  type PublicFormSubmitInput,
} from '@crm/contracts';
import { Public } from '../../common/decorators';
import { AppError } from '../../common/errors/app-error';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import type { Env } from '../../config/env.schema';
import { buildEmbedScript, EMBED_NOT_FOUND_SCRIPT } from './embed-script';
import { FormLookupService } from './form-lookup.service';
import { FormPublicService, isNotFound } from './form-public.service';
import { FormSubmitService, type PublicRequestMeta } from './form-submit.service';

/** The browser may call these routes from an allowed origin; the answer says which one, and varies on it. */
export function applyCors(res: Response, allowOrigin: string | null): void {
  res.setHeader('Vary', 'Origin');
  if (!allowOrigin) return;
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '3600');
  // No credentials: the public API has no cookies and nothing to forge.
}

const metaOf = (req: Request): PublicRequestMeta => ({
  ip: req.ip,
  userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
  origin: typeof req.headers.origin === 'string' ? req.headers.origin : undefined,
});

/**
 * The public form (docs/specs/forms-builder-app.md 7.2): no sign-in, `/v2/public/forms/<publicKey>`; the key in the path is the only
 * credential and carries no secret. The web app serves the page at `/f/<publicKey>` and calls these routes through its same-origin relay;
 * a customer's own page may call them from a browser only from an allowed origin (see `FormLookupService`).
 *
 * An unknown, archived, closed (for a submit), malformed or plan-locked key is the same 404. The door never says whether a contact
 * existed, was created or was updated, or whether a submission was spam or needs review: the answer is the form's own thank-you.
 */
@ApiTags('forms-public')
@Public()
@Controller({ path: 'public/forms', version: '2' })
export class PublicFormsController {
  constructor(
    private readonly lookup: FormLookupService,
    private readonly pub: FormPublicService,
    private readonly submitService: FormSubmitService,
  ) {}

  @Get(':publicKey')
  @ApiOperation({
    summary: 'The published form, as the page draws it',
    description:
      'The frozen version the public sees: steps, theme, consent line, honeypot field name, captcha need, and the `frame-ancestors` values the page must answer with. A paused form comes back `closed`. 404 for an unknown, archived or plan-locked key; 403 FORMS_ORIGIN_DENIED for a browser on an origin the form does not allow. Cached 30 seconds with an ETag.',
  })
  async definition(
    @Param('publicKey') key: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const meta = metaOf(req);
    const { route, allowOrigin } = await this.lookup.open(key, meta, { requirePublished: false });
    applyCors(res, allowOrigin);
    const { body, etag } = await this.pub.definition(route);
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (req.headers['if-none-match'] === etag) {
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }
    return body;
  }

  @Post(':publicKey/events')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Analytics beacon: a view, a start, a step, a submit, a completion',
    description:
      'Always 204 for a key that does not exist; a refused origin is still 403 and a rate limit 429. Nothing personal is stored.',
  })
  async event(
    @Param('publicKey') key: string,
    @Body(zodPipe(publicFormEventSchema)) body: PublicFormEventInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const { route, allowOrigin } = await this.lookup.open(key, metaOf(req), {
        requirePublished: true,
      });
      applyCors(res, allowOrigin);
      await this.pub.recordEvent(route, body);
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  @Post(':publicKey/submit')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  @ApiOperation({
    summary: 'Send a submission',
    description:
      'JSON only. `idempotencyKey` (made by the page, once per page load) makes a repeat the same submission: the stored answer comes back and nothing is written twice. ' +
      '201 `{ submissionToken, next }` whatever happened to the submission. 422 FORMS_VALIDATION lists `{ path: fieldId, message: rule }` (the one case the sender learns specifics: it is their own input). ' +
      '404 for an unknown, archived, paused or plan-locked key, 403 FORMS_ORIGIN_DENIED for a browser on a disallowed origin, 413 over the body cap, 415 for another content type, 429 over a rate limit.',
  })
  async submit(
    @Param('publicKey') key: string,
    @Body(zodPipe(publicFormSubmitSchema)) body: PublicFormSubmitInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!req.is('application/json')) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Send the submission as application/json.',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }
    const meta = metaOf(req);
    const { route, allowOrigin } = await this.lookup.open(key, meta, { requirePublished: true });
    applyCors(res, allowOrigin);
    return this.submitService.submit(route, body, meta);
  }
}

/**
 * The loader a customer's site includes: `<script src="<api origin>/form-embed/<publicKey>/embed.js" async>`. It carries nothing but the
 * key and the web origin, so it is cached and never touches the database: a key that does not exist yields an iframe whose page says so.
 */
@ApiExcludeController()
@Public()
@Controller({ path: 'form-embed', version: VERSION_NEUTRAL })
export class FormEmbedController {
  private readonly webOrigin: string;

  constructor(config: ConfigService<Env, true>) {
    this.webOrigin = new URL(config.get('WEB_APP_URL', { infer: true })).origin;
  }

  @Get(':publicKey/embed.js')
  embed(@Param('publicKey') key: string, @Res() res: Response): void {
    res.type('application/javascript');
    if (!FORM_PUBLIC_KEY.test(key)) {
      res.status(HttpStatus.NOT_FOUND).send(EMBED_NOT_FOUND_SCRIPT);
      return;
    }
    res
      .set('Cache-Control', 'public, max-age=300')
      .status(HttpStatus.OK)
      .send(buildEmbedScript(key, this.webOrigin));
  }
}
