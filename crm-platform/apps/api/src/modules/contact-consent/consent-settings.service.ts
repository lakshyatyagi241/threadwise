import { HttpStatus, Injectable } from '@nestjs/common';
import {
  CONSENT_SETTINGS_DEFAULTS,
  ERROR_CODES,
  compileConsentKeywords,
  evaluateConsentMessage,
  normaliseConsentText,
  type CompiledKeywords,
  type ConsentSettings,
  type ConsentSettingsValues,
  type TestConsentMessageInput,
  type TestConsentMessageResult,
  type UpdateConsentSettingsInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { ConsentRepository, type SettingsRow } from './consent.repository';
import { setCapped } from '../../common/cache/capped-map';
import { cacheMetrics } from '@crm/observability';

const cache = cacheMetrics('consent_settings');

const MODULE_KEY = 'contact_consent_settings';

/** How long a process keeps a workspace's compiled keyword set. A save invalidates the saving process at once; others within this time. */
export const CONSENT_CACHE_MS = 60_000;
/** At most this many workspaces are remembered per process; the oldest goes first. */
export const CONSENT_SETTINGS_CACHE_MAX = 2_000;

export interface EffectiveConsentSettings extends ConsentSettingsValues {
  compiled: CompiledKeywords;
}

type Config = Partial<
  Pick<
    ConsentSettingsValues,
    'optOutKeywords' | 'optInKeywords' | 'optOutReply' | 'optInReply' | 'footerText'
  >
>;

/** The saved row merged over the defaults: a field never saved is the default, so a new knob needs no data migration. */
export function mergeSettings(row: SettingsRow | null): ConsentSettingsValues {
  const d = CONSENT_SETTINGS_DEFAULTS;
  const c = (row?.config ?? {}) as Config;
  return {
    detectionEnabled: row?.detectionEnabled ?? d.detectionEnabled,
    requireConsentForMarketing: row?.requireConsentForMarketing ?? d.requireConsentForMarketing,
    autoReplyEnabled: row?.autoReplyEnabled ?? d.autoReplyEnabled,
    footerDefaultOn: row?.footerDefaultOn ?? d.footerDefaultOn,
    optOutKeywords: c.optOutKeywords ?? d.optOutKeywords,
    optInKeywords: c.optInKeywords ?? d.optInKeywords,
    optOutReply: c.optOutReply ?? d.optOutReply,
    optInReply: c.optInReply ?? d.optInReply,
    footerText: c.footerText ?? d.footerText,
  };
}

@Injectable()
export class ConsentSettingsService {
  private readonly cache = new Map<number, { at: number; v: EffectiveConsentSettings }>();

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ConsentRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** For the listener and the send paths: cached, no query for a hot message. Works with or without a request context. */
  async effective(orgId: number): Promise<EffectiveConsentSettings> {
    const hit = this.cache.get(orgId);
    if (hit && Date.now() - hit.at < CONSENT_CACHE_MS) {
      cache.hit();
      return hit.v;
    }
    cache.miss();
    const row = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.getSettings(tx, orgId),
    );
    const values = mergeSettings(row);
    const v = {
      ...values,
      compiled: compileConsentKeywords({
        optOut: values.optOutKeywords,
        optIn: values.optInKeywords,
      }),
    };
    setCapped(this.cache, orgId, { at: Date.now(), v }, CONSENT_SETTINGS_CACHE_MAX);
    return v;
  }

  invalidate(orgId: number): void {
    this.cache.delete(orgId);
  }

  async get(): Promise<ConsentSettings> {
    const orgId = RequestContextStore.orgId();
    const row = await this.db.tx((tx) => this.repo.getSettings(tx, orgId));
    return {
      ...mergeSettings(row),
      rowVersion: row?.rowVersion ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async update(input: UpdateConsentSettingsInput): Promise<ConsentSettings> {
    const orgId = RequestContextStore.orgId();
    assertKeywords(input);
    const { rowVersion, ...values } = input;
    await this.db.tx(async (tx) => {
      const before = await this.repo.getSettings(tx, orgId);
      if ((before === null) !== (rowVersion === undefined)) {
        throw AppError.rowVersionConflict('Consent settings');
      }
      const ok = await this.repo.saveSettings(
        tx,
        orgId,
        {
          detectionEnabled: values.detectionEnabled,
          requireConsentForMarketing: values.requireConsentForMarketing,
          autoReplyEnabled: values.autoReplyEnabled,
          footerDefaultOn: values.footerDefaultOn,
          config: {
            optOutKeywords: values.optOutKeywords,
            optInKeywords: values.optInKeywords,
            optOutReply: values.optOutReply,
            optInReply: values.optInReply,
            footerText: values.footerText,
          },
        },
        rowVersion,
      );
      if (!ok) throw AppError.rowVersionConflict('Consent settings');
      const was = mergeSettings(before);
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: orgId,
        action: before ? 'update' : 'insert',
        delta: {
          ...(was.detectionEnabled !== values.detectionEnabled && {
            detectionEnabled: { old: was.detectionEnabled, new: values.detectionEnabled },
          }),
          ...(was.requireConsentForMarketing !== values.requireConsentForMarketing && {
            requireConsentForMarketing: {
              old: was.requireConsentForMarketing,
              new: values.requireConsentForMarketing,
            },
          }),
          ...(was.autoReplyEnabled !== values.autoReplyEnabled && {
            autoReplyEnabled: { old: was.autoReplyEnabled, new: values.autoReplyEnabled },
          }),
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: orgId,
        eventType: 'contact.consent.settings_changed',
        payload: { requireConsentForMarketing: values.requireConsentForMarketing },
      });
    });
    this.invalidate(orgId);
    return this.get();
  }

  /** The "test a message" box: the same rule as the listener, against the saved settings or the unsaved edits. */
  async test(input: TestConsentMessageInput): Promise<TestConsentMessageResult> {
    const s = await this.get();
    return evaluateConsentMessage(input.text, {
      ...s,
      optOutKeywords: input.optOutKeywords ?? s.optOutKeywords,
      optInKeywords: input.optInKeywords ?? s.optInKeywords,
    });
  }

  /** What the composers need: the footer text and its default, the policy switch. Readable by anyone who can compose a send. */
  async composerConfig(): Promise<{
    footerText: Record<string, string>;
    footerDefaultOn: boolean;
    requireConsentForMarketing: boolean;
    optOutKeywords: Record<string, string[]>;
  }> {
    const s = await this.effective(RequestContextStore.orgId());
    return {
      footerText: s.footerText,
      footerDefaultOn: s.footerDefaultOn,
      requireConsentForMarketing: s.requireConsentForMarketing,
      optOutKeywords: s.optOutKeywords,
    };
  }
}

/** A keyword that normalises to nothing (only punctuation) would never match; a list that is empty while detection is on is a mistake. */
function assertKeywords(input: UpdateConsentSettingsInput): void {
  const bad: Array<{ path: string; message: string }> = [];
  for (const [field, map] of [
    ['optOutKeywords', input.optOutKeywords],
    ['optInKeywords', input.optInKeywords],
  ] as const) {
    for (const [lang, words] of Object.entries(map)) {
      words.forEach((w, i) => {
        if (normaliseConsentText(w) === '') {
          bad.push({
            path: `${field}.${lang}.${i}`,
            message: 'A keyword needs at least one letter or digit.',
          });
        }
      });
    }
  }
  const total = Object.values(input.optOutKeywords).reduce((n, l) => n + l.length, 0);
  if (input.detectionEnabled && total === 0) {
    bad.push({
      path: 'optOutKeywords',
      message: 'Keep at least one STOP keyword, or switch detection off.',
    });
  }
  if (bad.length > 0) {
    throw new AppError(
      ERROR_CODES.CONSENT_SETTINGS_INVALID,
      'The keyword lists are not valid.',
      HttpStatus.UNPROCESSABLE_ENTITY,
      bad,
    );
  }
}
