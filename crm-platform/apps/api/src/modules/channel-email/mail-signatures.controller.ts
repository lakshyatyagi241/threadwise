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
  createMailSignatureSchema,
  listMailSignaturesQuerySchema,
  updateMailSignatureSchema,
  type CreateMailSignatureInput,
  type ListMailSignaturesQuery,
  type UpdateMailSignatureInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { MailSignaturesService } from './mail-signatures.service';

/** Email signatures (TW-MAIL-027): `/v2/email/signatures`. */
@ApiTags('email')
@ActorKinds('user')
@RequirePlanFeature('email_channel')
@Controller({ path: 'email/signatures', version: '2' })
export class MailSignaturesController {
  constructor(private readonly signatures: MailSignaturesService) {}

  @Get()
  @RequirePermission('mail.mailboxes.read')
  @ApiOperation({
    summary: "The mailboxes' signatures and your own",
    description:
      "Signatures of the mailboxes you can see plus your own user signatures (never anybody else's). Filter by `mailboxId` and `scope`.",
  })
  list(@Query(zodPipe(listMailSignaturesQuerySchema)) query: ListMailSignaturesQuery) {
    return this.signatures.list(query);
  }

  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('mail.signatures.manage')
  @ApiOperation({
    summary: "Create a signature (a mailbox's, or your own)",
    description:
      'A `mailbox` signature also needs `mail.mailboxes.manage` on a shared mailbox (the owner manages a personal one). The HTML is sanitised; `{{name}}`, `{{title}}` and `{{phone}}` are filled from the sending user. `isDefault` makes it the default of its mailbox or user and clears the previous default.',
  })
  create(@Body(zodPipe(createMailSignatureSchema)) body: CreateMailSignatureInput) {
    return this.signatures.create(body);
  }

  @Patch(':id')
  @Idempotent()
  @RequirePermission('mail.signatures.manage')
  @ApiOperation({
    summary: 'Change a signature',
    description:
      "Requires the `rowVersion` you read: 409 ROW_VERSION_CONFLICT otherwise. 404 for another person's user signature.",
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateMailSignatureSchema)) body: UpdateMailSignatureInput,
  ) {
    return this.signatures.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('mail.signatures.manage')
  @ApiOperation({ summary: 'Delete a signature' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.signatures.remove(id);
  }
}
