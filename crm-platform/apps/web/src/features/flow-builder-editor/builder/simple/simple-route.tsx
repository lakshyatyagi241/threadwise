'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { flowsApi } from '../../api/flows';
import { FLB_KEYS } from '../../api/hooks';
import { SimpleScreen } from './simple-screen';

/**
 * `/flows/simple` and `/flows/simple/<id>`: refuses people without the read key (as the Advanced route does) and, when the
 * platform admin switched the Simple builder off, sends the person to the Advanced one.
 */
export function SimpleRoute({ flowId }: { flowId?: string }) {
  const allowed = useCan('flb.flows.read');
  const router = useRouter();
  const overview = useQuery({
    queryKey: FLB_KEYS.overview,
    queryFn: ({ signal }) => flowsApi.overview(signal),
  });
  const mode = overview.data?.builderMode;
  useEffect(() => {
    if (!allowed) router.replace('/inbox');
    else if (mode === 'advanced')
      router.replace(flowId ? `/flows/builder/${flowId}` : '/flows/builder');
  }, [allowed, mode, flowId, router]);
  if (!allowed || mode === 'advanced') return null;
  return <SimpleScreen flowId={flowId} />;
}
