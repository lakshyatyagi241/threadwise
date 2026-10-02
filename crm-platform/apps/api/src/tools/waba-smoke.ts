/**
 * Live smoke test of the WhatsApp adapters against real Meta (or Interakt). No database, Redis or Nest app: it builds the same
 * `WabaHttp`, `WabaAdminClient`, `WabaTemplateClient` and `MetaCloudProvider` the API uses and calls them directly.
 *
 *   WABA_TOKEN=... WABA_PHONE_ID=... WABA_ID=... pnpm --filter @crm/api waba:smoke [flags]
 *
 * Reads only by default. Anything that creates or sends needs its flag:
 *   --create-template        create `crm_smoke_<time>` (UTILITY, one variable) and read it back
 *   --send-template=to       send Meta's pre-approved `hello_world` (en_US) to a number, E.164 digits
 *   --send-text=to           send a text (only delivered inside the customer's 24 h window)
 *
 * Interakt route: set WABA_ROUTE=interakt and INTERAKT_PARTNER_AUTH_KEY instead of WABA_TOKEN.
 * Optional: META_APP_ID / META_APP_SECRET (token inspection), META_API_VERSION, WABA_PIN (register the number).
 */
import { readWabaEnv } from '../config/domains/whatsapp-cloud-api-waba.env';
import { WabaAdminClient } from '../infra/providers/whatsapp-cloud-api-waba/waba-admin.client';
import type { WabaConnection } from '../infra/providers/whatsapp-cloud-api-waba/waba-admin.port';
import { WabaApiError } from '../infra/providers/whatsapp-cloud-api-waba/waba-errors';
import { WabaHttp } from '../infra/providers/whatsapp-cloud-api-waba/waba-http';
import { WabaTemplateClient } from '../infra/providers/whatsapp-cloud-api-waba/waba-template.client';
import { MetaCloudProvider } from '../infra/providers/whatsapp/meta-cloud.provider';

const need = (k: string): string => {
  const v = process.env[k]?.trim();
  if (!v) {
    console.error(`Missing ${k}. See the header of src/tools/waba-smoke.ts.`);
    process.exit(2);
  }
  return v;
};
const flag = (name: string): string | true | undefined => {
  const hit = process.argv.slice(2).find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
};

let failures = 0;
async function step<T>(title: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const out = await fn();
    console.log(`PASS  ${title}`);
    return out;
  } catch (e) {
    failures++;
    if (e instanceof WabaApiError) {
      console.log(
        `FAIL  ${title}\n      HTTP ${e.status}, Meta code ${e.code ?? '-'}/${e.subcode ?? '-'}: ${e.message}`,
      );
    } else console.log(`FAIL  ${title}\n      ${(e as Error).message}`);
    return undefined;
  }
}

async function main(): Promise<void> {
  const route = process.env.WABA_ROUTE === 'interakt' ? 'interakt' : 'meta';
  const env = readWabaEnv(process.env);
  const http = new WabaHttp(env);
  const admin = new WabaAdminClient(env, http);
  const templates = new WabaTemplateClient(http, env);
  const provider = new MetaCloudProvider(http, {
    beforeSend: async () => undefined,
    withFooter: async (i) => i.body,
  });

  const conn: WabaConnection =
    route === 'interakt'
      ? {
          provider: 'interakt',
          wabaId: need('WABA_ID'),
          phoneNumberId: need('WABA_PHONE_ID'),
          authKey: need('INTERAKT_PARTNER_AUTH_KEY'),
        }
      : {
          provider: 'meta',
          wabaId: need('WABA_ID'),
          phoneNumberId: need('WABA_PHONE_ID'),
          accessToken: need('WABA_TOKEN'),
        };
  const auth =
    route === 'interakt'
      ? ({
          provider: 'interakt',
          authKey: conn.authKey!,
          wabaId: conn.wabaId,
          phoneNumberId: conn.phoneNumberId,
        } as const)
      : ({ provider: 'meta', accessToken: conn.accessToken! } as const);
  console.log(`Route: ${route}   Graph: ${http.baseUrl(route)}\n`);

  if (route === 'meta' && env.META_APP_ID && env.META_APP_SECRET) {
    const t = await step('token inspection (debug_token)', () =>
      admin.inspectToken(conn.accessToken!),
    );
    if (t)
      console.log(
        `      valid=${t.isValid} scopes=${t.scopes.join(',')} wabas=${t.wabaIds.join(',')} expires=${t.expiresAt?.toISOString() ?? 'never'}`,
      );
  }

  const phone = await step('read phone number', () => admin.getPhone(auth, conn.phoneNumberId));
  if (phone) {
    console.log(
      `      ${phone.displayPhoneNumber} "${phone.verifiedName}" quality=${phone.qualityRating} tier=${phone.messagingLimitTier} platform=${phone.platformType} nameStatus=${phone.nameStatus}`,
    );
    if (phone.platformType === 'ON_PREMISE')
      console.log('      !! On-Premises API number: register it on the Cloud API first.');
  }

  if (process.env.WABA_PIN)
    await step('register number on the Cloud API', () =>
      admin.registerPhone(conn, process.env.WABA_PIN!),
    );

  const list = await step('list templates (cursor paged, first page)', () =>
    templates.list(conn, { limit: 5 }),
  );
  if (list)
    for (const t of list.items)
      console.log(
        `      ${t.name} [${t.language}] ${t.status} ${t.category ?? ''}${t.rejectedReason && t.rejectedReason !== 'NONE' ? ` rejected: ${t.rejectedReason}` : ''}`,
      );

  if (flag('create-template')) {
    const name = `crm_smoke_${Date.now()}`;
    const made = await step(`create template ${name}`, () =>
      templates.create(conn, {
        name,
        language: 'en_US',
        category: 'UTILITY',
        allowCategoryChange: true,
        parameterFormat: 'POSITIONAL',
        components: [
          {
            type: 'BODY',
            text: 'Your order {{1}} is ready for pickup.',
            example: { body_text: [['A1042']] },
          },
        ],
      }),
    );
    if (made) {
      console.log(`      id=${made.id} status=${made.status} category=${made.category}`);
      await step('read it back by name', async () => {
        const back = await templates.getByName(conn, name);
        if (!back) throw new Error('Meta does not list it yet');
        console.log(`      status=${back.status} category=${back.category}`);
      });
      await step('delete it', () => templates.deleteByName(conn, name));
    }
  }

  const sendTemplate = flag('send-template');
  if (typeof sendTemplate === 'string') {
    const r = await step(`send hello_world to ${sendTemplate}`, () =>
      provider.sendTemplate(
        {
          senderId: conn.phoneNumberId,
          accessToken: conn.accessToken ?? '',
          businessAccountId: conn.wabaId,
          route,
          authKey: conn.authKey,
        },
        {
          to: sendTemplate,
          templateName: 'hello_world',
          language: 'en_US',
          variables: {},
          clientReference: `smoke-${Date.now()}`,
        },
      ),
    );
    if (r) console.log(`      wamid=${r.providerMessageId}`);
  }
  const sendText = flag('send-text');
  if (typeof sendText === 'string') {
    const r = await step(`send text to ${sendText}`, () =>
      provider.sendText(
        {
          senderId: conn.phoneNumberId,
          accessToken: conn.accessToken ?? '',
          businessAccountId: conn.wabaId,
          route,
          authKey: conn.authKey,
        },
        { to: sendText, body: 'CRM smoke test', clientReference: `smoke-${Date.now()}` },
      ),
    );
    if (r) console.log(`      wamid=${r.providerMessageId}`);
  }

  console.log(failures ? `\n${failures} step(s) failed.` : '\nAll steps passed.');
  process.exit(failures ? 1 : 0);
}

void main();
