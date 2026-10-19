import { billing, vip } from '@/test/labels-fixtures';
import { DEFAULT_LABEL_COLOR } from '@/lib/theme/tokens';
import {
  EMPTY_LABEL,
  draftOfLabel,
  labelProblems,
  toCreateLabel,
  toUpdateLabel,
} from './label-draft';

describe('labelProblems', () => {
  it('has none for a name and a colour', () => {
    expect(labelProblems({ name: 'VIP', color: '#2563EB', description: '' })).toEqual({});
  });

  it('finds an empty name and a colour the server would refuse', () => {
    expect(labelProblems({ ...EMPTY_LABEL, name: '   ' }).name).toBe('nameEmpty');
    expect(labelProblems({ ...EMPTY_LABEL, name: 'x', color: 'red;' }).color).toBe('colorInvalid');
    expect(labelProblems({ ...EMPTY_LABEL, name: 'x', color: '' }).color).toBe('colorInvalid');
  });

  it('accepts a hex colour, with or without the #, and a colour name', () => {
    for (const color of ['#075E54', '075E54', 'tomato', 'dark-blue']) {
      expect(labelProblems({ name: 'x', color, description: '' })).toEqual({});
    }
  });
});

describe('the request bodies', () => {
  it('builds a create body, leaving the description out when it is empty', () => {
    expect(toCreateLabel({ name: ' VIP ', color: ' #2563EB ', description: '' })).toEqual({
      name: 'VIP',
      color: '#2563EB',
    });
    expect(toCreateLabel({ name: 'VIP', color: '#2563EB', description: 'Premium' })).toMatchObject({
      description: 'Premium',
    });
  });

  it('builds an update body with the version that was read, clearing an emptied description', () => {
    expect(toUpdateLabel(draftOfLabel(vip), vip.rowVersion)).toEqual({
      rowVersion: 2,
      name: 'VIP',
      color: '#2563EB',
      description: 'Customers with a premium plan',
    });
    expect(toUpdateLabel({ ...draftOfLabel(vip), description: '  ' }, 2).description).toBeNull();
  });

  it('starts a label without a colour on the default colour', () => {
    expect(draftOfLabel(billing)).toEqual({
      name: 'Billing',
      color: DEFAULT_LABEL_COLOR,
      description: '',
    });
  });
});
