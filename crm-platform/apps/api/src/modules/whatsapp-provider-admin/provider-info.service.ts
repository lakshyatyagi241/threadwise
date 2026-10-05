import { Injectable } from '@nestjs/common';
import type { ChannelProviderInfo, WhatsappOnboardingMethod } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { providerKeyOf } from '../../infra/providers/whatsapp-cloud-api-waba/waba-registry-routes';
import {
  ProviderStore,
  WhatsAppProviderResolver,
  type ProviderRow,
} from '../whatsapp-provider-registry';

/**
 * What a workspace may know about how its WhatsApp is carried: the provider new numbers connect through and the one each of its numbers
 * is on, whether the provider takes a media upload and whose credential it uses. Names a provider (key and label); never an address, a
 * header, an id of the provider's or a secret. The numbers are read through the caller's tenant (row-level security), the provider
 * rows through the platform store, narrowed here to those fields.
 */
@Injectable()
export class ProviderInfoService {
  constructor(
    private readonly db: DatabaseService,
    private readonly store: ProviderStore,
    private readonly resolver: WhatsAppProviderResolver,
  ) {}

  async forWorkspace(): Promise<ChannelProviderInfo> {
    const { orgId } = RequestContextStore.require();
    const numbers = await this.db.tx((tx) => this.store.numbersOf(tx, orgId));
    const rows = await this.store.tx((tx) => this.store.forRouting(tx));
    const byKey = new Map(rows.map((r) => [r.key, r]));

    let newNumbers: ChannelProviderInfo['newNumbers'] = null;
    try {
      const route = await this.resolver.forNewNumbers(orgId);
      const row = byKey.get(route.key);
      if (row) newNumbers = this.newNumbersOf(row, route.label);
    } catch (e) {
      if (!(e instanceof AppError)) throw e; // the assigned provider is not active: nothing can take a new number
    }

    return {
      newNumbers,
      numbers: numbers.flatMap((n) => {
        const row = byKey.get(providerKeyOf(n.meta_json));
        if (!row) return [];
        return [
          {
            id: n.uuid,
            label: n.display_label,
            phoneNumber: n.phone_number,
            providerKey: row.key,
            providerLabel: row.label,
            credentialMode: row.credential_mode,
            capabilities: { mediaUpload: row.capabilities?.mediaUpload !== false },
          },
        ];
      }),
    };
  }

  private newNumbersOf(
    row: ProviderRow,
    label: string,
  ): NonNullable<ChannelProviderInfo['newNumbers']> {
    const methods: WhatsappOnboardingMethod[] = [];
    if (row.onboarding === 'embedded_signup') methods.push('embedded_signup');
    // A customer who holds the token can paste it; a provider that keeps the credential itself has nothing to paste.
    if (row.credential_mode === 'channel_token') methods.push('manual');
    if (methods.length === 0) methods.push(row.onboarding);
    return {
      providerKey: row.key,
      providerLabel: label,
      credentialMode: row.credential_mode,
      capabilities: { mediaUpload: row.capabilities?.mediaUpload !== false },
      onboardingMethods: methods,
    };
  }
}
