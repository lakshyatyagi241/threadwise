import type {
  CatalogAutomation,
  CatalogProvider,
  ConnectCatalogInput,
  SaveAutomationInput,
} from '@crm/contracts';
import { isHttpUrl } from './product-form';

/** The pure half of the Setup tab forms: connect (WD-CAT-002) and automation (WD-CAT-006). */

export interface ConnectForm {
  provider: CatalogProvider;
  catalogId: string;
  catalogName: string;
  wabaId: string;
  phoneNumberId: string;
  accessToken: string;
}

export const EMPTY_CONNECT_FORM: ConnectForm = {
  provider: 'meta_cloud',
  catalogId: '',
  catalogName: '',
  wabaId: '',
  phoneNumberId: '',
  accessToken: '',
};

export type ConnectField = 'catalogId' | 'catalogName' | 'wabaId' | 'phoneNumberId' | 'accessToken';
export type ConnectProblem = 'required' | 'tooShort' | 'tooLong';

export function connectProblems(f: ConnectForm): Partial<Record<ConnectField, ConnectProblem>> {
  const out: Partial<Record<ConnectField, ConnectProblem>> = {};
  const id = f.catalogId.trim();
  if (!id) out.catalogId = 'required';
  else if (id.length > 64) out.catalogId = 'tooLong';
  if (f.catalogName.trim().length > 191) out.catalogName = 'tooLong';
  if (f.wabaId.trim().length > 64) out.wabaId = 'tooLong';
  if (f.phoneNumberId.trim().length > 64) out.phoneNumberId = 'tooLong';
  const token = f.accessToken.trim();
  if (!token) out.accessToken = 'required';
  else if (token.length < 20) out.accessToken = 'tooShort';
  else if (token.length > 4096) out.accessToken = 'tooLong';
  return out;
}

const text = (v: string): string | null => (v.trim() ? v.trim() : null);

export function buildConnect(f: ConnectForm): ConnectCatalogInput {
  return {
    provider: f.provider,
    catalogId: f.catalogId.trim(),
    catalogName: text(f.catalogName),
    wabaId: text(f.wabaId),
    phoneNumberId: text(f.phoneNumberId),
    accessToken: f.accessToken.trim(),
  };
}

export const DEFAULT_CONCIERGE_MAX = 10;

export interface AutomationForm {
  orderAckEnabled: boolean;
  orderAckPayUrl: string;
  conciergeEnabled: boolean;
  conciergeHeader: string;
  conciergeMax: string;
  conciergeReplyOnEmpty: boolean;
  conciergeEmptyText: string;
}

export function automationForm(a: CatalogAutomation): AutomationForm {
  return {
    orderAckEnabled: a.orderAckEnabled,
    orderAckPayUrl: a.orderAckPayUrl ?? '',
    conciergeEnabled: a.conciergeEnabled,
    conciergeHeader: a.conciergeHeader ?? '',
    conciergeMax: String(a.conciergeMax),
    conciergeReplyOnEmpty: a.conciergeReplyOnEmpty,
    conciergeEmptyText: a.conciergeEmptyText ?? '',
  };
}

export type AutomationField =
  'orderAckPayUrl' | 'conciergeHeader' | 'conciergeMax' | 'conciergeEmptyText';
export type AutomationProblem = 'badUrl' | 'tooLong' | 'range';

export function automationProblems(
  f: AutomationForm,
): Partial<Record<AutomationField, AutomationProblem>> {
  const out: Partial<Record<AutomationField, AutomationProblem>> = {};
  const url = f.orderAckPayUrl.trim();
  if (url && (url.length > 500 || !isHttpUrl(url)))
    out.orderAckPayUrl = url.length > 500 ? 'tooLong' : 'badUrl';
  if (f.conciergeHeader.trim().length > 60) out.conciergeHeader = 'tooLong';
  if (f.conciergeEmptyText.trim().length > 1024) out.conciergeEmptyText = 'tooLong';
  const max = f.conciergeMax.trim();
  if (max) {
    const n = Number(max);
    if (!Number.isInteger(n) || n < 1 || n > 30) out.conciergeMax = 'range';
  }
  return out;
}

/** Blank text posts null (the consumers fall back to their defaults) and a blank maximum posts 10, as WaDesk did. */
export function buildAutomation(f: AutomationForm): SaveAutomationInput {
  const max = f.conciergeMax.trim();
  return {
    orderAckEnabled: f.orderAckEnabled,
    orderAckPayUrl: text(f.orderAckPayUrl),
    conciergeEnabled: f.conciergeEnabled,
    conciergeHeader: text(f.conciergeHeader),
    conciergeMax: max ? Number(max) : DEFAULT_CONCIERGE_MAX,
    conciergeReplyOnEmpty: f.conciergeReplyOnEmpty,
    conciergeEmptyText: text(f.conciergeEmptyText),
  };
}
