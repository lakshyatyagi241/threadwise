import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { contactId, mysteryFile, pageOf, pdfFile } from '@/test/contact-notes-fixtures';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { deleteContactFile, listContactFiles } from './files-api';

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('contact files api', () => {
  it('lists a page of file records with the limit and the cursor', async () => {
    const http = mockFetch(jsonResponse(200, pageOf([pdfFile, mysteryFile], 'cursor-2')));
    const result = await listContactFiles(contactId, { limit: 20, cursor: 'cursor-1' });
    expect(result.data.map((f) => f.fileName)).toEqual(['Price list.pdf', 'scan-001']);
    expect(result.data[1]).toMatchObject({ fileSizeBytes: null, mimeType: null });
    const call = http.calls[0]!;
    const url = new URL(call.url);
    expect(url.pathname).toBe(`/v2/contacts/${contactId}/files`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '20', cursor: 'cursor-1' });
    expect(call.init.method).toBe('GET');
  });

  it('refuses an answer that is not a page of files', async () => {
    mockFetch(jsonResponse(200, { data: [{ fileName: 5 }], page: {} }));
    await expect(listContactFiles(contactId, { limit: 20 })).rejects.toMatchObject({
      code: 'CLIENT_CONTRACT_MISMATCH',
    });
  });

  it('deletes a file record and accepts the empty 204 answer', async () => {
    const http = mockFetch(jsonResponse(204));
    await expect(deleteContactFile(contactId, pdfFile.id)).resolves.toBeUndefined();
    const call = http.calls[0]!;
    expect(new URL(call.url).pathname).toBe(`/v2/contacts/${contactId}/files/${pdfFile.id}`);
    expect(call.init.method).toBe('DELETE');
  });
});
