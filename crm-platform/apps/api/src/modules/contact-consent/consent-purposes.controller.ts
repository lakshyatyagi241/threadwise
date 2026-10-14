import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PURPOSES, type PurposeCatalog } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { ConsentPolicyService } from './consent-policy.service';

/** The purpose and processing registry (BL-140): a read-only, code-defined catalogue with the names as locale keys. */
@ApiTags('contact-consent')
@ActorKinds('user')
@Controller({ path: 'consent', version: '2' })
export class ConsentPurposesController {
  constructor(private readonly policy: ConsentPolicyService) {}

  @Get('purposes')
  @RequirePermission('bcast.broadcasts.create', 'camp.campaigns.create', 'settings.consent.manage')
  @ApiOperation({
    summary: 'The purposes the platform contacts or processes people for',
    description:
      'Each entry: lawful basis, whether opt-in is mandatory, modalities, channels, default retention, required evidence and the notice key. `enforcedAsGrant` says whether the gate refuses a send without a recorded grant in this workspace today.',
  })
  async purposes(): Promise<PurposeCatalog> {
    const require = await this.policy.requiresConsent(RequestContextStore.orgId());
    return {
      requireConsentForMarketing: require,
      purposes: PURPOSES.map((p) => ({
        ...p,
        enforcedAsGrant: p.ledgerPurpose === 'marketing' ? require : false,
      })),
    };
  }
}
