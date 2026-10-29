import { describe, expect, it, vi } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { AppError } from '../../../src/common/errors/app-error';
import { InstallationsService } from '../../../src/modules/marketplace/installations.service';
import { RelayService } from '../../../src/modules/marketplace/relay.service';
import { relayRecipe } from './fixtures';

/**
 * #1269: a stored credential blob that cannot be opened must not be read as "no credentials". Configuring the installation with one
 * field would then merge that field against {} and delete every other secret the blob held. The write is refused and nothing is changed.
 */

const relayWith = (decrypt: (enc: string) => string) =>
  new RelayService(
    {} as never,
    {} as never,
    { decrypt } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

describe('#1269 unreadable stored credentials', () => {
  it('openStoredCredentials refuses a blob that cannot be opened, instead of reading it as empty', () => {
    const relay = relayWith(() => {
      throw new Error('bad key');
    });
    let err: unknown;
    try {
      relay.openStoredCredentials('v1:stored', 'inst-uuid');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).getStatus()).toBe(409);
    expect((err as AppError).details).toEqual([{ path: 'credentials', message: 'unreadable' }]);
  });

  it('openStoredCredentials returns what a readable blob holds, and {} when nothing is stored', () => {
    const decrypt = vi.fn(() => JSON.stringify({ apiKey: 'k1', webhookSecret: 's1' }));
    const relay = relayWith(decrypt);
    expect(relay.openStoredCredentials('v1:stored', 'inst-uuid')).toEqual({
      apiKey: 'k1',
      webhookSecret: 's1',
    });
    expect(relay.openStoredCredentials(null, 'inst-uuid')).toEqual({});
    expect(decrypt).toHaveBeenCalledTimes(1);
  });

  it('configure with a credential refuses when the stored blob cannot be opened, and writes nothing', async () => {
    const update = vi.fn(async () => true);
    const row = {
      id: 5,
      uuid: '22222222-2222-4222-8222-222222222222',
      status: 'active',
      recipe: relayRecipe(),
      credentialsEnc: 'v1:stored',
      rowVersion: 1,
      app: { slug: 'relay', name: 'Relay' },
      connection: null,
    };
    const relay = relayWith(() => {
      throw new Error('bad key');
    });
    const service = new InstallationsService(
      { tx: async (fn: (tx: unknown) => unknown) => fn({}) } as never,
      {
        byUuid: async () => row,
        update,
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { record: vi.fn() } as never,
      { emit: vi.fn() } as never,
      {} as never,
      {} as never,
      relay,
      {} as never,
      {} as never,
      { get: () => 'https://app.example.test' } as never,
    );
    const err = await RequestContextStore.run(
      { requestId: 'r', orgId: 7, actorType: 'user', actorId: 3, userId: 3 },
      () =>
        service
          .configure(row.uuid, { credentials: { apiKey: 'new-key' }, rowVersion: 1 } as never)
          .catch((e: unknown) => e),
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).getStatus()).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });
});
