import {
  Body,
  Catch,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
  VERSION_NEUTRAL,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators';
import {
  NOT_FOUND_SCRIPT,
  WidgetPublicError,
  WidgetPublicService,
  type PublicRequest,
} from './widget-public.service';

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** Public failures keep the shape pages already embedded in the wild read: `{ ok: false, error }`, not problem+json. */
@Catch(WidgetPublicError)
export class WidgetPublicErrorFilter implements ExceptionFilter {
  catch(err: WidgetPublicError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    for (const [k, v] of Object.entries(err.headers)) res.setHeader(k, v);
    res.status(err.getStatus()).json(err.payload);
  }
}

/**
 * The widget as a visitor's browser sees it (WD-WGT-008 to 020): no sign-in, no version prefix (the snippet address is
 * printed on other people's sites), the embed token in the path is the only credential.
 */
@ApiExcludeController()
@Public()
@UseFilters(WidgetPublicErrorFilter)
@Controller({ path: 'widget/:token', version: VERSION_NEUTRAL })
export class WidgetPublicController {
  constructor(
    private readonly widgets: WidgetPublicService,
    private readonly config: ConfigService,
  ) {}

  /** Behind a proxy `req.protocol` and `req.get('host')` follow the configured `trust proxy`; an override pins the base. */
  private base(req: Request): string {
    const configured = this.config.get<string>('WIDGET_PUBLIC_BASE_URL');
    if (configured) return configured.replace(/\/+$/, '');
    return `${req.protocol}://${req.get('host')}`;
  }

  private publicRequest(req: Request, inputUuid: unknown): PublicRequest {
    const header = req.headers['x-visitor-uuid'];
    return {
      ip: req.ip ?? '',
      referer: String(req.headers.referer ?? ''),
      userAgent: String(req.headers['user-agent'] ?? ''),
      cookies: req.headers.cookie,
      inputUuid: typeof inputUuid === 'string' ? inputUuid.trim() : '',
      headerUuid: (Array.isArray(header) ? header[0] : header)?.trim() ?? '',
      secure: req.secure,
    };
  }

  /**
   * The allow-list check shared by the three `api/*` routes. A denied origin gets 403 `cors_origin_denied` with no CORS
   * headers; an allowed one gets the exact origin echoed back, with credentials. Returns true when the handler may run.
   */
  private async cors(token: string, req: Request, res: Response): Promise<void> {
    const origin = req.headers.origin;
    const result = await this.widgets.checkOrigin(token, origin);
    if (result.kind === 'skip') return;
    if (result.kind === 'not_found')
      throw new WidgetPublicError(404, { ok: false, error: 'widget_not_found' });
    if (result.kind === 'denied') {
      throw new WidgetPublicError(403, {
        ok: false,
        error: 'cors_origin_denied',
        message: result.message,
      });
    }
    res.setHeader('Access-Control-Allow-Origin', result.origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      req.headers['access-control-request-headers'] ??
        'Content-Type, X-Requested-With, X-Widget-Session',
    );
    res.setHeader('Access-Control-Max-Age', '3600');
    res.setHeader('Vary', 'Origin');
  }

  @Get(['embed', 'embed.js'])
  async embed(
    @Param('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const js = await this.widgets.embedScript(token, this.base(req));
    res.type('application/javascript');
    if (js === null) {
      res.status(404).send(NOT_FOUND_SCRIPT);
      return;
    }
    res.set('Cache-Control', 'no-cache, must-revalidate').status(200).send(js);
  }

  @Get('chat')
  async chat(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const html = await this.widgets.chatPage(token);
    if (html === null) {
      res.status(404).type('text/plain').send('Widget not found');
      return;
    }
    // Deliberately no X-Frame-Options and no frame-ancestors: the page exists to be framed on other people's sites.
    res.status(200).type('text/html').send(html);
  }

  @Get('api/config')
  async config_(
    @Param('token') token: string,
    @Query('visitor_uuid') queryUuid: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.cors(token, req, res);
    const out = await this.widgets.config(token, this.publicRequest(req, queryUuid));
    if (out.newVisitorUuid) {
      res.cookie(`wgt_vid_${out.widgetUuid}`, out.newVisitorUuid, {
        maxAge: YEAR_MS,
        httpOnly: true,
        path: '/',
        secure: req.secure,
        sameSite: req.secure ? 'none' : 'lax',
      });
    }
    res.status(200).json(out.body);
  }

  @Post('api/message')
  async message(
    @Param('token') token: string,
    @Query('visitor_uuid') queryUuid: string | undefined,
    @Body() body: Record<string, unknown> | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.cors(token, req, res);
    await this.widgets.enforceThrottle('message', req.ip ?? '');
    const inputUuid =
      queryUuid ?? (typeof body?.visitor_uuid === 'string' ? body.visitor_uuid : undefined);
    const out = await this.widgets.message(token, this.publicRequest(req, inputUuid), body);
    res.status(200).json(out);
  }

  @Get('api/history')
  async history(
    @Param('token') token: string,
    @Query('since') since: string | undefined,
    @Query('visitor_uuid') queryUuid: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.cors(token, req, res);
    await this.widgets.enforceThrottle('history', req.ip ?? '');
    const n = Number.parseInt(since ?? '0', 10);
    const out = await this.widgets.history(
      token,
      this.publicRequest(req, queryUuid),
      Number.isFinite(n) && n > 0 ? n : 0,
    );
    res.status(200).json(out);
  }
}
