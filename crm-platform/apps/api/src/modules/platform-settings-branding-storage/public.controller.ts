import { Controller, Get, Header, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { BrandAssetsService } from './brand-assets.service';
import { ProjectionService } from './projection.service';

/**
 * What every visitor needs from the platform settings (brand, footer, SEO tags, cookie banner, tracker ids,
 * theme, manifest, robots). No authentication, no secrets, no operator data: the read model is built field
 * by field in ProjectionService, never by echoing a stored document.
 */
@ApiTags('public')
@Public()
@Controller({ path: 'public', version: '2' })
export class SitePublicController {
  constructor(
    private readonly projection: ProjectionService,
    private readonly assets: BrandAssetsService,
  ) {}

  @Get('site-config')
  @Header('Cache-Control', 'public, max-age=30')
  @ApiOperation({ summary: 'Brand, defaults, theme, SEO, footer, cookie banner and tracker ids' })
  siteConfig() {
    return this.projection.siteConfig();
  }

  @Get('manifest.webmanifest')
  @Header('Content-Type', 'application/manifest+json; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'Web app manifest (404 while installable-app support is off)' })
  async manifest() {
    const m = await this.projection.manifest();
    if (!m) throw new NotFoundException();
    return m;
  }

  @Get('robots.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'robots.txt from the SEO settings' })
  robots() {
    return this.projection.robots();
  }

  @Get('team-inbox-manifest.webmanifest')
  @Header('Content-Type', 'application/manifest+json; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'Team Inbox app manifest (404 while that app is off)' })
  async teamInboxManifest() {
    const m = await this.projection.teamInboxManifest();
    if (!m) throw new NotFoundException();
    return m;
  }

  @Get('brand/:slot')
  @ApiOperation({ summary: 'An uploaded brand file (favicon, logo, app icon)' })
  async brand(@Param('slot') slot: string, @Res() res: Response) {
    const file = await this.assets.read(slot);
    if (!file) throw new NotFoundException();
    res
      .status(200)
      .set({
        'Content-Type': file.mime,
        'Content-Length': String(file.bytes.length),
        // The saved URL carries the content hash, so a replaced file always has a new URL.
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        // An SVG opened directly must not run script; as an <img> it never does.
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'Cross-Origin-Resource-Policy': 'cross-origin',
      })
      .end(file.bytes);
  }
}
