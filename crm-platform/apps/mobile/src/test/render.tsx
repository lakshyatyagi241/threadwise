import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { i18n } from '@/lib/i18n';

/** Renders a screen or component with the app's language and a fresh query cache that never retries. */
export async function renderApp(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const wrap = (element: ReactElement) => (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>
    </I18nextProvider>
  );
  const view = await render(wrap(ui));
  // `rerender` keeps the same providers around the new element.
  return {
    queryClient,
    ...view,
    rerender: async (next: ReactElement) => await view.rerender(wrap(next)),
  };
}
