import {
  complianceChecklistSchema,
  dncAddResultSchema,
  dncListSchema,
  type AddDncInput,
  type ImportDncInput,
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
  dnc: (query: { q?: string; cursor?: string; limit?: number }, signal?: AbortSignal) =>
    apiFetch(`${BASE}/dnc`, { schema: dncListSchema, signal, query }),
  addDnc: (input: AddDncInput) =>
    apiFetch(`${BASE}/dnc`, { method: 'POST', body: input, schema: dncAddResultSchema }),
  importDnc: (input: ImportDncInput) =>
    apiFetch(`${BASE}/dnc/import`, { method: 'POST', body: input, schema: dncAddResultSchema }),
  removeDnc: (id: string) => apiFetch(`${BASE}/dnc/${enc(id)}`, { method: 'DELETE' }),
};
