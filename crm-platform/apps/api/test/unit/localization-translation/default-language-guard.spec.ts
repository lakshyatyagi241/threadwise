import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ERROR_CODES } from '@crm/contracts';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { LanguagesService } from '../../../src/modules/localization-translation/languages.service';

/**
 * TW-I18N-003/004/005 race (#1292): the default-language guard must read the default inside the same transaction that
 * takes the row lock. This test drives the real service against an in-memory stand-in for the platform store that
 * models what matters here: the default is an uncommitted write until its transaction commits, and the advisory lock
 * the service takes serialises default-language transactions. The DB-backed version of the same race lives in
 * test/integration/localization-translation/i18n-admin-services.spec.ts.
 */

interface Row {
  uuid: string;
  code: string;
  name: string;
  native_name: string | null;
  direction: 'ltr' | 'rtl';
  is_active: boolean;
  sort_order: number;
  row_version: number;
}

const dialect = new PgDialect();

function platformStore(initial: { defaultCode: string; langs: Row[] }) {
  const committed = {
    defaultCode: initial.defaultCode as string | undefined,
    langs: new Map(initial.langs.map((r) => [r.uuid, { ...r }])),
  };

  // Advisory lock stand-in: one transaction at a time holds it until it ends.
  let tail: Promise<void> = Promise.resolve();
  const acquire = (): Promise<() => void> => {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const prev = tail;
    tail = prev.then(() => next);
    return prev.then(() => release);
  };

  const tx = <T>(fn: (t: unknown) => Promise<T>): Promise<T> => {
    const staged = {
      defaultCode: undefined as string | undefined,
      langs: new Map<string, Row | null>(),
    };
    let release: (() => void) | null = null;
    const visible = (uuid: string) =>
      staged.langs.has(uuid) ? staged.langs.get(uuid) : committed.langs.get(uuid);

    const t = {
      execute: async (query: unknown) => {
        const { sql: text, params } = dialect.sqlToQuery(query as never);
        if (text.includes('pg_advisory_xact_lock')) {
          if (!release) release = await acquire();
          return { rows: [] };
        }
        if (text.includes('FROM platform_settings')) {
          const v = staged.defaultCode ?? committed.defaultCode;
          return { rows: v === undefined ? [] : [{ value: v }] };
        }
        if (text.includes('INSERT INTO platform_settings')) {
          staged.defaultCode = JSON.parse(params[1] as string) as string;
          return { rows: [] };
        }
        if (text.includes('FOR UPDATE')) {
          const row = visible(params[0] as string);
          return { rows: row ? [{ ...row }] : [] };
        }
        if (text.startsWith('UPDATE languages SET is_active')) {
          const uuid = params[1] as string;
          const row = { ...visible(uuid)!, is_active: params[0] as boolean };
          row.row_version = row.row_version + 1;
          staged.langs.set(uuid, row);
          return { rows: [{ ...row }] };
        }
        if (text.startsWith('UPDATE languages')) {
          const uuid = params[5] as string;
          const row = {
            ...visible(uuid)!,
            name: params[0] as string,
            native_name: params[1] as string | null,
            direction: params[2] as 'ltr' | 'rtl',
            is_active: params[3] as boolean,
            sort_order: params[4] as number,
          };
          row.row_version = row.row_version + 1;
          staged.langs.set(uuid, row);
          return { rows: [{ ...row }] };
        }
        if (text.startsWith('DELETE FROM languages')) {
          staged.langs.set(params[0] as string, null);
          return { rows: [] };
        }
        throw new Error(`unexpected SQL in the fake store: ${text}`);
      },
    };

    const finish = () => {
      if (release) release();
      release = null;
    };
    return fn(t).then(
      (out) => {
        if (staged.defaultCode !== undefined) committed.defaultCode = staged.defaultCode;
        for (const [uuid, row] of staged.langs) {
          if (row === null) committed.langs.delete(uuid);
          else committed.langs.set(uuid, row);
        }
        finish();
        return out;
      },
      (err) => {
        finish();
        throw err;
      },
    );
  };

  return {
    committed,
    store: { tx } as never,
    settings: {
      get: async () => committed.defaultCode,
      invalidate: () => undefined,
    } as never,
  };
}

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const operator = <T>(fn: () => Promise<T>) =>
  RequestContextStore.run(
    {
      requestId: 'req-default-guard',
      orgId: 0,
      actorType: 'platform_operator',
      actorId: 1,
      userId: null,
      operatorRole: 'super_admin',
    } as never,
    fn,
  );

function build() {
  const lang = (uuid: string, code: string, sort: number): Row => ({
    uuid,
    code,
    name: code,
    native_name: null,
    direction: 'ltr',
    is_active: true,
    sort_order: sort,
    row_version: 1,
  });
  const fake = platformStore({
    defaultCode: 'de',
    langs: [lang('uuid-de', 'de', 1), lang('uuid-en', 'en', 2)],
  });
  // The audit row is where the default change is paused: the setting is written, the transaction has not committed.
  const pause = { reached: deferred(), release: deferred() };
  const audit = {
    record: async (_tx: unknown, input: { event: string }) => {
      if (input.event === 'platform.i18n.language_default_changed') {
        pause.reached.resolve();
        await pause.release.promise;
      }
    },
  };
  const service = new LanguagesService(fake.store, {} as never, audit as never, fake.settings, {
    del: async () => 1,
    get: async () => null,
    set: async () => 'OK',
  } as never);
  return { service, fake, pause };
}

describe('default-language guard reads the default inside the lock (#1292)', () => {
  const racers: Array<[string, (s: LanguagesService) => Promise<unknown>]> = [
    ['toggle', (s) => s.toggle('uuid-en', 1)],
    ['remove', (s) => s.remove('uuid-en', 1)],
    [
      'update (switch off)',
      (s) =>
        s.update('uuid-en', {
          rowVersion: 1,
          name: 'en',
          nativeName: '',
          direction: 'ltr',
          isActive: false,
          sortOrder: 2,
        } as never),
    ],
  ];

  it.each(racers)(
    '%s waits for a concurrent set-default and then refuses, instead of deactivating the new default',
    (_name, racer) =>
      operator(async () => {
        const { service, fake, pause } = build();

        const setting = service.setDefault('uuid-en', 1);
        await pause.reached.promise;

        let settled = false;
        const outcome = racer(service).then(
          () => 'ok',
          (e: { code?: string }) => e.code ?? 'no-code',
        );
        const second = outcome.then((v) => {
          settled = true;
          return v;
        });
        await sleep(50);
        // The default change has not committed yet, so the second operation must still be waiting.
        expect(settled).toBe(false);

        pause.release.resolve();
        expect((await setting).isDefault).toBe(true);
        expect(await second).toBe(ERROR_CODES.I18N_LANGUAGE_IS_DEFAULT);
        expect(fake.committed.defaultCode).toBe('en');
        expect(fake.committed.langs.get('uuid-en')?.is_active).toBe(true);
      }),
  );
});
