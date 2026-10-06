import { Controller, Get, Header, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../../common/decorators';
import { ApiV1DocsService } from './api-v1-docs.service';

/**
 * `GET /docs/api.json` (TW-API-150): the OpenAPI document of the customer API. Public, as in Reference: it describes routes, never data, and
 * the developer reference page (web, `/developers/docs`) renders it for people who have no key yet.
 */
@ApiExcludeController()
@Public()
@Controller({ path: 'docs', version: VERSION_NEUTRAL })
export class ApiV1DocsController {
  constructor(private readonly docs: ApiV1DocsService) {}

  @Get('api.json')
  @Header('Cache-Control', 'public, max-age=60')
  spec() {
    return this.docs.spec();
  }
}
