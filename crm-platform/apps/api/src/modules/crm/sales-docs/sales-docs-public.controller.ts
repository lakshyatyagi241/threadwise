import {
  applyDecorators,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  publicAcceptSchema,
  publicDeclineSchema,
  type PublicAcceptInput,
  type PublicDeclineInput,
} from '@crm/contracts';
import { Public } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { SalesDocsPublicService } from './sales-docs-public.service';

/** The page carries the buyer's details and a bearer link: never cached, never indexed, never leaked through a referrer. */
const privatePage = () =>
  applyDecorators(
    Header('Cache-Control', 'no-store'),
    Header('X-Robots-Tag', 'noindex, nofollow'),
    Header('Referrer-Policy', 'no-referrer'),
  );

/**
 * The buyer's side of a proposal or an estimate (TW-PROP-014..016). Unauthenticated: the 43-character token in the path is the
 * credential. `/v2/public/sales-docs/:token`. The web app serves the page at `/q/<token>` and calls these routes on the server.
 * Throttled per IP and per link (reads 120 / 60 a minute, decisions 20 / 10); unknown token 404; revoked or expired link 410.
 */
@ApiTags('sales-docs-public')
@Public()
@Controller({ path: 'public/sales-docs', version: '2' })
export class PublicSalesDocsController {
  constructor(private readonly pub: SalesDocsPublicService) {}

  @Get(':token')
  @privatePage()
  @ApiOperation({
    summary: 'The document as the buyer sees it',
    description:
      'First open of a sent document marks it viewed (timeline + salesdoc.viewed). `status` reads `expired` once the valid-until date has passed, even before the sweep marks it. No buyer email or phone is returned.',
  })
  view(@Param('token') token: string) {
    return this.pub.view(token);
  }

  @Get(':token/print')
  @privatePage()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
  @ApiOperation({ summary: 'Printable page (save as PDF from the browser); not counted as a view' })
  print(@Param('token') token: string) {
    return this.pub.print(token);
  }

  @Post(':token/accept')
  @HttpCode(HttpStatus.OK)
  @privatePage()
  @ApiOperation({
    summary: 'Accept',
    description:
      'Needs the signer name and the consent flag; an email and a drawn PNG signature are optional. Signer, IP, user agent and time are recorded in the timeline (encrypted at rest). The same call again is the same answer with `replay: true`; after a decline it is 409 SALESDOC_ALREADY_DECIDED; past the valid-until date 409 SALESDOC_EXPIRED.',
  })
  accept(
    @Param('token') token: string,
    @Body(zodPipe(publicAcceptSchema)) body: PublicAcceptInput,
  ) {
    return this.pub.accept(token, body);
  }

  @Post(':token/decline')
  @HttpCode(HttpStatus.OK)
  @privatePage()
  @ApiOperation({
    summary: 'Decline, with an optional reason',
    description: 'Symmetric to accept; a decision is final until staff revise the document.',
  })
  decline(
    @Param('token') token: string,
    @Body(zodPipe(publicDeclineSchema)) body: PublicDeclineInput,
  ) {
    return this.pub.decline(token, body);
  }
}
