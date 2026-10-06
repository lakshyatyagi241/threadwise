import {
  Body,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation } from '@nestjs/swagger';
import {
  V1_TEMPLATE_CATEGORIES,
  v1CreateTemplateSchema,
  v1ListQuerySchema,
  v1SendTemplateSchema,
  v1UpdateTemplateSchema,
  type V1CreateTemplate,
  type V1ListQuery,
  type V1SendTemplate,
  type V1UpdateTemplate,
} from '@crm/contracts';
import { Idempotent } from '../../../../../common/decorators';
import { zodPipe } from '../../../../../common/pipes/zod-validation.pipe';
import { RequireApiScope } from '../../../auth/api-scope';
import { V1Controller } from '../../../http/v1-controller.decorator';
import { ok, pageMeta } from '../../../http/v1-envelope';
import { HEADER_MEDIA_MAX_BYTES } from './header-upload.guard';
import { V1TemplatesService } from './templates.v1.service';

/** A path id that is not a uuid is a route that does not exist, as WaDesk's digits-only `{id}` was. */
const idPipe = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

/** WhatsApp message templates (WD-API-030 to 037). Thin: the template domain's services do the work. */
@V1Controller('templates')
export class V1TemplatesController {
  constructor(private readonly templates: V1TemplatesService) {}

  @Get()
  @RequireApiScope('templates:read')
  @ApiOperation({ summary: 'Sendable templates, newest first (cursor paginated)' })
  async list(@Query(zodPipe(v1ListQuerySchema)) q: V1ListQuery) {
    const { items, page } = await this.templates.list(q);
    return ok(items, pageMeta(page));
  }

  // Literal route before ':id', which would otherwise take it for an id.
  @Get('categories')
  @RequireApiScope('templates:read')
  @ApiOperation({ summary: 'The Meta template categories `category` understands' })
  categories() {
    return ok(V1_TEMPLATE_CATEGORIES);
  }

  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequireApiScope('templates:write')
  @ApiOperation({ summary: 'Create a template (saved as a draft, never sent to Meta)' })
  async create(@Body(zodPipe(v1CreateTemplateSchema)) body: V1CreateTemplate) {
    return ok(await this.templates.create(body));
  }

  @Get(':id')
  @RequireApiScope('templates:read')
  @ApiOperation({ summary: 'One template, whatever its approval state' })
  async show(@Param('id', idPipe) id: string) {
    return ok(await this.templates.show(id));
  }

  @Put(':id')
  @Idempotent()
  @RequireApiScope('templates:write')
  @ApiOperation({ summary: 'Replace the text of a template that Meta has not approved' })
  async update(
    @Param('id', idPipe) id: string,
    @Body(zodPipe(v1UpdateTemplateSchema)) body: V1UpdateTemplate,
  ) {
    return ok(await this.templates.update(id, body));
  }

  @Delete(':id')
  @RequireApiScope('templates:write')
  @ApiOperation({ summary: 'Delete a template' })
  async remove(@Param('id', idPipe) id: string) {
    await this.templates.remove(id);
    return ok({ deleted: true, message: 'Template deleted successfully' });
  }

  @Post(':id/send')
  @Idempotent()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireApiScope('templates:write')
  @ApiConsumes('application/json', 'multipart/form-data')
  // A file past the limit must reach the upload guard (a 422 as in WaDesk), not be cut off by the parser (a 413), so the parser's own cap
  // is looser than the guard's.
  @UseInterceptors(
    FileInterceptor('header_media', {
      limits: { fileSize: HEADER_MEDIA_MAX_BYTES + 1024 * 1024, files: 1 },
    }),
  )
  @ApiOperation({ summary: 'Send a template to one number (queued like an inbox send)' })
  async send(
    @Param('id', idPipe) id: string,
    @Body(zodPipe(v1SendTemplateSchema)) body: V1SendTemplate,
    @UploadedFile() file: { originalname: string; buffer: Buffer } | undefined,
  ) {
    return ok(await this.templates.send(id, body, file));
  }
}
