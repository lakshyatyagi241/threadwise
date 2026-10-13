import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirect = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ redirect }));

import FaqMovedPage from '../../app/(app)/(faq-knowledge)/faq/[[...path]]/page';

describe('/faq', () => {
  beforeEach(() => redirect.mockReset());

  it('sends an old workspace FAQ link to the flows list instead of a 404', () => {
    FaqMovedPage();
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith('/flows');
  });
});
