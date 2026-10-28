import type { ReactNode } from 'react';
import { GetaFrame } from '@/features/marketing-site-cms/geta/frame';

/** The public site frame: header with mega menus, footer and the platform's own custom code. */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return <GetaFrame>{children}</GetaFrame>;
}
