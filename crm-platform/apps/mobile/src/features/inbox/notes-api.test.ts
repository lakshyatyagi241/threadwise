import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { CONVERSATION_ID } from '@/test/inbox-fixtures';
import { addNote, deleteNote, fetchEvents, fetchNotes } from './notes-api';

const NOTE_ID = 'bbbbbbbb-0000-4000-8000-000000000001';
const note = {
  id: NOTE_ID,
  conversationId: CONVERSATION_ID,
  author: { userId: null, name: 'Asha Verma' },
  body: 'Call back tomorrow',
  mentions: [],
  isPinned: false,
  editedAt: null,
  createdAt: '2026-10-11T09:30:00.000Z',
  rowVersion: 1,
};
const page = <T>(data: T[]) => ({ data, page: { nextCursor: null, hasMore: false, limit: 100 } });

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('inbox notes and timeline api', () => {
  it('reads the notes and the events of a conversation', async () => {
    const http = mockFetch(
      jsonResponse(200, page([note])),
      jsonResponse(
        200,
        page([
          {
            id: 'cccccccc-0000-4000-8000-000000000001',
            conversationId: CONVERSATION_ID,
            type: 'assigned',
            actor: { kind: 'user', userId: null, name: 'Asha Verma' },
            payload: {},
            createdAt: '2026-10-11T09:30:00.000Z',
          },
        ]),
      ),
    );
    await expect(fetchNotes(CONVERSATION_ID)).resolves.toMatchObject({
      data: [{ body: 'Call back tomorrow' }],
    });
    await expect(fetchEvents(CONVERSATION_ID)).resolves.toMatchObject({
      data: [{ type: 'assigned' }],
    });
    expect(http.calls[0]?.url).toContain(
      `/v2/inbox/conversations/${CONVERSATION_ID}/notes?limit=100`,
    );
    expect(http.calls[1]?.url).toContain(
      `/v2/inbox/conversations/${CONVERSATION_ID}/events?limit=100`,
    );
  });

  it('adds a note with an idempotency key, and deletes one', async () => {
    const http = mockFetch(jsonResponse(201, note), jsonResponse(204, null));
    await expect(
      addNote(CONVERSATION_ID, { body: 'Call back tomorrow', mentions: [] }, 'key-1'),
    ).resolves.toMatchObject({ id: NOTE_ID });
    await deleteNote(CONVERSATION_ID, NOTE_ID);
    expect(http.calls.map((c) => [c.init.method, c.url.split('/v2')[1], c.body])).toEqual([
      [
        'POST',
        `/inbox/conversations/${CONVERSATION_ID}/notes`,
        { body: 'Call back tomorrow', mentions: [] },
      ],
      ['DELETE', `/inbox/conversations/${CONVERSATION_ID}/notes/${NOTE_ID}`, undefined],
    ]);
    expect(http.calls[0]?.headers['Idempotency-Key']).toBe('key-1');
  });
});
