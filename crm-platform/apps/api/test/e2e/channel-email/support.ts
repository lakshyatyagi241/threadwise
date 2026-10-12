import { expect } from 'vitest';
import request from 'supertest';
import { deriveStateKey, newState, signState } from '../../../src/modules/channel-email/mail-state';
import { startPipeline, type Pipeline } from '../chat-conversations/pipeline-support';
import type { Tenant } from '../contacts-attributes-tags/support';
import { FakeGmail, type FakeAccount } from './fake-gmail';

export const CALLBACK = '/v2/public/email/google/callback';
export const WEB = 'http://localhost:3001';
export const STATE_KEY = deriveStateKey(Buffer.alloc(32, 7).toString('base64'));

const ENV_KEYS = [
  'GOOGLE_OAUTH_AUTH_URL',
  'GOOGLE_OAUTH_TOKEN_URL',
  'GOOGLE_OAUTH_REVOKE_URL',
  'GOOGLE_USERINFO_URL',
  'GMAIL_API_URL',
  'GOOGLE_MAIL_CLIENT_ID',
  'GOOGLE_MAIL_CLIENT_SECRET',
  'GOOGLE_MAIL_REDIRECT_URI',
  'MAIL_SYNC_MAX_MESSAGES',
  'MAIL_ATTACHMENT_MAX_BYTES',
];

export interface MailRig {
  p: Pipeline;
  fake: FakeGmail;
  restore(): Promise<void>;
}

/** The real API and worker-side processors in one process, with the Google OAuth endpoints and the Gmail API aimed at a local stand-in. */
export async function startMailRig(): Promise<MailRig> {
  const fake = await FakeGmail.start();
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  Object.assign(process.env, fake.env());
  const p = await startPipeline(async () => [
    (await import('../../../src/modules/channel-email/channel-email-worker.module'))
      .ChannelEmailWorkerModule,
  ]);
  return {
    p,
    fake,
    restore: async () => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await p.stop();
      await fake.stop();
    },
  };
}

/** Gives the workspace the Email add-on the way owning the Marketplace app does (plan feature and limit overrides). */
export async function setMailPlan(
  p: Pipeline,
  orgId: number,
  opts: { feature?: boolean; mailboxes?: number } = {},
): Promise<void> {
  await p.h.owner.query(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
    orgId,
    JSON.stringify({
      features: { email_channel: opts.feature ?? true },
      limits: opts.mailboxes === undefined ? {} : { email_mailboxes: opts.mailboxes },
    }),
  ]);
}

export async function mailWorkspace(p: Pipeline, label: string, mailboxes = 3): Promise<Tenant> {
  const t = await p.api.signup(label);
  await setMailPlan(p, t.orgId, { mailboxes });
  return t;
}

let codeSeq = 0;

/** The admin presses Connect, Google redirects back with a code. Returns where the callback sent the browser. */
export async function connectMailbox(
  rig: MailRig,
  t: Tenant,
  account: FakeAccount,
  opts: { scope?: string; refresh?: boolean; mailboxId?: string; token?: string } = {},
): Promise<string> {
  const { p, fake } = rig;
  const start = await p.api
    .as(opts.token ?? t.admin)
    .post('/v2/email/mailboxes/connect')
    .send({ returnTo: '/email', ...(opts.mailboxId ? { mailboxId: opts.mailboxId } : {}) });
  expect(start.status, JSON.stringify(start.body)).toBe(200);
  const state = new URL(start.body.authorizeUrl as string).searchParams.get('state')!;
  const code = fake.grant(`code-${++codeSeq}`, account, opts);
  const res = await request(p.h.app.getHttpServer())
    .get(CALLBACK)
    .query({ code, state })
    .redirects(0);
  expect(res.status).toBe(302);
  return res.headers.location as string;
}

export const outcomeOf = (location: string): string | null =>
  new URL(location).searchParams.get('email');

/** A signed state for a workspace, as the connect route would issue it (to drive the callback directly). */
export const stateFor = (
  orgId: number,
  userId: number | null,
  mailboxId: string | null = null,
  nowMs = Date.now(),
): string =>
  signState(newState({ orgId, userId, returnTo: '/email', mailboxId }, nowMs), STATE_KEY);
