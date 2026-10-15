import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { pqlRequestSchema, type PqlRequest } from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { PqlService } from './pql.service';

@ApiTags('contacts')
@ActorKinds('user')
@Controller({ path: 'contacts/pql', version: '2' })
export class PqlController {
  constructor(private readonly pql: PqlService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.contacts.read')
  @ApiOperation({
    summary: 'Turn a plain English contact search into segment rules',
    description:
      'Returns the rules to pass as `rules` to GET /contacts. Sends the AI model the query and the workspace names of tags, groups, owners, stages and custom fields; no contact data.',
  })
  translate(@Body(zodPipe(pqlRequestSchema)) body: PqlRequest) {
    return this.pql.translate(body);
  }
}
