import {
  complianceChecklistSchema,
  complianceLinksSchema,
  complianceSettingsSchema,
  subprocessorListSchema,
  subprocessorSchema,
  type SubprocessorInput,
  type UpdateComplianceSettingsInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

const BASE = '/compliance';
const enc = encodeURIComponent;

export const complianceApi = {
  settings: (signal?: AbortSignal) =>
    apiFetch(`${BASE}/settings`, { schema: complianceSettingsSchema, signal }),
  saveSettings: (input: UpdateComplianceSettingsInput) =>
    apiFetch(`${BASE}/settings`, {
      method: 'PATCH',
      body: input,
      schema: complianceSettingsSchema,
    }),
  checklist: (signal?: AbortSignal) =>
    apiFetch(`${BASE}/checklist`, { schema: complianceChecklistSchema, signal }),
  links: (signal?: AbortSignal) =>
    apiFetch(`${BASE}/links`, { schema: complianceLinksSchema, signal }),
  subprocessors: (signal?: AbortSignal) =>
    apiFetch(`${BASE}/subprocessors`, { schema: subprocessorListSchema, signal }),
  addSubprocessor: (input: SubprocessorInput) =>
    apiFetch(`${BASE}/subprocessors`, { method: 'POST', body: input, schema: subprocessorSchema }),
  changeSubprocessor: (id: string, input: SubprocessorInput & { rowVersion: number }) =>
    apiFetch(`${BASE}/subprocessors/${enc(id)}`, {
      method: 'PATCH',
      body: input,
      schema: subprocessorSchema,
    }),
  removeSubprocessor: (id: string) =>
    apiFetch(`${BASE}/subprocessors/${enc(id)}`, { method: 'DELETE' }),
};
