import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FormBlock, PublicForm, PublicFormEventInput } from '@crm/contracts';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import { CaptchaService, HtmlSanitizerService } from '../auth';
import { frameAncestorsFor } from './form-origin';
import { notFound, type FormRoute } from './form-lookup.service';
import { HONEYPOT_FIELD } from './form-spam';
import { readDefinition } from './forms.mapper';
import { FormsRepository } from './forms.repository';

/**
 * What the public page, the embed and a visitor's browser read (docs/specs/forms-builder-app.md 7.2): the PUBLISHED version of a form as
 * the page needs to draw it, and the analytics beacon. Never the draft, the owner rule, the notification list, the field bindings or the
 * tags: those are how the workspace works, not what the form shows.
 */
@Injectable()
export class FormPublicService {
  private readonly brand: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly forms: FormsRepository,
    private readonly captcha: CaptchaService,
    private readonly sanitizer: HtmlSanitizerService,
    config: ConfigService<Env, true>,
  ) {
    this.brand = config.get('APP_NAME', { infer: true });
  }

  /** The form as the page draws it, with an ETag for the cache. A paused form is returned `closed` (the page says so). */
  async definition(route: FormRoute): Promise<{ body: PublicForm; etag: string }> {
    const loaded = await this.db.txAs({ orgId: route.orgId, userId: null }, async (tx) => ({
      form: await this.forms.findById(tx, route.orgId, route.formId),
      version:
        route.publishedVersionId === null
          ? undefined
          : await this.forms.findVersionById(tx, route.orgId, route.publishedVersionId),
    }));
    if (!loaded.form || !loaded.version) throw notFound();
    const { form, version } = loaded;
    const def = readDefinition(version.definition);
    const closed = route.status === 'paused';
    const captcha = await this.captcha.publicConfig();
    const s = def.settings;

    const body: PublicForm = {
      key: form.publicKey,
      closed,
      version: version.version,
      title: def.title,
      // Sanitised when it was saved, and again here: the output is what the visitor's browser renders.
      description: def.description ? this.sanitizer.sanitize(def.description) : null,
      steps: closed
        ? []
        : def.steps.map((step) => ({
            ...step,
            blocks: step.blocks.map((b) => this.publicBlock(b)),
          })),
      settings: {
        submitLabel: s.submitLabel,
        successMode: s.successMode,
        locale: s.locale,
        dir: s.dir ?? (s.locale === 'ar' ? 'rtl' : 'ltr'),
      },
      consent: {
        enabled: def.consent.enabled,
        text: def.consent.text,
        privacyUrl: def.consent.privacyUrl,
        required: def.consent.required,
        version: def.consent.version,
      },
      theme: def.theme,
      payment: def.payment.enabled
        ? {
            amountType: def.payment.amountType,
            amountMinor: def.payment.amountMinor,
            fieldId: def.payment.fieldId,
            minMinor: def.payment.minMinor,
            maxMinor: def.payment.maxMinor,
            currency: def.payment.currency,
            description: def.payment.description,
          }
        : null,
      honeypotField: form.honeypot ? HONEYPOT_FIELD : null,
      captcha: {
        required: !closed && form.captchaMode !== 'off' && captcha !== null,
        version: captcha?.version ?? null,
        siteKey: captcha?.siteKey ?? null,
      },
      poweredBy: { show: true, label: this.brand },
      frameAncestors: {
        hosted: frameAncestorsFor(route.allowedOrigins, false),
        embed: frameAncestorsFor(route.allowedOrigins, true),
      },
    };
    const etag = `W/"${createHash('sha1').update(JSON.stringify(body)).digest('base64url').slice(0, 27)}"`;
    return { body, etag };
  }

  /** A block as the page needs it: the CRM binding is the workspace's business and stays out; rich text is sanitised on the way out. */
  private publicBlock(b: FormBlock): FormBlock {
    if (b.type === 'paragraph') return { ...b, html: this.sanitizer.sanitize(b.html) };
    if (b.type === 'field') {
      const out = { ...b };
      delete out.bind;
      return out;
    }
    return b;
  }

  /**
   * The analytics beacon: a view, a start, a step, a submit, a completion. Always answers nothing (204) for a key that does not exist,
   * so the beacon cannot be used to probe keys; a refused origin or a rate limit is still refused. Nothing personal is stored.
   */
  async recordEvent(route: FormRoute, input: PublicFormEventInput): Promise<void> {
    await this.db.txAs({ orgId: route.orgId, userId: null }, (tx) =>
      this.forms.insertEvent(tx, route.orgId, {
        formId: route.formId,
        versionId: route.publishedVersionId,
        visitId: input.visitId,
        kind: input.kind,
        step: input.step ?? null,
      }),
    );
  }
}

/** True for the one "no such form" answer: the beacon swallows it. */
export const isNotFound = (err: unknown): boolean =>
  err instanceof AppError && err.code === ERROR_CODES.NOT_FOUND;
