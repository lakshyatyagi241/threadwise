import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createApiLibraryApiSchema,
  deleteApiLibraryApiQuerySchema,
  listApiLibraryApisQuerySchema,
  listApiLibraryLogsQuerySchema,
  testApiLibraryApiSchema,
  testApiLibraryFunctionSchema,
  updateApiLibraryApiSchema,
  type CreateApiLibraryApiInput,
  type DeleteApiLibraryApiQuery,
  type ListApiLibraryApisQuery,
  type ListApiLibraryLogsQuery,
  type TestApiLibraryApiInput,
  type TestApiLibraryFunctionInput,
  type UpdateApiLibraryApiInput,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiLibraryService } from './api-library.service';
import { ApiLibraryLogsService } from './api-library-logs.service';
import { ApiLibraryRunService } from './api-library-run.service';

/**
 * The API Library (Settings > Integrations > API Library): saved HTTP calls a flow can use. Reading needs `integ.apilibrary.read`,
 * and every other action has its own key; the picker feed also opens to `flb.flows.read` so a flow author need not hold the screen.
 * Literal routes come before `:id` (Express matches in declaration order).
 */
@ApiTags('api-library')
@ActorKinds('user')
@Controller({ path: 'api-library', version: '2' })
export class ApiLibraryController {
  constructor(
    private readonly apis: ApiLibraryService,
    private readonly runs: ApiLibraryRunService,
    private readonly logs: ApiLibraryLogsService,
  ) {}

  @Get('apis')
  @RequirePermission('integ.apilibrary.read')
  @ApiOperation({
    summary: 'The saved APIs, newest first (search by name or URL, filter by method)',
  })
  list(@Query(zodPipe(listApiLibraryApisQuerySchema)) query: ListApiLibraryApisQuery) {
    return this.apis.list(query);
  }

  @Get('apis/options')
  @RequirePermission('integ.apilibrary.read', 'flb.flows.read')
  @ApiOperation({
    summary:
      'The pickers feed: every API with its variables and exposed response fields (no URL, headers or body)',
  })
  options() {
    return this.apis.options();
  }

  @Post('apis/test')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('integ.apilibrary.test')
  @ApiOperation({
    summary:
      'Run a definition now (saved or not) and answer with the status, headers, body and time',
    description:
      'The processing function runs in the sandbox, the request goes out through the guarded fetcher (public addresses only, no redirects, 15 s, 1 MB), and the run is logged. A failed run is a 200 with ok:false and an errorKind.',
  })
  test(@Body(zodPipe(testApiLibraryApiSchema)) body: TestApiLibraryApiInput) {
    return this.runs.test(body);
  }

  @Post('apis/test-function')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('integ.apilibrary.test')
  @ApiOperation({
    summary: 'Run only the processing function on a sample payload (the form\'s "Run code" button)',
  })
  testFunction(@Body(zodPipe(testApiLibraryFunctionSchema)) body: TestApiLibraryFunctionInput) {
    return this.runs.testFunction(body);
  }

  @Post('apis')
  @RequirePermission('integ.apilibrary.create')
  @ApiOperation({ summary: 'Save an API (the name is permanent and unique ignoring case)' })
  create(@Body(zodPipe(createApiLibraryApiSchema)) body: CreateApiLibraryApiInput) {
    return this.apis.create(body);
  }

  @Get('apis/:id')
  @RequirePermission('integ.apilibrary.read')
  @ApiOperation({ summary: 'One API for the edit form (secret header values read as the mask)' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.apis.get(id);
  }

  @Patch('apis/:id')
  @RequirePermission('integ.apilibrary.update')
  @ApiOperation({
    summary: 'Replace the definition of an API (the form sends all of it; rowVersion is the lock)',
    description:
      'A secret header sent back as the mask keeps its stored value. Variables the definition no longer uses are dropped.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateApiLibraryApiSchema)) body: UpdateApiLibraryApiInput,
  ) {
    return this.apis.update(id, body);
  }

  @Delete('apis/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('integ.apilibrary.delete')
  @ApiOperation({
    summary: 'Delete an API',
    description:
      '409 ALIB_IN_USE (the flows are in `details`) while a flow calls it; `?force=true` deletes it anyway. Its logs stay.',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(deleteApiLibraryApiQuerySchema)) query: DeleteApiLibraryApiQuery,
  ): Promise<void> {
    await this.apis.remove(id, query.force);
  }

  @Get('apis/:id/usage')
  @RequirePermission('integ.apilibrary.read')
  @ApiOperation({ summary: 'The flows that call this API' })
  usage(@Param('id', ParseUUIDPipe) id: string) {
    return this.apis.usage(id);
  }

  @Get('apis/:id/logs')
  @RequirePermission('integ.apilibrary.read')
  @ApiOperation({ summary: 'The run log of one API, newest first' })
  apiLogs(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(listApiLibraryLogsQuerySchema)) query: ListApiLibraryLogsQuery,
  ) {
    return this.logs.list(query, id);
  }

  @Get('logs')
  @RequirePermission('integ.apilibrary.read')
  @ApiOperation({
    summary: 'The run log of every API (filter by API, status, source, dates, text)',
  })
  allLogs(@Query(zodPipe(listApiLibraryLogsQuerySchema)) query: ListApiLibraryLogsQuery) {
    return this.logs.list(query);
  }

  @Get('logs/:id')
  @RequirePermission('integ.apilibrary.read')
  @ApiOperation({ summary: 'One run: the masked request, the answer, and what ran it' })
  log(@Param('id', ParseUUIDPipe) id: string) {
    return this.logs.get(id);
  }

  @Get('contact-properties')
  @RequirePermission('integ.apilibrary.read')
  @ApiOperation({ summary: 'The contact properties a response field can be saved into' })
  contactProperties() {
    return this.apis.contactProperties();
  }
}
