import type { ReactNode } from 'react';
import { FormsProviders } from '@/features/web-forms/components/forms-providers';

/** Shared frame of the Forms screens: the toast region. The app gate (`gates.app`) closes every route below for a workspace without the add-on. */
export default function FormsDomainLayout({ children }: { children: ReactNode }) {
  return <FormsProviders>{children}</FormsProviders>;
}
