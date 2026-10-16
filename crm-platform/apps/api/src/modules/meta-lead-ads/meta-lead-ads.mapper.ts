import type {
  FacebookPage,
  MetaLeadForm,
  MetaLeadPage,
  MetaLeadQuestion,
  MetaLeadSourceHealth,
} from '@crm/contracts';
import type {
  LeadForm,
  LeadFormQuestion,
} from '../../infra/providers/meta-lead-ads/meta-lead-ads.port';
import type { FacebookPageRow } from '../channel-facebook';
import type { FormRow, PageStateRow } from './meta-lead-ads.repository';
import { leadAccessOf, suggestTarget, syncStateOf } from './meta-lead-rules';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** A connected Page as the lead ads screen shows it: the channel's facts plus lead access and the sync state. */
export function toPageView(
  fb: FacebookPageRow,
  state: PageStateRow | undefined,
  formsConnected: number,
): MetaLeadPage {
  const { access, missing } = leadAccessOf(fb.scopes);
  const enabled = state?.enabled === true;
  return {
    id: fb.uuid,
    pageId: fb.pageId,
    name: fb.name,
    pictureUrl: fb.pictureUrl,
    pageStatus: fb.status as FacebookPage['status'],
    leadAccess: access,
    missingScopes: missing,
    sync: {
      enabled,
      state: syncStateOf({
        enabled,
        pageStatus: fb.status,
        access,
        lastError: state?.lastError ?? null,
        lastErrorKind: state?.lastErrorKind ?? null,
      }),
      subscribedAt: iso(state?.subscribedAt ?? null),
      lastLeadAt: iso(state?.lastLeadAt ?? null),
      lastSweepAt: iso(state?.lastSweepAt ?? null),
      lastError: enabled ? (state?.lastError ?? null) : null,
      formsConnected,
    },
  };
}

const toQuestion = (q: LeadFormQuestion): MetaLeadQuestion => ({
  key: q.key,
  label: q.label,
  type: q.type,
  suggestedTarget: suggestTarget(q.type, q.key),
});

/** A form read from Meta, with what this workspace holds of it (the source it feeds, its health). */
export function toFormView(f: LeadForm, ours: FormRow | undefined): MetaLeadForm {
  return {
    formId: f.id,
    name: f.name,
    status: f.status,
    locale: f.locale,
    leadsCount: f.leadsCount,
    createdTime: f.createdTime,
    questions: f.questions.map(toQuestion),
    hasConsentCheckbox: f.checkboxes.length > 0,
    connected: ours !== undefined,
    sourceId: ours?.sourceUuid ?? null,
    lastLeadAt: iso(ours?.lastLeadAt ?? null),
    lastError: ours?.lastError ?? null,
  };
}

/** A picked form Meta no longer lists (deleted there): shown from what was cached, so the admin can see it and disconnect it. */
export function toFormViewFromRow(r: FormRow): MetaLeadForm {
  return {
    formId: r.formId,
    name: r.name,
    status: 'DELETED',
    locale: r.locale,
    leadsCount: null,
    createdTime: null,
    questions: r.questions.map(toQuestion),
    hasConsentCheckbox: r.checkboxes.length > 0,
    connected: true,
    sourceId: r.sourceUuid,
    lastLeadAt: iso(r.lastLeadAt),
    lastError: r.lastError,
  };
}

export const NOT_A_META_SOURCE: MetaLeadSourceHealth = {
  connected: false,
  pageId: null,
  pageName: null,
  formId: null,
  formName: null,
  pageRef: null,
  leadAccess: null,
  state: null,
  subscribed: false,
  lastLeadAt: null,
  lastError: null,
};
