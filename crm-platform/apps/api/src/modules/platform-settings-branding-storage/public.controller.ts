import { Controller, Get, Header, NotFoundException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
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
  constructor(private readonly projection: ProjectionService) {}

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
}
