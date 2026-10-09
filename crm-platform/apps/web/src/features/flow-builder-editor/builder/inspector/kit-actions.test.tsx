import { describe, expect, it, vi } from 'vitest';
import { KnowledgeBaseActions } from './kit';

// Called as a plain function (to press its button), so the translator hook is stubbed; the rendered wording is covered in forms-channels/forms.test.tsx.
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

describe('KnowledgeBaseActions', () => {
  it('Refresh list is wired to the builder context re-read', () => {
    const refresh = vi.fn();
    const tree = KnowledgeBaseActions({ refresh }) as {
      props: { children: Array<{ type: string; props: { onClick?: () => void } }> };
    };
    const button = tree.props.children.find((c) => c.type === 'button')!;
    button.props.onClick!();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
