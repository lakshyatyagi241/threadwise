import {
  workspaceVocabularyResponseSchema,
  type SaveWorkspaceVocabularyInput,
  type WorkspaceVocabularyResponse,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

const BASE = '/persona/vocabulary';

/** "Words we use": the workspace's own names for contact, appointment, deal and meeting (BL-310). Labels only. */
export const vocabularyApi = {
  get: (locale: string, signal?: AbortSignal): Promise<WorkspaceVocabularyResponse> =>
    apiFetch(BASE, { query: { locale }, schema: workspaceVocabularyResponseSchema, signal }),
  save: (
    locale: string,
    input: SaveWorkspaceVocabularyInput,
  ): Promise<WorkspaceVocabularyResponse> =>
    apiFetch(BASE, {
      method: 'PUT',
      query: { locale },
      body: input,
      schema: workspaceVocabularyResponseSchema,
    }),
};
