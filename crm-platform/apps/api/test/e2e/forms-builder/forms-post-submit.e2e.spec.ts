import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../../src/infra/db/database.service';
import {
  MAIL_PORT,
  type MailPort,
} from '../../../src/infra/providers/auth-registration-security/mail.port';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
} from '../../../src/kernel/outbox/outbox-subscribers';
import { AuthSettingsService } from '../../../src/modules/auth/platform/auth-settings.service';
import { FormNotificationConsumer } from '../../../src/modules/forms-builder/form-notification.consumer';
import { NotificationsRepository } from '../../../src/modules/notifications/notifications.repository';
import { FormsApi, contactDefinition, startHarness, type Harness, type Tenant } from './support';

/**
 * What happens AFTER a visitor presses send, as one chain per protection (docs/specs/forms-builder-app.md 9): the CAPTCHA the platform
 * offers (and the honest answer when it offers none), the hidden trap and the spam bin, the consent line and its marketing opt-in, and
 * the notification a person gets and the link in it. Each test crosses the public door, the pipeline, the outbox consumer and the staff
 * API the way a real day does.
 */
let h: Harness;
let api: FormsApi;
let t: Tenant;
let seq = 0;
const fresh = (label = 'ps') => `${label}${Date.now().toString(36)}${seq++}@example.test`;

const PROVIDER = {
  version: 'v2' as const,
  siteKey: 'site-key-1',
  secret: 'very-secret',
  threshold: 0.5,
};
const withProvider = async <T>(fn: () => Promise<T>): Promise<T> => {
  const spy = vi.spyOn(h.app.get(AuthSettingsService), 'captchaConfig').mockResolvedValue(PROVIDER);
  try {
    return await fn();
  } finally {
    spy.mockRestore();
  }
};

beforeAll(async () => {
  h = await startHarness();
  api = new FormsApi(h);
  t = await api.workspace('post');
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('the platform CAPTCHA, and being told the truth about it', () => {
  it('says there is none, and refuses to publish a form set to always-on without one; follow-the-platform and off publish fine', async () => {
    const meta = await api.as(t.admin).get('/v2/forms/meta/protection');
    expect(meta.status, JSON.stringify(meta.body)).toBe(200);
    expect(meta.body.captcha).toEqual({ available: false, version: null });

    const strict = await api.createForm(t.admin, { settings: { captchaMode: 'on' } });
    const refused = await api
      .as(t.admin)
      .post(`/v2/forms/${strict.id}/publish`)
      .send({ rowVersion: strict.rowVersion });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('FORMS_PUBLISH_INVALID');
    expect(refused.body.errors).toContainEqual(
      expect.objectContaining({ path: 'settings.captchaMode', message: 'captcha_not_configured' }),
    );

    expect((await api.liveForm(t.admin, { settings: { captchaMode: 'inherit' } })).status).toBe(
      'published',
    );
    expect((await api.liveForm(t.admin, { settings: { captchaMode: 'off' } })).status).toBe(
      'published',
    );
  });

  it('with a provider it reports the version and lets always-on publish; the secret never leaves', async () => {
    await withProvider(async () => {
      const meta = await api.as(t.admin).get('/v2/forms/meta/protection');
      expect(meta.body.captcha).toEqual({ available: true, version: 'v2' });
      expect(JSON.stringify(meta.body)).not.toContain('very-secret');
      const form = await api.liveForm(t.admin, { settings: { captchaMode: 'on' } });
      expect(form.status).toBe('published');
    });
  });

  it('needs the forms read permission', async () => {
    const nobody = await api.member(t, 'prot-nobody', []);
    expect((await api.as(nobody.token).get('/v2/forms/meta/protection')).status).toBe(403);
  });

  it('the whole chain with a CAPTCHA: no token and a wrong token store nothing and notify nobody; a good token makes the contact and the notification', async () => {
    // Signing up is itself behind the CAPTCHA, so the workspace and its people exist before the platform turns one on.
    const w = await api.workspace('postcap');
    const watcher = await api.member(w, 'cap-watch', [['record.contacts.read']]);
    const watcherUuid = await api.userUuid(watcher.userId);
    await withProvider(async () => {
      const form = await api.liveForm(w.admin, {
        settings: {
          captchaMode: 'on',
          notify: { owner: false, userIds: [watcherUuid], emails: [] },
        },
      });
      const email = fresh('cap');
      const body = { answers: { name: 'Katherine Johnson', email } };
      expect((await api.submit(form.publicKey, body)).body.code).toBe('AUTH_CAPTCHA_FAILED');
      expect((await api.submit(form.publicKey, { ...body, captchaToken: 'bad' })).body.code).toBe(
        'AUTH_CAPTCHA_FAILED',
      );
      expect(await api.submissions(w.orgId, form.id)).toHaveLength(0);
      expect(await api.eventsOfType(w.orgId, 'form.submitted')).toHaveLength(0);

      const ok = await api.submit(form.publicKey, { ...body, captchaToken: h.captchaValid.token });
      expect(ok.status).toBe(201);
      expect(await api.contactByEmail(w.orgId, email)).toBeTruthy();
      expect(await api.eventsOfType(w.orgId, 'form.submitted')).toHaveLength(1);
    });
  });
});

describe('the hidden trap and the spam bin are visible to the people who run the forms', () => {
  it('counts what the trap dropped and what is held as spam, and a released submission leaves the held count', async () => {
    const w = await api.workspace('postspam');
    const form = await api.liveForm(w.admin);
    const zero = (await api.as(w.admin).get('/v2/forms/meta/protection')).body;
    expect(zero).toMatchObject({ blockedThisMonth: 0, heldAsSpam: 0 });

    // a bot fills the trap: silent success, counted
    await api.submit(form.publicKey, {
      answers: { name: 'Bot', email: fresh('bot') },
      hp: 'http://spam.example',
    });
    await api.submit(form.publicKey, {
      answers: { name: 'Bot2', email: fresh('bot') },
      hp: 'x',
    });
    // a spammy human-looking one is stored, held
    const spam = await api.submit(form.publicKey, {
      answers: {
        name: 'Seo Guy',
        email: fresh('seo'),
        note: 'We offer cheap SEO services and backlinks, visit https://spam.example and http://other.example today',
      },
    });
    expect(spam.status).toBe(201);
    const counted = (await api.as(w.admin).get('/v2/forms/meta/protection')).body;
    expect(counted).toMatchObject({ blockedThisMonth: 2, heldAsSpam: 1 });

    const sub = (await api.submissions(w.orgId, form.id))[0]!;
    const released = await api
      .as(w.admin)
      .post(`/v2/forms/${form.id}/submissions/${sub.uuid}/retry`)
      .send({});
    expect(released.status).toBe(200);
    const after = (await api.as(w.admin).get('/v2/forms/meta/protection')).body;
    expect(after).toMatchObject({ blockedThisMonth: 2, heldAsSpam: 0 });
  });

  it('is per workspace: another workspace sees none of it', async () => {
    const a = await api.workspace('postiso-a');
    const b = await api.workspace('postiso-b');
    const form = await api.liveForm(a.admin);
    await api.submit(form.publicKey, { answers: { name: 'Bot', email: fresh('b') }, hp: 'x' });
    expect((await api.as(a.admin).get('/v2/forms/meta/protection')).body.blockedThisMonth).toBe(1);
    expect((await api.as(b.admin).get('/v2/forms/meta/protection')).body.blockedThisMonth).toBe(0);
  });

  it('spam tells nobody until a person releases it; then the notification arrives and its link opens that submission', async () => {
    const w = await api.workspace('postrelease');
    const watcher = await api.member(w, 'rel-watch', [['record.contacts.read']]);
    const form = await api.liveForm(w.admin, {
      settings: {
        notify: { owner: false, userIds: [await api.userUuid(watcher.userId)], emails: [] },
      },
    });
    await api.submit(form.publicKey, {
      answers: {
        name: 'Seo Guy',
        email: fresh('seo'),
        note: 'We offer cheap SEO services and backlinks, visit https://spam.example and http://other.example today',
      },
    });
    const registry = new OutboxSubscriberRegistry();
    new FormNotificationConsumer(
      h.app.get(DatabaseService),
      new NotificationsRepository(),
      registry,
      h.redis,
      h.app.get(ConfigService),
      h.app.get<MailPort>(MAIL_PORT, { strict: false }),
    ).onModuleInit();
    const deliver = async () => {
      const res = await h.owner.query(
        `SELECT id, org_id, aggregate_module, aggregate_id, event_type, payload FROM event_outbox
         WHERE org_id = $1 AND event_type IN ('form.submitted', 'form.needs_review') ORDER BY id`,
        [w.orgId],
      );
      for (const r of res.rows) {
        const event: OutboxEvent = {
          id: String(r.id),
          orgId: Number(r.org_id),
          aggregateModule: r.aggregate_module,
          aggregateId: String(r.aggregate_id),
          eventType: r.event_type,
          payload: r.payload,
        };
        await registry.dispatch(event);
      }
    };
    const notes = () =>
      api.rows(
        w.orgId,
        `SELECT * FROM inbox_notifications WHERE org_id = $1 AND user_id = $2 ORDER BY id`,
        [watcher.userId],
      );
    await deliver();
    expect(await notes()).toHaveLength(0);

    const sub = (await api.submissions(w.orgId, form.id))[0]!;
    await api.as(w.admin).post(`/v2/forms/${form.id}/submissions/${sub.uuid}/retry`).send({});
    await deliver();
    const [note] = await notes();
    expect(note).toMatchObject({
      type: 'form_submission',
      link: `/forms/${form.id}/submissions?submission=${sub.uuid}`,
    });
    // the screen opens the submission named by that link: this is the call it makes
    const opened = await api.as(w.admin).get(`/v2/forms/${form.id}/submissions/${sub.uuid}`);
    expect(opened.status).toBe(200);
    expect(opened.body).toMatchObject({ id: sub.uuid, status: 'created' });
  });
});

describe('consent, from the visitor to the contact to the people who read it', () => {
  const consentForm = (w: Tenant, over: Record<string, unknown> = {}) =>
    api.liveForm(w.admin, {
      definition: contactDefinition({
        consent: {
          enabled: true,
          text: 'I agree to be contacted about my request.',
          required: true,
          marketing: true,
          version: 1,
          privacyUrl: 'https://example.com/privacy',
          ...over,
        },
      }),
    });

  it('a ticked box is stored with the exact wording, version and time, subscribes the contact, and staff can read all of it', async () => {
    const w = await api.workspace('postconsent');
    const form = await consentForm(w);
    const email = fresh('consent');
    const pub = await api.publicGet(form.publicKey);
    expect(pub.body.consent).toMatchObject({
      enabled: true,
      text: 'I agree to be contacted about my request.',
      required: true,
      version: 1,
      privacyUrl: 'https://example.com/privacy',
    });
    const ok = await api.submit(form.publicKey, {
      answers: { name: 'Mary Jackson', email },
      consent: { given: true, textVersion: 1 },
    });
    expect(ok.status).toBe(201);
    const contact = await api.contactByEmail(w.orgId, email);
    expect(contact).toMatchObject({ email_subscription_status: 'subscribed' });

    const sub = (await api.submissions(w.orgId, form.id))[0]!;
    const detail = await api.as(w.admin).get(`/v2/forms/${form.id}/submissions/${sub.uuid}`);
    expect(detail.body.consentGiven).toBe(true);
    expect(detail.body.consent).toMatchObject({
      given: true,
      text: 'I agree to be contacted about my request.',
      version: 1,
    });
    expect(typeof detail.body.consent.at).toBe('string');
  });

  it('a required box left unticked is refused with the field named, and nothing is stored or announced', async () => {
    const w = await api.workspace('postconsent2');
    const form = await consentForm(w);
    const res = await api.submit(form.publicKey, {
      answers: { name: 'No Box', email: fresh('nb') },
      consent: { given: false, textVersion: 1 },
    });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('consent');
    expect(await api.submissions(w.orgId, form.id)).toHaveLength(0);
    expect(await api.eventsOfType(w.orgId, 'form.submitted')).toHaveLength(0);
  });

  it('an optional box left unticked still lands the contact but never subscribes them', async () => {
    const w = await api.workspace('postconsent3');
    const form = await consentForm(w, { required: false });
    const email = fresh('opt');
    const res = await api.submit(form.publicKey, {
      answers: { name: 'Optional', email },
      consent: { given: false, textVersion: 1 },
    });
    expect(res.status).toBe(201);
    const contact = await api.contactByEmail(w.orgId, email);
    expect(contact).toBeTruthy();
    expect(contact!.email_subscription_status ?? null).not.toBe('subscribed');
  });
});
