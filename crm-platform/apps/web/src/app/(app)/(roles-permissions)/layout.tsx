import type { ReactNode } from 'react';
import { WorkspaceRbacProviders } from '@/features/roles-permissions/workspace/providers';

/** Shared frame of the workspace Team members and Roles screens: the toast region. */
export default function WorkspaceRbacLayout({ children }: { children: ReactNode }) {
  return <WorkspaceRbacProviders>{children}</WorkspaceRbacProviders>;
}
