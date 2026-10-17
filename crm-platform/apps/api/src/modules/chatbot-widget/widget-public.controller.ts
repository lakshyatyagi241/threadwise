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
  UploadedFile,
  UseFilters,
  UseInterceptors,
  VERSION_NEUTRAL,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { pipeline } from 'node:stream';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { ChatMediaStore } from '../../infra/providers/chat-conversations/media';
import {
  isInlineMime,
  servableMime,
} from '../../infra/providers/chat-conversations/media/media-types';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators';
import { isGpcSignal } from '../contact-consent';
import { pickChatLocale } from './chat-page-text';
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
 * The widget as a visitor's browser sees it (TW-WGT-008 to 020): no sign-in, no version prefix (the snippet address is
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
    private readonly mediaStore: ChatMediaStore,
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
      gpc: isGpcSignal(req.headers['sec-gpc']),
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
  async chat(
    @Param('token') token: string,
    @Query('lang') lang: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // The window speaks the visitor's browser language (or `?lang=`), one of the app's 21.
    const html = await this.widgets.chatPage(
      token,
      pickChatLocale(req.headers['accept-language'], lang),
    );
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

  /** The visitor attaches a file to answer a question that asked for one. Up to 10 MB; the content is checked on the server. */
  @Post('api/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  async upload(
    @Param('token') token: string,
    @Query('visitor_uuid') queryUuid: string | undefined,
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.cors(token, req, res);
    await this.widgets.enforceThrottle('message', req.ip ?? '');
    const out = await this.widgets.upload(token, this.publicRequest(req, queryUuid), file);
    res.status(200).json(out);
  }

  /** The visitor's thumbs up or down on a line the bot sent. */
  @Post('api/feedback')
  async feedback(
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
    res
      .status(200)
      .json(await this.widgets.feedback(token, this.publicRequest(req, inputUuid), body));
  }

  /** The visitor chose "Restart this chat" or "Close this chat": a fresh visitor, so the next load is a new conversation. */
  @Post('api/restart')
  async restart(
    @Param('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.cors(token, req, res);
    await this.widgets.enforceThrottle('message', req.ip ?? '');
    const out = await this.widgets.restart(token, this.publicRequest(req, undefined));
    res.cookie(`wgt_vid_${out.widgetUuid}`, out.visitorUuid, {
      maxAge: YEAR_MS,
      httpOnly: true,
      path: '/',
      secure: req.secure,
      sameSite: req.secure ? 'none' : 'lax',
    });
    res.status(200).json({ ok: true, visitor_uuid: out.visitorUuid });
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

  /**
   * A file the flow bot sent this visitor (`GET /widget/<token>/api/media/<line id>`): read through the visitor's own thread, so
   * another visitor's id or a stale one is the same 404. Served as data, never as a page.
   */
  @Get('api/media/:id')
  async media(
    @Param('token') token: string,
    @Param('id') idParam: string,
    @Query('visitor_uuid') queryUuid: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.widgets.enforceThrottle('history', req.ip ?? '');
    const id = Number.parseInt(idParam, 10);
    if (!Number.isFinite(id) || id <= 0)
      throw new WidgetPublicError(404, { ok: false, error: 'widget_not_found' });
    const file = await this.widgets.mediaFile(token, this.publicRequest(req, queryUuid), id);
    const opened = await this.mediaStore.open(file.orgId, file.key, undefined);
    if (!opened) throw new WidgetPublicError(404, { ok: false, error: 'widget_not_found' });
    const mime = servableMime(file.mime, file.key);
    res.status(200);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(opened.end - opened.start + 1));
    res.setHeader(
      'Content-Disposition',
      `${isInlineMime(mime) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=300');
    pipeline(opened.stream, res, () => undefined);
  }
}

/**
 * The pictures of a WhatsApp bot's button (its logo and popup picture) as a visitor's browser fetches them: public, cacheable for good
 * because the address carries the picture's version (`?v=`), and allowed to be embedded by any site, since the button lives on them.
 */
@ApiExcludeController()
@Public()
@Controller({ path: 'widget-assets', version: VERSION_NEUTRAL })
export class WidgetAssetsPublicController {
  constructor(private readonly widgets: WidgetPublicService) {}

  @Get(':flowId/:slot')
  async asset(
    @Param('flowId') flowId: string,
    @Param('slot') slot: string,
    @Res() res: Response,
  ): Promise<void> {
    const found = await this.widgets.asset(flowId, slot);
    if (!found) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    res.setHeader('Content-Type', found.mime);
    res.setHeader('ETag', `"${found.etag}"`);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    // An SVG opened at its own address runs nothing: no script, no fetch, and the page is a sandbox of its own.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
    );
    res.send(found.bytes);
  }
}
