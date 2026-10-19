import { thanks } from '@/test/quick-replies-fixtures';
import {
  EMPTY_DRAFT,
  draftOf,
  draftProblems,
  insertAtSelection,
  limitState,
  previewOf,
  toCreateInput,
  toUpdateInput,
} from './quick-reply-draft';

const valid = { ...EMPTY_DRAFT, shortcut: 'Thank You', title: ' Thanks ', body: ' Hello ' };

describe('draftProblems', () => {
  it('has none for a draft with a shortcut, a title and a text', () => {
    expect(draftProblems(valid)).toEqual({});
  });

  it('finds each empty field, counting a shortcut with nothing a shortcut can be made of as empty', () => {
    expect(draftProblems(EMPTY_DRAFT)).toEqual({
      shortcut: 'shortcutEmpty',
      title: 'titleEmpty',
      body: 'bodyEmpty',
    });
    expect(draftProblems({ ...valid, shortcut: '///' }).shortcut).toBe('shortcutEmpty');
  });

  it('finds a title and a text that are too long', () => {
    expect(draftProblems({ ...valid, title: 'a'.repeat(129) }).title).toBe('titleLong');
    expect(draftProblems({ ...valid, body: 'a'.repeat(4001) }).body).toBe('bodyLong');
  });

  it('accepts a language code such as en or pt-BR, and nothing else', () => {
    expect(draftProblems({ ...valid, language: 'pt-BR' })).toEqual({});
    expect(draftProblems({ ...valid, language: 'english please' }).language).toBe('languageFormat');
    expect(draftProblems({ ...valid, language: '' })).toEqual({});
  });
});

describe('the request bodies', () => {
  it('builds a create body with the shortcut as the server stores it and empty optional fields as null', () => {
    expect(toCreateInput(valid)).toEqual({
      shortcut: 'thank_you',
      title: 'Thanks',
      body: 'Hello',
      category: null,
      language: null,
      channelKinds: [],
      scope: 'shared',
    });
  });

  it('builds an update body with the version that was read and no scope', () => {
    const body = toUpdateInput({ ...draftOf(thanks), title: 'Changed' }, 3);
    expect(body).toMatchObject({
      rowVersion: 3,
      title: 'Changed',
      shortcut: 'thanks',
      channelKinds: ['whatsapp_cloud'],
    });
    expect(body).not.toHaveProperty('scope');
  });

  it('turns a saved reply into a draft, with empty strings for what is missing', () => {
    expect(draftOf({ ...thanks, category: null, language: null })).toMatchObject({
      category: '',
      language: '',
    });
  });
});

describe('previewOf', () => {
  it('fills the catalogue variables with sample customer data and leaves an unknown one as written', () => {
    const { text, issues } = previewOf('Hi {{first_name}}, ref {{order_no}}');
    expect(text).toBe('Hi Amira, ref {{order_no}}');
    expect(issues.map((i) => i.token)).toEqual(['{{order_no}}']);
  });
});

describe('insertAtSelection', () => {
  it('puts the text at the cursor and moves the cursor after it', () => {
    expect(insertAtSelection('Hi , bye', { start: 3, end: 3 }, '{{name}}')).toEqual({
      value: 'Hi {{name}}, bye',
      caret: 11,
    });
  });

  it('replaces a selection, whichever way it was dragged', () => {
    expect(insertAtSelection('Hi XX bye', { start: 5, end: 3 }, 'Y')).toEqual({
      value: 'Hi Y bye',
      caret: 4,
    });
  });
});

describe('limitState', () => {
  it('is none without a limit, then ok, near (80%) and reached', () => {
    expect(limitState(500, null)).toBe('none');
    expect(limitState(7, 10)).toBe('ok');
    expect(limitState(8, 10)).toBe('near');
    expect(limitState(10, 10)).toBe('reached');
    expect(limitState(11, 10)).toBe('reached');
  });
});
