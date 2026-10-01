import type { ReactNode } from 'react';
import { CatProviders } from '@/features/contacts-attributes-tags/components/cat-providers';

/** Shared frame of the contacts, groups and attributes screens: the toast region. */
export default function ContactsDomainLayout({ children }: { children: ReactNode }) {
  return <CatProviders>{children}</CatProviders>;
}
